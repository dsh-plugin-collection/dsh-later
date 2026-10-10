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
import { type PresenceBadgeState, type PresenceScheduleLike, type PresenceSummary } from './presence.js';
/** `userSchedules` 投影值在 `projectionValues` 里的键名。 */
export declare const SCHEDULE_PROJECTION_KEY = "userSchedules";
/**
 * 一条会话的定时摘要：数量 + 下次触发 + 视觉状态。
 *
 * `state` 是**快照时刻**由 {@link badgeStateFor} 判定的结果（`scheduled` /
 * `urgent` ≤5min / `overdue` 已到期未派发），因此 store 每次重算/定时 tick 都会
 * 刷新它；暂停项计入 `count`/`pausedCount`，但**不参与** `nextAt`（见 presence 模块
 * 对暂停语义的说明）。
 */
export interface ScheduleSummaryEntry extends PresenceSummary {
    /** 该会话的 badge 状态（按快照时刻判定）。 */
    readonly state: PresenceBadgeState;
}
/** 会话 id → 该会话的定时摘要（**仅**包含有任务的会话）。 */
export type ScheduleSummaryMap = ReadonlyMap<string, ScheduleSummaryEntry>;
/** 摘要所需的最小会话列表快照面（`SessionListState` 的结构子集）。 */
export interface ScheduleSummarySource {
    /** 会话 id → 会话行事实（只用到 `projectionValues`）。 */
    readonly byId: Readonly<Record<string, ScheduleSummaryRowLike | undefined>>;
}
/** 会话行事实的结构子集。 */
export interface ScheduleSummaryRowLike {
    /** 该会话的投影现值（含 `userSchedules`）。 */
    readonly projectionValues?: Readonly<Record<string, unknown>>;
}
/**
 * 从 `projectionValues` 里取出任务数组（容错：形状不对一律当作无任务）。
 * @param projectionValues - 会话行的投影现值集合。
 * @returns 任务数组；缺失或形状非法时 undefined。
 */
export declare function schedulesOfProjection(projectionValues: Readonly<Record<string, unknown>> | undefined): readonly PresenceScheduleLike[] | undefined;
/**
 * 全会话归纳：把会话列表快照折叠成 {@link ScheduleSummaryMap}。
 * @param source - 会话列表快照（`sessions.list.getSnapshot()`）。
 * @param now - 判定 `state` 的当前时刻（epoch ms）。
 * @returns 会话 id → 摘要；无任务的会话不出现在 map 里。
 */
export declare function buildScheduleSummary(source: ScheduleSummarySource, now: number): ScheduleSummaryMap;
/**
 * 两份摘要是否等价（逐条比对四个字段）。store 用它决定是否需要通知订阅者，
 * 避免每次重算都产生新的 Map 引用导致 React 无谓重渲染。
 * @param a - 旧摘要。
 * @param b - 新摘要。
 * @returns 键集合与每条内容都相同时为 true。
 */
export declare function sameScheduleSummary(a: ScheduleSummaryMap, b: ScheduleSummaryMap): boolean;
/** 分组聚合结果（折叠的工作区分组徽标直接用这一份）。 */
export interface GroupScheduleSummary {
    /** 组内**有任务**的会话数。 */
    readonly sessions: number;
    /** 组内任务总数（含暂停项）。 */
    readonly count: number;
    /** 组内暂停项数量。 */
    readonly pausedCount: number;
    /** 组内最早触发时刻（epoch ms）；全部暂停或缺省时为 undefined。 */
    readonly nextAt?: number;
    /** 组内最高优先级状态（overdue > urgent > scheduled）；无任务时为 undefined。 */
    readonly state?: PresenceBadgeState;
}
/**
 * 按**分组**聚合摘要：给定组内会话 id，折叠出可直接渲染的分组事实。
 *
 * 消费方（如 dsh-group-status 的 `GroupLiveStatus`）只需把组内会话 id 传进来，
 * 无需理解 `nextAt`/暂停语义。
 * @param summary - {@link ScheduleSummaryMap}。
 * @param sessionIds - 组内会话 id（顺序无关；不在摘要里的会被忽略）。
 * @returns 分组级摘要；组内无任务时 `sessions`/`count` 为 0、`state` 缺省。
 */
export declare function summarizeScheduleGroup(summary: ScheduleSummaryMap, sessionIds: Iterable<string>): GroupScheduleSummary;
