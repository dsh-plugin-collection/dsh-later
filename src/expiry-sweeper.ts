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
export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

/** 同一会话连续唤醒失败多少次后放弃并告警一次。 */
export const MAX_WAKE_FAILURES = 5;

/** 退避上限：失败越多次，越不该继续频繁拉起 agent。 */
export const MAX_BACKOFF_MS = 10 * 60_000;

/**
 * 一次唤醒之后的「消化宽限期」：这段时间内即使提醒仍在 sidecar 里到期，也不判失败。
 *
 * 投递不是同步的——`followup` 之后还有确认窗口与一次 flush，扫描轮次之间往往还没落盘。
 * 宽限期取 250ms：正常路径的 followup → `user/message` 落盘是同一次宏任务里的事，
 * 而确认轮询本身也会在毫秒级完成；真投不出去时，第一次退避（1s）立刻接上，既不会把成功
 * 判成失败，也能让"放弃"在十秒量级内收敛（实测 5 次失败 ≈ 11s）。
 */
const WAKE_GRACE_MS = 250;

/** Node timers 能表示的最大延迟（超过会立刻触发，必须夹住）。 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

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

/** 一个会话的退避状态。 */
interface BackoffState {
  failures: number;
  /** 下一次允许尝试的时刻（epoch ms）：退避到期前扫描器不碰它。 */
  nextAttempt: number;
  /** 最近一次尝试的起点（epoch ms）——排下一次扫描与后来清算失败都以它为基准。 */
  attemptAt: number;
  /** 是否已经为「放弃」告过警（只喊一次）。 */
  gaveUp: boolean;
}

/**
 * 第 `failures` 次失败后的等待时长（1s → 2s → 4s …，封顶 {@link MAX_BACKOFF_MS}）。
 * @param failures - 已经连续失败的次数（≥1）。
 * @returns 毫秒数。
 */
export function backoffForFailures(failures: number): number {
  const exponent = Math.min(Math.max(failures, 1) - 1, 20);
  return Math.min(1000 * 2 ** exponent, MAX_BACKOFF_MS);
}

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
export function resolveScheduledAtFromLog(
  events: readonly ScheduleChangeEventLike[],
  scheduleId: string,
  createdAt: number,
): number | undefined {
  if (!Number.isFinite(createdAt) || createdAt < 0) return undefined;
  for (const event of events) {
    if (event?.type !== 'schedule/change') continue;
    const data = event.data as
      | { operation?: unknown; id?: unknown; schedule?: { id?: unknown; kind?: unknown; scheduledAt?: unknown; afterSeconds?: unknown } }
      | undefined;
    if (data === undefined || data === null) continue;
    if (data.operation !== 'create') continue;
    const record = data.schedule;
    if (record === undefined || record === null || record.id !== scheduleId) continue;
    if (record.kind === 'after') {
      const seconds = record.afterSeconds;
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return undefined;
      return createdAt + seconds * 1000;
    }
    if (typeof record.scheduledAt === 'string') {
      const at = Date.parse(record.scheduledAt);
      if (Number.isFinite(at)) return at;
    }
    return undefined;
  }
  return undefined;
}

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
export function createExpirySweeper(options: ExpirySweeperOptions): ExpirySweeper {
  const now = options.now ?? (() => Date.now());
  const intervalMs = options.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  // 默认走全局定时器；测试可整体换成假件（含假时钟）。
  const setTimer = options.setTimeout ?? ((handler: () => void, delay: number) => setTimeout(handler, delay));
  const clearTimerFn = options.clearTimeout ?? ((handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
  const setTick = options.setInterval ?? ((handler: () => void, delay: number) => setInterval(handler, delay));
  const clearTickFn = options.clearInterval ?? ((handle: ReturnType<typeof setInterval>) => clearInterval(handle));

  let stopped = false;
  /** 精确 timer：排在最近的到期点。 */
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** 兜底 tick。 */
  let ticker: ReturnType<typeof setInterval> | undefined;
  /** 在途扫描（同一时刻最多一轮）。 */
  let running: Promise<void> | undefined;
  let rerun = false;
  /** 会话 → 退避状态（连续失败次数 / 下次允许尝试的时刻 / 是否已放弃）。 */
  const backoff = new Map<string, BackoffState>();
  /** 已尝试唤醒、但还没观察到到期点被消化的会话。 */
  const inFlight = new Set<string>();
  /** 已喊过「无法回算」的条目（`会话/id`）：每项只喊一次，不刷日志。 */
  const warnedUnresolved = new Set<string>();
  /** 已喊过「放弃」的会话：只喊一次。 */
  const warnedGaveUp = new Set<string>();

  const unref = (handle: unknown): void => {
    const candidate = handle as { unref?: () => void } | undefined;
    if (candidate !== undefined && typeof candidate.unref === 'function') candidate.unref();
  };

  const clearArmed = (): void => {
    if (timer !== undefined) {
      clearTimerFn(timer);
      timer = undefined;
    }
  };

  /** `resolveScheduledAt` 的容错包装：它读会话日志，可能抛。 */
  const safeResolve = (sessionId: string, scheduleId: string): number | undefined => {
    try {
      const value = options.resolveScheduledAt(sessionId, scheduleId);
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
    } catch (error) {
      options.warn(
        `later: 回算提醒 ${scheduleId}（会话 ${sessionId}）的到期时刻失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  };

  /** 一条条目的到期时刻：优先 sidecar 字段，缺了按日志回算（推不出来 = undefined）。 */
  const targetOf = (sessionId: string, scheduleId: string, entry: OwnedEntry): number | undefined => {
    if (typeof entry.scheduledAt === 'number' && Number.isFinite(entry.scheduledAt) && entry.scheduledAt >= 0) {
      return entry.scheduledAt;
    }
    const resolved = safeResolve(sessionId, scheduleId);
    if (resolved === undefined) {
      // v2→v3：推不出来就**保守跳过**并告警一次——既不静默丢任务（会话被打开时它
      // 照常派发），也绝不把它当成"永久逾期"去把会话反复拉起来。
      const key = `${sessionId}/${scheduleId}`;
      if (!warnedUnresolved.has(key)) {
        warnedUnresolved.add(key);
        options.warn(
          `later: 提醒 ${scheduleId}（会话 ${sessionId}）缺到期时刻且无法从会话日志回算，` +
            `已跳过宿主级唤醒；该会话被打开时它仍会照常派发。`,
        );
      }
    }
    return resolved;
  };

  /** 一个快照里最早到期的时刻（用来判断"唤醒后到期点有没有被消化"）。 */
  const earliestOf = (snapshot: SweepSnapshot): number | undefined => {
    let earliest: number | undefined;
    for (const [scheduleId, entry] of Object.entries(snapshot.entries)) {
      const target = targetOf(snapshot.sessionId, scheduleId, entry);
      if (target === undefined) continue;
      earliest = earliest === undefined ? target : Math.min(earliest, target);
    }
    return earliest;
  };

  const readSnapshots = (): readonly SweepSnapshot[] => {
    try {
      return options.snapshots();
    } catch (error) {
      options.warn(
        `later: 到期扫描读不到 sidecar 快照，本轮跳过: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  };

  /**
   * 排下一次精确扫描。
   *
   * 目标 = 「sidecar 里最近的到期点」与「每个会话的退避下限」中**最近**的那个：
   * 到期点已经过去时延迟是 0，若不夹上退避下限，一次失败的唤醒会立刻再排 NextTick 的一轮，
   * 于是退避参数形同虚设、一个会话在一秒内能被叫醒几十次（实测 88 次）。兜底 tick 也覆盖
   * 到了这部分时间，所以这里**只在有活可干时才排**。
   */
  const reschedule = (): void => {
    if (stopped) return;
    clearArmed();
    let nearest: number | undefined;
    const consider = (value: number | undefined): void => {
      if (value === undefined) return;
      nearest = nearest === undefined ? value : Math.min(nearest, value);
    };
    for (const snapshot of readSnapshots()) {
      const state = backoff.get(snapshot.sessionId);
      if (state !== undefined) {
        if (state.gaveUp) continue;
        // ⚠️ 排的**不是条目自己的到期点**，而是"这个会话下一次真的会被尝试"的时刻。
        // 一旦尝试过，到期点永远在过去、延迟恒为 0，扫描器就退化成忙循环（实测几百次空转）。
        // 下一次尝试 = 这次尝试的起点 + 该失败次数对应的退避（首轮尝试是宽限期）。
        consider(state.attemptAt + Math.max(backoffForFailures(state.failures), WAKE_GRACE_MS));
        continue;
      }
      consider(earliestOf(snapshot));
    }
    if (nearest === undefined) return;
    const at = now();
    const delay = Math.min(Math.max(nearest - at, 0), MAX_TIMER_DELAY_MS);
    timer = setTimer(() => {
      timer = undefined;
      void sweep();
    }, delay);
    unref(timer);
  };

  /** 记一次唤醒失败并排退避；只在「第一次」与「放弃」两处告警（不刷日志）。 */
  /**
   * 记一次唤醒失败：失败计数 +1、排下一次退避、把失败时刻记下来。
   *
   * 为什么不是"每看到一次仍在到期就 +1"：投递是异步的，`followup` 之后还有确认窗与一次
   * flush；扫描轮次之间往往还没落盘。以「失败发生在哪一次尝试之后」为唯一口径——
   * `lastAttemptAt` 只会被 `poll`（真的发起了一次唤醒）和本函数（尝试以异常收场）推进——
   * 同一个尝试最多只记一次失败，退避也就不会被空转放大（实测曾把一个会话数到 417 次）。
   */
  const noteFailure = (sessionId: string, detail: string): void => {
    const attemptAt = now();
    const failures = (backoff.get(sessionId)?.failures ?? 0) + 1;
    const gaveUp = failures >= MAX_WAKE_FAILURES;
    backoff.set(sessionId, {
      failures,
      nextAttempt: attemptAt + backoffForFailures(failures),
      attemptAt,
      gaveUp,
    });
    if (gaveUp) {
      if (warnedGaveUp.has(sessionId)) return;
      warnedGaveUp.add(sessionId);
      options.warn(
        `later: 会话 ${sessionId} 连续 ${failures} 次冷唤醒失败，已停止自动唤醒（不再重试风暴）；` +
          `该会话的提醒在它被打开或被用户改动时照常投递。最后一次错误: ${detail}`,
      );
      return;
    }
    if (failures === 1) {
      options.warn(
        `later: 会话 ${sessionId} 冷唤醒失败，按指数退避重试（第 1 次）: ${detail}`,
      );
    }
  };

  /**
   * 对单个会话决定是否唤醒。
   *
   * 成败不看 `wake()` 的返回值（投递是异步的），而看「下一次尝试时这条提醒还在不在、
   * 还到期不到期」：不在/被推远 = 上次唤醒有效；仍在到期 = 那次没投出去。
   * `wake()` 抛错当场记一次失败。
   */
  const poll = (snapshot: SweepSnapshot, at: number): void => {
    const sessionId = snapshot.sessionId;
    if (!options.wakeable(sessionId)) return;
    const state = backoff.get(sessionId);
    if (state !== undefined && (state.gaveUp || at < state.nextAttempt)) return;
    // 记下"刚尝试过"。`attemptAt` 是这一次尝试的起点，`reschedule` 用它算"还要等多久"。
    //
    // ⚠️ 这一行不只是记账：`reschedule` 用 `nextAttempt` 排下一次精确扫描。到期点已经过去，
    // 若这里留下一个过去时刻，`reschedule` 会算出 0 延迟、立刻再来一轮——而那一轮只会看到
    // "退避未到"什么都不做，退化成逐 tick 空转（实测一个会话百来次唤醒就是从这里来的）。
    backoff.set(sessionId, {
      failures: state?.failures ?? 0,
      nextAttempt: Math.max(state?.nextAttempt ?? 0, at),
      attemptAt: at,
      gaveUp: state?.gaveUp ?? false,
    });
    inFlight.add(sessionId);
    let outcome: Promise<void>;
    try {
      outcome = Promise.resolve(options.wake(sessionId));
    } catch (error) {
      inFlight.delete(sessionId);
      noteFailure(sessionId, error instanceof Error ? error.message : String(error));
      return;
    }
    void outcome.then(
      () => {
        inFlight.delete(sessionId);
      },
      (error: unknown) => {
        inFlight.delete(sessionId);
        noteFailure(sessionId, error instanceof Error ? error.message : String(error));
      },
    );
  };

  /**
   * 结算「上次唤醒之后是否把它消化掉了」，并据此刻的退避状态决定这一轮要不要再唤醒。
   *
   * 每个会话**每轮至多推进一次**：
   *  1. 上次尝试以来还没过一个宽限期（{@link WAKE_GRACE_MS}）→ 什么都不做（给投递留时间）；
   *  2. 提醒已经不在了 / 被推远了 → 上次唤醒有效，退避清零；
   *  3. 仍在到期且退避窗口已到 → 记一次失败（下次再试的间隔会翻倍）；
   *  4. 仍在到期、退避窗口未到 → 跳过。
   * 全部处理完仍然到期、且没在退避里的会话，才是本轮真正要 `poll` 的。
   */
  const settle = (snapshot: SweepSnapshot, at: number): 'poll' | 'skip' => {
    const sessionId = snapshot.sessionId;
    const state = backoff.get(sessionId);
    const earliest = earliestOf(snapshot);
    if (state !== undefined) {
      // 仍在飞：等它落地，本轮不干扰。
      if (inFlight.has(sessionId)) return 'skip';
      // 还没到下一次允许尝试的时刻（宽限期或退避窗口）：什么都不做。
      // 这条必须在「是否仍然到期」之前——投递是异步的，确认窗口内条目当然还在到期，
      // 先下结论会把**一次成功的唤醒**算成失败。
      if (at < state.nextAttempt) return 'skip';
      if (state.gaveUp) return 'skip';
      const unconsumed = earliest !== undefined && earliest <= at;
      if (unconsumed) {
        // 仍然到期 = 上一次唤醒没投出去：这次失败已经"观察到"，`noteFailure` 立刻把等待
        // 时间翻倍并重新排下一次扫描。
        noteFailure(sessionId, '唤醒后提醒仍然到期（未投递）');
        return 'skip';
      }
      // 条目没了 / 被推远 = 上次唤醒有效：退避清零，回到正常节奏。
      backoff.delete(sessionId);
      warnedGaveUp.delete(sessionId);
    }
    if (earliest === undefined || earliest > at) return 'skip';
    return 'poll';
  };

  /** 一轮扫描。 */
  const runSweep = async (): Promise<void> => {
    const at = now();
    const snapshots = readSnapshots();
    for (const snapshot of snapshots) {
      if (stopped) return;
      if (settle(snapshot, at) === 'poll') poll(snapshot, at);
    }
    reschedule();
  };

  /** 入口：串行化扫描（不并发，重入合并成"再跑一轮"）。 */
  const sweep = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running !== undefined) {
      rerun = true;
      return running;
    }
    const run = (async () => {
      do {
        rerun = false;
        // 每轮之间让出一个宏任务：唤醒是 async 的，落在微任务之后的重入不能被本轮吞掉
        // （否则一次唤醒会在同一个 `while` 里被反复消费，实测 246 次）。
        await Promise.resolve();
        try {
          await runSweep();
        } catch (error) {
          options.warn(
            `later: 到期扫描本轮异常（下轮继续）: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      } while (rerun && !stopped);
    })();
    running = run;
    void run.finally(() => {
      if (running === run) running = undefined;
    });
    return run;
  };

  // 起步：先按 sidecar 现状排一次精确 timer，再挂兜底 tick。
  ticker = setTick(() => {
    void sweep();
  }, intervalMs);
  unref(ticker);
  reschedule();

  return {
    sweepNow() {
      if (stopped) return 0;
      const snapshots = readSnapshots();
      void sweep();
      return snapshots.length;
    },
    reschedule,
    get stopped() {
      return stopped;
    },
    async dispose() {
      stopped = true;
      rerun = false;
      clearArmed();
      if (ticker !== undefined) {
        clearTickFn(ticker);
        ticker = undefined;
      }
      const pending = running;
      if (pending !== undefined) await pending.catch(() => undefined);
      inFlight.clear();
    },
    failuresOf(sessionId: string) {
      return backoff.get(sessionId)?.failures ?? 0;
    },
  };
}
