import { TEMPLATE_FORMAT, TEMPLATE_VERSION } from "../shared/constants";
import type {
  BotFieldDependency,
  FlowSnapshot,
  FlowTemplateV1,
  MediaDependency,
  MediaKind,
  TemplateInput,
  UnsupportedDependency,
} from "../shared/types";
import { deepClone, randomId, walkJson } from "../shared/utils";

const PLACEHOLDER_RE = /\[\[([A-Za-z0-9_.-]+)\]\]/g;
const BOT_FIELD_RE = /\{\{(\d+)\/\|([^}]+)\}\}/g;

const UNSUPPORTED_KEYS: Record<string, string> = {
  tag_id: "标签属于专页对象，当前版本不能可靠迁移",
  custom_field_id: "自定义字段属于专页对象，当前版本不能可靠迁移",
  sequence_id: "序列属于专页对象，当前版本不能可靠迁移",
  product_id: "商品属于专页对象，当前版本不能可靠迁移",
  warehouse_id: "仓库属于专页对象，当前版本不能可靠迁移",
};

export function analyzeSnapshot(snapshot: FlowSnapshot): FlowTemplateV1 {
  const post = deepClone(snapshot.post);
  const entryBlockKey = getEntryBlockKey(post);
  if (!entryBlockKey) throw new Error("当前流程没有可识别的入口节点");
  const inputKeys = new Set<string>();
  const botFields = new Map<string, BotFieldDependency>();
  const media = new Map<string, MediaDependency>();
  const unsupported: UnsupportedDependency[] = [];

  walkJson(post, (value, path, parent, key) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(PLACEHOLDER_RE)) inputKeys.add(match[1]);
      for (const match of value.matchAll(BOT_FIELD_RE)) {
        const sourceId = match[1];
        const name = match[2].trim();
        const sourceField = snapshot.botFields.find((field) => String(field.id) === sourceId);
        botFields.set(name.toLocaleLowerCase(), {
          name,
          sourceId,
          fieldType: sourceField?.type,
          defaultValue: sourceField?.value,
          description: typeof sourceField?.description === "string" ? sourceField.description : undefined,
        });
      }
    }

    if (parent && !Array.isArray(parent) && typeof key === "string") {
      const reason = UNSUPPORTED_KEYS[key];
      if (reason && value !== null && value !== undefined && value !== "") {
        unsupported.push({ path, key, value, reason });
      }
      if (key === "flow_id" && value !== null && value !== undefined && value !== "" && String(value) !== snapshot.identity.flowId) {
        unsupported.push({ path, key, value, reason: "引用了另一个 Flow，目标专页不一定存在" });
      }
      if (key === "add_actions" && Array.isArray(value) && value.length > 0) {
        unsupported.push({ path, key, value, reason: "动作可能绑定专页对象，需要人工检查" });
      }
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const cardPluginId = getCardPluginId(post, path);
      const pluginKind = record.plugin_id === "image" || record.plugin_id === "audio" || record.plugin_id === "video" ? record.plugin_id : undefined;
      const pluginConfig = record.config && typeof record.config === "object" && !Array.isArray(record.config)
        ? record.config as Record<string, unknown>
        : undefined;
      const url = pluginConfig
        ? firstString(pluginConfig.content_url, pluginConfig.url)
        : firstString(record.content_url, record.url);
      const kind = pluginKind ?? (isNestedCardMedia(path, cardPluginId) && hasMediaIdentity(record)
        ? inferMediaKind(record, url)
        : undefined);
      const configPath = pluginConfig ? `${path}.config` : path;
      if (url && kind && !media.has(configPath)) {
        const extension = extensionFor(kind, url);
        const mediaKey = `media_${media.size + 1}`;
        media.set(configPath, {
          key: mediaKey,
          kind,
          configPath,
          sourceUrl: url,
          asset: `assets/${mediaKey}.${extension}`,
          name: firstString(pluginConfig?.name, record.name) || `${mediaKey}.${extension}`,
          mime: mimeFor(kind, extension),
        });
      }
    }
  });

  const inputs: TemplateInput[] = [...inputKeys].map((key) => ({
    key,
    label: key,
    kind: "text",
    required: true,
  }));

  return {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    meta: {
      id: randomId("template"),
      name: snapshot.name || "未命名流程模板",
      createdAt: new Date().toISOString(),
      sourcePageId: snapshot.identity.pageId,
      sourceFlowId: snapshot.identity.flowId,
    },
    flow: {
      name: snapshot.name,
      post,
      entryBlockKey,
      selectedTab: snapshot.selectedTab,
      isPreview: snapshot.isPreview,
      isPreviewPublished: snapshot.isPreviewPublished,
    },
    inputs,
    dependencies: {
      botFields: [...botFields.values()],
      media: [...media.values()],
      unsupported,
    },
  };
}

function getEntryBlockKey(post: Record<string, unknown>): string | undefined {
  const blocks = Array.isArray(post.blocks) ? post.blocks : [];
  const first = blocks[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return undefined;
  const key = (first as Record<string, unknown>).key;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

function getCardPluginId(post: Record<string, unknown>, path: string): string | undefined {
  const match = path.match(/^\$\.blocks\[(\d+)]\.cards\[(\d+)](?:\.|$)/);
  if (!match) return undefined;
  const blocks = Array.isArray(post.blocks) ? post.blocks : [];
  const block = blocks[Number(match[1])];
  if (!block || typeof block !== "object" || Array.isArray(block)) return undefined;
  const cards = (block as Record<string, unknown>).cards;
  const card = Array.isArray(cards) ? cards[Number(match[2])] : undefined;
  if (!card || typeof card !== "object" || Array.isArray(card)) return undefined;
  const pluginId = (card as Record<string, unknown>).plugin_id;
  return typeof pluginId === "string" ? pluginId.toLowerCase() : undefined;
}

function isNestedCardMedia(path: string, cardPluginId?: string): boolean {
  if (!cardPluginId || !/^\$\.blocks\[\d+]\.cards\[\d+]\.config(?:\.|\[)/.test(path)) return false;
  return /(?:multi_image|multiple(?:_image)?|gallery|carousel|generic|template)/i.test(cardPluginId);
}

function hasMediaIdentity(record: Record<string, unknown>): boolean {
  return firstString(record.content_url, record.name, record.content_id, record.upload_type, record.media_type) !== undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function inferMediaKind(record: Record<string, unknown>, url?: string): MediaKind | undefined {
  const cue = `${record.upload_type ?? ""} ${record.type ?? ""} ${record.card_type ?? ""}`.toLowerCase();
  if (cue.includes("video") || url?.match(/\.(mp4|mov|webm|mkv)(?:[?#]|$)/i)) return "video";
  if (cue.includes("audio") || url?.match(/\.(mp3|m4a|wav|ogg)(?:[?#]|$)/i)) return "audio";
  if (cue.includes("image") || url?.match(/\.(png|jpe?g|gif|webp)(?:[?#]|$)/i)) return "image";
  return undefined;
}

function extensionFor(kind: MediaKind, url: string): string {
  const match = url.match(/\.([A-Za-z0-9]{2,5})(?:[?#]|$)/);
  if (match) return match[1].toLowerCase().replace("jpeg", "jpg");
  return kind === "image" ? "jpg" : kind === "audio" ? "mp3" : "mp4";
}

function mimeFor(kind: MediaKind, extension: string): string {
  if (kind === "image") return `image/${extension === "jpg" ? "jpeg" : extension}`;
  if (kind === "audio") return extension === "m4a" ? "audio/mp4" : `audio/${extension === "mp3" ? "mpeg" : extension}`;
  return extension === "mov" ? "video/quicktime" : `video/${extension === "mkv" ? "x-matroska" : extension}`;
}

export function extractPlaceholderKeys(value: unknown): string[] {
  const keys = new Set<string>();
  walkJson(value, (item) => {
    if (typeof item !== "string") return;
    for (const match of item.matchAll(PLACEHOLDER_RE)) keys.add(match[1]);
  });
  return [...keys];
}
