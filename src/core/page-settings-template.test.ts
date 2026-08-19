import { describe, expect, it } from "vitest";
import { extractPageSettingsTemplate, parsePageSettingsTemplate, templateToUpdatePayload } from "./page-settings-template";
import type { PageAutomationState } from "../shared/types";

const state: PageAutomationState = {
  pageId: "123",
  timezone: 8,
  targetCountryCodes: ["95"],
  comment: {
    autoReplyComment: true,
    autoInbox: true,
    prioritizePostSettings: false,
    replyBasedOnSpecificPosts: false,
    onlyFirstCommentOnPage: false,
    onlyFirstCommentOnEachPost: true,
    onlyFirstLevelComments: true,
    inboxCommentsFromGroupPosts: true,
    autoLikeComments: false,
    ignoreSeedingAccounts: false,
    replies: [{ text: "一级", images: [], commentLevel2: "不会导出", imagesLv2: [] }],
  },
  botFields: [{ id: 1, name: "fish_link", type: "string", value: "https://example.com" }],
};

describe("page settings template", () => {
  it("extracts transferable settings without private reply configuration", () => {
    const template = extractPageSettingsTemplate(state, "缅甸专页");
    expect(template.settings.comment).not.toHaveProperty("autoInbox");
    expect(template.settings.comment.onlyFirstCommentOnEachPost).toBe(true);
    expect(template.settings.comment.replies).toEqual([{ text: "一级", images: [] }]);
    expect(template.settings.botFields[0]).toMatchObject({ name: "fish_link", value: "https://example.com" });
  });

  it("builds an update payload that only contains first-level replies", () => {
    const payload = templateToUpdatePayload(extractPageSettingsTemplate(state));
    expect(payload.comment?.replies).toEqual([{ text: "一级", images: [] }]);
    expect(payload.comment).not.toHaveProperty("autoInbox");
  });

  it("rejects unknown or incomplete template data", () => {
    expect(() => parsePageSettingsTemplate({ format: "other" })).toThrow("专页设置模板格式无效");
  });

  it("rejects mutually exclusive first-comment settings", () => {
    const template = extractPageSettingsTemplate(state);
    template.settings.comment.onlyFirstCommentOnPage = true;
    template.settings.comment.onlyFirstCommentOnEachPost = true;
    expect(() => parsePageSettingsTemplate(template)).toThrow("不能同时开启");
  });
});
