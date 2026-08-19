import { useEffect, useState } from "react";
import { normalizePublicDriveUrl } from "../../core/catalog";
import { extensionForMime, inferMediaMime } from "../../core/media";
import { MAX_REMOTE_FILE_BYTES } from "../../shared/constants";
import type { ImportInputValue, LoadedTemplate, TemplateInput } from "../../shared/types";
import { fetchBytes, fetchText } from "./bridge";

export function initialInputValues(template: LoadedTemplate["template"]): Record<string, ImportInputValue> {
  return Object.fromEntries(template.inputs.map((input) => [input.key, input.default == null ? {} : { text: String(input.default) }]));
}

export function countMissingRequired(template: LoadedTemplate["template"], values: Record<string, ImportInputValue>): number {
  return template.inputs.filter((input) => {
    if (!input.required || (input.kind === "random" && input.options?.length)) return false;
    const value = values[input.key];
    if (isMediaInput(input)) return !value?.bytes?.byteLength && !value?.url?.trim() && !value?.asset?.trim();
    return !(value?.text ?? (input.default == null ? "" : String(input.default))).trim();
  }).length;
}

export function TemplateInputControl({ input, value, assets, onChange }: { input: TemplateInput; value: ImportInputValue; assets: Map<string, Uint8Array>; onChange: (value: ImportInputValue) => void }) {
  const [optionError, setOptionError] = useState("");
  const [selectedOption, setSelectedOption] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(() => {
    setSelectedOption("");
    setOptionError("");
  }, [input.key, input.kind, input.options]);
  useEffect(() => {
    if (!value.bytes?.byteLength || !value.mime) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(new Blob([value.bytes.slice().buffer], { type: value.mime }));
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value.bytes, value.mime]);
  const label = <label><strong>{input.label}</strong>{input.required && <b>*</b>}{input.description && <small>{input.description}</small>}</label>;
  if (isMediaInput(input)) return <div className="field input-card">{label}
    {input.options?.length ? <select value={selectedOption} onChange={async (event) => {
      const index = event.target.value;
      setSelectedOption(index);
      const option = index === "" ? undefined : input.options?.[Number(index)];
      if (!option) { setOptionError(""); onChange({}); return; }
      try {
        setOptionError("正在读取素材…");
        let bytes: Uint8Array;
        let declaredMime: string | undefined;
        let fileName: string | undefined;
        if (option.asset && assets.has(option.asset)) {
          bytes = assets.get(option.asset)!;
          fileName = option.asset.split("/").at(-1);
        } else if (option.url) {
          const remote = await fetchBytes(normalizePublicDriveUrl(option.url));
          bytes = remote.bytes;
          declaredMime = remote.contentType;
          fileName = cleanRemoteFileName(remote.fileName);
        } else throw new Error("预置素材不存在，也没有下载链接");
        const mime = inferMediaMime(input.kind, bytes, declaredMime, fileName ?? option.url ?? option.asset);
        setOptionError("");
        onChange({ bytes, fileName: fileName || `${safeName(option.label)}.${extensionForMime(mime, input.kind)}`, mime, asset: option.asset, url: option.url ? normalizePublicDriveUrl(option.url) : undefined });
      } catch (error) {
        setSelectedOption("");
        setOptionError(`素材读取失败：${messageOf(error)}`);
        onChange({});
      }
    }}><option value="">请选择预置素材</option>{input.options.map((option, index) => <option value={index} key={index}>{option.label}</option>)}</select> : null}
    <label className="inline-file">从电脑选择文件<input type="file" accept={input.accept ?? `${input.kind}/*`} onChange={async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_REMOTE_FILE_BYTES) { setOptionError("单个素材不能超过 30MB"); return; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      setSelectedOption(""); setOptionError("");
      onChange({ bytes, fileName: file.name, mime: inferMediaMime(input.kind, bytes, file.type, file.name) });
    }} /></label>
    {previewUrl && input.kind === "image" && <img className="media-input-preview" src={previewUrl} alt={value.fileName ?? input.label} />}
    {previewUrl && input.kind === "audio" && <audio className="media-input-preview" src={previewUrl} controls />}
    {previewUrl && input.kind === "video" && <video className="media-input-preview" src={previewUrl} controls />}
    {value.fileName && <small>已选择：{value.fileName}</small>}{optionError && <small className="field-error">{optionError}</small>}
  </div>;
  const picker = input.options?.length ? <select value={selectedOption} onChange={async (event) => {
    const index = event.target.value;
    setSelectedOption(index);
    const option = index === "" ? undefined : input.options?.[Number(index)];
    if (!option) {
      setOptionError("");
      if (input.kind === "random") onChange({});
      return;
    }
    try {
      setOptionError(option.url ? "正在读取选项…" : "");
      onChange({ text: option.url ? await fetchText(normalizePublicDriveUrl(option.url)) : option.value ?? "" });
      setOptionError("");
    }
    catch (error) { setSelectedOption(""); setOptionError(`读取选项失败：${messageOf(error)}`); }
  }}><option value="">{input.kind === "random" ? "自动随机（也可指定）" : "选择预置内容"}</option>{input.options.map((option, index) => <option key={index} value={index}>{option.label}</option>)}</select> : null;
  const updateManualText = (text: string) => {
    setSelectedOption("");
    setOptionError("");
    onChange({ text });
  };
  if (input.kind === "random") return <div className="field input-card">{label}{picker}<textarea rows={5} value={value.text ?? ""} onChange={(event) => updateManualText(event.target.value)} placeholder={`手动填写${input.label}（留空时自动随机）`} /><small>选择后可在输入框中预览和修改；留空时自动随机一项。</small>{optionError && <small className="field-error">{optionError}</small>}</div>;
  if (input.kind === "text") return <div className="field input-card">{label}{picker}<textarea rows={5} value={value.text ?? ""} onChange={(event) => updateManualText(event.target.value)} placeholder={input.description || `填写${input.label}`} />{input.options?.length ? <small>选择后可在输入框中预览和修改。</small> : null}{optionError && <small className="field-error">{optionError}</small>}</div>;
  return <div className="field input-card">{label}{picker}<input type="number" value={value.text ?? ""} onChange={(event) => updateManualText(event.target.value)} placeholder={input.description || `填写${input.label}`} />{input.options?.length ? <small>选择后可在输入框中预览和修改。</small> : null}{optionError && <small className="field-error">{optionError}</small>}</div>;
}

export function isMediaInput(input: TemplateInput): input is TemplateInput & { kind: "image" | "audio" | "video" } {
  return input.kind === "image" || input.kind === "audio" || input.kind === "video";
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function safeName(value: string): string { return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "resource"; }
function cleanRemoteFileName(value?: string): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim().replace(/^['"]|['"]$/g, "");
  try { return decodeURIComponent(cleaned); } catch { return cleaned; }
}
