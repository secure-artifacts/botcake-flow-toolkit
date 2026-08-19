import React from "react";
import { createRoot } from "react-dom/client";
import { TemplateEditorApp } from "./TemplateEditorApp";
import "@xyflow/react/dist/style.css";
import "./style.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><TemplateEditorApp /></React.StrictMode>);
