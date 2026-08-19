import { z } from "zod";
import type {
  BotFieldSpec,
  CommentReplyItem,
  PageAutomationState,
  PageSettingsTemplateV1,
  UpdatePageAutomationPayload,
} from "../shared/types";

const commentReplySchema = z.object({
  text: z.string().trim().min(1),
  images: z.array(z.record(z.string(), z.unknown())).optional().default([]),
}).strict();

const botFieldSchema = z.object({
  name: z.string().trim().min(1),
  type: z.string().optional(),
  value: z.unknown().optional(),
  description: z.string().optional(),
}).strict();

const pageSettingsTemplateSchema = z.object({
  format: z.literal("botcake-page-settings-template"),
  version: z.literal(1),
  meta: z.object({
    name: z.string().trim().min(1),
    description: z.string().optional(),
    createdAt: z.string(),
    sourcePageId: z.string().optional(),
  }).strict(),
  settings: z.object({
    timezone: z.number().min(-12).max(14).optional(),
    targetCountryCodes: z.array(z.string().trim().min(1)).min(1),
    comment: z.object({
      autoReplyComment: z.boolean(),
      prioritizePostSettings: z.boolean(),
      replyBasedOnSpecificPosts: z.boolean(),
      onlyFirstCommentOnPage: z.boolean(),
      onlyFirstCommentOnEachPost: z.boolean(),
      onlyFirstLevelComments: z.boolean(),
      inboxCommentsFromGroupPosts: z.boolean(),
      autoLikeComments: z.boolean(),
      ignoreSeedingAccounts: z.boolean(),
      replies: z.array(commentReplySchema),
    }).strict().refine(
      (value) => !(value.onlyFirstCommentOnPage && value.onlyFirstCommentOnEachPost),
      { message: "“专页首次评论”和“每篇帖子首次评论”不能同时开启", path: ["onlyFirstCommentOnEachPost"] },
    ),
    botFields: z.array(botFieldSchema),
  }).strict(),
}).strict();

export function extractPageSettingsTemplate(
  state: PageAutomationState,
  name = `专页设置-${state.pageId}`,
): PageSettingsTemplateV1 {
  return {
    format: "botcake-page-settings-template",
    version: 1,
    meta: {
      name,
      createdAt: new Date().toISOString(),
      sourcePageId: state.pageId,
    },
    settings: {
      timezone: state.timezone,
      targetCountryCodes: [...state.targetCountryCodes],
      comment: {
        autoReplyComment: state.comment.autoReplyComment,
        prioritizePostSettings: state.comment.prioritizePostSettings,
        replyBasedOnSpecificPosts: state.comment.replyBasedOnSpecificPosts,
        onlyFirstCommentOnPage: state.comment.onlyFirstCommentOnPage,
        onlyFirstCommentOnEachPost: state.comment.onlyFirstCommentOnEachPost,
        onlyFirstLevelComments: state.comment.onlyFirstLevelComments,
        inboxCommentsFromGroupPosts: state.comment.inboxCommentsFromGroupPosts,
        autoLikeComments: state.comment.autoLikeComments,
        ignoreSeedingAccounts: state.comment.ignoreSeedingAccounts,
        replies: firstLevelReplies(state.comment.replies),
      },
      botFields: state.botFields.map(toBotFieldSpec),
    },
  };
}

export function parsePageSettingsTemplate(source: string | unknown): PageSettingsTemplateV1 {
  const value = typeof source === "string" ? JSON.parse(source) : source;
  const parsed = pageSettingsTemplateSchema.safeParse(value);
  if (!parsed.success) throw new Error(`专页设置模板格式无效：${parsed.error.issues[0]?.message ?? "未知错误"}`);
  return parsed.data as PageSettingsTemplateV1;
}

export function serializePageSettingsTemplate(template: PageSettingsTemplateV1): string {
  return `${JSON.stringify(parsePageSettingsTemplate(template), null, 2)}\n`;
}

export function templateToUpdatePayload(template: PageSettingsTemplateV1): UpdatePageAutomationPayload {
  const checked = parsePageSettingsTemplate(template);
  return {
    timezone: checked.settings.timezone,
    targetCountryCodes: checked.settings.targetCountryCodes,
    comment: { ...checked.settings.comment, replies: firstLevelReplies(checked.settings.comment.replies) },
  };
}

function firstLevelReplies(replies: CommentReplyItem[]): CommentReplyItem[] {
  return replies.map((reply) => ({ text: reply.text.trim(), images: [...(reply.images ?? [])] })).filter((reply) => reply.text);
}

function toBotFieldSpec(field: PageAutomationState["botFields"][number]): BotFieldSpec {
  return {
    name: field.name,
    ...(typeof field.type === "string" ? { type: field.type } : {}),
    ...(Object.prototype.hasOwnProperty.call(field, "value") ? { value: field.value } : {}),
    ...(typeof field.description === "string" ? { description: field.description } : {}),
  };
}
