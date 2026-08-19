import type { CommentReplyItem } from "../shared/types";

/**
 * 将“每行一条回复”的批量文本转换成 Botcake data_comments。
 * JSON 序列化交给 fetch 层处理，因此引号、反斜杠和 Unicode 不需要手工转义。
 */
export function parseBulkCommentReplies(source: string): CommentReplyItem[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ text, images: [] }));
}

export function serializeBulkCommentReplies(replies: CommentReplyItem[]): string {
  return replies.map((reply) => reply.text.trim()).filter(Boolean).join("\n");
}
