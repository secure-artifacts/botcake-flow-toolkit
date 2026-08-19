import { describe, expect, it } from "vitest";
import { parseBulkCommentReplies, serializeBulkCommentReplies } from "./comment-automation";

describe("comment automation", () => {
  it("converts every non-empty line into a Botcake comment reply", () => {
    expect(parseBulkCommentReplies('第一条 "回复"\r\n\r\n  第二条  ')).toEqual([
      { text: '第一条 "回复"', images: [] },
      { text: "第二条", images: [] },
    ]);
  });

  it("returns an empty list for blank input", () => {
    expect(parseBulkCommentReplies(" \n\r\n")).toEqual([]);
  });

  it("serializes replies back to line based editing text", () => {
    expect(serializeBulkCommentReplies([
      { text: "A", images: [] },
      { text: " B ", images: [] },
    ])).toBe("A\nB");
  });
});
