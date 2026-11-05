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
  /** 下一次允许尝试的时刻（epoch ms）。 */
  nextAttempt: number;
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

  /** 排下一次精确扫描（只排仍存在的最小到期点）。 */
  const reschedule = (): void => {
    if (stopped) return;
    clearArmed();
    let nearest: number | undefined;
    for (const snapshot of readSnapshots()) {
      const earliest = earliestOf(snapshot);
      if (earliest === undefined) continue;
      nearest = nearest === undefined ? earliest : Math.min(nearest, earliest);
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
  const noteFailure = (sessionId: string, detail: string): void => {
    const failures = (backoff.get(sessionId)?.failures ?? 0) + 1;
    const gaveUp = failures >= MAX_WAKE_FAILURES;
    backoff.set(sessionId, { failures, nextAttempt: now() + backoffForFailures(failures), gaveUp });
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
   * 不看 `wake()` 的返回值定成败：投递是异步的（followup 之后还有确认窗口），用
   * 「下一轮扫描时这条提醒还在不在、还到期不到期」当判据更可靠。`wake()` 抛错则当场记失败。
   */
  const poll = (snapshot: SweepSnapshot, at: number): void => {
    const sessionId = snapshot.sessionId;
    if (!options.wakeable(sessionId)) return;
    const state = backoff.get(sessionId);
    if (state !== undefined && (state.gaveUp || at < state.nextAttempt)) return;
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

  /** 结算上一轮的在飞唤醒（见 poll 的注释）。 */
  const settleInFlight = (byId: ReadonlyMap<string, SweepSnapshot>, at: number): void => {
    for (const sessionId of [...inFlight]) {
      // 还在飞：等它落地，不重复计数。
      if (inFlight.has(sessionId)) continue;
      const snapshot = byId.get(sessionId);
      const earliest = snapshot === undefined ? undefined : earliestOf(snapshot);
      if (earliest === undefined || earliest > at) {
        // 条目没了 / 被推远了 —— 这次唤醒有效，退避清零。
        backoff.delete(sessionId);
        warnedGaveUp.delete(sessionId);
      }
    }
  };

  /**
   * 结算「上一轮唤醒过、这一轮仍然到期」的会话：那次唤醒没把提醒投出去。
   *
   * 只处理**已经落地**（不在飞）且**到期点仍在过去**的会话。这是退避的唯一来源，
   * 也是「反复投不出去」会自己停下来的原因。
   */
  const settleUnconsumed = (byId: ReadonlyMap<string, SweepSnapshot>, at: number): void => {
    for (const [sessionId, state] of [...backoff.entries()]) {
      if (inFlight.has(sessionId) || state.gaveUp) continue;
      const snapshot = byId.get(sessionId);
      if (snapshot === undefined) {
        backoff.delete(sessionId);
        continue;
      }
      const earliest = earliestOf(snapshot);
      if (earliest === undefined || earliest > at) {
        backoff.delete(sessionId);
        warnedGaveUp.delete(sessionId);
        continue;
      }
      // 仍然到期：说明上一次唤醒没有消化它。只在退避窗口已到时再记一次失败，
      // 否则同一个失败会被每一轮 tick 重复计数（几轮就"放弃"了，纯属虚报）。
      if (at < state.nextAttempt) continue;
      if (settledSessions.has(sessionId)) continue;
      noteFailure(sessionId, '唤醒后提醒仍然到期（未投递）');
    }
  };

  /** 本轮已尝试过的会话（每轮每个会话最多记一次失败）。 */
  const settledSessions = new Set<string>();

  /** 一轮扫描。 */
  const runSweep = async (): Promise<void> => {
    const at = now();
    const snapshots = readSnapshots();
    const byId = new Map<string, SweepSnapshot>();
    for (const snapshot of snapshots) byId.set(snapshot.sessionId, snapshot);
    settledSessions.clear();

    settleInFlight(byId, at);
    settleUnconsumed(byId, at);

    for (const snapshot of snapshots) {
      if (stopped) return;
      if (inFlight.has(snapshot.sessionId)) continue;
      const earliest = earliestOf(snapshot);
      if (earliest === undefined || earliest > at) continue;
      poll(snapshot, at);
      settledSessions.add(snapshot.sessionId);
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
