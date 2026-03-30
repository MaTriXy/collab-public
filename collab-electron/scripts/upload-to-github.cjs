#!/usr/bin/env node

// Upload build artifacts to GitHub Releases.
// Requires GH_TOKEN or GITHUB_TOKEN environment variable.

const { Octokit } = require("@octokit/rest");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Load .env.local so GH_TOKEN can live alongside other credentials.
const envLocalPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envLocalPath)) {
  for (const line of fs.readFileSync(envLocalPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (key && rest.length > 0 && !(key.trim() in process.env)) {
      process.env[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
}

const pkg = require("../package.json");
const version = pkg.version;
const product = pkg.build.productName;
const owner = pkg.build.publish[0].owner;
const repo = pkg.build.publish[0].repo;

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error("No GitHub token. Set GH_TOKEN or GITHUB_TOKEN.");
  process.exit(1);
}

const distDir = path.join(__dirname, "..", pkg.build.directories.output);

function sha512Base64(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha512").update(buf).digest("base64");
}

function resolveArtifact(label, artifactPath, optional) {
  const resolved = path.resolve(artifactPath);
  if (!fs.existsSync(resolved)) {
    if (optional) return null;
    throw new Error(`${label} not found: ${resolved}`);
  }
  return resolved;
}

// Discover Mac zips in dist/ and regenerate latest-mac.yml listing all of them.
// electron-builder's PublishManager.awaitTasks() may overwrite the yml
// after the build, so regenerate it from the actual zips on disk.
// Supports --arch to limit which architectures are uploaded.
function regenerateMacYml() {
  const defaultArches = ["arm64", "x64"];
  const arches = parseMacArches(defaultArches);

  const zipEntries = [];
  for (const arch of arches) {
    const zipName = `${product}-${version}-${arch}-mac.zip`;
    const zipPath = path.join(distDir, zipName);
    if (!fs.existsSync(zipPath)) {
      console.warn(`Skipping ${arch} — ${zipName} not found in dist/`);
      continue;
    }
    zipEntries.push({ arch, zipName, zipPath });
  }

  if (zipEntries.length === 0) {
    throw new Error(
      `No Mac zips found in ${distDir} for architectures: ${arches.join(", ")}`,
    );
  }

  // Build latest-mac.yml with all discovered zips.
  const filesLines = [];
  for (const { zipName, zipPath } of zipEntries) {
    const stats = fs.statSync(zipPath);
    const hash = sha512Base64(zipPath);
    const blockmapPath = zipPath + ".blockmap";
    const blockMapSize = fs.existsSync(blockmapPath)
      ? fs.statSync(blockmapPath).size
      : 0;
    const blockMapLine =
      blockMapSize > 0 ? `\n    blockMapSize: ${blockMapSize}` : "";
    filesLines.push(
      `  - url: ${zipName}`,
      `    sha512: ${hash}`,
      `    size: ${stats.size}${blockMapLine}`,
    );
  }

  // Top-level path/sha512 point to the first entry (electron-updater fallback).
  const primary = zipEntries[0];
  const primaryHash = sha512Base64(primary.zipPath);

  const ymlPath = path.join(distDir, "latest-mac.yml");
  const yml = [
    `version: ${version}`,
    "files:",
    ...filesLines,
    `path: ${primary.zipName}`,
    `sha512: ${primaryHash}`,
    `releaseDate: '${new Date().toISOString()}'`,
    "",
  ].join("\n");

  fs.writeFileSync(ymlPath, yml);
  console.log(
    `Regenerated latest-mac.yml (${zipEntries.map((e) => e.arch).join(", ")})`,
  );

  const list = [{ label: "latest-mac.yml", path: ymlPath }];
  for (const { arch, zipName, zipPath } of zipEntries) {
    list.push({ label: `ZIP (${arch})`, path: resolveArtifact(`ZIP (${arch})`, zipPath) });
    const bm = resolveArtifact(`Blockmap (${arch})`, zipPath + ".blockmap", true);
    if (bm) {
      list.push({ label: `Blockmap (${arch})`, path: bm });
    } else {
      console.warn(`No blockmap for ${arch} — delta updates disabled for ${zipName}`);
    }
  }
  return list;
}

function parseMacArches(defaultArches) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--arch" && args[i + 1]) {
      return args[i + 1].split(",");
    }
  }
  return defaultArches;
}

function collectWindowsArtifacts() {
  // Disk filename has spaces; electron-builder publishes with hyphens.
  // latest.yml references the hyphenated name, so uploads must match.
  const diskName = `${product} Setup ${version}.exe`;
  const uploadName = `${product}-Setup-${version}.exe`;
  const exePath = path.join(distDir, diskName);
  const list = [
    { label: "Installer", path: resolveArtifact("Installer", exePath), uploadName },
  ];
  const bm = resolveArtifact("Blockmap", exePath + ".blockmap", true);
  if (bm) list.push({ label: "Blockmap", path: bm, uploadName: uploadName + ".blockmap" });
  const yml = resolveArtifact("latest.yml", path.join(distDir, "latest.yml"), true);
  if (yml) list.push({ label: "latest.yml", path: yml });
  const sums = resolveArtifact("SHA256SUMS", path.join(distDir, "SHA256SUMS.txt"), true);
  if (sums) list.push({ label: "SHA256SUMS", path: sums });
  return list;
}

const artifacts = (() => {
  try {
    if (process.platform === "darwin") {
      return regenerateMacYml();
    }
    return collectWindowsArtifacts();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
})();

const octokit = new Octokit({ auth: token });

async function uploadAsset(release, assetPath, uploadName) {
  const fileName = uploadName || path.basename(assetPath);
  const existing = release.assets.find((a) => a.name === fileName);

  if (existing) {
    console.log(`Replacing existing asset ${fileName}...`);
    await octokit.repos.deleteReleaseAsset({
      owner,
      repo,
      asset_id: existing.id,
    });
  }

  const stats = fs.statSync(assetPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`Uploading ${fileName} (${sizeMB} MB)...`);

  await octokit.repos.uploadReleaseAsset({
    owner,
    repo,
    release_id: release.id,
    name: fileName,
    data: fs.readFileSync(assetPath),
    headers: {
      "content-length": stats.size,
      "content-type": fileName.endsWith(".yml")
        ? "text/x-yaml"
        : "application/octet-stream",
    },
  });

  console.log(`Uploaded ${fileName}`);
}

async function main() {
  const tag = `v${version}`;
  console.log(`Uploading to ${owner}/${repo} ${tag}`);

  let release;
  let wasDraft = true;
  try {
    const { data } = await octokit.repos.getReleaseByTag({
      owner,
      repo,
      tag,
    });
    release = data;
    wasDraft = release.draft;
    console.log(`Found existing release: ${release.name || tag}`);

    if (!wasDraft) {
      console.log("Converting to draft while uploading...");
      await octokit.repos.updateRelease({
        owner,
        repo,
        release_id: release.id,
        draft: true,
      });
    }
  } catch (err) {
    if (err.status === 404) {
      console.log(`Creating draft release ${tag}...`);
      const { data } = await octokit.repos.createRelease({
        owner,
        repo,
        tag_name: tag,
        name: `Collaborator ${version}`,
        draft: true,
        prerelease: false,
      });
      release = data;
      console.log(`Created draft release: ${release.html_url}`);
    } else {
      throw err;
    }
  }

  for (const artifact of artifacts) {
    await uploadAsset(release, artifact.path, artifact.uploadName);
  }

  if (!wasDraft) {
    console.log("Re-publishing release...");
    await octokit.repos.updateRelease({
      owner,
      repo,
      release_id: release.id,
      draft: false,
    });
  }

  console.log(`\nUploaded to ${release.html_url}`);
  console.log(
    wasDraft
      ? "Review and publish the draft release when ready."
      : "Release re-published.",
  );
}

main().catch((err) => {
  console.error("Upload failed:", err.message);
  if (err.response) console.error("Response:", err.response.data);
  process.exit(1);
});
