/**
 * 客户端 → host 变更通道：通过 DSH 的 slash-command 一等机制把 GUI 的
 * 创建/删除/列表请求送到宿主，由 handler 复用 `user-tools` 一次性写入会话日志。
 *
 * 为什么不用 Typert Remote：命令 handler 直接携带 `agent`，天然按会话路由，
 * 且 `command/run` / `command/done` 自动落日志（审计友好）。`recordInput: false`
 * 避免把 GUI 的 JSON 载荷重复写进日志（权威载荷在 domain 事件里）。
 *
 * 客户端经 `session.command('/user-schedule-create <json>')` 调用；
 * 返回的 `RemoteResult<{matched}>` 只表达“已受理”，状态以 `userSchedules`
 * 投影回流（commands 框架本身的 admission 语义）。
 * @module dsh-later/commands
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CommandDefinition } from '@deepseek-ai/dsh-commands';
import type { PromptLimits } from './user-tools.js';
/**
 * 用户创建/删除成功后的通知回调（宿主用它重驱用户调度器）。
 * @returns 调度器是否在位。false 表示"这条不会被触发"，创建路径必须把它说出来。
 */
export type UserChangeNotifier = (agent: Agent) => boolean;
/**
 * 用户主动插话回调（GUI「插话发送」按钮触发）。handler 返回 steer 结果；
 * - `{ ok: true, steered: true }` 表示已成功把消息立即推给 in-flight agent；
 * - `{ ok: false, code }` 表示拒绝（未到点 / 不存在 / every 类型暂不支持）。
 * @module dsh-later/commands
 */
export type UserSteerHandler = (agent: Agent, id: string) => Promise<{
    readonly ok: true;
    readonly id: string;
    readonly steered: true;
} | {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
}>;
/** `parseScheduleSpec` 的结果。 */
export type ParsedScheduleSpec = {
    ok: true;
    kind: 'after';
    afterSeconds: number;
} | {
    ok: true;
    kind: 'at';
    at: {
        date: string;
        time: string;
        time_zone: string;
    };
    epoch: number;
} | {
    ok: false;
    error: string;
};
/**
 * `parseScheduleInput` 的结果：时间目标 + 剩余内容。
 *
 * `targets` 恒为 1..MAX_OCCURRENCES 个未来时刻：单条写法就是 1 个；
 * `+1h*3` / `+1h+30m` 这类多次写法给出多个，由命令层展开成同等数量的任务。
 * `target` 恒等于 `targets[0]`，为既有调用方保留。
 */
export type ParsedScheduleInput = {
    ok: true;
    target: ResolvedTarget;
    targets: readonly ResolvedTarget[];
    content: string;
} | {
    ok: false;
    error: string;
};
/** 语法开关（来自 settings.advancedSyntax）。 */
export interface ScheduleSyntaxOptions {
    /**
     * 高级语法（Beta）是否可用。
     *
     * `undefined` 与 `true` 都按开启处理——只有显式 `false` 才关闭，
     * 与 schema 的 `default(true)` 及旧调用方（不传第三参）的行为一致。
     */
    readonly advancedSyntax?: boolean;
}
/** 关闭高级语法时的统一提示：说清去哪儿开，而不是只说"不支持"。 */
export declare const ADVANCED_SYNTAX_DISABLED: string;
/** 一次命令最多展开出的任务条数（`+1h*11`、11 段序列一律拒绝）。 */
export declare const MAX_OCCURRENCES = 10;
/**
 * 多次写法下相邻两次之间的最小间隔（秒）。
 *
 * 只约束「多次」：单条 `/later +5s` 是既有合法用法（README 演示与测试都依赖它），
 * 不因这道地板失效。`every` 记录在宿主侧另有 ≥300s 口径；多次写法走的是
 * 「展开成 N 条 one-shot」，不经过 `every`，所以这里自带一道 60s 防护，
 * 免得 `+1s*10` 一行命令把 dock 刷成瀑布。
 */
export declare const MIN_OCCURRENCE_INTERVAL_SECONDS = 60;
/** 目标解析结果（时间 → 具体时刻/时长的落定）。 */
type ResolvedTarget = {
    kind: 'after';
    afterSeconds: number;
} | {
    kind: 'at';
    at: {
        date: string;
        time: string;
        time_zone: string;
    };
    epoch: number;
};
/**
 * 解析 `/schedule` 与 `/later` 的完整输入：开头的时间表达式 + 剩余内容。
 *
 * 支持格式（示例）：
 *  - `+30m` `+1h30m` `+90s` `+1w`
 *  - `30分钟后` `半小时后` `两小时后` `1天以后`
 *  - `1532` `15:32` `15：32` `15时32分` `9点` `9点半`
 *  - `明天 15:32` `后天9点` `大后天 10:00`
 *  - `8月21日 15:32` `08-21 15:32`
 *  - `2026-08-21 15:32` `0821-1532` `20260821-1532`
 *  - 等间隔重复：`+1h*3` `+30m×2` `两小时后x3次` → t+1h、t+2h、t+3h
 *  - 链式序列：`+1h+1h+0.5h` → t+1h、t+2h、t+2.5h（梯度催办）
 *
 * 多次写法一律展开成 N 条 `after` 一次性任务（不是 1 条 `every`），理由见
 * {@link expandOccurrences}。上限 `MAX_OCCURRENCES`，多次写法的最小间隔
 * `MIN_OCCURRENCE_INTERVAL_SECONDS`。
 *
 * `limits` 可选：未传时回落到 `DEFAULT_MAX_PROMPT_CHARS=1000`，错误文案里
 * 的字符数与 settings 实际生效值一致。
 */
export declare function parseScheduleInput(raw: string, now: number, timeZone: string, limits?: PromptLimits, options?: ScheduleSyntaxOptions): ParsedScheduleInput;
/**
 * 兼容旧签名：解析纯时间描述（不含内容），**只支持单条**。
 *
 * 多次/序列写法会被明确拒绝：本函数的消费方（GUI 单次通道）一次只能落一条记录，
 * 静默取第一条等于把用户的「3 次」吃掉。
 */
export declare function parseScheduleSpec(spec: string, now: number, timeZone: string): ParsedScheduleSpec;
/** 命令工厂：返回三个命令定义。
 *
 * `getSettings` 支持传数字（静态，兼容旧签名）、返回 `{maxSchedules}` 的 getter，
 * `() => { maxSchedules, allowLongPrompts, maxPromptChars }` 的 getter——传 getter
 * 时每次调用读取设置页的**实时**上限（设置保存后即时生效，按需 scope.get()，
 * 与 dsh-smooth-stream 一致）。
 */
export declare function userScheduleCommands(ctx: Context, getSettings?: number | (() => number) | (() => {
    maxSchedules: number;
    allowLongPrompts?: boolean;
    maxPromptChars?: number;
    advancedSyntax?: boolean;
}), onUserChange?: UserChangeNotifier, onUserSteer?: UserSteerHandler, getLocale?: () => string | undefined): CommandDefinition[];
/** 注册三个命令，返回统一 disposer。 */
export declare function registerUserScheduleCommands(ctx: Context, getSettings?: number | (() => number) | (() => {
    maxSchedules: number;
    allowLongPrompts?: boolean;
    maxPromptChars?: number;
    advancedSyntax?: boolean;
}), onUserChange?: UserChangeNotifier, onUserSteer?: UserSteerHandler, getLocale?: () => string | undefined): () => void;
export {};
