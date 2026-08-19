import type { PendingFlowApply } from "../../shared/types";

const DB_NAME = "botcake-flow-toolkit";
const STORE_NAME = "pending-flow-apply";
const SESSION_KEY = "botcake-flow-toolkit:pending-flow-apply-id";

export async function savePendingFlowApply(task: Omit<PendingFlowApply, "id" | "createdAt">): Promise<string> {
  const record: PendingFlowApply = { ...task, id: crypto.randomUUID(), createdAt: Date.now() };
  const db = await openDatabase();
  await requestResult(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(record));
  sessionStorage.setItem(SESSION_KEY, record.id);
  return record.id;
}

export async function readPendingFlowApply(): Promise<PendingFlowApply | undefined> {
  const id = sessionStorage.getItem(SESSION_KEY);
  if (!id) return undefined;
  const db = await openDatabase();
  return await requestResult<PendingFlowApply | undefined>(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id));
}

export async function clearPendingFlowApply(id?: string): Promise<void> {
  const target = id ?? sessionStorage.getItem(SESSION_KEY) ?? "";
  sessionStorage.removeItem(SESSION_KEY);
  if (!target) return;
  const db = await openDatabase();
  await requestResult(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(target));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开流程任务存储"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("流程任务存储失败"));
  });
}
