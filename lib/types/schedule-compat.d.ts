/**
 * dsh-schedule 0.1.5 → 0.1.7 的版本桥接层。
 *
 * 0.1.7 对 `dsh-schedule` 做了三处破坏性变更，本模块把差异收敛为三个函数，
 * 使 `user-tools.ts` / `runtime.ts` 不必写版本分支：
 *
 * 1. `allocateScheduleId(folded)` → 删除。0.1.5 用确定性递增
 *    （`schedule-1`、`schedule-2`…，靠 `seenIds` 避让），0.1.7 内联改为
 *    `ScheduleId(\`schedule-${randomUUID()}\`)`（见 0.1.7 `ScheduleService.create`）。
 *    本插件的 `ownership-store` 把 id 当**不透明字符串**处理（无排序、无数字
 *    解析，见 docs/verification.md），故行为差异对功能无影响。
 *
 * 2. `createAfterScheduleRecord` 新增第 5 个必填参数 `title`。0.1.7 起
 *    `decodeStoredTitle` 会在读取时校验：缺失 / 未 trim / 超长（>120）的
 *    存量记录抛 `ScheduleLogError`——**不是跳过，是整份日志拒读**。
 *
 * 3. `renderEveryReminderBatchFraming` → 改名
 *    `renderRecurringReminderBatchFraming`（语义与参数不变）。
 *
 * @module dsh-later/schedule-compat
 */
import * as sched from '@deepseek-ai/dsh-schedule';
import type { ScheduleRecord } from '@deepseek-ai/dsh-schedule';
import { type KernelVersion } from './upstream-compat.js';
declare const ScheduleId: typeof sched.ScheduleId;
/** 0.1.7 `MAX_TITLE_LENGTH`；0.1.5 无此概念，该常量在此仅作截断阈值。 */
export declare const SCHEDULE_TITLE_MAX = 120;
/**
 * 0.1.7 的 `allocateScheduleId` 等价物。
 *
 * 随机 UUID 而非递增序号：与官方 `ScheduleService.create` 行为一致，且并发
 * 创建时天然无碰撞。0.1.5 下也可用（`ScheduleId` 是纯 brand 校验，任意
 * 非空字符串通过），因此本函数在两个代次上语义相同，无需双轨。
 *
 * @param _folded 仅为**保持调用点不变**而接受 0.1.5 的 `folded` 参数；0.1.7
 *   不再需要它来避让碰撞（UUID 本身唯一），故不使用。
 */
export declare function allocateScheduleIdCompat(_folded?: unknown): ReturnType<typeof ScheduleId>;
/**
 * 从提醒正文派生 `title`。
 *
 * 0.1.7 要求 title 非空、已 trim、≤120 字符。实测本插件历史 496 条提醒中
 * 最长 575 字符（27 条超限，占 5.4%），故**必须截断**而非直接透传 prompt。
 * 截断在词边界优先，找不到合适边界时按字符硬切并补省略号，保证结果始终
 * 是合法 title（`scheduleTitle` 不会抛）。
 */
export declare function deriveScheduleTitle(prompt: string): string;
/** `createAfterScheduleRecord` 的跨版本包装。 */
export declare function createAfterRecord(id: ReturnType<typeof ScheduleId>, prompt: string, afterSeconds: number, now: number): ScheduleRecord;
/** `createAtScheduleRecord` 的跨版本包装。 */
export declare function createAtRecord(id: ReturnType<typeof ScheduleId>, prompt: string, scheduledAt: string, now: number): ScheduleRecord;
/** `createEveryScheduleRecord` 的跨版本包装。 */
export declare function createEveryRecord(id: ReturnType<typeof ScheduleId>, prompt: string, everySeconds: number, now: number): ScheduleRecord;
/**
 * 周期提醒批次的 framing 渲染。
 *
 * 0.1.5 导出 `renderEveryReminderBatchFraming`，0.1.7 改名为
 * `renderRecurringReminderBatchFraming`（并扩展到 daily/weekly/cron，本插件
 * 只产生 `every` 记录）。两代参数与返回结构一致，按存在性择一。
 */
export declare function renderRecurringBatchFraming(reminders: readonly unknown[]): string;
/** 判定结果的出处（诊断文案要说清「凭什么这么选」）。 */
export type MessageSourceVia = 'kernel-version' | 'symbol-probe';
/** 一次 source kind 判定的完整结论。 */
export interface MessageSourceDecision {
    readonly kind: 'schedule' | 'plugin';
    readonly via: MessageSourceVia;
    /** 人类可读的依据，例如 `内核 0.1.7-rc.1（读自 @deepseek-ai/dsh-schedule）`。 */
    readonly detail: string;
}
/** `messageSourceDecision` 的可注入面（测试不依赖真实内核安装）。 */
export interface MessageSourceProbeOptions {
    /** 读内核版本；默认真去解析宿主包。读不到时返回 `undefined`。 */
    readKernel?: () => KernelVersion | undefined;
    /** 符号探测：`renderRecurringReminderBatchFraming` 是否存在（降级路径用）。 */
    hasModernRenderName?: () => boolean;
    /** 降级警告出口（默认 `console.warn`，每进程一次）。 */
    warn?: (message: string) => void;
}
/** 清掉判定缓存与「已警告」状态。只给测试用——生产路径上缓存就该活到进程结束。 */
export declare function resetMessageSourceDecision(): void;
/**
 * 提醒注入消息该用哪个 `source.kind`（issue #75 改的就是这里的判定方式）。
 *
 * **版本优先，符号兜底**：
 *
 * 1. 读到内核版本 → 与 {@link PLUGIN_KIND_RETIRED_SINCE} 比（含预发布语义）。
 *    `0.1.7-rc.1` 起 `kind:'plugin'` 被 v4 准入拒绝，官方 `dsh-schedule` 自己在那一代
 *    注入提醒用的就是 `{ kind: 'schedule' }`，所以这一代往后一律 `schedule`；更早一律 `plugin`。
 * 2. 读不到版本 → 退回旧的符号探测，并**警告一次**。
 *
 * 为什么非用版本号不可：这两个破坏性变更**不在同一个 rc 落地**——rc.1 已经删了
 * `plugin` kind，但 `renderEveryReminderBatchFraming` 的改名要到 rc.2。于是 rc.1 是一代
 * 「旧符号还在、旧 kind 已死」的组合代，按符号存在性推断必然选错。而且 0.1.5 与
 * 0.1.7-rc.1 的 `dsh-schedule` 导出面**逐符号相同**（两版都在 registry 里，实测
 * `renderEveryReminderBatchFraming` / `allocateScheduleId` 两边都有），所以连换个符号探测
 * 都救不回来——能区分的只有版本号。原注释写的「`schedule` 与
 * `renderRecurringReminderBatchFraming` 同属 0.1.7 引入，二者同时存在即为 0.1.7+」正是
 * 这个被实测推翻的前提。
 *
 * 后果为什么必须被看见：选错是**静默**的——提醒到点不投递、会话日志里没有 dispatch 也没有
 * 校验报错（那条在宿主 stdout），用户只看到「超时未确认」。
 */
export declare function messageSourceDecision(options?: MessageSourceProbeOptions): MessageSourceDecision;
/**
 * 提醒注入消息的 `source`。
 *
 * `form:'notice'` + `summary` 两代都在（`ContextFormed` 未变），保留。
 *
 * 不能用具名类型断言跨代：source 的字面量 union 在两代不同，断言只会把
 * 编译错误推迟到运行期。
 */
export declare function scheduleMessageSource(boundedSummary: string): Record<string, unknown>;
/**
 * `foldScheduleEvents` 结果的读视图收窄。
 *
 * 0.1.5 的 `FoldedSchedules.active` 是 `ScheduleRecord[]`；0.1.7 改为
 * `LegacyScheduleRecord[]`（title 可选）。本插件只消费 `id` / `kind` /
 * `prompt` / `afterSeconds` / `everySeconds` / `scheduledAt`，这些字段在
 * `Legacy*` 视图中全部存在，故收窄无损。
 */
export declare function asLegacySchedules(folded: unknown): {
    readonly active: readonly ScheduleRecord[];
    readonly seenIds: ReadonlySet<string>;
};
/**
 * `schedule/change` 事件里 `create` 操作的载荷类型。
 *
 * 0.1.7 起内核把「事件载荷」与「内部记录」拆成两个类型：
 * - `ScheduleCreateChange.schedule` 是 **`LegacyScheduleRecord`**（title 可选）
 * - `ScheduleRecord` 是 Host 内部的新格式（title 必填，且含 daily/weekly/cron）
 *
 * 本插件只产生 `after` / `at` / `every` 三种（见 buildScheduleRecord），三者都是
 * `Legacy*` 的对应分支去掉「title 必填」后的结果，故结构兼容。
 *
 * 但 TS 层面 `ScheduleRecord`（6 变体联合）对 `LegacyScheduleRecord`（3 变体）
 * 不可赋值——**这不是运行时问题，是联合宽度问题**。故在此显式收窄：本插件
 * 的产出已经过 `createAfter/At/EveryRecord` 限定，不含 daily/weekly/cron。
 */
export declare function toChangePayload(record: ScheduleRecord): never;
/**
 * `foldScheduleEvents().active` 元素的读取侧类型。
 *
 * 0.1.5 直接返回 `ScheduleRecord`；0.1.7 返回 `LegacyScheduleRecord`
 * （title 可选，因为历史事件没有）。本插件读路径只在 title 存在时展示，
 * 缺失时回退到 prompt——故按 Legacy 收窄是**语义正确**的，而非绕过检查。
 */
export declare function asLegacyRecords(records: readonly unknown[]): readonly ScheduleRecord[];
export {};
