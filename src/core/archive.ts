import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { MAX_ARCHIVE_FILES, MAX_UNZIPPED_BYTES } from "../shared/constants";
import type { FlowTemplateV1, LoadedTemplate } from "../shared/types";
import { assertTemplateContract } from "./template-contract";
import { flowTemplateSchema } from "./template-schema";

export function createTemplateArchive(template: FlowTemplateV1, assets: Map<string, Uint8Array>): Uint8Array {
  assertTemplateContract(template);
  validateReferencedAssets(template, assets);
  const files: Record<string, Uint8Array> = {
    "template.json": strToU8(JSON.stringify(template, null, 2)),
  };
  for (const [name, bytes] of assets) {
    validateArchivePath(name);
    files[name] = bytes;
  }
  return zipSync(files, { level: 6 });
}

export function loadTemplateArchive(bytes: Uint8Array, sourceName = "template.zip"): LoadedTemplate {
  const files = unzipSync(bytes);
  const entries = Object.entries(files);
  if (entries.length > MAX_ARCHIVE_FILES) throw new Error(`资源包文件过多（最多 ${MAX_ARCHIVE_FILES} 个）`);
  let total = 0;
  const assets = new Map<string, Uint8Array>();
  for (const [name, data] of entries) {
    validateArchivePath(name);
    total += data.byteLength;
    if (total > MAX_UNZIPPED_BYTES) throw new Error("资源包解压后体积过大");
    if (name !== "template.json" && !name.endsWith("/")) assets.set(name, data);
  }
  const rawTemplate = files["template.json"];
  if (!rawTemplate) throw new Error("资源包缺少 template.json");
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(rawTemplate));
  } catch {
    throw new Error("template.json 不是有效 JSON");
  }
  const result = flowTemplateSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`模板结构无效：${issue.path.join(".")} ${issue.message}`);
  }
  const template = result.data as FlowTemplateV1;
  assertTemplateContract(template);
  validateReferencedAssets(template, assets);
  return { template, assets, sourceName };
}

function validateReferencedAssets(template: FlowTemplateV1, assets: Map<string, Uint8Array>): void {
  for (const media of template.dependencies.media) {
    if (media.asset && !assets.has(media.asset) && !media.sourceUrl) throw new Error(`缺少素材：${media.asset}`);
  }
  for (const input of template.inputs) {
    if (input.kind !== "image" && input.kind !== "audio" && input.kind !== "video") continue;
    for (const option of input.options ?? []) {
      if (option.asset && !assets.has(option.asset) && !option.url) throw new Error(`预置选项“${option.label}”缺少素材：${option.asset}`);
    }
  }
}

function validateArchivePath(path: string): void {
  if (!path || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`资源包包含非法路径：${path}`);
  }
  const normalized = path.replace(/\\/g, "/");
  if (normalized.split("/").includes("..")) throw new Error(`资源包包含越界路径：${path}`);
}
