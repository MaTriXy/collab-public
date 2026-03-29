const fs = require("node:fs");
const path = require("node:path");

function loadEnvLocal() {
  const envLocalPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envLocalPath)) return;
  const content = fs.readFileSync(envLocalPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (key && rest.length > 0 && !(key.trim() in process.env)) {
      process.env[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
}

module.exports = async function notarizeIfNeeded(context) {
  if (process.platform !== "darwin") return;
  if (process.env.SKIP_NOTARIZE === "true") return;

  loadEnvLocal();

  const keychainProfile = process.env.KEYCHAIN_PROFILE;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword =
    process.env.APPLE_ID_PASSWORD ||
    process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const appleTeamId = process.env.APPLE_TEAM_ID;

  if (!keychainProfile && !(appleId && appleIdPassword && appleTeamId)) {
    return;
  }

  const { notarize } = require("@electron/notarize");
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;

  await notarize({
    appBundleId: packager.appInfo.id,
    appPath: path.join(appOutDir, `${appName}.app`),
    ...(keychainProfile
      ? { keychainProfile }
      : {
          appleId,
          appleIdPassword,
          teamId: appleTeamId,
        }),
  });
};
