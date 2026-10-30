/**
 * `/later` 代发消息的**来源标记**（host 写，client 读）。
 *
 * 为什么需要：`/later` 到点后以用户身份送出，投递时 `source` 只有 `{kind:'user'}`，
 * 与手动发送的消息在日志、投影、客户端节点里完全一致。任何「这条是定时发的」的
 * 呈现（气泡标记、统计、审计）都无从判断。
 *
 * 形状（issue #112）：
 *
 * ```ts
 * { kind: 'user', later: { v: 1, delivery: 'one-shot', count: 1 } }
 * ```
 *
 * 不改 `kind`：客户端的 input-message 生命周期按 `source.kind === 'user'` 分流，
 * 改 kind 会把消息渲染成 context 行。附加字段由 `createMessage` 的
 * `structuredClone` 原样保留（没有 schema 校验），客户端节点也带得过去。
 *
 * 容错口径：读侧只认「有 `later` 对象且 `v` 是 >= 1 的数字」。未来 `v > 1` 的写侧
 * 仍会被识别为定时消息，未知字段忽略；坏值一律当没有标记，绝不因此把消息画坏。
 * @module dsh-later/later-message-source
 */
/** 标记版本。语义变化时才进位（加字段不加）。
 *
 * 注意：`src/client` 与 host 共用本模块，**不能**引入任何 Node 内置模块。
 */
export declare const LATER_SOURCE_VERSION = 1;
/** 投递形态：一次性 / 固定间隔。 */
export type LaterDeliveryKind = 'one-shot' | 'every';
/** `source.later` 的 v1 形状。 */
export interface LaterUserMessageMarker {
    readonly v: number;
    readonly delivery: LaterDeliveryKind;
    readonly count: number;
}
/** 代发消息的完整 source（可直接交给 `createUserMessage`）。 */
export interface LaterUserSource {
    readonly kind: 'user';
    readonly later: LaterUserMessageMarker;
}
/**
 * 构造代发消息的 source。
 * @param input - 投递形态与本批条数。
 * @returns `{ kind: 'user', later: { v, delivery, count } }`。
 */
export declare function laterUserSource(input: {
    readonly delivery: LaterDeliveryKind;
    readonly count: number;
}): LaterUserSource;
/**
 * 从任意 source 读标记。
 * @param source - 日志里的 `UserMessage.source`（不可信输入）。
 * @returns 标记；不是定时消息或数据坏掉时为 undefined。
 */
export declare function readLaterMarker(source: unknown): LaterUserMessageMarker | undefined;
