/**
 * `userSchedules` 会话投影：宿主侧维护的「用户创建的、当前活动的定时提醒」，
 * 通过 `session/projection` 帧实时推给客户端（GUI 用 `useProjection` 读取）。
 *
 * fold 输入两路事件：
 *  - `schedule/change`：dsh-schedule 的严格 v1 事件（我们写入时与其完全兼容），
 *    用其导出的 `decodeScheduleChange` 解码；
 *  - `session-scheduler/user-schedule`：本插件自有的所有权记录（哪种来源）。
 *
 * 「哪些事件属于本会话」按 **seq 切点**判，不按 `session/end-seed` 事件判。
 * 宿主把**整份**日志（含继承前缀）从 seq 0 折进本单元，并在
 * `init(header, inheritedEventCount)` 的第二参数给出前缀长度——那个长度就是这里的
 * `seedSeq`，`seq < seedSeq` 的事件一律不进状态，因此派生会话不继承父会话的提醒
 * （AC-07）。投递通道 `foldUserState`（`src/user-tools.ts` → `readFoldInput`）吃的
 * 是**同一个数字**，两条通道对「本会话的历史」的口径由此一致。
 *
 * 为什么不能拿 `session/end-seed` 当边界（issue #11 的缺陷本体）：内核**每次冷恢复
 * 会话**都会在日志尾部补一条 `session/end-seed {}`（`dsh-session/lib/index.js:1428`，
 * 0.1.2-rc.1 是 `:1322`，措辞略异但同样只发 `{}`）——它标记的是「本会话自己历史的
 * 重放结束」，不是归属边界。旧实现见该事件即清空 active，于是投影被抹空而投递通道
 * 照常工作：提醒到点照发，dock 倒计时条与侧栏却是空的，用户看不见也就取消不掉。
 * 也不能改按 `data.inherited === true` 分派：`0.1.2-rc.1` 的 fork 边界也只发 `{}`
 * （那代根本没有 `inherited` 这个字段），按 data 形状判会把那一代的 fork 隔离弄坏。
 *
 * 注意 `apply` 为增量 fold：无关事件必须返回同一状态引用，否则会误触发推送。
 * @module dsh-later/projection
 */
import { z } from 'zod';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import * as schedNs from '@deepseek-ai/dsh-schedule';
import { resolveEveryOccurrence } from '@deepseek-ai/dsh-schedule';

/**
 * `decodeScheduleChange` 在 `dsh-schedule@0.2.2-alpha.3` 起被移除（改为
 * domain / task 模型，见 GitHub issue #12）。**不能**用具名 import：ESM 在
 * 目标导出缺失时是链接期硬失败，整个插件一条 fiber 都不激活
 * （`SyntaxError: The requested module … does not provide an export named …`），
 * 运行期 try/catch 也接不住。这里走 namespace + 属性访问，缺符号时退化为
 * 「该事件不解码」，由下面的解码失败分支原地跳过。
 *
 * 与 `schedule-compat.ts` 的 `pick()` 同一口径；那边是模块私有，这里保持
 * 本文件自足，避免为一个属性访问引入跨模块依赖。
 */
function pickExport<T>(name: string): T | undefined {
  return (schedNs as unknown as Record<string, unknown>)[name] as T | undefined;
}

/**
 * 旧代次的变更解码器；`0.2.2-alpha.3` 起不存在（返回 undefined）。
 *
 * 但**不能就此跳过**：alpha.3 保留了 `decodeScheduleRecord`（只解记录、不解
 * `{operation, schedule}` 包装），而载荷形状两代一致。取不到旧解码器时在本仓库
 * 拆开包装、把 `schedule` 交给 `decodeScheduleRecord` 校验——语义与旧解码器一致。
 *
 * 这条与 `user-tools.ts` 的 `decodeChangeCompat` 是**同一件事的两处实现**：
 * 两处都必须有，只改一处就会出现「fold 通了、投影还是空」的半残状态
 * （0.2.2-alpha.3 上真实发生过：提醒能建、能投递，GUI 上什么都看不见）。
 */
const upstreamDecodeChange = pickExport<(data: unknown) => ScheduleChange>('decodeScheduleChange');
const upstreamDecodeRecord = pickExport<(value: unknown) => unknown>('decodeScheduleRecord');

function decodeScheduleChangeCompat(data: unknown): ScheduleChange {
  const upstream = upstreamDecodeChange;
  if (upstream !== undefined) return upstream(data);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new TypeError('schedule change must be an object');
  }
  const payload = data as Record<string, unknown>;
  const operation = payload['operation'];
  if (operation === 'create') {
    const raw = payload['schedule'];
    const record = upstreamDecodeRecord !== undefined ? upstreamDecodeRecord(raw) : raw;
    if (typeof (record as { id?: unknown })?.id !== 'string') {
      throw new TypeError('schedule change create requires a record with a string id');
    }
    return { operation: 'create', schedule: record as AfterScheduleRecord };
  }
  if (operation === 'delete') {
    const id = payload['id'];
    if (typeof id !== 'string') throw new TypeError('schedule change delete requires a string id');
    return { operation: 'delete', id };
  }
  if (operation === 'dispatch') {
    const id = payload['id'];
    if (typeof id !== 'string') throw new TypeError('schedule change dispatch requires a string id');
    const acceptedAt = payload['acceptedAt'];
    return typeof acceptedAt === 'string'
      ? { operation: 'dispatch', id, acceptedAt }
      : { operation: 'dispatch', id };
  }
  throw new TypeError(`unknown schedule change operation ${String(operation)}`);
}

/**
 * 仅供 `tests/schedule-change-decode-parity.test.mjs` 使用的兜底解码器出口。
 *
 * 为什么必须导出：开发树里 `dsh-schedule` 一直有 `decodeScheduleChange`，所以
 * 正常路径**永远走不到兜底分支**——不导出就只能靠真内核复现，而这正是 issue #12
 * 第二段「只改了一处、单测全绿」的成因。导出让单测能直接钉住兜底语义。
 */
export const __decodeScheduleChangeCompatForTest = decodeScheduleChangeCompat;

import type {
  AfterScheduleRecord,
  AtScheduleRecord,
  EveryScheduleRecord,
} from '@deepseek-ai/dsh-schedule';

/**
 * `schedule/change` 事件解出的三种操作。上游 `0.2.2-alpha.3` 起类型面不再导出
 * `ScheduleChange`（GitHub issue #12），本仓按旧版语义自行声明。
 */
type ScheduleChange =
  | { readonly operation: 'create'; readonly schedule: unknown }
  | { readonly operation: 'delete'; readonly id: string }
  | { readonly operation: 'dispatch'; readonly id: string; readonly acceptedAt?: string };
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
    host_path: z.string().optional(),
  })
  .strict();

/**
 * 耐久图片引用 → 宿主绝对路径的解析器（由 `index.ts` 在 apply 时注入）。
 *
 * 为什么是**注入**而不是让本模块直接依赖 `ctx`：投影单元是纯 fold + 纯 view，
 * 宿主按事件到达推进它、并按 seq 消费 view 出的帧，模块内不持有任何服务引用
 * （`ownership-store` 同理，走的是 sessionId 键控的模块级状态）。注入一个函数
 * 既能拿到 `ctx.attachments`，又保住这条边界，也让 `attachmentWireOf` 可在
 * 无服务环境下（`node --test`）直接测。
 *
 * 未注入（旧宿主 / 无 attachments 后端 / 测试）时返回 `undefined`，即不带
 * `host_path`，客户端退回 `uiConversation.imageUrl` 那条通道。
 */
/** 耐久图片引用（= sidecar 里 image 块的 `attachment`，宿主 `imageHostPath` 的入参）。 */
type ImageRefLike = Extract<ScheduledAttachment, { type: 'image' }>['attachment'];

type ImageHostPathResolver = (ref: ImageRefLike) => string | undefined;

let imageHostPathResolver: ImageHostPathResolver | undefined;

/** 注入解析器（幂等；插件重载时重复调用是预期行为）。 */
export function setImageHostPathResolver(resolver: ImageHostPathResolver | undefined): void {
  imageHostPathResolver = resolver;
}

/**
 * 现算一条图片引用的宿主绝对路径，任何失败都收敛成 `undefined`。
 *
 * 必须吞异常：`imageHostPath` 对非法 `attachmentId` 抛 `AttachmentError`
 * （`INVALID_ATTACHMENT_REF`），而 sidecar 是本地文件、可能被外部改写——
 * 一个坏引用不该让整份投影拒读，只该让这张缩略图退回降级 chip。
 */
function imageHostPathOf(ref: ImageRefLike): string | undefined {
  if (imageHostPathResolver === undefined) return undefined;
  try {
    const path = imageHostPathResolver(ref);
    return typeof path === 'string' && path.length > 0 ? path : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 单条任务最多带出多少个附件块（issue #37）。
 *
 * 投影帧按「任务数 × 附件数」膨胀，而宿主 composer 的 `dropLimits.count` 远小于
 * 此值，所以 8 是防御性上限而非产品限制；被截断时以 `attachments_total` 报原始
 * 总数，客户端据此显示「+N」。
 */
const MAX_WIRE_ATTACHMENTS = 8;

/**
 * 把 sidecar 的附件块映射成 wire 引用（不透明 id + 展示元数据；image 另带一个
 * **现算**的 `host_path`，供客户端走宿主 `/api/file` 出图，见 `domain.ts`）。
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
      // host_path 从引用**现算**（不是从 sidecar 读），所以改写 sidecar 造不出假路径。
      const hostPath = imageHostPathOf(ref);
      return {
        kind: 'image',
        attachment_id: ref.attachmentId,
        ...(typeof ref.mediaType === 'string' ? { media_type: ref.mediaType } : {}),
        ...(typeof ref.bytes === 'number' ? { bytes: ref.bytes } : {}),
        ...(typeof ref.width === 'number' ? { width: ref.width } : {}),
        ...(typeof ref.height === 'number' ? { height: ref.height } : {}),
        ...(hostPath === undefined ? {} : { host_path: hostPath }),
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
  /**
   * 继承前缀切点（seq）：由 `init` 的第二参数 `inheritedEventCount` 带入，
   * `seq < seedSeq` 的事件属于祖先会话，一律不进状态。正常 `init` 只产出 `>= 0`；
   * 负值只可能来自手搓的状态，含义是「切点未知」，一条事件都不忽略。
   */
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
  /**
   * 继承前缀切点（= `init` 第二参数 `inheritedEventCount`，与投递通道同源）：
   * `seq < seedSeq` 的事件属于祖先会话，一条都不进状态。
   */
  readonly seedSeq: number;
  /** sidecar 暂停留档镜像。 */
  readonly paused: readonly PausedEntry[];
}

function pausedFromSidecar(sessionId: string): readonly PausedEntry[] {
  if (sessionId.length === 0) return [];
  return Object.values(allPaused(sessionId));
}

/**
 * 继承前缀切点的规范化：只接受「非负安全整数」，其余（`undefined` / `null` /
 * 非数字 / 负数）一律折成 `0`。
 *
 * 为什么折成 `0` 而不是退回旧的「见到 end-seed 就清空」：`0` 是内核给**非派生会话**
 * 的诚实答案（`dsh-session` 构造器有 `if (!header.isSeeded && inheritedEventCount !== 0)
 * throw`，表内 9 代都在），拿不到数字时按最可能的真值办。旧的「按 data 形状猜边界 +
 * 见 end-seed 就清」正是 issue #11 的成因，不给它留兜底分支——留了就是把 bug 写成
 * 防御代码。
 */
function normalizeInheritedCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** 初始状态：按会话 id 从所有权 sidecar 装载（进程重启后恢复 GUI 归属）。
 *
 * 第二个参数是宿主 `ProjectionDefinition.init(header, inheritedEventCount)` 契约里的
 * **继承前缀长度**（fork 点之前那些条目的条数）。表内 9 代（`0.1.2-rc.1` …
 * `0.2.2-alpha.2`）都在 `def.init(session.header, session.inheritedEventCount)` 处传它
 * ——逐代 grep 各自 `dsh-session-projection/lib/index.js` 的调用点核实，本模块因此
 * **不依赖任何只在较新代次出现的字段**。本模块把它折成 `seedSeq`，作为「哪些事件
 * 属于本会话」的**唯一**判据——与投递通道 `foldUserState` → `readFoldInput` 吃的是
 * 同一个数字。
 */
export function initUserScheduleProjection(
  header?: { readonly id?: string },
  inheritedEventCount?: number,
): UserScheduleProjectionState {
  const sessionId = typeof header?.id === 'string' && header.id.length > 0 ? header.id : '';
  const entries = sessionId.length > 0 ? allOwnership(sessionId) : {};
  return {
    sessionId,
    owned: Object.keys(entries),
    active: [],
    seedSeq: normalizeInheritedCount(inheritedEventCount),
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
  // 继承前缀：一条都不进状态（AC-07 fork 隔离的实际执行处）。判据是 seq 与切点的
  // 比较，与投递通道 `readFoldInput` 切掉前缀的判据同构。
  if (seedIsBefore(state, event)) return state;

  // `session/end-seed` 对本单元是**无关事件**：返回同一引用，不触发推送帧。
  //
  // 内核在两种完全不同的场合追加这个事件，而两者在日志里的形状无法靠 `data`
  // 区分（`0.1.2-rc.1` 的 fork 边界也只发 `{}`）：
  //  1. fork 切点标记——落在 `seq === seedSeq` 处，前缀已经被上面那条判据整段丢掉，
  //     这里无事可做；
  //  2. 每次冷恢复在**尾部**补的重放边界（`dsh-session/lib/index.js:1428`，
  //     0.1.2-rc.1 是 `:1322`）——落在 `seq > seedSeq` 处，它后面本会话的自有事件
  //     还得继续 fold，清空就把用户的提醒从 GUI 上抹掉了（issue #11）。
  // 于是两条通道口径分叉：投递通道（`foldUserState`）不看这个事件，提醒照发；投影
  // 却空了，用户看不见也取消不掉。这里统一成「不看」，边界由 seq 切点负责。
  if (event.type === 'session/end-seed') return state;

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
      change = decodeScheduleChangeCompat(event.data);
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
        if (change.acceptedAt !== undefined) {
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

/**
 * 该事件是否落在继承前缀里（属于祖先会话，本会话不该有它）。
 *
 * `seedSeq < 0` 只可能来自手搓的状态（正常 `init` 经 `normalizeInheritedCount` 只会
 * 给出 `>= 0`），含义是「切点未知」，此时不忽略任何事件。
 */
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
  // v5：继承前缀切点改由 `init` 的第二参数 `inheritedEventCount` 供给（issue #11）。
  // 必须升版而不是只改 fold：**v4 的缓存 cell 很可能就是被旧的「见 end-seed 就清空」
  // 抹空的那份状态**。宿主 `restore()` 只在行可用（`ver` 相等）时才从行的水位往后折
  // （dsh-session-projection/lib/index.js:286-300），尾部那条重放 end-seed 过了新 fold
  // 也只是 no-op，历史 create 事件**再也不会被重看**——升版前修好的口径对已中毒的
  // 会话永远不生效，用户重启后仍然看不见自己的提醒。版本失配时 `restoreFloor()` 返回
  // 0，宿主整段重折（同一文件 223-231 行），中毒行随之作废。
  stateVersion: 5,
} as const;
