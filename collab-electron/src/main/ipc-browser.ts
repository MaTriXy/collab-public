import {
  ipcMain,
  webContents as webContentsModule,
} from "electron";
import { cdpSend } from "./cdp";

function getWc(webContentsId: number) {
  const wc = webContentsModule.fromId(webContentsId);
  if (!wc || wc.isDestroyed()) {
    throw new Error("Browser tile not found");
  }
  return wc;
}

export function registerBrowserIpc(): void {

  ipcMain.handle(
    "browser:navigate",
    async (_event, { webContentsId, url }: {
      webContentsId: number; url: string;
    }) => {
      const wc = getWc(webContentsId);
      await wc.loadURL(url);
      return { url: wc.getURL() };
    },
  );

  ipcMain.handle(
    "browser:screenshot",
    async (_event, { webContentsId }: {
      webContentsId: number;
    }) => {
      const wc = getWc(webContentsId);
      const image = await wc.capturePage();
      return { data: image.toPNG().toString("base64") };
    },
  );

  ipcMain.handle(
    "browser:snapshot",
    async (_event, { webContentsId }: {
      webContentsId: number;
    }) => {
      const result = await cdpSend(
        webContentsId,
        "DOM.getDocument",
        { depth: -1, pierce: true },
      );
      return result;
    },
  );

  ipcMain.handle(
    "browser:click",
    async (_event, { webContentsId, selector }: {
      webContentsId: number; selector: string;
    }) => {
      const doc = await cdpSend(
        webContentsId,
        "DOM.getDocument",
      ) as { root: { nodeId: number } };
      const found = await cdpSend(
        webContentsId,
        "DOM.querySelector",
        { nodeId: doc.root.nodeId, selector },
      ) as { nodeId: number };
      if (!found.nodeId) {
        throw new Error(`Element not found: ${selector}`);
      }
      const box = await cdpSend(
        webContentsId,
        "DOM.getBoxModel",
        { nodeId: found.nodeId },
      ) as { model: { content: number[] } };
      const quad = box.model.content;
      const x = (quad[0]! + quad[2]!) / 2;
      const y = (quad[1]! + quad[5]!) / 2;
      await cdpSend(
        webContentsId,
        "Input.dispatchMouseEvent",
        {
          type: "mousePressed",
          x,
          y,
          button: "left",
          clickCount: 1,
        },
      );
      await cdpSend(
        webContentsId,
        "Input.dispatchMouseEvent",
        {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          clickCount: 1,
        },
      );
      return {};
    },
  );

  ipcMain.handle(
    "browser:type",
    async (_event, { webContentsId, selector, text }: {
      webContentsId: number; selector: string; text: string;
    }) => {
      const doc = await cdpSend(
        webContentsId,
        "DOM.getDocument",
      ) as { root: { nodeId: number } };
      const found = await cdpSend(
        webContentsId,
        "DOM.querySelector",
        { nodeId: doc.root.nodeId, selector },
      ) as { nodeId: number };
      if (!found.nodeId) {
        throw new Error(`Element not found: ${selector}`);
      }
      await cdpSend(webContentsId, "DOM.focus", {
        nodeId: found.nodeId,
      });
      await cdpSend(
        webContentsId,
        "Input.insertText",
        { text },
      );
      return {};
    },
  );
}
