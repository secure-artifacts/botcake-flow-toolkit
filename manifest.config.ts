import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Botcake 流程助手",
  description: "从结构化模板制作、校验并替换 Botcake Flow。",
  version: "1.0.1",
  icons: {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  },
  action: {
    default_title: "Botcake 流程助手",
    default_popup: "src/scopes/popup/index.html",
    default_icon: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },
  },
  background: {
    service_worker: "src/scopes/background/index.ts",
    type: "module",
  },
  options_ui: {
    page: "src/scopes/options/index.html",
    open_in_tab: true,
  },
  permissions: ["storage", "downloads", "scripting"],
  host_permissions: [
    "https://botcake.io/*",
    "https://docs.google.com/*",
    "https://drive.google.com/*",
    "https://drive.usercontent.google.com/*",
    "https://lh3.googleusercontent.com/*",
    "https://content.pancake.vn/*",
  ],
  content_scripts: [
    {
      matches: ["https://botcake.io/*"],
      js: ["src/scopes/injects/botcake-main.entry.ts"],
      run_at: "document_idle",
      world: "MAIN",
    },
    {
      matches: ["https://botcake.io/*"],
      js: ["src/scopes/content/index.tsx"],
      run_at: "document_idle",
    },
  ],
});
