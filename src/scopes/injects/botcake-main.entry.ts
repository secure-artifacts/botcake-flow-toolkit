import { APP_ID, DEFAULT_REPLY_EDIT_URL_PATTERN } from "../../shared/constants";
import { isSameBotcakeTimezone, toBotcakeTimezoneValue } from "../../core/botcake-timezone";
import type {
  BotField,
  BotFieldSpec,
  CommentAutomationSettings,
  CommentFlowStatus,
  CommentReplyItem,
  EnsureBotFieldsResult,
  EnsureDefaultCommentFlowResult,
  EnsureWelcomeFlowResult,
  FlowSnapshot,
  MainAction,
  MainBridgeRequest,
  MainBridgeResponse,
  MainRequestMap,
  MainResponseMap,
  PageAutomationState,
  SaveFlowPayload,
  UpdatePageAutomationPayload,
  UpdatePageAutomationResult,
} from "../../shared/types";
import { base64ToBytes, getFlowIdentity } from "../../shared/utils";

type RuntimeState = {
  accessToken: string;
  selectedPost?: Record<string, unknown>;
  botFields: BotField[];
  selectedTab?: string | number;
  currentPageId?: string;
};

type BotcakeReduxState = {
  auth?: { accessToken?: unknown; access_token?: unknown };
  cards?: { selectedPost?: unknown; selectedTabMenu?: unknown; privateReplies?: unknown };
  pages?: { botFields?: unknown; bot_fields?: unknown; currentPageId?: unknown; currentSettings?: unknown };
};

declare global {
  interface Window {
    __NEXT_REDUX_STORE__?: { getState?: () => BotcakeReduxState };
    __BOTCAKE_FLOW_TOOLKIT_ROUTE_OBSERVER__?: boolean;
    __BOTCAKE_FLOW_TOOLKIT_BRIDGE__?: boolean;
  }
}

installRouteObserver();
if (!window.__BOTCAKE_FLOW_TOOLKIT_BRIDGE__) {
  window.__BOTCAKE_FLOW_TOOLKIT_BRIDGE__ = true;
  window.addEventListener("message", (event: MessageEvent<MainBridgeRequest>) => {
    const message = event.data;
    if (event.source !== window || !message || message.app !== APP_ID || message.channel !== "request") return;
    void handleRequest(message);
  });
}

async function handleRequest<A extends MainAction>(request: MainBridgeRequest<A>): Promise<void> {
  const response: MainBridgeResponse<A> = {
    app: APP_ID,
    channel: "response",
    requestId: request.requestId,
    action: request.action,
    ok: false,
  };
  try {
    response.result = await dispatch(request.action, request.payload) as MainResponseMap[A];
    response.ok = true;
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
  }
  window.postMessage(response, location.origin);
}

async function dispatch<A extends MainAction>(action: A, payload: MainRequestMap[A]): Promise<MainResponseMap[A]> {
  switch (action) {
    case "inspect": return inspectFlow() as MainResponseMap[A];
    case "saveFlow": return saveFlow(payload as SaveFlowPayload) as Promise<MainResponseMap[A]>;
    case "getBotFields": return getBotFields() as Promise<MainResponseMap[A]>;
    case "createBotField": {
      const value = payload as MainRequestMap["createBotField"];
      return createBotField(value.name, value.type, value.value, value.description) as Promise<MainResponseMap[A]>;
    }
    case "uploadMedia": return uploadMedia(payload as MainRequestMap["uploadMedia"]) as Promise<MainResponseMap[A]>;
    case "getPrivateReplies": return getPrivateReplies() as Promise<MainResponseMap[A]>;
    case "getCommentFlowStatus": return getCommentFlowStatus() as Promise<MainResponseMap[A]>;
    case "getPageAutomationState": return getPageAutomationState() as Promise<MainResponseMap[A]>;
    case "updatePageAutomation": return updatePageAutomation(payload as UpdatePageAutomationPayload) as Promise<MainResponseMap[A]>;
    case "ensureBotFields": return ensureBotFields((payload as MainRequestMap["ensureBotFields"]).fields) as Promise<MainResponseMap[A]>;
    case "ensureDefaultCommentFlow": return ensureDefaultCommentFlow(payload as MainRequestMap["ensureDefaultCommentFlow"]) as Promise<MainResponseMap[A]>;
    case "ensureWelcomeFlowFromComment": return ensureWelcomeFlowFromComment(payload as MainRequestMap["ensureWelcomeFlowFromComment"]) as Promise<MainResponseMap[A]>;
    case "ensureDefaultReplyFlow": return ensureDefaultReplyFlow(payload as MainRequestMap["ensureDefaultReplyFlow"]) as Promise<MainResponseMap[A]>;
    case "activateDefaultReply": return activateDefaultReply() as Promise<MainResponseMap[A]>;
    default: throw new Error(`不支持的页面操作：${String(action)}`);
  }
}

const COMMENT_SIMPLE_SETTING_KEYS = {
  autoReplyComment: "auto_reply_comment",
  autoInbox: "inbox_from_comment",
  prioritizePostSettings: "prioritize_auto_reply_with_setup_of_each_post",
  replyBasedOnSpecificPosts: "only_reply_post_config",
  onlyFirstCommentOnPage: "only_reply_first_comment",
  onlyFirstCommentOnEachPost: "inbox_first_comment_post",
  onlyFirstLevelComments: "only_track_first_level_comment",
  inboxCommentsFromGroupPosts: "auto_comment_in_group",
  autoLikeComments: "auto_like_comment",
  ignoreSeedingAccounts: "no_auto_inb_fr_cmt_seeding",
} as const;

async function getPageAutomationState(): Promise<PageAutomationState> {
  const pageId = getCurrentPageId();
  const settings = getCurrentSettings();
  const replies = await getPrivateRepliesWithRetry(pageId, readRuntime().accessToken);
  const defaultReply = firstRecord(replies[0]);
  const welcome = await getWelcomeState(pageId, readRuntime().accessToken, settings);
  const systemDefault = await getDefaultReplyState(pageId, readRuntime().accessToken);
  return {
    pageId,
    timezone: finiteNumber(settings.time_zone),
    targetCountryCodes: readTargetCountryCodes(settings.webform_setting),
    comment: commentAutomationFromSettings(settings),
    defaultPrivateReply: defaultReply?.id ? {
      id: String(defaultReply.id),
      name: String(defaultReply.name ?? defaultReply.title ?? `Flow ${defaultReply.id}`),
    } : undefined,
    defaultReply: systemDefault,
    welcome,
    botFields: await getBotFields(),
  };
}

async function updatePageAutomation(payload: UpdatePageAutomationPayload): Promise<UpdatePageAutomationResult> {
  const pageId = getCurrentPageId();
  const runtime = readRuntime();
  const settings = getCurrentSettings();
  const changed: string[] = [];

  if (payload.timezone !== undefined && !isSameBotcakeTimezone(settings.time_zone, payload.timezone)) {
    const timezoneValue = toBotcakeTimezoneValue(payload.timezone);
    const form = new FormData();
    form.append("timezone", timezoneValue);
    await botcakeFetch(`/api/v1/pages/${pageId}/change_timezone`, runtime.accessToken, { method: "POST", body: form });
    settings.time_zone = timezoneValue;
    changed.push("timezone");
  }

  if (payload.targetCountryCodes) {
    const countryCodes = uniqueStrings(payload.targetCountryCodes);
    if (!countryCodes.length) throw new Error("目标地区至少保留一个国家/地区");
    if (JSON.stringify(countryCodes) !== JSON.stringify(readTargetCountryCodes(settings.webform_setting))) {
      await saveTargetCountryCodes(pageId, runtime.accessToken, settings, countryCodes);
      settings.webform_setting = { ...readWebformSetting(settings.webform_setting), country: countryCodes };
      changed.push("targetCountryCodes");
    }
  }

  if (payload.comment) {
    if (payload.comment.onlyFirstCommentOnPage === true && payload.comment.onlyFirstCommentOnEachPost === true) {
      throw new Error("“专页首次评论”和“每篇帖子首次评论”不能同时开启");
    }
    if (payload.comment.onlyFirstCommentOnPage === true && booleanValue(settings.inbox_first_comment_post)) {
      await saveSimplePageSetting(pageId, runtime.accessToken, "inbox_first_comment_post", false);
      settings.inbox_first_comment_post = false;
      changed.push("comment.onlyFirstCommentOnEachPost");
    }
    if (payload.comment.onlyFirstCommentOnEachPost === true && booleanValue(settings.only_reply_first_comment)) {
      await saveSimplePageSetting(pageId, runtime.accessToken, "only_reply_first_comment", false);
      settings.only_reply_first_comment = false;
      changed.push("comment.onlyFirstCommentOnPage");
    }
    const simpleEntries = Object.entries(COMMENT_SIMPLE_SETTING_KEYS) as Array<[keyof typeof COMMENT_SIMPLE_SETTING_KEYS, string]>;
    for (const [uiKey, apiKey] of simpleEntries) {
      const value = payload.comment[uiKey];
      if (typeof value !== "boolean" || booleanValue(settings[apiKey]) === value) continue;
      await saveSimplePageSetting(pageId, runtime.accessToken, apiKey, value);
      settings[apiKey] = value;
      changed.push(`comment.${uiKey}`);
    }
    if (payload.comment.replies) {
      const normalized = normalizeCommentReplies(payload.comment.replies);
      if (JSON.stringify(normalized) !== JSON.stringify(normalizeCommentReplies(arrayValue(settings.data_comments)))) {
        await saveCommentReplies(pageId, runtime.accessToken, settings, normalized);
        settings.data_comments = normalized;
        changed.push("comment.replies");
      }
    }
  }

  const replies = await getPrivateRepliesWithRetry(pageId, runtime.accessToken);
  const defaultReply = firstRecord(replies[0]);
  const welcome = await getWelcomeState(pageId, runtime.accessToken, settings);
  const systemDefault = await getDefaultReplyState(pageId, runtime.accessToken);
  return {
    changed,
    state: {
      pageId,
      timezone: finiteNumber(settings.time_zone),
      targetCountryCodes: readTargetCountryCodes(settings.webform_setting),
      comment: commentAutomationFromSettings(settings),
      defaultPrivateReply: defaultReply?.id ? { id: String(defaultReply.id), name: String(defaultReply.name ?? defaultReply.title ?? `Flow ${defaultReply.id}`) } : undefined,
      defaultReply: systemDefault,
      welcome,
      botFields: await getBotFields(),
    },
  };
}

async function getDefaultReplyState(pageId: string, token: string): Promise<PageAutomationState["defaultReply"]> {
  const result = await botcakeFetch(`/api/v1/pages/${pageId}/get_contents?type=default`, token);
  const flow = firstRecord(result?.flow) ?? firstRecord(arrayValue(result?.flow)[0]);
  return flow?.id ? {
    id: String(flow.id),
    name: String(flow.name ?? flow.title ?? "Default message"),
  } : undefined;
}

async function ensureDefaultReplyFlow(payload: MainRequestMap["ensureDefaultReplyFlow"]): Promise<MainResponseMap["ensureDefaultReplyFlow"]> {
  const pageId = getCurrentPageId();
  const runtime = readRuntime();
  const name = payload.name?.trim() || "默认回复";
  const existing = await getDefaultReplyState(pageId, runtime.accessToken);
  if (existing) return { created: false, flow: existing };
  const blocks = createPrivateReplySkeleton(name).blocks;
  const post = { blocks, drafts: { blocks: cloneSerializable(blocks) }, config: {}, name };
  const form = new FormData();
  form.append("post", JSON.stringify(post));
  form.append("type", "default");
  const created = await botcakeFetch(`/api/v1/pages/${pageId}/create_contents`, runtime.accessToken, { method: "POST", body: form });
  const updated = await getDefaultReplyState(pageId, runtime.accessToken);
  if (!updated) throw new Error(`Botcake 未返回新默认回复 ID：${JSON.stringify(created).slice(0, 400)}`);
  return { created: true, flow: updated };
}

async function ensureWelcomeFlowFromComment(payload: MainRequestMap["ensureWelcomeFlowFromComment"]): Promise<EnsureWelcomeFlowResult> {
  const pageId = getCurrentPageId();
  const runtime = readRuntime();
  const settings = getCurrentSettings();
  const replies = await getPrivateRepliesWithRetry(pageId, runtime.accessToken);
  const commentFlow = firstRecord(replies[0]);
  if (!commentFlow?.id) throw new Error("请先创建评论私信流程，再设置欢迎信息");

  const comment = {
    id: String(commentFlow.id),
    name: String(commentFlow.name ?? commentFlow.title ?? `Flow ${commentFlow.id}`),
  };
  const current = await getWelcomeState(pageId, runtime.accessToken, settings);
  let changed = false;
  if (current.flow?.id !== comment.id) {
    const form = new FormData();
    form.append("type", "welcomes");
    form.append("flow_id", comment.id);
    await botcakeFetch(`/api/v1/pages/${pageId}/replace`, runtime.accessToken, { method: "POST", body: form });
    changed = true;
  }
  const enable = payload.enable !== false;
  if (enable && !booleanValue(settings.is_started)) {
    await saveSimplePageSetting(pageId, runtime.accessToken, "is_started", true);
    changed = true;
  }
  return { changed, flow: comment, enabled: enable ? true : booleanValue(settings.is_started) };
}

async function getWelcomeState(
  pageId: string,
  token: string,
  settings: Record<string, any>,
): Promise<NonNullable<PageAutomationState["welcome"]>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await botcakeFetch(`/api/v1/pages/${pageId}/get_contents?type=welcome`, token);
      const flow = firstRecord(result?.flow);
      return {
        enabled: booleanValue(settings.is_started),
        ...(flow?.id ? { flow: { id: String(flow.id), name: String(flow.name ?? flow.title ?? `Flow ${flow.id}`) } } : {}),
      };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function ensureBotFields(specs: BotFieldSpec[]): Promise<EnsureBotFieldsResult> {
  const allFields = await getAllBotFields();
  const activeByName = new Map(allFields
    .filter((field) => !booleanValue(field.is_archive))
    .map((field) => [field.name.trim().toLocaleLowerCase(), field]));
  const archivedByName = new Map(allFields
    .filter((field) => booleanValue(field.is_archive))
    .map((field) => [field.name.trim().toLocaleLowerCase(), field]));
  const created: BotField[] = [];
  const existing: BotField[] = [];
  const restored: BotField[] = [];
  for (const spec of specs) {
    const name = spec.name.trim();
    if (!name) throw new Error("机器人变量名称不能为空");
    const normalizedName = name.toLocaleLowerCase();
    const found = activeByName.get(normalizedName);
    if (found) { existing.push(found); continue; }
    const archived = archivedByName.get(normalizedName);
    if (archived) {
      await restoreBotFields([archived.id]);
      const active = { ...archived, is_archive: false };
      archivedByName.delete(normalizedName);
      activeByName.set(normalizedName, active);
      restored.push(active);
      continue;
    }
    const field = await createBotField(name, spec.type, spec.value, spec.description);
    activeByName.set(normalizedName, field);
    created.push(field);
  }
  return { created, existing, restored };
}

async function ensureDefaultCommentFlow(payload: MainRequestMap["ensureDefaultCommentFlow"]): Promise<EnsureDefaultCommentFlowResult> {
  const pageId = getCurrentPageId();
  const runtime = readRuntime();
  const settings = getCurrentSettings();
  const existingReplies = await getPrivateRepliesWithRetry(pageId, runtime.accessToken);
  const existing = firstRecord(existingReplies[0]);
  const enableAutoInbox = payload.enableAutoInbox !== false;
  if (existing?.id) {
    if (enableAutoInbox && !booleanValue(settings.inbox_from_comment)) {
      await saveSimplePageSetting(pageId, runtime.accessToken, "inbox_from_comment", true);
    }
    return {
      created: false,
      flow: { id: String(existing.id), name: String(existing.name ?? existing.title ?? `Flow ${existing.id}`) },
      autoInboxEnabled: enableAutoInbox ? true : booleanValue(settings.inbox_from_comment),
    };
  }

  const name = payload.name?.trim() || "评论";
  const post = createPrivateReplySkeleton(name);
  let replyId: string | undefined;
  try {
    const createForm = new FormData();
    createForm.append("post", JSON.stringify(post));
    const created = await botcakeFetch(`/api/v1/pages/${pageId}/create_private_reply?for_case=1`, runtime.accessToken, { method: "POST", body: createForm });
    replyId = String(created?.reply_id ?? created?.id ?? "");
    if (!replyId) throw new Error(`Botcake 未返回新评论流程 ID：${JSON.stringify(created).slice(0, 400)}`);

    post.id = Number.isSafeInteger(Number(replyId)) ? Number(replyId) : replyId;
    const saveForm = new FormData();
    saveForm.append("post", JSON.stringify(post));
    saveForm.append("is_preview", "false");
    saveForm.append("name", name);
    saveForm.append("is_preview_published", "false");
    saveForm.append("selected_tab", "content");
    await botcakeFetch(`/api/v1/pages/${pageId}/save_contents`, runtime.accessToken, { method: "POST", body: saveForm });
    if (enableAutoInbox) await saveSimplePageSetting(pageId, runtime.accessToken, "inbox_from_comment", true);
    return { created: true, flow: { id: replyId, name }, autoInboxEnabled: enableAutoInbox || booleanValue(settings.inbox_from_comment) };
  } catch (error) {
    if (replyId) {
      try { await botcakeFetch(`/api/v1/pages/${pageId}/private_replies?for_case=1`, runtime.accessToken, { method: "DELETE" }); }
      catch { /* best-effort rollback */ }
    }
    throw error;
  }
}

function createPrivateReplySkeleton(name: string): Record<string, any> {
  return {
    key: randomBotcakeKey(),
    type: "private_replies",
    name,
    post_id: null,
    config: { add_actions: [] },
    blocks: [{
      title: "Private Replies",
      coordinate: { coordinateX: 891, coordinateY: 779 },
      key: randomBotcakeKey(),
      cards: [{
        key: randomBotcakeKey(),
        is_valid: false,
        plugin_id: "text",
        is_spin: false,
        messages: [""],
        config: { text: "", buttons: [] },
      }],
    }],
  };
}

function randomBotcakeKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (value) => (value % 36).toString(36)).join("");
}

function getCurrentSettings(): Record<string, any> {
  const settings = firstRecord(window.__NEXT_REDUX_STORE__?.getState?.()?.pages?.currentSettings);
  if (!settings) throw new Error("尚未读取到当前专页设置，请等待 Botcake 页面加载完成");
  return cloneSerializable(settings);
}

function commentAutomationFromSettings(settings: Record<string, any>): CommentAutomationSettings {
  return {
    autoReplyComment: booleanValue(settings.auto_reply_comment),
    autoInbox: booleanValue(settings.inbox_from_comment),
    prioritizePostSettings: booleanValue(settings.prioritize_auto_reply_with_setup_of_each_post),
    replyBasedOnSpecificPosts: booleanValue(settings.only_reply_post_config),
    onlyFirstCommentOnPage: booleanValue(settings.only_reply_first_comment),
    onlyFirstCommentOnEachPost: booleanValue(settings.inbox_first_comment_post),
    onlyFirstLevelComments: booleanValue(settings.only_track_first_level_comment),
    inboxCommentsFromGroupPosts: booleanValue(settings.auto_comment_in_group),
    autoLikeComments: booleanValue(settings.auto_like_comment),
    ignoreSeedingAccounts: booleanValue(settings.no_auto_inb_fr_cmt_seeding),
    replies: normalizeCommentReplies(arrayValue(settings.data_comments)),
  };
}

function normalizeCommentReplies(value: unknown[]): CommentReplyItem[] {
  return value.map((item, index) => {
    const record = firstRecord(item) ?? {};
    const text = String(record.text ?? "").trim();
    const commentLevel2 = String(record.commentLevel2 ?? "").trim();
    if (!text) throw new Error(`第 ${index + 1} 条评论回复为空`);
    return {
      text,
      images: arrayValue(record.images) as Record<string, unknown>[],
      ...(commentLevel2 ? { commentLevel2, imagesLv2: arrayValue(record.imagesLv2) as Record<string, unknown>[] } : {}),
    };
  });
}

async function saveSimplePageSetting(pageId: string, token: string, key: string, value: boolean): Promise<void> {
  const form = new FormData();
  form.append(`changes[${key}]`, String(value));
  await botcakeFetch(`/api/v1/pages/${pageId}/settings`, token, { method: "POST", body: form });
}

async function activateDefaultReply(): Promise<MainResponseMap["activateDefaultReply"]> {
  const pageId = getCurrentPageId();
  const { accessToken } = readRuntime();
  // Botcake uses two independent page settings here. Keep the normal Default
  // mode selected before publishing so a failed second request never enables AI.
  await saveSimplePageSetting(pageId, accessToken, "is_using_ai_for_default_reply", false);
  await saveSimplePageSetting(pageId, accessToken, "is_published", true);
  return { enabled: true, usingAi: false };
}

async function saveCommentReplies(pageId: string, token: string, settings: Record<string, any>, replies: CommentReplyItem[]): Promise<void> {
  const changes = {
    keywords: settings.keywords ?? [],
    hide_comment_keyword: settings.hide_comment_keyword ?? [],
    time_ranges: readTimeRanges(settings),
    action_mention: settings.action_mention ?? null,
    data_comments: replies,
    data_has_phone: settings.data_has_phone ?? [],
    data_has_mentions: settings.data_has_mentions ?? [],
    data_phone_customer: settings.data_phone_customer ?? [],
    data_live_comment: settings.data_live_comment ?? [],
    cmt_add_actions: settings.cmt_add_actions ?? [],
    use_ai_for_default_cmt: Boolean(settings.use_ai_for_default_cmt),
    selected_agent_default_cmt: settings.selected_agent_default_cmt ?? null,
  };
  const form = new FormData();
  form.append("changes", JSON.stringify(changes));
  await botcakeFetch(`/api/v1/pages/${pageId}/settings/comment`, token, { method: "POST", body: form });
}

async function saveTargetCountryCodes(pageId: string, token: string, settings: Record<string, any>, countryCodes: string[]): Promise<void> {
  const form = new FormData();
  const webformSetting = { ...readWebformSetting(settings.webform_setting), country: countryCodes };
  form.append("changes", "general_webform");
  form.append("is_country_code", "true");
  form.append("is_admin", "false");
  form.append("is_add_actions", "false");
  form.append("is_webform", "false");
  form.append("webform_setting", JSON.stringify(webformSetting));
  await botcakeFetch(`/api/v1/pages/${pageId}/settings`, token, { method: "POST", body: form });
}

function readWebformSetting(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return cloneSerializable(value as Record<string, any>);
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed; } catch { /* ignore */ }
  }
  return {};
}

function readTargetCountryCodes(value: unknown): string[] {
  return uniqueStrings(arrayValue(readWebformSetting(value).country).map(String));
}

function readTimeRanges(settings: Record<string, any>): Array<{ begin_time: string; end_time: string }> {
  const ranges = arrayValue(settings.time_ranges);
  if (ranges.length) return ranges as Array<{ begin_time: string; end_time: string }>;
  return [{ begin_time: String(settings.begin_time ?? ""), end_time: String(settings.end_time ?? "") }];
}

function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function uniqueStrings(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
function finiteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
function booleanValue(value: unknown): boolean { return value === true || value === "true" || value === 1 || value === "1"; }

async function getPrivateRepliesWithRetry(pageId: string, token: string): Promise<unknown[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await botcakeFetch(`/api/v1/pages/${pageId}/settings/comment`, token);
      return findPrivateReplies(result);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

function inspectFlow(): FlowSnapshot {
  const runtime = readRuntime();
  const selectedPost = runtime.selectedPost;
  if (!selectedPost) throw new Error("尚未读取到当前 Flow，请等页面加载完成后重试");
  const defaultRoute = location.href.match(DEFAULT_REPLY_EDIT_URL_PATTERN);
  const identity = defaultRoute
    ? { pageId: defaultRoute[1], flowId: String(selectedPost.id ?? ""), kind: "defaultReply" as const }
    : getFlowIdentity();
  if (!identity.flowId) throw new Error("尚未读取到当前默认回复 ID，请等页面加载完成后重试");
  if (runtime.currentPageId && runtime.currentPageId !== identity.pageId) throw new Error("Botcake 仍在切换专页");
  const post = cloneSerializable(selectedPost);
  const name = String(selectedPost.name ?? selectedPost.title ?? document.title.replace(/\s*[-|].*$/, "") ?? "未命名 Flow");
  return {
    identity,
    name,
    post,
    selectedTab: runtime.selectedTab,
    isPreview: Boolean(selectedPost.is_preview ?? false),
    isPreviewPublished: Boolean(selectedPost.is_preview_published ?? false),
    botFields: cloneSerializable(runtime.botFields),
    capturedAt: new Date().toISOString(),
  };
}

async function saveFlow(payload: SaveFlowPayload): Promise<{ success: boolean; result?: unknown }> {
  const pageId = getCurrentPageId();
  const { accessToken } = readRuntime();
  const form = new FormData();
  form.append("post", JSON.stringify(payload.post));
  form.append("is_preview", String(payload.isPreview ?? false));
  form.append("name", payload.name);
  form.append("is_preview_published", String(payload.isPreviewPublished ?? false));
  form.append("selected_tab", String(payload.selectedTab ?? "content"));
  const result = await botcakeFetch(`/api/v1/pages/${pageId}/save_contents`, accessToken, {
    method: "POST",
    body: form,
  });
  return { success: result?.success !== false, result };
}

async function getBotFields(): Promise<BotField[]> {
  return (await getAllBotFields()).filter((field) => !booleanValue(field.is_archive));
}

async function getAllBotFields(): Promise<BotField[]> {
  const pageId = getCurrentPageId();
  const { accessToken } = readRuntime();
  const json = await botcakeFetch(`/api/v1/pages/${pageId}/bot_field`, accessToken);
  const fields = Array.isArray(json?.result) ? json.result : Array.isArray(json) ? json : [];
  return fields as BotField[];
}

async function createBotField(name: string, type = "string", value?: unknown, description = ""): Promise<BotField> {
  const pageId = getCurrentPageId();
  const { accessToken } = readRuntime();
  const normalizedName = name.trim().toLocaleLowerCase();
  const sameName = (await getAllBotFields()).find((field) => field.name.trim().toLocaleLowerCase() === normalizedName);
  if (sameName) {
    if (booleanValue(sameName.is_archive)) {
      await restoreBotFields([sameName.id]);
      return { ...sameName, is_archive: false };
    }
    return sameName;
  }
  const field = {
    name,
    type,
    value: value ?? defaultBotFieldValue(type),
    description,
    folder_id: null,
  };
  const form = new FormData();
  form.append("field", JSON.stringify(field));
  form.append("path", location.pathname);
  const result = await botcakeFetch(`/api/v1/pages/${pageId}/bot_field`, accessToken, {
    method: "POST",
    body: form,
  });
  const created = result?.result ?? result?.field ?? result;
  if (!created?.id) throw new Error(`机器人变量“${name}”创建失败：${JSON.stringify(result)}`);
  return created as BotField;
}

async function restoreBotFields(fieldIds: Array<string | number>): Promise<void> {
  if (!fieldIds.length) return;
  const pageId = getCurrentPageId();
  const { accessToken } = readRuntime();
  const form = new FormData();
  form.append("changes", JSON.stringify({ is_archive: false, field_ids: fieldIds }));
  const result = await botcakeFetch(`/api/v1/pages/${pageId}/bot_field/archive`, accessToken, {
    method: "POST",
    body: form,
  });
  if (result?.success === false) throw new Error(`机器人变量取消归档失败：${JSON.stringify(result).slice(0, 400)}`);
}

async function uploadMedia(payload: MainRequestMap["uploadMedia"]): Promise<Record<string, unknown>> {
  const pageId = getCurrentPageId();
  const { accessToken } = readRuntime();
  const bytes = base64ToBytes(payload.base64);
  const file = new File([bytes.slice().buffer as ArrayBuffer], payload.name, { type: payload.mime });
  const form = new FormData();
  form.append("name", payload.name);
  form.append("file", file);
  form.append("upload_type", payload.kind);
  form.append("length", String(file.size));
  const result = await botcakeFetch(
    `/api/v1/pages/${pageId}/contents?is_reusable=true&upload_type=${payload.kind}`,
    accessToken,
    { method: "POST", body: form },
  );
  if (result?.success === false) throw new Error(`素材上传失败：${result?.message ?? "未知错误"}`);
  const root = objectValue(result?.result) ?? objectValue(result?.data) ?? objectValue(result) ?? {};
  const kindData = objectValue(root[`${payload.kind}_data`])
    ?? objectValue(result?.[`${payload.kind}_data`])
    ?? objectValue(result?.result?.[`${payload.kind}_data`])
    ?? objectValue(result?.data?.[`${payload.kind}_data`])
    ?? {};
  const media = { ...root, ...kindData };
  const contentUrl = media.content_url ?? media.url ?? result?.content_url ?? result?.url;
  const previewUrl = media.content_preview_url ?? media.preview_url ?? result?.content_preview_url ?? result?.preview_url ?? contentUrl;
  if (!contentUrl && !media.content_id && !media.fb_id) {
    throw new Error(`Botcake 素材上传成功但未返回素材信息：${JSON.stringify(result).slice(0, 600)}`);
  }
  return {
    ...result,
    ...media,
    content_url: contentUrl,
    url: contentUrl,
    preview_url: previewUrl,
    name: media.name ?? result?.name ?? payload.name,
    page_id: pageId,
  } as Record<string, unknown>;
}

function objectValue(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

async function getPrivateReplies(): Promise<unknown[]> {
  const pageId = getCurrentPageId();
  const { accessToken } = readRuntime();
  const result = await botcakeFetch(`/api/v1/pages/${pageId}/settings/comment`, accessToken);
  return findPrivateReplies(result);
}

async function getCommentFlowStatus(): Promise<CommentFlowStatus> {
  const pageId = getCurrentPageId();
  const runtime = readRuntime();
  const state = window.__NEXT_REDUX_STORE__?.getState?.();
  const reduxReplies = Array.isArray(state?.cards?.privateReplies) ? state.cards.privateReplies : [];
  const reduxSettings = firstRecord(state?.pages?.currentSettings);
  if (reduxReplies.length) return commentFlowStatusFrom(pageId, reduxReplies, reduxSettings ?? {});

  const result = await botcakeFetch(`/api/v1/pages/${pageId}/settings/comment`, runtime.accessToken);
  const replies = findPrivateReplies(result);
  const settings = reduxSettings
    ?? firstRecord(result?.result)
    ?? firstRecord(result?.settings)
    ?? firstRecord(result)
    ?? {};
  return commentFlowStatusFrom(pageId, replies, settings);
}

function commentFlowStatusFrom(pageId: string, replies: unknown[], settings: Record<string, unknown>): CommentFlowStatus {
  const first = replies.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).id) as Record<string, unknown> | undefined;
  return {
    pageId,
    flow: first ? { id: String(first.id), name: String(first.name ?? first.title ?? `Flow ${first.id}`) } : undefined,
    autoInbox: firstBoolean(settings, ["inbox_from_comment", "auto_inbox", "is_auto_inbox"]),
    autoReplyComment: firstBoolean(settings, ["auto_reply_comment", "is_auto_reply_comment"]),
  };
}

function findPrivateReplies(value: any): unknown[] {
  const candidates = [
    value?.private_replies,
    value?.privateReplies,
    value?.result?.private_replies,
    value?.result?.privateReplies,
    value?.settings?.private_replies,
    value?.settings?.privateReplies,
  ];
  return candidates.find(Array.isArray) ?? [];
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function firstBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) if (typeof record[key] === "boolean") return record[key] as boolean;
  return undefined;
}

function getCurrentPageId(): string {
  const fromUrl = location.pathname.match(/^\/(\d+)(?:\/|$)/)?.[1];
  if (!fromUrl) throw new Error("当前页面尚未选择 Botcake 专页");
  const runtimePageId = readRuntime().currentPageId;
  if (runtimePageId && runtimePageId !== fromUrl) throw new Error("Botcake 仍在切换专页");
  return fromUrl;
}

async function botcakeFetch(path: string, accessToken: string, init: RequestInit = {}): Promise<any> {
  const url = new URL(path, location.origin);
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
  const text = await response.text();
  let body: any;
  try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  if (!response.ok) throw new Error(`Botcake 接口 ${response.status}：${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

function readRuntime(): RuntimeState {
  const reduxRuntime = readReduxRuntime();
  if (reduxRuntime) return reduxRuntime;

  const roots = collectReactRoots();
  const objects = collectObjects(roots, 5, 5000);
  const accessToken = findStringProperty(objects, ["accessToken", "access_token", "token"])
    ?? findNextDataToken();
  if (!accessToken) throw new Error("无法取得 Botcake 登录令牌，请刷新页面后重试");

  const selectedPost = findSelectedPost(objects);
  const botFields = findArrayProperty(objects, "botFields")
    ?? findArrayProperty(objects, "bot_fields")
    ?? [];
  const selectedTabValue = findPrimitiveProperty(objects, ["selectedTab", "selected_tab", "selectedTabMenu"]);
  const selectedTab = typeof selectedTabValue === "string" || typeof selectedTabValue === "number"
    ? selectedTabValue
    : undefined;
  return { accessToken, selectedPost, botFields: botFields as BotField[], selectedTab };
}

function readReduxRuntime(): RuntimeState | undefined {
  const state = window.__NEXT_REDUX_STORE__?.getState?.();
  if (!state) return undefined;
  const accessTokenValue = state.auth?.accessToken ?? state.auth?.access_token;
  if (typeof accessTokenValue !== "string" || accessTokenValue.length <= 10) return undefined;
  const selectedPost = isPost(state.cards?.selectedPost) ? state.cards.selectedPost : undefined;
  const fields = state.pages?.botFields ?? state.pages?.bot_fields;
  const selectedTabValue = state.cards?.selectedTabMenu;
  const pageIdValue = state.pages?.currentPageId;
  return {
    accessToken: accessTokenValue,
    selectedPost,
    botFields: Array.isArray(fields) ? fields as BotField[] : [],
    selectedTab: typeof selectedTabValue === "string" || typeof selectedTabValue === "number" ? selectedTabValue : undefined,
    currentPageId: typeof pageIdValue === "string" || typeof pageIdValue === "number" ? String(pageIdValue) : undefined,
  };
}

function installRouteObserver(): void {
  if (window.__BOTCAKE_FLOW_TOOLKIT_ROUTE_OBSERVER__) return;
  window.__BOTCAKE_FLOW_TOOLKIT_ROUTE_OBSERVER__ = true;
  const notify = () => window.postMessage({ app: APP_ID, channel: "route", href: location.href }, location.origin);
  const historyMethods = history as unknown as Record<"pushState" | "replaceState", (...args: unknown[]) => unknown>;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = historyMethods[method].bind(history);
    historyMethods[method] = (...args: unknown[]) => {
      const result = original(...args);
      queueMicrotask(notify);
      return result;
    };
  }
  window.addEventListener("popstate", notify);
  window.addEventListener("hashchange", notify);
}

function collectReactRoots(): unknown[] {
  const roots: unknown[] = [];
  const elements = document.querySelectorAll(".react-flow__node, .react-flow, #__next");
  for (const element of elements) {
    for (const key of Object.getOwnPropertyNames(element)) {
      if (!key.startsWith("__reactFiber$") && !key.startsWith("__reactProps$") && !key.startsWith("__reactContainer$")) continue;
      let fiber = (element as unknown as Record<string, unknown>)[key] as Record<string, unknown> | undefined;
      let guard = 0;
      while (fiber && guard < 150) {
        roots.push(fiber.memoizedProps, fiber.pendingProps, fiber.memoizedState);
        fiber = fiber.return as Record<string, unknown> | undefined;
        guard += 1;
      }
    }
  }
  const nextData = document.getElementById("__NEXT_DATA__")?.textContent;
  if (nextData) {
    try { roots.push(JSON.parse(nextData)); } catch { /* ignore */ }
  }
  return roots.filter(Boolean);
}

function collectObjects(roots: unknown[], maxDepth: number, maxItems: number): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const seen = new WeakSet<object>();
  const queue = roots.map((value) => ({ value, depth: 0 }));
  while (queue.length && result.length < maxItems) {
    const item = queue.shift()!;
    if (!item.value || typeof item.value !== "object" || seen.has(item.value as object)) continue;
    if (item.value instanceof Element || item.value instanceof Window || item.value instanceof EventTarget) continue;
    seen.add(item.value as object);
    if (Array.isArray(item.value)) {
      if (item.depth < maxDepth) item.value.slice(0, 300).forEach((value) => queue.push({ value, depth: item.depth + 1 }));
      continue;
    }
    const record = item.value as Record<string, unknown>;
    result.push(record);
    if (item.depth >= maxDepth) continue;
    for (const value of Object.values(record).slice(0, 300)) queue.push({ value, depth: item.depth + 1 });
  }
  return result;
}

function findSelectedPost(objects: Record<string, unknown>[]): Record<string, unknown> | undefined {
  for (const object of objects) {
    const direct = object.selectedPost;
    if (isPost(direct)) return direct;
    if (isPost(object) && (object.id || object.key)) return object;
  }
  return undefined;
}

function isPost(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).blocks));
}

function findStringProperty(objects: Record<string, unknown>[], keys: string[]): string | undefined {
  const value = findPrimitiveProperty(objects, keys);
  return typeof value === "string" && value.length > 10 ? value : undefined;
}

function findPrimitiveProperty(objects: Record<string, unknown>[], keys: string[]): string | number | boolean | undefined {
  for (const object of objects) {
    for (const key of keys) {
      const value = object[key];
      if (["string", "number", "boolean"].includes(typeof value)) return value as string | number | boolean;
    }
  }
  return undefined;
}

function findArrayProperty(objects: Record<string, unknown>[], key: string): unknown[] | undefined {
  for (const object of objects) if (Array.isArray(object[key])) return object[key] as unknown[];
  return undefined;
}

function findNextDataToken(): string | undefined {
  const text = document.getElementById("__NEXT_DATA__")?.textContent;
  if (!text) return undefined;
  const match = text.match(/"(?:accessToken|access_token)":"([^"]+)"/);
  return match?.[1];
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function defaultBotFieldValue(type: string): unknown {
  if (type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "date") return Math.floor(Date.now() / 1000);
  return " ";
}
