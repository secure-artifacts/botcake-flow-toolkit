import React from "react";
import { createRoot } from "react-dom/client";
import { LauncherShell } from "./LauncherShell";
import css from "./style.css?inline";

const HOST_ID = "botcake-flow-toolkit-host";

if (!document.getElementById(HOST_ID)) {
  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  shadow.append(style, root);
  createRoot(root).render(<React.StrictMode><LauncherShell /></React.StrictMode>);
}
