import { useEffect, useMemo, useState, type HTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { loadTemplateArchive } from "../../core/archive";
import { normalizePublicDriveUrl, parseCatalogCsv, sheetUrlToCsv } from "../../core/catalog";
import {
  extractPageSettingsTemplate,
  parsePageSettingsTemplate,
  serializePageSettingsTemplate,
  templateToUpdatePayload,
} from "../../core/page-settings-template";
import type { CatalogRow, ImportInputValue, LoadedTemplate, PageAutomationState } from "../../shared/types";
import { callMain, downloadBytes, fetchBytes, fetchCatalog, fetchText } from "./bridge";
import { savePendingFlowApply } from "./pending-flow-apply";
import { countMissingRequired, initialInputValues, TemplateInputControl } from "./TemplateInputControl";

type Notice = { kind: "info" | "success" | "error"; text: string };
type FlowApplyTarget = "comment" | "defaultReply";

export function PageAssistant({ pageId, onClose, style, dragProps }: { pageId: string; onClose: () => void; style: CSSProperties; dragProps: HTMLAttributes<HTMLElement> }) {
  const [state, setState] = useState<PageAutomationState>();
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<Notice>({ kind: "info", text: "正在读取专页和资源目录…" });
  const [applyWelcome, setApplyWelcome] = useState(true);
  const [loaded, setLoaded] = useState<LoadedTemplate>();
  const [archiveBytes, setArchiveBytes] = useState<Uint8Array>();
  const [values, setValues] = useState<Record<string, ImportInputValue>>({});
  const [view, setView] = useState<"home" | "inputs">("home");
  const [flowTarget, setFlowTarget] = useState<FlowApplyTarget>("comment");

  useEffect(() => { void initialize(); }, [pageId]);

  const settingsRows = useMemo(() => catalog.filter((row) => row.kind === "settings"), [catalog]);
  const flowRows = useMemo(() => catalog.filter((row) => row.kind === "flow"), [catalog]);
  const defaultReplyRows = useMemo(() => catalog.filter((row) => row.kind === "defaultReply"), [catalog]);
  const missingRequired = loaded ? countMissingRequired(loaded.template, values) : 0;

  async function initialize() {
    await run("读取专页", async () => {
      const stored = await chrome.storage.local.get(["catalogSheetUrl", "applyWelcomeWithCommentFlow"]);
      setApplyWelcome(stored.applyWelcomeWithCommentFlow !== false);
      const [nextState, rows] = await Promise.all([
        readPageStateWithRetry(),
        typeof stored.catalogSheetUrl === "string" && stored.catalogSheetUrl
          ? fetchCatalog(sheetUrlToCsv(stored.catalogSheetUrl)).then((result) => parseCatalogCsv(result.text).filter((row) => row.enabled))
          : Promise.resolve([]),
      ]);
      setState(nextState); setCatalog(rows);
      setNotice({ kind: "success", text: rows.length ? `已载入 ${rows.length} 个可用资源` : "请先在扩展图标中设置控制台表格" });
    });
  }

  async function applySettings(row: CatalogRow) {
    await run(`应用 ${row.name}`, async () => {
      await applySettingsText(await fetchText(normalizePublicDriveUrl(row.url)));
    });
  }

  async function loadLocalSettings(file: File) {
    await run("应用本地设置", async () => applySettingsText(await file.text()));
  }

  async function exportSettings() {
    await run("导出专页设置", async () => {
      const current = await callMain("getPageAutomationState", undefined, 30_000);
      const template = extractPageSettingsTemplate(current, `设置-${pageId}`);
      const bytes = new TextEncoder().encode(serializePageSettingsTemplate(template));
      await downloadBytes(bytes, `设置-${pageId}.json`, "application/json");
      setState(current);
      setNotice({ kind: "success", text: "已导出当前专页设置 JSON" });
    });
  }

  async function applySettingsText(text: string) {
    const template = parsePageSettingsTemplate(text);
    const updated = await callMain("updatePageAutomation", templateToUpdatePayload(template), 120_000);
    const fields = await callMain("ensureBotFields", { fields: template.settings.botFields }, 120_000);
    setState(updated.state);
    setNotice({ kind: "success", text: `设置完成：更新 ${updated.changed.length} 项，新建机器人变量 ${fields.created.length} 个，恢复归档变量 ${fields.restored.length} 个` });
  }

  async function loadRemoteFlow(row: CatalogRow, target: FlowApplyTarget) {
    await run(`下载 ${row.name}`, async () => {
      const remote = await fetchBytes(normalizePublicDriveUrl(row.url));
      await selectFlowArchive(remote.bytes, row.name, target);
    });
  }

  async function loadLocalFlow(file: File) {
    await run("打开本地流程", async () => selectFlowArchive(new Uint8Array(await file.arrayBuffer()), file.name, "comment"));
  }

  async function selectFlowArchive(bytes: Uint8Array, sourceName: string, target: FlowApplyTarget) {
    const next = loadTemplateArchive(bytes, sourceName);
    setFlowTarget(target);
    setLoaded(next); setArchiveBytes(bytes); setValues(initialInputValues(next.template));
    if (next.template.inputs.length) {
      setView("inputs");
      setNotice({ kind: "success", text: `请填写 ${next.template.inputs.length} 个流程变量` });
      return;
    }
    await queueFlowApply(next, bytes, {}, target);
  }

  async function queueSelectedFlow() {
    if (!loaded || !archiveBytes) return;
    if (missingRequired) { setNotice({ kind: "error", text: `还有 ${missingRequired} 个必填变量未填写` }); return; }
    const label = flowTarget === "defaultReply" ? "准备默认回复流程" : "准备评论私信流程";
    await run(label, async () => queueFlowApply(loaded, archiveBytes, values, flowTarget));
  }

  async function queueFlowApply(next: LoadedTemplate, bytes: Uint8Array, inputValues: Record<string, ImportInputValue>, target: FlowApplyTarget) {
    const destination = target === "defaultReply"
      ? await callMain("ensureDefaultReplyFlow", { name: next.template.meta.name || "默认回复" }, 120_000)
      : await callMain("ensureDefaultCommentFlow", { name: "评论", enableAutoInbox: true }, 120_000);
    if (target === "comment") await chrome.storage.local.set({ applyWelcomeWithCommentFlow: applyWelcome });
    await savePendingFlowApply({
      sourceName: next.sourceName,
      archiveBytes: bytes,
      values: inputValues,
      targetPageId: pageId,
      targetFlowId: destination.flow.id,
      applyWelcome: target === "comment" && applyWelcome,
      target,
    });
    location.assign(target === "defaultReply"
      ? `/${pageId}/default/edit#bft-open-assistant`
      : `/${pageId}/flows/${destination.flow.id}/content#bft-open-assistant`);
  }

  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label); setNotice({ kind: "info", text: `${label}…` });
    try { await action(); } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(""); }
  }

  return <aside className={`bft-launch-card page-assistant ${view === "inputs" ? "show-inputs" : ""}`} style={style}>
    <header {...dragProps}>
      <div><strong>{view === "inputs" ? loaded?.template.meta.name : "Botcake 专页助手"}</strong><small>{view === "inputs" ? "填写流程需要的内容" : `专页 ${pageId}`}</small></div>
      {view === "home" && <div className="header-local-loads"><button type="button" onClick={() => void exportSettings()} disabled={Boolean(busy)}>导出专页<br />设置 JSON</button><label>本地加载<br />设置 JSON<input type="file" accept=".json,application/json" onChange={(event) => event.target.files?.[0] && void loadLocalSettings(event.target.files[0])} /></label><label>本地加载<br />流程 ZIP<input type="file" accept=".zip,application/zip" onChange={(event) => event.target.files?.[0] && void loadLocalFlow(event.target.files[0])} /></label></div>}
      <div className="bft-header-actions">
        {view === "inputs" && <button onClick={() => setView("home")}>返回</button>}
        <button className="icon" aria-label="收起" onClick={onClose}>×</button>
      </div>
    </header>
    <div className={`page-assistant-notice ${notice.kind}`}>{busy && <span className="spinner" />}{notice.text}</div>
    <div className="page-assistant-viewport"><div className="page-assistant-slides">
      <div className="page-assistant-body page-home-view">
        <ResourceSection title="专页设置" empty="控制台中没有以“设置”开头的资源">{settingsRows.map((row) => <ResourceRow key={`${row.name}-${row.url}`} row={row} action="应用设置" disabled={Boolean(busy)} onClick={() => void applySettings(row)} />)}</ResourceSection>
        <section className="resource-section"><div className="resource-section-title"><h3>评论私信流程</h3><label className="welcome-toggle"><input type="checkbox" checked={applyWelcome} onChange={(event) => { setApplyWelcome(event.target.checked); void chrome.storage.local.set({ applyWelcomeWithCommentFlow: event.target.checked }); }} /><span>同步欢迎信息流程</span></label></div>
          {flowRows.map((row) => <ResourceRow key={`${row.name}-${row.url}`} row={row} action="应用评论私信" disabled={Boolean(busy)} onClick={() => void loadRemoteFlow(row, "comment")} />)}
          {!flowRows.length && <p className="resource-empty">控制台中没有以“流程”开头的资源</p>}
        </section>
        <ResourceSection title="默认回复流程" empty="控制台中没有以“默认回复”开头的资源">{defaultReplyRows.map((row) => <ResourceRow key={`${row.name}-${row.url}`} row={row} action="应用默认回复" disabled={Boolean(busy)} onClick={() => void loadRemoteFlow(row, "defaultReply")} />)}</ResourceSection>
        {state?.defaultPrivateReply && <p className="current-flow-note">当前评论流程：{state.defaultPrivateReply.name}</p>}
        {state?.defaultReply && <p className="current-flow-note">当前默认回复：{state.defaultReply.name}</p>}
      </div>
      <div className="page-assistant-body page-input-view">
        <div className="input-intro"><strong>填写流程变量</strong><span>变量名称和说明来自资源包，完成后自动进入{flowTarget === "defaultReply" ? "默认回复" : "评论私信"} Flow 并替换。</span></div>
        {loaded?.template.inputs.map((input) => <TemplateInputControl key={input.key} input={input} value={values[input.key] ?? {}} assets={loaded.assets} onChange={(value) => setValues((current) => ({ ...current, [input.key]: value }))} />)}
        <button className="primary sticky-apply" onClick={() => void queueSelectedFlow()} disabled={Boolean(busy) || !loaded}>应用{flowTarget === "defaultReply" ? "默认回复" : "评论私信"}{missingRequired ? `（缺 ${missingRequired} 项）` : ""}</button>
      </div>
    </div></div>
  </aside>;
}

async function readPageStateWithRetry(): Promise<PageAutomationState> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { return await callMain("getPageAutomationState", undefined, 30_000); }
    catch (error) {
      lastError = error;
      if (attempt < 7) await new Promise((resolve) => window.setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error("无法读取当前专页设置");
}

function ResourceSection({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return <section className="resource-section"><h3>{title}</h3>{rows.length ? children : <p className="resource-empty">{empty}</p>}</section>;
}

function ResourceRow({ row, action, disabled, onClick }: { row: CatalogRow; action: string; disabled: boolean; onClick: () => void }) {
  return <div className="resource-row"><div><strong>{row.name}</strong>{row.description && <small>{row.description}</small>}</div><button onClick={onClick} disabled={disabled}>{action}</button></div>;
}
