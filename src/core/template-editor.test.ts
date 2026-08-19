import { describe, expect, it } from "vitest";
import { assignMediaInput, detachMediaInput, plainTextToRawText, pruneUnusedTemplateInputs, rawTextToPlainText, reconcileTemplateInputBindings, removeUnusedTemplateInput, replaceTemplateSection, syncBlockRichTextMirrors, syncBlockTextInputBindings, syncTextInputBindings } from "./template-editor";
import type { FlowTemplateV1 } from "../shared/types";

function emptyTemplate(): FlowTemplateV1 {
  return {
    format: "botcake-flow-template",
    version: 1,
    meta: { id: "test", name: "测试", createdAt: "2026-08-17T00:00:00.000Z" },
    flow: { name: "测试", entryBlockKey: "a", post: { blocks: [{ key: "a" }] } },
    inputs: [],
    dependencies: { botFields: [], media: [], unsupported: [] },
  };
}

describe("template editor helpers", () => {
  it("registers inline placeholders and reuses one definition across paths", () => {
    const template = emptyTemplate();
    template.flow.post.blocks = [{ key: "a", cards: [{ plugin_id: "text", config: { text: "您好 [[name]]", buttons: [{ type: "link", title: "查看", url: "https://example.com/[[name]]" }] } }] }];
    syncTextInputBindings(template, "$.blocks[0].cards[0].config.text", "您好 [[name]]", true);
    syncTextInputBindings(template, "$.blocks[0].cards[0].config.buttons[0].url", "https://example.com/[[name]]", false);
    expect(template.inputs).toHaveLength(1);
    expect(template.inputs[0]).toMatchObject({ key: "name", kind: "text", required: true });
    expect(template.inputs[0].bindings).toEqual([
      "$.blocks[0].cards[0].config.text",
      "$.blocks[0].cards[0].config.buttons[0].url",
    ]);
  });

  it("updates bindings when a field stops using a variable", () => {
    const template = emptyTemplate();
    template.flow.post.blocks = [{ key: "a", cards: [{ plugin_id: "text", config: { text: "[[title]]" } }] }];
    syncTextInputBindings(template, "$.blocks[0].title", "[[title]]", false);
    (template.flow.post.blocks as Array<{ cards: Array<{ config: { text: string } }> }>)[0].cards[0].config.text = "固定标题";
    syncTextInputBindings(template, "$.blocks[0].title", "固定标题", false);
    expect(template.inputs).toEqual([]);
  });

  it("removes abandoned typing variants but keeps variables still present in the flow", () => {
    const template = emptyTemplate();
    template.flow.post.blocks = [{ key: "a", cards: [{ plugin_id: "text", config: { text: "[[fish_text]]" } }] }];
    template.inputs = [
      { key: "f", label: "F", kind: "text", bindings: [] },
      { key: "fish", label: "Fish", kind: "text", bindings: [] },
      { key: "fish_text", label: "正文", kind: "text", bindings: ["$.blocks[0].cards[0].config.text"] },
    ];
    expect(pruneUnusedTemplateInputs(template)).toEqual(["f", "fish"]);
    expect(template.inputs.map((input) => input.key)).toEqual(["fish_text"]);
  });

  it("reconciles placeholders after editing one node as JSON", () => {
    const template = emptyTemplate();
    template.flow.post.blocks = [{
      key: "a",
      cards: [{
        plugin_id: "text",
        config: {
          text: "您好 [[name]]",
          buttons: [{ type: "link", title: "查看", url: "https://example.com/[[name]]" }],
        },
      }],
    }];
    syncBlockTextInputBindings(template, 0);
    expect(template.inputs).toHaveLength(1);
    expect(template.inputs[0].bindings).toEqual([
      "$.blocks[0].cards[0].config.text",
      "$.blocks[0].cards[0].config.buttons[0].url",
    ]);
  });

  it("rebuilds all bindings in one batch without losing later variable options", () => {
    const template = emptyTemplate();
    template.flow.post.blocks = [{
      key: "a",
      cards: [{ plugin_id: "text", config: { text: "[[first]]", buttons: [{ type: "link", title: "打开", url: "https://example.com/[[second]]" }] } }],
    }];
    template.inputs = [
      { key: "first", label: "第一项", kind: "text", required: true, bindings: [] },
      { key: "second", label: "第二项", kind: "text", required: true, bindings: [], options: [{ label: "预设", value: "abc" }] },
    ];
    syncBlockTextInputBindings(template, 0);
    expect(template.inputs.find((input) => input.key === "second")).toMatchObject({
      label: "第二项",
      options: [{ label: "预设", value: "abc" }],
      bindings: ["$.blocks[0].cards[0].config.buttons[0].url"],
    });
  });

  it("keeps configured unused variables until the user deletes them", () => {
    const template = emptyTemplate();
    template.inputs = [
      { key: "empty", label: "Empty", kind: "text", required: true, bindings: [] },
      { key: "saved", label: "已配置文案", kind: "text", required: true, bindings: [], options: [{ label: "版本 A", value: "完整文案" }] },
    ];
    expect(pruneUnusedTemplateInputs(template)).toEqual(["empty"]);
    expect(template.inputs.map((input) => input.key)).toEqual(["saved"]);
    expect(removeUnusedTemplateInput(template, "saved")).toBe(true);
    expect(template.inputs).toEqual([]);
  });

  it("reuses copied input JSON while rebuilding bindings for the target template", () => {
    const target = emptyTemplate();
    target.flow.post.blocks = [{ key: "a", cards: [{ plugin_id: "text", config: { text: "目标 [[content]]", buttons: [{ url: "https://example.com/[[id]]" }] } }] }];
    const copiedInputs: FlowTemplateV1["inputs"] = [
      { key: "content", label: "正文", kind: "random", required: true, bindings: ["$.blocks[99].old"], options: [{ label: "版本 A", value: "文案 A" }] },
      { key: "id", label: "账号 ID", kind: "text", required: true, bindings: ["$.blocks[88].old"], options: [{ label: "默认账号", value: "123" }] },
    ];
    replaceTemplateSection(target, "inputs", copiedInputs);
    reconcileTemplateInputBindings(target);
    expect(target.inputs.find((input) => input.key === "content")).toMatchObject({
      kind: "random",
      options: [{ label: "版本 A", value: "文案 A" }],
      bindings: ["$.blocks[0].cards[0].config.text"],
    });
    expect(target.inputs.find((input) => input.key === "id")?.bindings).toEqual(["$.blocks[0].cards[0].config.buttons[0].url"]);
  });

  it("can merge and split one media position without renaming the whole shared variable", () => {
    const template = emptyTemplate();
    template.inputs = [
      { key: "media_1", label: "主图", kind: "image", bindings: ["$.blocks[0].cards[0].config"], options: [{ label: "图片 A", url: "https://example.com/a.png" }] },
      { key: "media_2", label: "副图", kind: "image", bindings: ["$.blocks[0].cards[1].config"] },
    ];
    template.dependencies.media = [
      { key: "media_1", kind: "image", configPath: "$.blocks[0].cards[0].config" },
      { key: "media_2", kind: "image", configPath: "$.blocks[0].cards[1].config" },
    ];
    expect(assignMediaInput(template, "$.blocks[0].cards[1].config", "media_1")).toEqual({ reused: true });
    expect(template.inputs).toHaveLength(1);
    expect(template.inputs[0]).toMatchObject({ key: "media_1", options: [{ label: "图片 A", url: "https://example.com/a.png" }] });
    expect(template.inputs[0].bindings).toEqual(["$.blocks[0].cards[0].config", "$.blocks[0].cards[1].config"]);
    expect(template.dependencies.media.map((media) => media.key)).toEqual(["media_1", "media_1"]);

    expect(assignMediaInput(template, "$.blocks[0].cards[1].config", "separate_image")).toEqual({ reused: false });
    expect(template.inputs.map((input) => input.key)).toEqual(["media_1", "separate_image"]);
    expect(template.inputs.find((input) => input.key === "media_1")?.bindings).toEqual(["$.blocks[0].cards[0].config"]);
    expect(template.inputs.find((input) => input.key === "separate_image")).toMatchObject({ options: [{ label: "图片 A", url: "https://example.com/a.png" }], bindings: ["$.blocks[0].cards[1].config"] });

    detachMediaInput(template, "$.blocks[0].cards[1].config");
    expect(template.inputs.map((input) => input.key)).toEqual(["media_1"]);
    expect(template.dependencies.media[1].key).toMatch(/^fixed_image_/);
  });

  it("keeps Botcake text and rawText mirrors synchronized", () => {
    const template = emptyTemplate();
    template.flow.post.blocks = [{
      key: "a",
      cards: [{ plugin_id: "text", config: { text: "第一行\n第二行", rawText: [{ children: [{ text: "旧内容" }] }] } }],
    }];
    syncBlockRichTextMirrors(template, 0);
    const config = (template.flow.post.blocks as Array<{ cards: Array<{ config: { rawText: unknown } }> }>)[0].cards[0].config;
    expect(config.rawText).toEqual(plainTextToRawText("第一行\n第二行"));
    expect(rawTextToPlainText(config.rawText)).toBe("第一行\n第二行");
  });
});
