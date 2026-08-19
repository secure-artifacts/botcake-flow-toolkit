import { MAX_REMOTE_FILE_BYTES } from "../../shared/constants";
import type { BackgroundRequest, BackgroundResponse } from "../../shared/background-protocol";
import { parseCatalogCsv } from "../../core/catalog";

const CATALOG_CACHE_KEY = "catalogCsvCache";
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

type CatalogCacheEntry = {
  url: string;
  text: string;
  contentType?: string;
  fetchedAt: number;
};

chrome.runtime.onMessage.addListener((request: BackgroundRequest, _sender, sendResponse: (response: BackgroundResponse) => void) => {
  void handleMessage(request).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

async function handleMessage(request: BackgroundRequest): Promise<BackgroundResponse> {
  switch (request.action) {
    case "fetchText": {
      const response = await safeFetch(request.url);
      return { ok: true, text: await response.text(), contentType: response.headers.get("content-type") ?? undefined };
    }
    case "fetchCatalog": {
      return fetchCatalog(request.url, request.forceRefresh === true);
    }
    case "fetchBinary": {
      const response = await safeFetch(request.url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_REMOTE_FILE_BYTES) throw new Error("远程文件超过 30MB 限制");
      return {
        ok: true,
        bytes: Array.from(bytes),
        contentType: response.headers.get("content-type") ?? undefined,
        fileName: fileNameFromResponse(response),
      };
    }
    case "download": {
      const blob = new Blob([new Uint8Array(request.bytes)], { type: request.mime });
      const dataUrl = await blobToDataUrl(blob);
      const downloadId = await chrome.downloads.download({ url: dataUrl, filename: request.fileName, saveAs: false });
      return { ok: true, downloadId };
    }
    case "saveBackup": {
      const storageKey = `backup:${request.key}:${Date.now()}`;
      const removed = await trimFlowBackupsBeforeWrite(request.key, 4);
      while (true) {
        try {
          await chrome.storage.local.set({ [storageKey]: request.value });
          return { ok: true, value: { storageKey, removed } };
        } catch (error) {
          if (!isStorageQuotaError(error)) throw error;
          const oldest = await findOldestBackupForQuota(request.key);
          if (!oldest) throw new Error(`本地备份空间不足，且没有可自动清理的旧备份：${error instanceof Error ? error.message : String(error)}`);
          await chrome.storage.local.remove(oldest);
          removed.push(oldest);
        }
      }
    }
    case "getBackups": {
      const all = await chrome.storage.local.get();
      const prefix = `backup:${request.key}:`;
      return { ok: true, value: Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith(prefix))) };
    }
  }
}

async function fetchCatalog(url: string, forceRefresh: boolean): Promise<BackgroundResponse> {
  const cachedValue = (await chrome.storage.local.get(CATALOG_CACHE_KEY))[CATALOG_CACHE_KEY];
  const cached = isCatalogCacheEntry(cachedValue) && cachedValue.url === url ? cachedValue : undefined;
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CATALOG_CACHE_TTL_MS) {
    return { ok: true, text: cached.text, contentType: cached.contentType, cache: "fresh" };
  }
  try {
    const response = await safeFetch(requestUrl(url), 1);
    const text = await response.text();
    if (!parseCatalogCsv(text).length) throw new Error("控制台 CSV 中没有可识别的设置或流程资源");
    const entry: CatalogCacheEntry = {
      url,
      text,
      contentType: response.headers.get("content-type") ?? undefined,
      fetchedAt: Date.now(),
    };
    await chrome.storage.local.set({ [CATALOG_CACHE_KEY]: entry });
    return { ok: true, text: entry.text, contentType: entry.contentType, cache: "network" };
  } catch (error) {
    if (cached) return { ok: true, text: cached.text, contentType: cached.contentType, cache: "stale" };
    throw error;
  }
}

function isCatalogCacheEntry(value: unknown): value is CatalogCacheEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CatalogCacheEntry>;
  return typeof entry.url === "string" && typeof entry.text === "string" && typeof entry.fetchedAt === "number";
}

function requestUrl(url: string): string {
  return new URL(url).toString();
}

async function trimFlowBackupsBeforeWrite(scopeKey: string, keep: number): Promise<string[]> {
  const all = await chrome.storage.local.get();
  const prefix = `backup:${scopeKey}:`;
  const keys = Object.keys(all).filter((key) => key.startsWith(prefix)).sort().reverse();
  const removed = keys.slice(keep);
  if (removed.length) await chrome.storage.local.remove(removed);
  return removed;
}

async function findOldestBackupForQuota(currentScopeKey: string): Promise<string | undefined> {
  const all = await chrome.storage.local.get();
  const entries = Object.keys(all).map(parseBackupKey).filter((entry): entry is BackupKeyInfo => Boolean(entry));
  if (!entries.length) return undefined;
  entries.sort((a, b) => a.timestamp - b.timestamp);

  const newestByScope = new Map<string, string>();
  for (const entry of [...entries].reverse()) if (!newestByScope.has(entry.scopeKey)) newestByScope.set(entry.scopeKey, entry.storageKey);
  const duplicate = entries.find((entry) => newestByScope.get(entry.scopeKey) !== entry.storageKey);
  if (duplicate) return duplicate.storageKey;

  const otherFlow = entries.find((entry) => entry.scopeKey !== currentScopeKey);
  return otherFlow?.storageKey ?? entries[0]?.storageKey;
}

type BackupKeyInfo = { storageKey: string; scopeKey: string; timestamp: number };

function parseBackupKey(storageKey: string): BackupKeyInfo | undefined {
  const match = storageKey.match(/^backup:(\d+):(\d+|defaultReply):(\d+)$/);
  if (!match) return undefined;
  return { storageKey, scopeKey: `${match[1]}:${match[2]}`, timestamp: Number(match[3]) };
}

function isStorageQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /quota|QUOTA_BYTES|MAX_WRITE|bytes.*limit/i.test(message);
}

async function safeFetch(url: string, maxRetries = 0): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("只允许 HTTPS 资源");
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(parsed, { redirect: "follow", cache: "no-store", credentials: "omit" });
      if (!response.ok) {
        if (attempt < maxRetries && (response.status === 429 || response.status >= 500)) {
          await delay(700);
          continue;
        }
        throw new Error(`下载失败（HTTP ${response.status}）`);
      }
      const size = Number(response.headers.get("content-length") ?? 0);
      if (size > MAX_REMOTE_FILE_BYTES) throw new Error("远程文件超过 30MB 限制");
      return response;
    } catch (error) {
      if (attempt >= maxRetries || !isNetworkError(error)) throw error;
      await delay(700);
    }
  }
  throw new Error("下载失败");
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || /network|fetch failed|connection/i.test(error instanceof Error ? error.message : String(error));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fileNameFromResponse(response: Response): string | undefined {
  const disposition = response.headers.get("content-disposition") ?? "";
  const raw = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i)?.[1]?.trim();
  if (!raw) return undefined;
  const cleaned = raw.replace(/^['"]|['"]$/g, "");
  try { return decodeURIComponent(cleaned); } catch { return cleaned; }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
