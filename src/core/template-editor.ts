import type { FlowTemplateV1, MediaKind, TemplateInput } from "../shared/types";
import { getByPath, setByPath, walkJson } from "../shared/utils";
import { getBlockTextFields } from "./template-graph";

const PLACEHOLDER_RE = /\[\[([A-Za-z0-9_.-]+)]]/g;

export function syncTextInputBindings(
  template: FlowTemplateV1,
  _path: string,
  value: string,
  _multiline: boolean,
): string[] {
  const keys = placeholderKeys(value);
  reconcileTemplateInputBindings(template);
  return keys;
}

export function reconcileTemplateInputBindings(template: FlowTemplateV1): string[] {
  const usage = collectTextInputUsage(template);
  for (const [key, paths] of usage) {
    const existing = template.inputs.find((input) => input.key === key);
    if (existing && isMediaKind(existing.kind)) {
      throw new Error(`变量“${key}”已经是素材变量，不能同时用于文字或链接`);
    }
    if (existing) existing.bindings = paths;
    else template.inputs.push({
      key,
      label: readableVariableName(key),
      kind: "text",
      required: true,
      bindings: paths,
    });
  }

  const removed: string[] = [];
  template.inputs = template.inputs.filter((input) => {
    if (isMediaKind(input.kind)) return true;
    input.bindings = usage.get(input.key) ?? [];
    if (input.bindings.length || shouldRetainUnusedInput(input)) return true;
    removed.push(input.key);
    return false;
  });
  return removed;
}

export function pruneUnusedTemplateInputs(template: FlowTemplateV1): string[] {
  return reconcileTemplateInputBindings(template);
}

export function removeUnusedTemplateInput(template: FlowTemplateV1, key: string): boolean {
  reconcileTemplateInputBindings(template);
  const input = template.inputs.find((item) => item.key === key);
  if (!input) return false;
  if (inputUsageCount(template, input) > 0) throw new Error(`变量“${key}”仍在流程中使用，不能删除`);
  template.inputs = template.inputs.filter((item) => item.key !== key);
  return true;
}

export function assignMediaInput(template: FlowTemplateV1, configPath: string, newKey: string): { reused: boolean } {
  const normalized = newKey.trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(normalized)) throw new Error("素材变量标识只能使用字母、数字、下划线、点或短横线");
  const media = template.dependencies.media.find((item) => item.configPath === configPath);
  if (!media) throw new Error(`素材位置不存在：${configPath}`);
  const oldKey = media.key;
  if (oldKey === normalized && template.inputs.some((input) => input.key === normalized && input.kind === media.kind)) return { reused: true };

  const source = template.inputs.find((input) => input.key === oldKey && input.kind === media.kind);
  const target = template.inputs.find((input) => input.key === normalized);
  if (target && target.kind !== media.kind) throw new Error(`变量“${normalized}”已被其他类型使用`);
  const sourceSnapshot = source ? { ...source, options: source.options?.map((option) => ({ ...option })) } : undefined;
  media.key = normalized;

  if (!target) {
    template.inputs.push({
      ...sourceSnapshot,
      key: normalized,
      label: sourceSnapshot?.label ?? `${media.name ?? mediaKindLabel(media.kind)}（可替换）`,
      kind: media.kind,
      required: sourceSnapshot?.required ?? false,
      accept: sourceSnapshot?.accept ?? `${media.kind}/*`,
      description: sourceSnapshot?.description ?? "不选择时使用模板内置素材",
      retainWhenUnused: true,
      bindings: [configPath],
    });
  }
  syncMediaInputBindings(template);
  removeOrphanedMediaInput(template, oldKey);
  return { reused: Boolean(target) };
}

export function detachMediaInput(template: FlowTemplateV1, configPath: string): void {
  const media = template.dependencies.media.find((item) => item.configPath === configPath);
  if (!media) throw new Error(`素材位置不存在：${configPath}`);
  const oldKey = media.key;
  const usedKeys = new Set(template.dependencies.media.map((item) => item.key));
  let index = 1;
  let fixedKey = `fixed_${media.kind}_${index}`;
  while (usedKeys.has(fixedKey) || template.inputs.some((input) => input.key === fixedKey)) fixedKey = `fixed_${media.kind}_${++index}`;
  media.key = fixedKey;
  syncMediaInputBindings(template);
  removeOrphanedMediaInput(template, oldKey);
}

export function inputUsageCount(template: FlowTemplateV1, input: TemplateInput): number {
  if (isMediaKind(input.kind)) {
    const dependencyCount = template.dependencies.media.filter((media) => media.key === input.key).length;
    const bindingCount = (input.bindings ?? []).filter((path) => getByPath(template.flow.post, path) !== undefined).length;
    return Math.max(dependencyCount, bindingCount);
  }
  return collectTextInputUsage(template).get(input.key)?.length ?? 0;
}

export function syncBlockTextInputBindings(template: FlowTemplateV1, _blockIndex: number): void {
  reconcileTemplateInputBindings(template);
}

export function plainTextToRawText(value: string): Array<{ children: Array<{ text: string }> }> {
  return value.split("\n").map((text) => ({ children: [{ text }] }));
}

export function rawTextToPlainText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((line) => {
    let text = "";
    walkJson(line, (item, _path, _parent, key) => {
      if (key === "text" && typeof item === "string") text += item;
    });
    return text;
  }).join("\n");
}

export function syncBlockRichTextMirrors(template: FlowTemplateV1, blockIndex: number): void {
  for (const field of getBlockTextFields(template, blockIndex)) {
    if (!field.rawTextPath) continue;
    const current = getByPath(template.flow.post, field.rawTextPath);
    if (rawTextToPlainText(current) !== field.value) {
      setByPath(template.flow.post, field.rawTextPath, plainTextToRawText(field.value));
    }
  }
}

export function replaceTemplateSection(
  template: FlowTemplateV1,
  section: "inputs" | "media" | "botFields",
  value: unknown,
): void {
  if (!Array.isArray(value)) throw new Error("该分区必须是 JSON 数组");
  if (section === "inputs") template.inputs = value as TemplateInput[];
  else if (section === "media") template.dependencies.media = value as FlowTemplateV1["dependencies"]["media"];
  else template.dependencies.botFields = value as FlowTemplateV1["dependencies"]["botFields"];
}

function collectTextInputUsage(template: FlowTemplateV1): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  walkJson(template.flow.post, (value, path) => {
    if (typeof value !== "string" || path.includes(".rawText")) return;
    for (const key of placeholderKeys(value)) {
      const paths = usage.get(key) ?? [];
      if (!paths.includes(path)) paths.push(path);
      usage.set(key, paths);
    }
  });
  return usage;
}

function shouldRetainUnusedInput(input: TemplateInput): boolean {
  if (input.retainWhenUnused) return true;
  if (input.options?.length) return true;
  if (input.default !== undefined && String(input.default).length > 0) return true;
  if (input.description?.trim()) return true;
  if (input.required === false) return true;
  if (input.kind === "random" || input.kind === "number") return true;
  return input.label.trim() !== readableVariableName(input.key);
}

function syncMediaInputBindings(template: FlowTemplateV1): void {
  for (const input of template.inputs) {
    if (!isMediaKind(input.kind)) continue;
    input.bindings = template.dependencies.media
      .filter((media) => media.key === input.key && media.kind === input.kind)
      .map((media) => media.configPath);
  }
}

function removeOrphanedMediaInput(template: FlowTemplateV1, key: string): void {
  if (template.dependencies.media.some((media) => media.key === key)) return;
  template.inputs = template.inputs.filter((input) => !(input.key === key && isMediaKind(input.kind)));
}

function placeholderKeys(value: string): string[] {
  return [...new Set([...value.matchAll(PLACEHOLDER_RE)].map((match) => match[1]))];
}

function readableVariableName(key: string): string {
  return key.replace(/[_.-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function isMediaKind(kind: TemplateInput["kind"]): kind is MediaKind {
  return kind === "image" || kind === "audio" || kind === "video";
}

function mediaKindLabel(kind: MediaKind): string {
  return kind === "image" ? "图片" : kind === "audio" ? "音频" : "视频";
}
