import { MAX_TIMER_DELAY_MS } from './domain.js';
import { readDueIndex } from './due.js';
export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
export const MAX_WAKE_FAILURES = 5;
export const MAX_BACKOFF_MS = 10 * 60_000;
const WAKE_GRACE_MS = 250;
const WAKE_SETTLE_MS = 30_000;
export function backoffForFailures(failures) {
    const exponent = Math.min(Math.max(failures, 1) - 1, 20);
    return Math.min(1000 * 2 ** exponent, MAX_BACKOFF_MS);
}
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
export function createExpirySweeper(options) {
    const now = options.now ?? (() => Date.now());
    const intervalMs = options.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    const setTimer = options.setTimeout ?? ((handler, delay) => setTimeout(handler, delay));
    const clearTimerFn = options.clearTimeout ?? ((handle) => clearTimeout(handle));
    const setTick = options.setInterval ?? ((handler, delay) => setInterval(handler, delay));
    const clearTickFn = options.clearInterval ?? ((handle) => clearInterval(handle));
    let stopped = false;
    let timer;
    let ticker;
    let running;
    let rerun = false;
    const backoff = new Map();
    const inFlight = new Set();
    const warnedUnresolved = new Set();
    const warnedGaveUp = new Set();
    const warnedUndelivered = new Set();
    const undeliveredRound = new Map();
    const undeliveredTotal = new Map();
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
    const targetOf = (sessionId, scheduleId, entry) => {
        const reading = readDueIndex(entry);
        if (reading.kind === 'consumed')
            return undefined;
        if (reading.kind === 'due')
            return reading.target;
        const resolved = safeResolve(sessionId, scheduleId);
        if (resolved === undefined) {
            const key = `${sessionId}/${scheduleId}`;
            if (!warnedUnresolved.has(key)) {
                warnedUnresolved.add(key);
                options.warn(`later: 提醒 ${scheduleId}（会话 ${sessionId}）缺到期时刻且无法从会话日志回算，` +
                    `已跳过宿主级唤醒；该会话被打开时它仍会照常派发。`);
            }
        }
        return resolved;
    };
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
            return undefined;
        }
    };
    const reschedule = () => {
        if (stopped)
            return;
        clearArmed();
        let nearest;
        const consider = (value) => {
            if (value === undefined)
                return;
            nearest = nearest === undefined ? value : Math.min(nearest, value);
        };
        for (const snapshot of readSnapshots() ?? []) {
            const state = backoff.get(snapshot.sessionId);
            if (state !== undefined) {
                if (state.gaveUp)
                    continue;
                consider(state.attemptAt + Math.max(backoffForFailures(state.failures), WAKE_GRACE_MS));
                continue;
            }
            consider(earliestOf(snapshot));
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
    const noteFailure = (sessionId, detail) => {
        const attemptAt = now();
        const state = backoff.get(sessionId);
        const failures = (state?.failures ?? 0) + 1;
        const gaveUp = failures >= MAX_WAKE_FAILURES;
        backoff.set(sessionId, {
            failures,
            wakes: state?.wakes ?? 0,
            nextAttempt: attemptAt + backoffForFailures(failures),
            attemptAt,
            pending: false,
            gaveUp,
        });
        if (gaveUp) {
            if (warnedGaveUp.has(sessionId))
                return;
            warnedGaveUp.add(sessionId);
            const wakes = state?.wakes ?? 0;
            const elapsed = Math.max(0, Math.round((attemptAt - (state?.attemptAt ?? attemptAt)) / 1000));
            const what = failures === wakes
                ? `连续 ${failures} 次冷唤醒失败（每一次都没能把提醒投出去）`
                : `自最后一次唤醒起已有 ${elapsed}s 投递未收敛（期间共唤醒 ${wakes} 次、失败计数 ${failures}）`;
            options.warn(`later: 会话 ${sessionId} ${what}，已停止自动唤醒与自动重试（不再重试风暴）；` +
                `该会话的提醒在它被打开或被用户改动时立即补投。最后一次错误: ${detail}`);
            return;
        }
        if (failures === 1) {
            options.warn(`later: 会话 ${sessionId} 冷唤醒失败，按指数退避重试（第 1 次）: ${detail}`);
        }
    };
    const poll = (snapshot, at) => {
        const sessionId = snapshot.sessionId;
        if (!options.wakeable(sessionId, snapshot.entries))
            return;
        const state = backoff.get(sessionId);
        if (state !== undefined && (state.gaveUp || at < state.nextAttempt))
            return;
        backoff.set(sessionId, {
            failures: state?.failures ?? 0,
            wakes: (state?.wakes ?? 0) + 1,
            nextAttempt: Math.max(state?.nextAttempt ?? 0, at),
            attemptAt: at,
            pending: true,
            gaveUp: state?.gaveUp ?? false,
        });
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
            const settled = backoff.get(sessionId);
            if (settled !== undefined && !settled.gaveUp) {
                backoff.set(sessionId, { ...settled, nextAttempt: now() + WAKE_SETTLE_MS });
            }
        }, (error) => {
            inFlight.delete(sessionId);
            noteFailure(sessionId, error instanceof Error ? error.message : String(error));
        });
    };
    const settle = (snapshot, at) => {
        const sessionId = snapshot.sessionId;
        const state = backoff.get(sessionId);
        const earliest = earliestOf(snapshot);
        if (state !== undefined) {
            if (inFlight.has(sessionId))
                return 'skip';
            if (at < state.nextAttempt)
                return 'skip';
            const unconsumed = earliest !== undefined && earliest <= at;
            if (!unconsumed) {
                backoff.delete(sessionId);
                warnedGaveUp.delete(sessionId);
            }
            else if (state.gaveUp) {
                return 'skip';
            }
            else if (state.pending) {
                noteFailure(sessionId, '唤醒后提醒仍然到期（未投递）');
                return 'skip';
            }
        }
        if (earliest === undefined || earliest > at)
            return 'skip';
        return 'poll';
    };
    const noteRefused = (sessionId, at, entries) => {
        const reason = options.refuseReason?.(sessionId, entries);
        if (reason === undefined)
            return false;
        const key = `${sessionId}/${reason}`;
        let reasonsOfRound = undeliveredRound.get(sessionId);
        if (reasonsOfRound === undefined) {
            reasonsOfRound = new Set();
            undeliveredRound.set(sessionId, reasonsOfRound);
        }
        reasonsOfRound.add(reason);
        undeliveredTotal.set(reason, (undeliveredTotal.get(reason) ?? 0) + 1);
        if (!warnedUndelivered.has(key)) {
            warnedUndelivered.add(key);
            options.warn(`later: 会话 ${sessionId} 的提醒已到期，但按「${reason}」暂缓唤醒（不是丢弃）：` +
                `它会在本轮之后重试，会话被打开或被用户改动时也会立即补投。`);
        }
        const state = backoff.get(sessionId);
        backoff.set(sessionId, {
            failures: state?.failures ?? 0,
            wakes: state?.wakes ?? 0,
            nextAttempt: at + WAKE_GRACE_MS,
            attemptAt: state?.attemptAt ?? at,
            pending: state?.pending ?? false,
            gaveUp: state?.gaveUp ?? false,
        });
        return true;
    };
    const runSweep = async () => {
        const at = now();
        const snapshots = readSnapshots();
        if (snapshots === undefined) {
            return;
        }
        const seen = new Set();
        for (const snapshot of snapshots) {
            if (stopped)
                return;
            seen.add(snapshot.sessionId);
            if (settle(snapshot, at) !== 'poll')
                continue;
            const entries = snapshot.entries;
            if (options.wakeable(snapshot.sessionId, entries)) {
                poll(snapshot, at);
                continue;
            }
            noteRefused(snapshot.sessionId, at, entries);
        }
        pruneUnseen(seen);
        reschedule();
    };
    const pruneUnseen = (seen) => {
        for (const sessionId of [...backoff.keys()]) {
            if (seen.has(sessionId))
                continue;
            backoff.delete(sessionId);
            warnedGaveUp.delete(sessionId);
        }
        const ownerOf = (key) => {
            const slash = key.indexOf('/');
            return slash === -1 ? '' : key.slice(0, slash);
        };
        const forget = (target) => {
            for (const key of [...target.keys()]) {
                const owner = ownerOf(key);
                if (owner !== '' && !seen.has(owner))
                    target.delete(key);
            }
        };
        forget(warnedUnresolved);
        forget(warnedUndelivered);
        for (const sessionId of [...undeliveredRound.keys()]) {
            if (!seen.has(sessionId))
                undeliveredRound.delete(sessionId);
        }
    };
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
                await Promise.resolve();
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
    ticker = setTick(() => {
        void sweep();
    }, intervalMs);
    void sweep();
    reschedule();
    return {
        sweepNow() {
            if (stopped)
                return 0;
            const snapshots = readSnapshots() ?? [];
            void sweep();
            return snapshots.length;
        },
        reschedule,
        rearm(sessionId) {
            if (backoff.delete(sessionId))
                warnedGaveUp.delete(sessionId);
            reschedule();
        },
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
        wakesOf(sessionId) {
            return backoff.get(sessionId)?.wakes ?? 0;
        },
        undeliveredReasons() {
            const counts = new Map();
            for (const reasons of undeliveredRound.values()) {
                for (const reason of reasons)
                    counts.set(reason, (counts.get(reason) ?? 0) + 1);
            }
            return counts;
        },
        undeliveredTotal() {
            return new Map(undeliveredTotal);
        },
    };
}
