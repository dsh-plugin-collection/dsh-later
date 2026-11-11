/**
 * 附件图片读取失败的**分类**（宿主拒绝 ≠ 真损坏）。
 *
 * 宿主 `session.readAttachment(id)` 只允许读「已被本会话事件引用」的附件，否则返回
 * `session/attachment-invalid: Image is not referenced by this session`。
 *
 * 待发送提醒的附件**在发出前本来就不会被日志引用**（`/later` 的附件由命令契约做
 * 耐久化准入，真正进会话要等到点代发那一刻），所以这条错误是**预期状态**，不是损坏。
 * 把它渲染成「图片不可用」会让人以为附件丢了 —— 实际上到点会随消息一起发出（已实测）。
 *
 * 这个分类抽成纯函数，供客户端与测试共用；宿主返回的其他错误仍归为 `unavailable`。
 *
 * @module dsh-later/attachment-failure
 */

/** 图片读不到的两种性质。 */
export type AttachmentImageFailure = 'pending-send' | 'unavailable';

/**
 * 判定一次图片读取失败的性质。
 * @param error 宿主 `imageUrl()` / `readAttachment()` 的拒绝原因
 * @returns `pending-send`（尚未被会话引用，等到点发送后自然可见）或 `unavailable`（真读不到）
 */
export function classifyAttachmentFailure(error: unknown): AttachmentImageFailure {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /session\/attachment-invalid|not referenced by this session/i.test(message)
    ? 'pending-send'
    : 'unavailable';
}
