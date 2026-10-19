/**
 * `userSchedules` 会话投影：宿主侧维护的「用户创建的、当前活动的定时提醒」，
 * 通过 `session/projection` 帧实时推给客户端（GUI 用 `useProjection` 读取）。
 *
 * fold 输入两路事件：
 *  - `schedule/change`：dsh-schedule 的严格 v1 事件（我们写入时与其完全兼容），
 *    用其导出的 `decodeScheduleChange` 解码；
 *  - `session-scheduler/user-schedule`：本插件自有的所有权记录（哪种来源）。
 *
 * fork 隔离：`session/end-seed` 标记派生会话的耐久边界。投影在遇到该事件时
 * 重置自身状态（清空 owned/active），因此子会话不继承父会话的提醒（AC-07）。
 *
 * 注意 `apply` 为增量 fold：无关事件必须返回同一状态引用，否则会误触发推送。
 * @module dsh-later/projection
 */
import { z } from 'zod';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { decodeScheduleChange, resolveEveryOccurrence } from '@deepseek-ai/dsh-schedule';
import type {
  AfterScheduleRecord,
  AtScheduleRecord,
  EveryScheduleRecord,
  ScheduleRecord,
} from '@deepseek-ai/dsh-schedule';
import { OWNED_EVENT, PROJECTION_KEY } from './domain.js';
import {
  allOwnership,
  allPaused,
  findPausedByScheduleId,
  getOwnership,
  hasOwnership,
} from './ownership-store.js';
import type { PausedEntry, ScheduledAttachment } from './ownership-store.js';
import type {
  UserScheduleOwnedChange,
  UserScheduleProjectionValue,
  UserScheduleWireItem,
  WireAttachment,
} from './domain.js';

/**
 * wire 里单条附件引用的 schema。
 *
 * `.strict()`：sidecar 是本地文件、可能被外部改写，多余键一律拒读，避免把非预期
 * 字段透给客户端（附件块最终参与「以用户身份代发」，读路径按不可信输入处理）。
 */
const wireAttachmentSchema = z
  .object({
    kind: z.union([z.literal('image'), z.literal('file')]),
    attachment_id: z.string(),
    name: z.string().optional(),
    bytes: z.number().optional(),
    media_type: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .strict();

/**
 * 单条任务最多带出多少个附件块（issue #37）。
 *
 * 投影帧按「任务数 × 附件数」膨胀，而宿主 composer 的 `dropLimits.count` 远小于
 * 此值，所以 8 是防御性上限而非产品限制；被截断时以 `attachments_total` 报原始
 * 总数，客户端据此显示「+N」。
 */
const MAX_WIRE_ATTACHMENTS = 8;

/**
 * 把 sidecar 的附件块映射成 wire 引用（只出不透明 id + 展示元数据）。
 *
 * 两个 builder 共用同一份映射，保证活动项与暂停项规则一致——两面分叉的历史根因
 * 就是规则各写各的。`undefined`/空数组都返回 `{}`，即**整个键不出现**，与
 * `sanitizeAttachments()` 的语义对齐，客户端因此不必区分两种空态。
 */
function attachmentWireOf(
  list: readonly ScheduledAttachment[] | undefined,
): Pick<UserScheduleWireItem, 'attachments' | 'attachments_total'> {
  if (list === undefined || list.length === 0) return {};
  // `attachment` 必须在判别式分支**内部**取：提前解构会让 TS 无法从
  // `block.type` 收窄到 ImageBlock/FileBlock 的具体 ref 类型。
  const mapped = list.map((block): WireAttachment => {
    if (block.type === 'image') {
      const ref = block.attachment;
      return {
        kind: 'image',
        attachment_id: ref.attachmentId,
        ...(typeof ref.mediaType === 'string' ? { media_type: ref.mediaType } : {}),
        ...(typeof ref.bytes === 'number' ? { bytes: ref.bytes } : {}),
        ...(typeof ref.width === 'number' ? { width: ref.width } : {}),
        ...(typeof ref.height === 'number' ? { height: ref.height } : {}),
      };
    }
    const ref = block.attachment;
    return {
      kind: 'file',
      attachment_id: ref.attachmentId,
      ...(typeof ref.name === 'string' ? { name: ref.name } : {}),
      ...(typeof ref.bytes === 'number' ? { bytes: ref.bytes } : {}),
    };
  });
  const shown = mapped.slice(0, MAX_WIRE_ATTACHMENTS);
  return {
    attachments: shown,
    ...(mapped.length > shown.length ? { attachments_total: mapped.length } : {}),
  };
}

/** 单条 wire 项 schema。 */
const wireItemSchema = z
  .object({
    id: z.string(),
    kind: z.union([z.literal('after'), z.literal('at'), z.literal('every')]),
    prompt: z.string(),
    after_seconds: z.number().optional(),
    every_seconds: z.number().optional(),
    scheduled_at: z.string(),
    created_at: z.string().optional(),
    delivery_mode: z.literal('session-local'),
    status: z.union([z.literal('active'), z.literal('paused')]).optional(),
    remaining_seconds: z.number().optional(),
    paused_at: z.string().optional(),
    schedule_id: z.string().optional(),
    window_seconds: z.number().optional(),
    // 无附件时整个键不出现（不是 []），理由见 domain.ts 的字段注释
    attachments: z.array(wireAttachmentSchema).optional(),
    attachments_total: z.number().optional(),
  })
  .strict();

/** 投影 wire 值 schema（wire.viewSchema：离开宿主前校验客户端载荷）。 */
export const userSchedulesSchema = z
  .object({
    schedules: z.array(wireItemSchema),
  })
  .strict();

/**
 * 投影内部状态 schema（stateSchema）。
 *
 * 契约要求内部状态是 plain JSON（持久化投影缓存的前提），因此 owned/active
 * 用数组而非 Set/Map 表达。
 */
const scheduleRecordStateSchema = z
  .object({
    id: z.string(),
    kind: z.union([z.literal('after'), z.literal('at'), z.literal('every')]),
    prompt: z.string(),
    afterSeconds: z.number().optional(),
    everySeconds: z.number().optional(),
    scheduledAt: z.string(),
    createdAt: z.number().optional(),
  })
  .passthrough();

const pausedStateSchema = z.object({
  uid: z.string(),
  prompt: z.string(),
  delivery: z.union([z.literal('context'), z.literal('user')]),
  kind: z.literal('after'),
  remainingSeconds: z.number(),
  originalScheduledAt: z.string(),
  originalAfterSeconds: z.number().optional(),
  lastScheduleId: z.string(),
  pausedAt: z.number(),
});

export const userSchedulesStateSchema = z.object({
  /** 会话 id（init 由 header 注入；apply 据此查询所有权 sidecar 缓存）。 */
  sessionId: z.string(),
  /** 用户工具创建的 schedule id 集合（数组承载集合语义）。 */
  owned: z.array(z.string()),
  /** 当前活动记录（保持首现顺序，view 侧再排序）。 */
  active: z.array(scheduleRecordStateSchema),
  /** 已见 `session/end-seed` 的 seq；更早的继承前缀一律忽略。 */
  seedSeq: z.number(),
  /** sidecar 暂停留档镜像（v4）。 */
  paused: z.array(pausedStateSchema).default([]),
});

/**
 * 活动存储记录：dsh-schedule 记录 + 创建时刻（来自 create 事件的 time）。
 *
 * 显式按**本插件产出的三种 kind** 收窄，而非直接用 `ScheduleRecord`：
 * 0.1.7 的联合新增了 daily/weekly/cron，它们的字段面
 * （`afterSeconds` / `everySeconds`）与本插件的 wire 契约不同，透传会让
 * `wireItemOf` 读到不存在的字段。
 *
 * 逐个具名引用而非 `Extract`：`Extract<ScheduleRecord, {kind:'after'|…}>`
 * 在本仓库的 tsc 配置下不触发收窄（判别式联合的 `Extract` 需 kind 为
 * 单字面量，逐个列举后交集才正确）。
 */
export type StoredScheduleRecord =
  | (AfterScheduleRecord & { readonly createdAt?: number })
  | (AtScheduleRecord & { readonly createdAt?: number })
  | (EveryScheduleRecord & { readonly createdAt?: number });

/** 投影内部状态（plain JSON：owned/active 用数组承载）。 */
export interface UserScheduleProjectionState {
  /** 会话 id（init 由 header 注入）。 */
  readonly sessionId: string;
  /** 用户工具创建的 schedule id 集合。 */
  readonly owned: readonly string[];
  /** 当前活动记录（按 schedule/change 严格 fold）。 */
  readonly active: readonly StoredScheduleRecord[];
  /** 已见 `session/end-seed` 的 seq；更早的继承前缀一律忽略。 */
  readonly seedSeq: number;
  /** sidecar 暂停留档镜像。 */
  readonly paused: readonly PausedEntry[];
}

function pausedFromSidecar(sessionId: string): readonly PausedEntry[] {
  if (sessionId.length === 0) return [];
  return Object.values(allPaused(sessionId));
}

/** 初始状态：按会话 id 从所有权 sidecar 装载（进程重启后恢复 GUI 归属）。 */
export function initUserScheduleProjection(
  header?: { readonly id?: string },
): UserScheduleProjectionState {
  const sessionId = typeof header?.id === 'string' && header.id.length > 0 ? header.id : '';
  const entries = sessionId.length > 0 ? allOwnership(sessionId) : {};
  return {
    sessionId,
    owned: Object.keys(entries),
    active: [],
    seedSeq: -1,
    paused: pausedFromSidecar(sessionId),
  };
}

/** 序列化一条活动记录为 wire 项（id 优先稳定 uid）。 */
function wireItemOf(record: StoredScheduleRecord, sessionId: string): UserScheduleWireItem {
  const ownership = sessionId.length > 0 ? getOwnership(sessionId, record.id) : undefined;
  const uid = ownership?.uid;
  const windowSeconds = ownership?.windowSeconds;
  // 0.1.7 的 `ScheduleRecord` 联合含 daily/weekly/cron，本插件的 wire 契约
  // （`UserScheduleWireItem.kind`）仍只认 after/at/every —— 这三个变体只可能
  // 来自其他插件写入的日志。归一为 `every`（与编辑路径的 300s 默认一致），
  // 避免把未知 kind 泄漏到客户端。
  //
  // 字段读取按 `record.kind` 而非归一后的 `kind`：只有前者能让 TS 对判别式
  // 联合收窄，从而确认 `afterSeconds` / `everySeconds` 存在。
  const kind: 'after' | 'at' | 'every' =
    record.kind === 'after' || record.kind === 'at' ? record.kind : 'every';
  const everySeconds =
    record.kind === 'every' && typeof record.everySeconds === 'number'
      ? record.everySeconds
      : undefined;
  return {
    id: uid ?? record.id,
    kind,
    prompt: record.prompt,
    ...(record.kind === 'after' ? { after_seconds: record.afterSeconds } : {}),
    ...(everySeconds !== undefined ? { every_seconds: everySeconds } : {}),
    ...(typeof record.createdAt === 'number' ? { created_at: new Date(record.createdAt).toISOString() } : {}),
    ...(record.kind === 'after' && typeof windowSeconds === 'number'
      ? { window_seconds: windowSeconds }
      : {}),
    scheduled_at: record.scheduledAt,
    delivery_mode: 'session-local',
    status: 'active',
    schedule_id: record.id,
    // 附件：ownership 已在上面取到，不新增任何 sidecar 读取
    ...attachmentWireOf(ownership?.attachments),
  };
}

function pausedWireItemOf(entry: PausedEntry): UserScheduleWireItem {
  const windowSec = entry.originalAfterSeconds ?? entry.remainingSeconds;
  return {
    id: entry.uid,
    kind: 'after',
    prompt: entry.prompt,
    // 进度条总窗口用原 after 间隔；remaining 单独给冻结剩余
    after_seconds: windowSec,
    window_seconds: windowSec,
    scheduled_at: entry.originalScheduledAt,
    delivery_mode: 'session-local',
    status: 'paused',
    remaining_seconds: entry.remainingSeconds,
    paused_at: new Date(entry.pausedAt).toISOString(),
    schedule_id: entry.lastScheduleId,
    // 暂停项的附件随留档冻结（pause 会删日志记录，留档是唯一素材来源），
    // 与活动项走同一个映射，规则不分叉。
    ...attachmentWireOf(entry.attachments),
  };
}

/** 对 `every` dispatch 推进 scheduledAt（与 dsh-schedule dispatchedRecord 一致）。 */
function advanceEvery(
  record: StoredScheduleRecord,
  acceptedAt: string,
): StoredScheduleRecord | undefined {
  if (record.kind !== 'every') return record;
  const occurrence = resolveEveryOccurrence(record, Date.parse(acceptedAt));
  if (occurrence.nextScheduledAt === undefined) return undefined;
  return { ...record, scheduledAt: occurrence.nextScheduledAt } as StoredScheduleRecord;
}

/**
 * 增量 fold。返回同一引用当事件无关；返回新状态当 owned/active 发生变化。
 */
export function applyUserScheduleProjection(
  state: UserScheduleProjectionState,
  event: SessionEvent,
): UserScheduleProjectionState {
  // 派生会话边界：重置自身，忽略继承前缀（AC-07 fork 隔离）。
  if (event.type === 'session/end-seed') {
    if (
      state.seedSeq === event.seq &&
      state.owned.length === 0 &&
      state.active.length === 0 &&
      state.paused.length === 0
    ) {
      return state;
    }
    // 派生会话（fork）：sidecar 以 sessionId 隔离，派生 id 天然空表；此处再清一次
    // 兜底「同 id 重播种」场景，保持 AC-07 语义。
    const owned =
      state.sessionId.length > 0
        ? Object.keys(allOwnership(state.sessionId))
        : [];
    return {
      sessionId: state.sessionId,
      owned,
      active: [],
      seedSeq: event.seq,
      paused: pausedFromSidecar(state.sessionId),
    };
  }
  if (seedIsBefore(state, event)) return state;

  if (event.type === OWNED_EVENT) {
    const data = event.data as unknown as UserScheduleOwnedChange;
    if (typeof data !== 'object' || data === null || data.version !== 1) return state;
    if (data.operation === 'add') {
      if (state.owned.includes(data.id)) return state;
      return {
        sessionId: state.sessionId,
        owned: [...state.owned, data.id],
        active: state.active,
        seedSeq: state.seedSeq,
        paused: state.paused,
      };
    }
    if (data.operation === 'remove') {
      if (!state.owned.includes(data.id)) return state;
      return {
        sessionId: state.sessionId,
        owned: state.owned.filter((id) => id !== data.id),
        active: state.active,
        seedSeq: state.seedSeq,
        paused: state.paused,
      };
    }
    return state;
  }

  if (event.type === 'schedule/change') {
    let change;
    try {
      change = decodeScheduleChange(event.data);
    } catch {
      return state; // 无法解码的事件跳过（dsh-schedule 自身的 fold 会严格报错）
    }
    switch (change.operation) {
      case 'create': {
        const record = change.schedule as StoredScheduleRecord;
        // 所有权判定改走 sidecar（用户工具在 append 前写 sidecar）。
        // 历史遗留：日志中的 OWNED 事件仍由上方独立分支维护（读兼容）。
        let owned = state.owned;
        if (!owned.includes(record.id) && state.sessionId.length > 0 && hasOwnership(state.sessionId, record.id)) {
          owned = [...owned, record.id];
        }
        // resume：同 uid 的暂停项应在 create 后从 paused 列表消失
        const paused =
          state.sessionId.length > 0
            ? pausedFromSidecar(state.sessionId)
            : state.paused;
        // 固化创建时刻（事件 time），供客户端进度条按真实起点计算
        const withCreated: StoredScheduleRecord =
          typeof event.time === 'number' ? { ...record, createdAt: event.time } : record;
        const existing = state.active.find((entry) => entry.id === record.id);
        if (existing === withCreated && owned === state.owned && paused === state.paused) return state;
        return {
          sessionId: state.sessionId,
          owned,
          active: existing === undefined
            ? [...state.active, withCreated]
            : state.active.map((entry) => (entry.id === record.id ? withCreated : entry)),
          seedSeq: state.seedSeq,
          paused,
        };
      }
      case 'delete': {
        if (!state.active.some((entry) => entry.id === change.id) && !state.owned.includes(change.id)) {
          // 仍可能要把 sidecar 暂停项挂进视图（pause 刚写完留档）
          if (state.sessionId.length > 0) {
            const paused = pausedFromSidecar(state.sessionId);
            const linked =
              findPausedByScheduleId(state.sessionId, change.id) !== undefined;
            if (linked && paused !== state.paused) {
              return {
                sessionId: state.sessionId,
                owned: state.owned.filter((id) => id !== change.id),
                active: state.active.filter((entry) => entry.id !== change.id),
                seedSeq: state.seedSeq,
                paused,
              };
            }
          }
          return state;
        }
        // 删除即撤销所有权声明（sidecar 由工具路径在 flush 后清理；此处先清视图）。
        const owned = state.owned.filter((id) => id !== change.id);
        const active = state.active.filter((entry) => entry.id !== change.id);
        const paused =
          state.sessionId.length > 0 ? pausedFromSidecar(state.sessionId) : state.paused;
        if (owned === state.owned && active === state.active && paused === state.paused) return state;
        return {
          sessionId: state.sessionId,
          owned,
          active,
          seedSeq: state.seedSeq,
          paused,
        };
      }
      case 'dispatch': {
        const current = state.active.find((entry) => entry.id === change.id);
        if (current === undefined) return state;
        let nextActive: readonly StoredScheduleRecord[];
        if ('acceptedAt' in change) {
          const advanced = advanceEvery(current, change.acceptedAt);
          // 周期推进后保留 createdAt（进度条起点跨周期不变）
          const next = advanced === undefined ? undefined : { ...advanced, createdAt: current.createdAt };
          if (next === undefined) {
            nextActive = state.active.filter((entry) => entry.id !== change.id);
          } else {
            nextActive = state.active.map((entry) => (entry.id === change.id ? next : entry));
          }
        } else {
          nextActive = state.active.filter((entry) => entry.id !== change.id);
        }
        if (nextActive === state.active) return state;
        return {
          sessionId: state.sessionId,
          owned: state.owned,
          active: nextActive,
          seedSeq: state.seedSeq,
          paused: state.paused,
        };
      }
      /* c8 ignore next 2 -- decodeScheduleChange 是闭包联合 */
      default:
        return state;
    }
  }

  return state;
}

function seedIsBefore(state: UserScheduleProjectionState, event: SessionEvent): boolean {
  return state.seedSeq >= 0 && typeof event.seq === 'number' && event.seq < state.seedSeq;
}

/**
 * 投影 view：活动 + 暂停（同列表；paused 靠 status 区分，dock 原地冻结）。
 *
 * ⚠️ 这里是**唯一**能让「删除暂停项」生效的地方。原因链：
 *  - 删除暂停项只清 sidecar、**不写会话事件**（补写 `schedule/change` delete 会
 *    因为该 id 在 pause 时已被删除而抛 `targets inactive id`，把日志读坏）；
 *  - 投影 cell 只在事件到达时由 `apply` 推进，且跨进程持久化（projcache），
 *    客户端又按 seq「更高者胜」消费控制帧——没有新事件就没有新帧；
 *  - 于是 `state.paused` 会永久停留在最后一次事件时的快照上。
 * 因此 view 不能直接信任 `state.paused`，必须**以 sidecar 为准重读**：
 * sidecar 是暂停留档的权威存储（`ownship-store`），`state.paused` 只是镜像。
 * 这样无论 cell 多陈旧，读出来的 paused 列表都与真实留档一致。
 */
export function viewUserScheduleProjection(
  state: UserScheduleProjectionState,
): UserScheduleProjectionValue {
  const active = state.active
    .filter((record) => state.owned.includes(record.id))
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
    .map((record) => wireItemOf(record, state.sessionId));
  // sidecar 权威：readFresh 带缓存但会按文件 mtime/内容失效，读到的是最新留档。
  // sessionId 缺失（init 未注入）时退回镜像，保持旧行为。
  const live = state.sessionId.length > 0 ? pausedFromSidecar(state.sessionId) : state.paused;
  const paused = live.map(pausedWireItemOf);
  return { schedules: [...active, ...paused] };
}

/**
 * 投影单元声明（传给 sessionProjections.register）。
 *
 * 形状必须匹配 `ProjectionDefinition`：
 *  - `stateSchema`（不是 schema）：宿主持久化缓存恢复前校验内部状态；
 *  - `wire: { viewSchema, view }`（不是顶层 view）：**只有带 wire 的单元才是
 *    client-visible 的**——`snapshot()`/变更帧都会跳过无 wire 的单元，
 *    客户端 `useProjection(key)` 将永远读到 undefined。
 */
export const userSchedulesProjectionUnit = {
  key: PROJECTION_KEY,
  stateSchema: userSchedulesStateSchema,
  init: initUserScheduleProjection,
  apply: applyUserScheduleProjection,
  wire: {
    viewSchema: userSchedulesSchema,
    view: viewUserScheduleProjection,
  },
  // v3：sessionId + 所有权 sidecar；v4：paused[] 镜像（暂停/恢复）
  stateVersion: 4,
} as const;
