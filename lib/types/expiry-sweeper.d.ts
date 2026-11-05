/**
 * 宿主级到期扫描器（GitHub issue #11 的投递半面，本仓记作 #11b）。
 *
 * ## 它修的是什么
 *
 * 到点投递原先只有一条路：每个会话的 runtime 自己 `setTimeout`（`runtime.ts` 的
 * `arm()` / `timer`），而 runtime 只在「该会话的 agent 是 live root」时才挂得上。
 * 于是冷启动（进程刚重启，没有一个会话被拉起）或 agent 被 dispose 之后，**没有任何
 * 组件知道某条提醒到点了**——实测：`/later +2m` → 杀进程 → 同 `DSH_HOME` 重启 →
 * 不开浏览器 → 到期后 +90s 会话日志里 `user/message` 投递 0 条；手动打开那条会话，
 * 立刻 1 条。也就是说，投递的正确性一直没问题，**缺的是"谁来叫醒"**。
 *
 * ## 它只做一件事：叫醒
 *
 * 本模块**不新写投递逻辑**。它对到期会话做的唯一动作是 `wake(sessionId)`——由宿主入口
 * 接线成「确保 runtime 挂上（`runtimeRegistry.mount` 幂等）+ `requestDrive()`」。之后
 * 走的全是原有链路：确认窗口、`schedule/change dispatch` 记账、`/later` 的 user 代发语义、
 * 暂停与逾期处理、`every` 的周期重挂，都和「有人打开会话」时逐字一致。
 * 这也是为什么 `tests/delivery.test.mjs` / `tests/occurrences.test.mjs` 一个字都不用改。
 *
 * ## 扫什么、多久扫一次
 *
 * 数据源是 sidecar（`listOwnershipSnapshots`）：进程外唯一能在「零 live agent」时看到的
 * 索引，v3 起每条带 `scheduledAt`。调度是**两级**的：
 *  - **精确 timer**：内存里记住最近的那个到期点，到点扫一次（正常路径，误差在毫秒级）；
 *  - **兜底 tick**：低频（{@link DEFAULT_SWEEP_INTERVAL_MS}，60s 量级）重扫，覆盖
 *    「别的进程改了 sidecar」「系统时钟跳变」「精确 timer 因故没排上」这些情况。
 * 两级都 `unref`：扫描器不替用户把进程钉住（宿主自己要不要常驻是宿主的事）。
 *
 * ## 唤醒是有代价的（D1：接受）
 *
 * 冷 resume 会真建一个 agent 并跑出一轮 turn（无 provider 时是 `turn/end` 带
 * `agent ... has no provider`，见入口注释）。所以这里必须**有节制**：
 *  - 每个会话同一时刻只允许一次唤醒（in-flight 去重）；
 *  - 唤醒后若这条提醒**仍在** sidecar 里、且仍然到期（= 这次唤醒没投出去），按
 *    退避（{@link backoffForFailures}：1s→2s→…→封顶 10 分钟）再试，**不是**每轮都试；
 *  - 同一个会话连续失败到 {@link MAX_WAKE_FAILURES} 次就**停下并告警一次**，之后只有
 *    「用户动了这条提醒」（sidecar 变更）才重新武装——不做重试风暴；
 *  - 有人接通了（`wake` 返回 true 且到期点消失 / 被推远）就清零退避。
 *
 * ## 生命周期
 *
 * 挂在插件 apply 的顶层 fiber 上、由 `ctx.effect` 交回撤销动作：`dispose()` 清掉两级
 * 定时器并等待在途扫描收敛。热重载重建后不会留下第二个扫描器——这条与
 * `runtime-registry` 的「attach 必须交回 disposer」是同一条纪律。
 *
 * @module dsh-later/expiry-sweeper
 */
import type { OwnedEntry } from './ownership-store.js';
/** 兜底 tick 周期：60s 量级（精确 timer 负责正常路径，它只负责"迟早会扫到"）。 */
export declare const DEFAULT_SWEEP_INTERVAL_MS = 60000;
/** 同一会话连续唤醒失败多少次后放弃并告警一次。 */
export declare const MAX_WAKE_FAILURES = 5;
/** 退避上限：失败越多次，越不该继续频繁拉起 agent。 */
export declare const MAX_BACKOFF_MS: number;
/** 扫描器需要的最小 sidecar 面（`listOwnershipSnapshots` 的结构子集）。 */
export interface SweepSnapshot {
    readonly sessionId: string;
    readonly entries: Readonly<Record<string, OwnedEntry>>;
}
/** 会话日志里 `schedule/change` 的最小面（回算老条目到期时刻用）。 */
export interface ScheduleChangeEventLike {
    readonly type: string;
    readonly data?: unknown;
}
/** 扫描器依赖（全部注入，单测里是假件）。 */
export interface ExpirySweeperOptions {
    /** 枚举全部会话的 sidecar 快照；抛错时本轮记为一次扫描失败但不中断。 */
    snapshots(): readonly SweepSnapshot[];
    /**
     * 唤醒一个会话（接线侧：mount + requestDrive）。
     *
     * 解析为 `true`/`false` 都**不再**看返回值决定退避——退避只看「到期点有没有被消化」，
     * 因为投递本身是异步的（followup + 确认窗口）。这里只要求**不抛**：抛错计入失败次数。
     */
    wake(sessionId: string): void | Promise<void>;
    /** 侧会话是否允许被唤醒（被委托子会话 / 非 root 一律 false，理由见 `wakeable`）。 */
    wakeable(sessionId: string): boolean;
    /**
     * 给老条目（v1/v2，缺 `scheduledAt`）回算到期时刻。
     * @returns 回算不出来时 `undefined`（扫描器据此**保守跳过**，不猜）。
     */
    resolveScheduledAt(sessionId: string, scheduleId: string): number | undefined;
    /** 告警出口（插件侧是 `ctx.logger.warn`）。 */
    warn(message: string): void;
    /** 当前时刻（测试可注入假时钟）。 */
    now?(): number;
    /** 扫描节奏覆盖。 */
    intervalMs?: number;
    /** 定时器工厂（测试可注入假件；默认用全局 setTimeout/setInterval）。 */
    setTimeout?(handler: () => void, delayMs: number): ReturnType<typeof setTimeout>;
    clearTimeout?(handle: ReturnType<typeof setTimeout>): void;
    setInterval?(handler: () => void, delayMs: number): ReturnType<typeof setInterval>;
    clearInterval?(handle: ReturnType<typeof setInterval>): void;
}
/** 扫描器对外面。 */
export interface ExpirySweeper {
    /** 立即扫一轮（也用于 sidecar 变更后的即时重算）；返回本轮实际走访的会话数。 */
    sweepNow(): number;
    /** 重新按 sidecar 现状排一次精确 timer（用户增删改提醒后调用）。 */
    reschedule(): void;
    /** 是否已经停摆（dispose 之后）。 */
    readonly stopped: boolean;
    /** 清掉两级定时器、等在途扫描收敛。 */
    dispose(): Promise<void>;
    /** 诊断用：某会话当前的连续失败次数。 */
    failuresOf(sessionId: string): number;
}
/**
 * 第 `failures` 次失败后的等待时长（1s → 2s → 4s …，封顶 {@link MAX_BACKOFF_MS}）。
 * @param failures - 已经连续失败的次数（≥1）。
 * @returns 毫秒数。
 */
export declare function backoffForFailures(failures: number): number;
/**
 * 从会话日志的 `schedule/change` 事件回算一条老条目的到期时刻（v2→v3 迁移的半面）。
 *
 * 为什么要回算而不是「缺就当没有」：v2 写下的条目**没有**这个字段，如果扫描器直接跳过它们，
 * 升级到 v3 的那一刻所有已排好的提醒（包括用户明早要的那条）都会失去冷唤醒能力——
 * 一次升级静默削掉一整类能力，是 #71 那种"安静"的复发。
 *
 * 规则（与 `schedule-compat.ts` 的 decode 口径一致，按 **最早** 的创建时刻推）：
 *  - `after`：`createdAt` + `afterSeconds`（afterSeconds 是相对创建时刻的）；
 *  - `at`：直接取记录里的 `scheduledAt`（ISO 字符串）。
 * 同 id 出现多次 create（编辑会「删旧建新」换新 id，但老数据里仍可能有重复）时取**第一次**
 * ——重复重建只会把时刻往后推，取最早的才是这条 id 最初被安排的时刻；反正它一旦过期，
 * 扫描器叫醒会话后由 runtime 的 fold 决定实际派发，多算一次不会造成重复投递。
 * 找不到任何 create 事件（或字段形状不认识）返回 `undefined`，由调用方保守跳过并告警。
 *
 * @param events - 该会话自己的 `schedule/change` 事件（顺序即日志顺序）。
 * @param scheduleId - 目标日志 id。
 * @param createdAt - sidecar 条目里的创建时刻（epoch ms）。
 * @returns 到期时刻（epoch ms），或回算不出来时的 `undefined`。
 */
export declare function resolveScheduledAtFromLog(events: readonly ScheduleChangeEventLike[], scheduleId: string, createdAt: number): number | undefined;
/**
 * 创建一个到期扫描器。
 *
 * 两处刻意的取舍：
 *  1. **不并发**：同一时刻最多一轮扫描（重入合并成"再跑一轮"）。两轮同时扫会对同一批到期
 *     会话各叫一次醒，冷 resume 建 agent 又不是幂等的；
 *  2. **不抛**：读快照、回算、唤醒的任何异常都只在本地收敛成告警。抛出去会变成未处理的
 *     rejection，而"整轮抛错"= 所有会话的提醒一起停摆——那正是本模块要消灭的失败形态。
 * @param options - 注入依赖（见 {@link ExpirySweeperOptions}）。
 * @returns 扫描器面（{@link ExpirySweeper}）。
 */
export declare function createExpirySweeper(options: ExpirySweeperOptions): ExpirySweeper;
