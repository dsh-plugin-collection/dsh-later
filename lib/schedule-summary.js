/**
 * 定时任务摘要：dsh-later 对外暴露的**公共数据面**（跨会话 / 跨插件）。
 *
 * 关键事实（本插件「路线 B」的数据源）：`userSchedules` 是 client-visible 投影，
 * 宿主在 `session.list` 基线里为**每个**会话携带 projections 块（live 会话走注册
 * 表现值、冷会话走持久化投影缓存），客户端把它合入
 * `SessionSummary.projectionValues`。因此**任何**持有 `sessions` 服务的客户端插件
 * 都能读到全会话的定时任务，本模块只负责把它折叠成稳定形状。
 *
 * 契约形状（issue #17）：`Map<SessionId, { count, nextAt, state }>`——即
 * {@link ScheduleSummaryMap}。dsh-later 通过 `dsh-later/client` 导出
 * {@link buildScheduleSummary}（纯函数）、`createScheduleSummaryStore`（可订阅
 * store）与 `useScheduleSummary`（React hook），消费方按需选用。
 *
 * 本模块零 DOM / 零 React 依赖：宿主、浏览器与 `node --test` 都能直接跑。
 * @module dsh-later/schedule-summary
 */
import { badgeStateFor, summarizeSchedules, } from './presence.js';
/** `userSchedules` 投影值在 `projectionValues` 里的键名。 */
export const SCHEDULE_PROJECTION_KEY = 'userSchedules';
/**
 * 从 `projectionValues` 里取出任务数组（容错：形状不对一律当作无任务）。
 * @param projectionValues - 会话行的投影现值集合。
 * @returns 任务数组；缺失或形状非法时 undefined。
 */
export function schedulesOfProjection(projectionValues) {
    const value = projectionValues?.[SCHEDULE_PROJECTION_KEY];
    if (typeof value !== 'object' || value === null)
        return undefined;
    const schedules = value.schedules;
    return Array.isArray(schedules) ? schedules : undefined;
}
/**
 * 全会话归纳：把会话列表快照折叠成 {@link ScheduleSummaryMap}。
 * @param source - 会话列表快照（`sessions.list.getSnapshot()`）。
 * @param now - 判定 `state` 的当前时刻（epoch ms）。
 * @returns 会话 id → 摘要；无任务的会话不出现在 map 里。
 */
export function buildScheduleSummary(source, now) {
    const summary = new Map();
    for (const [sessionId, row] of Object.entries(source.byId)) {
        if (row === undefined)
            continue;
        const entry = summarizeSchedules(schedulesOfProjection(row.projectionValues));
        if (entry.count === 0)
            continue;
        summary.set(sessionId, { ...entry, state: badgeStateFor(entry.nextAt, now) });
    }
    return summary;
}
/**
 * 两份摘要是否等价（逐条比对四个字段）。store 用它决定是否需要通知订阅者，
 * 避免每次重算都产生新的 Map 引用导致 React 无谓重渲染。
 * @param a - 旧摘要。
 * @param b - 新摘要。
 * @returns 键集合与每条内容都相同时为 true。
 */
export function sameScheduleSummary(a, b) {
    if (a === b)
        return true;
    if (a.size !== b.size)
        return false;
    for (const [sessionId, left] of a) {
        const right = b.get(sessionId);
        if (right === undefined)
            return false;
        if (left.count !== right.count ||
            left.pausedCount !== right.pausedCount ||
            left.nextAt !== right.nextAt ||
            left.state !== right.state) {
            return false;
        }
    }
    return true;
}
/** 状态优先级（越大越紧急）。 */
const STATE_RANK = { scheduled: 0, urgent: 1, overdue: 2 };
/**
 * 按**分组**聚合摘要：给定组内会话 id，折叠出可直接渲染的分组事实。
 *
 * 消费方（如 dsh-group-status 的 `GroupLiveStatus`）只需把组内会话 id 传进来，
 * 无需理解 `nextAt`/暂停语义。
 * @param summary - {@link ScheduleSummaryMap}。
 * @param sessionIds - 组内会话 id（顺序无关；不在摘要里的会被忽略）。
 * @returns 分组级摘要；组内无任务时 `sessions`/`count` 为 0、`state` 缺省。
 */
export function summarizeScheduleGroup(summary, sessionIds) {
    let sessions = 0;
    let count = 0;
    let pausedCount = 0;
    let nextAt;
    let state;
    for (const sessionId of sessionIds) {
        const entry = summary.get(sessionId);
        if (entry === undefined)
            continue;
        sessions += 1;
        count += entry.count;
        pausedCount += entry.pausedCount;
        if (entry.nextAt !== undefined && (nextAt === undefined || entry.nextAt < nextAt))
            nextAt = entry.nextAt;
        if (state === undefined || STATE_RANK[entry.state] > STATE_RANK[state])
            state = entry.state;
    }
    return nextAt === undefined
        ? { sessions, count, pausedCount, state }
        : { sessions, count, pausedCount, nextAt, state };
}
