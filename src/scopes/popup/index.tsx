import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseCatalogCsv, sheetUrlToCsv } from "../../core/catalog";
import type { BackgroundRequest, BackgroundResponse } from "../../shared/background-protocol";
import "./style.css";

const BOTCAKE_URL_RE = /^https:\/\/botcake\.io(?:\/|$)/;
const FLOW_URL_RE = /^https:\/\/botcake\.io\/\d+\/(?:flows\/\d+\/content|default\/edit)(?:[/?#]|$)/;

function PopupApp() {
  const [tab, setTab] = useState<chrome.tabs.Tab>();
  const [connection, setConnection] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [catalogStatus, setCatalogStatus] = useState("");
  const initialized = useRef(false);

  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(async ([activeTab]) => {
      setTab(activeTab);
      if (!activeTab?.id || !activeTab.url || !BOTCAKE_URL_RE.test(activeTab.url)) return;
      try {
        await chrome.tabs.sendMessage(activeTab.id, { action: "ensureInjected" });
        setConnection("页面浮标已连接");
      } catch {
        try {
          await reinjectPageAssistant(activeTab.id);
          setConnection("页面浮标已重新连接");
        } catch {
          setConnection("页面浮标连接失败，请刷新 Botcake 页面");
        }
      }
    });
  }, []);

  useEffect(() => {
    void chrome.storage.local.get("catalogSheetUrl").then((value) => {
      setSheetUrl(String(value.catalogSheetUrl ?? ""));
      initialized.current = true;
    });
  }, []);

  useEffect(() => {
    if (!initialized.current) return;
    const timer = window.setTimeout(() => {
      if (sheetUrl.trim()) void saveAndReadCatalog(sheetUrl, false);
      else void chrome.storage.local.remove(["catalogSheetUrl", "catalogCsvCache"]).then(() => setCatalogStatus("已清空资源控制台"));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [sheetUrl]);

  const isFlowPage = Boolean(tab?.url && FLOW_URL_RE.test(tab.url));
  const isBotcakePage = Boolean(tab?.url && BOTCAKE_URL_RE.test(tab.url));

  async function openTemplateEditor() {
    await chrome.runtime.openOptionsPage();
    window.close();
  }

  async function openBotcake() {
    await chrome.tabs.create({ url: "https://botcake.io/dashboard?#_=" });
    window.close();
  }

  async function saveAndReadCatalog(url: string, forceRefresh: boolean) {
    try {
      setCatalogStatus("正在读取控制台…");
      const response = await chrome.runtime.sendMessage<BackgroundRequest, BackgroundResponse>({ action: "fetchCatalog", url: sheetUrlToCsv(url), forceRefresh });
      if (!response?.ok || !("text" in response)) throw new Error(response?.ok ? "返回内容不是表格" : response?.error ?? "读取失败");
      const rows = parseCatalogCsv(response.text).filter((row) => row.enabled);
      const settings = rows.filter((row) => row.kind === "settings").length;
      const flows = rows.filter((row) => row.kind === "flow").length;
      const defaultReplies = rows.filter((row) => row.kind === "defaultReply").length;
      if (!rows.length) throw new Error("没有识别到以“设置”“流程”或“默认回复”开头的资源");
      await chrome.storage.local.set({ catalogSheetUrl: url.trim() });
      const source = "cache" in response ? response.cache === "fresh" ? "缓存" : response.cache === "stale" ? "上次缓存（网络失败）" : "最新数据" : "数据";
      setCatalogStatus(`已保存：${settings} 个设置，${flows} 个流程，${defaultReplies} 个默认回复 · ${source}`);
    } catch (error) {
      setCatalogStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return <main className="popup-shell">
    <header><div className="brand-mark"><img src={chrome.runtime.getURL("icons/icon-48.png")} alt="" /></div><div><strong>Botcake 流程助手</strong><span>{isFlowPage ? "已识别当前 Flow 页面" : isBotcakePage ? "Botcake 页面浮标已启用" : "当前页面不是 Botcake"}</span></div></header>
    <section className="launcher-list">
      <button className="launcher" onClick={openBotcake}><span className="launcher-icon">B</span><div><strong>打开 Botcake</strong><small>进入 Botcake 工作台</small></div></button>
      <button className="launcher" onClick={openTemplateEditor}><span className="launcher-icon">✎</span><div><strong>模板编辑器</strong><small>打开 ZIP、编辑节点并导出模板</small></div></button>
    </section>
    <section className="catalog-console">
      <label>资源控制台表格</label>
      <div className="catalog-input-row"><input value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} placeholder="粘贴带 gid 的公开 Google 表格链接" /><button disabled={!sheetUrl.trim()} onClick={() => void saveAndReadCatalog(sheetUrl, true)}>重新读取</button></div>
      <small>两列：名称、资源网盘链接；名称以“设置”“流程”或“默认回复”开头。</small>
      {catalogStatus && <p className={`catalog-status ${/失败|没有|错误|缺少/.test(catalogStatus) ? "error" : ""}`}>{catalogStatus}</p>}
    </section>
    {isBotcakePage && connection && <p className={`popup-status ${connection.includes("失败") ? "error" : ""}`}>{connection}</p>}
  </main>;
}

async function reinjectPageAssistant(tabId: number): Promise<void> {
  const scripts = chrome.runtime.getManifest().content_scripts ?? [];
  const mainFiles = scripts[0]?.js ?? [];
  const contentFiles = scripts[1]?.js ?? [];
  if (!mainFiles.length || !contentFiles.length) throw new Error("扩展注入脚本缺失");
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => document.getElementById("botcake-flow-toolkit-host")?.remove(),
  });
  await chrome.scripting.executeScript({ target: { tabId }, files: mainFiles, world: "MAIN" });
  await chrome.scripting.executeScript({ target: { tabId }, files: contentFiles, world: "ISOLATED" });
}

createRoot(document.getElementById("root")!).render(<PopupApp />);
