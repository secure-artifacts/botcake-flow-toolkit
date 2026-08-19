import type { MediaKind } from "../shared/types";

export function inferMediaMime(
  kind: MediaKind,
  bytes: Uint8Array,
  declared?: string,
  name?: string,
): string {
  const cleanDeclared = declared?.split(";", 1)[0].trim().toLowerCase();
  if (cleanDeclared?.startsWith(`${kind}/`)) return cleanDeclared;

  const detected = mimeFromSignature(bytes);
  if (detected?.startsWith(`${kind}/`)) return detected;

  const extension = name?.split(/[?#]/, 1)[0].split(".").at(-1)?.toLowerCase();
  const byExtension: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
    mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  };
  const extensionMime = byExtension[extension ?? ""];
  if (extensionMime?.startsWith(`${kind}/`)) return extensionMime;
  const label = kind === "image" ? "图片" : kind === "audio" ? "音频" : "视频";
  const actual = detected ?? cleanDeclared;
  throw new Error(actual ? `下载结果不是有效${label}（${actual}）` : `无法识别${label}文件类型`);
}

export function extensionForMime(mime: string, kind: MediaKind): string {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp",
    "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/ogg": "ogg", "audio/aac": "aac",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv",
  };
  return extensions[mime] ?? (kind === "image" ? "jpg" : kind === "audio" ? "mp3" : "mp4");
}

function mimeFromSignature(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, 4) === "GIF8") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (ascii(bytes, 0, 2) === "BM") return "image/bmp";
  if (ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return "audio/wav";
  if (ascii(bytes, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(bytes, 4, 4) === "ftyp") return "video/mp4";
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  return undefined;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}
