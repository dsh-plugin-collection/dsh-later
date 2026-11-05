/** 兜底 tick 周期：60s 量级（精确 timer 负责正常路径，它只负责"迟早会扫到"）。 */
export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
/** 同一会话连续唤醒失败多少次后放弃并告警一次。 */
export const MAX_WAKE_FAILURES = 5;
/** 退避上限：失败越多次，越不该继续频繁拉起 agent。 */
export const MAX_BACKOFF_MS = 10 * 60_000;
/** Node timers 能表示的最大延迟（超过会立刻触发，必须夹住）。 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;
/**
 * 第 `failures` 次失败后的等待时长（1s → 2s → 4s …，封顶 {@link MAX_BACKOFF_MS}）。
 * @param failures - 已经连续失败的次数（≥1）。
 * @returns 毫秒数。
 */
export function backoffForFailures(failures) {
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
export function resolveScheduledAtFromLog(events, scheduleId, createdAt) {
    if (!Number.isFinite(createdAt) || createdAt < 0)
        return undefined;
    for (const event of events) {
        if (event?.type !== 'schedule/change')
            continue;
        const data = event.data;
        if (data === undefined || data === null)
            continue;
        if (data.operation !== 'create')
            continue;
        const record = data.schedule;
        if (record === undefined || record === null || record.id !== scheduleId)
            continue;
        if (record.kind === 'after') {
            const seconds = record.afterSeconds;
            if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0)
                return undefined;
            return createdAt + seconds * 1000;
        }
        if (typeof record.scheduledAt === 'string') {
            const at = Date.parse(record.scheduledAt);
            if (Number.isFinite(at))
                return at;
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
export function createExpirySweeper(options) {
    const now = options.now ?? (() => Date.now());
    const intervalMs = options.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    // 默认走全局定时器；测试可整体换成假件（含假时钟）。
    const setTimer = options.setTimeout ?? ((handler, delay) => setTimeout(handler, delay));
    const clearTimerFn = options.clearTimeout ?? ((handle) => clearTimeout(handle));
    const setTick = options.setInterval ?? ((handler, delay) => setInterval(handler, delay));
    const clearTickFn = options.clearInterval ?? ((handle) => clearInterval(handle));
    let stopped = false;
    /** 精确 timer：排在最近的到期点。 */
    let timer;
    /** 兜底 tick。 */
    let ticker;
    /** 在途扫描（同一时刻最多一轮）。 */
    let running;
    let rerun = false;
    /** 会话 → 退避状态（连续失败次数 / 下次允许尝试的时刻 / 是否已放弃）。 */
    const backoff = new Map();
    /** 已尝试唤醒、但还没观察到到期点被消化的会话。 */
    const inFlight = new Set();
    /** 已喊过「无法回算」的条目（`会话/id`）：每项只喊一次，不刷日志。 */
    const warnedUnresolved = new Set();
    /** 已喊过「放弃」的会话：只喊一次。 */
    const warnedGaveUp = new Set();
    const unref = (handle) => {
        const candidate = handle;
        if (candidate !== undefined && typeof candidate.unref === 'function')
            candidate.unref();
    };
    const clearArmed = () => {
        if (timer !== undefined) {
            clearTimerFn(timer);
            timer = undefined;
        }
    };
    /** `resolveScheduledAt` 的容错包装：它读会话日志，可能抛。 */
    const safeResolve = (sessionId, scheduleId) => {
        try {
            const value = options.resolveScheduledAt(sessionId, scheduleId);
            return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
        }
        catch (error) {
            options.warn(`later: 回算提醒 ${scheduleId}（会话 ${sessionId}）的到期时刻失败: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    };
    /** 一条条目的到期时刻：优先 sidecar 字段，缺了按日志回算（推不出来 = undefined）。 */
    const targetOf = (sessionId, scheduleId, entry) => {
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
                options.warn(`later: 提醒 ${scheduleId}（会话 ${sessionId}）缺到期时刻且无法从会话日志回算，` +
                    `已跳过宿主级唤醒；该会话被打开时它仍会照常派发。`);
            }
        }
        return resolved;
    };
    /** 一个快照里最早到期的时刻（用来判断"唤醒后到期点有没有被消化"）。 */
    const earliestOf = (snapshot) => {
        let earliest;
        for (const [scheduleId, entry] of Object.entries(snapshot.entries)) {
            const target = targetOf(snapshot.sessionId, scheduleId, entry);
            if (target === undefined)
                continue;
            earliest = earliest === undefined ? target : Math.min(earliest, target);
        }
        return earliest;
    };
    const readSnapshots = () => {
        try {
            return options.snapshots();
        }
        catch (error) {
            options.warn(`later: 到期扫描读不到 sidecar 快照，本轮跳过: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    };
    /** 排下一次精确扫描（只排仍存在的最小到期点）。 */
    const reschedule = () => {
        if (stopped)
            return;
        clearArmed();
        let nearest;
        for (const snapshot of readSnapshots()) {
            const earliest = earliestOf(snapshot);
            if (earliest === undefined)
                continue;
            nearest = nearest === undefined ? earliest : Math.min(nearest, earliest);
        }
        if (nearest === undefined)
            return;
        const at = now();
        const delay = Math.min(Math.max(nearest - at, 0), MAX_TIMER_DELAY_MS);
        timer = setTimer(() => {
            timer = undefined;
            void sweep();
        }, delay);
        unref(timer);
    };
    /** 记一次唤醒失败并排退避；只在「第一次」与「放弃」两处告警（不刷日志）。 */
    const noteFailure = (sessionId, detail) => {
        const failures = (backoff.get(sessionId)?.failures ?? 0) + 1;
        const gaveUp = failures >= MAX_WAKE_FAILURES;
        backoff.set(sessionId, { failures, nextAttempt: now() + backoffForFailures(failures), gaveUp });
        if (gaveUp) {
            if (warnedGaveUp.has(sessionId))
                return;
            warnedGaveUp.add(sessionId);
            options.warn(`later: 会话 ${sessionId} 连续 ${failures} 次冷唤醒失败，已停止自动唤醒（不再重试风暴）；` +
                `该会话的提醒在它被打开或被用户改动时照常投递。最后一次错误: ${detail}`);
            return;
        }
        if (failures === 1) {
            options.warn(`later: 会话 ${sessionId} 冷唤醒失败，按指数退避重试（第 1 次）: ${detail}`);
        }
    };
    /**
     * 对单个会话决定是否唤醒。
     *
     * 不看 `wake()` 的返回值定成败：投递是异步的（followup 之后还有确认窗口），用
     * 「下一轮扫描时这条提醒还在不在、还到期不到期」当判据更可靠。`wake()` 抛错则当场记失败。
     */
    const poll = (snapshot, at) => {
        const sessionId = snapshot.sessionId;
        if (!options.wakeable(sessionId))
            return;
        const state = backoff.get(sessionId);
        if (state !== undefined && (state.gaveUp || at < state.nextAttempt))
            return;
        inFlight.add(sessionId);
        let outcome;
        try {
            outcome = Promise.resolve(options.wake(sessionId));
        }
        catch (error) {
            inFlight.delete(sessionId);
            noteFailure(sessionId, error instanceof Error ? error.message : String(error));
            return;
        }
        void outcome.then(() => {
            inFlight.delete(sessionId);
        }, (error) => {
            inFlight.delete(sessionId);
            noteFailure(sessionId, error instanceof Error ? error.message : String(error));
        });
    };
    /** 结算上一轮的在飞唤醒（见 poll 的注释）。 */
    const settleInFlight = (byId, at) => {
        for (const sessionId of [...inFlight]) {
            // 还在飞：等它落地，不重复计数。
            if (inFlight.has(sessionId))
                continue;
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
    const settleUnconsumed = (byId, at) => {
        for (const [sessionId, state] of [...backoff.entries()]) {
            if (inFlight.has(sessionId) || state.gaveUp)
                continue;
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
            if (at < state.nextAttempt)
                continue;
            if (settledSessions.has(sessionId))
                continue;
            noteFailure(sessionId, '唤醒后提醒仍然到期（未投递）');
        }
    };
    /** 本轮已尝试过的会话（每轮每个会话最多记一次失败）。 */
    const settledSessions = new Set();
    /** 一轮扫描。 */
    const runSweep = async () => {
        const at = now();
        const snapshots = readSnapshots();
        const byId = new Map();
        for (const snapshot of snapshots)
            byId.set(snapshot.sessionId, snapshot);
        settledSessions.clear();
        settleInFlight(byId, at);
        settleUnconsumed(byId, at);
        for (const snapshot of snapshots) {
            if (stopped)
                return;
            if (inFlight.has(snapshot.sessionId))
                continue;
            const earliest = earliestOf(snapshot);
            if (earliest === undefined || earliest > at)
                continue;
            poll(snapshot, at);
            settledSessions.add(snapshot.sessionId);
        }
        reschedule();
    };
    /** 入口：串行化扫描（不并发，重入合并成"再跑一轮"）。 */
    const sweep = () => {
        if (stopped)
            return Promise.resolve();
        if (running !== undefined) {
            rerun = true;
            return running;
        }
        const run = (async () => {
            do {
                rerun = false;
                try {
                    await runSweep();
                }
                catch (error) {
                    options.warn(`later: 到期扫描本轮异常（下轮继续）: ${error instanceof Error ? error.message : String(error)}`);
                }
            } while (rerun && !stopped);
        })();
        running = run;
        void run.finally(() => {
            if (running === run)
                running = undefined;
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
            if (stopped)
                return 0;
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
            if (pending !== undefined)
                await pending.catch(() => undefined);
            inFlight.clear();
        },
        failuresOf(sessionId) {
            return backoff.get(sessionId)?.failures ?? 0;
        },
    };
}
