export type BackgroundRequest =
  | { action: "fetchText"; url: string }
  | { action: "fetchCatalog"; url: string; forceRefresh?: boolean }
  | { action: "fetchBinary"; url: string }
  | { action: "download"; bytes: number[]; fileName: string; mime: string }
  | { action: "saveBackup"; key: string; value: unknown }
  | { action: "getBackups"; key: string };

export type BackgroundResponse =
  | { ok: true; text: string; contentType?: string }
  | { ok: true; text: string; contentType?: string; cache: "fresh" | "network" | "stale" }
  | { ok: true; bytes: number[]; contentType?: string; fileName?: string }
  | { ok: true; downloadId?: number; value?: unknown }
  | { ok: false; error: string };
