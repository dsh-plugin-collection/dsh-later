/**
 * 待发送提醒 dock（呈现对齐 DSH QueueDock）。
 *
 * 位置：输入框上方 dock 区（conversation.input.dock，与排队消息同区）。
 * 行为：
 *  - 空列表不渲染
 *  - 单条：直接显示 内容 + 时间 + 单独取消/修改
 *  - 多条：折叠为「数量 header + 下一条预览」，点击展开列表（max-height 180px）
 *  - 每条可单独取消；可点击编辑图标进入行内修改内容（保留原时刻）
 * @module dsh-later/client/components/ScheduleDock
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import {
  FileTypeIcon,
  IconChevronDownOutlineRegular,
  IconClockOutlineRegular,
  IconCloseOutlineRegular,
  IconEditOutlineRegular,
  IconPauseOutlineRegular,
  IconPlayOutlineRegular,
  IconSendOutlineRegular,
  IconTrashOutlineRegular,
  fileSizeText,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { detectTimeZone, formatHhmm } from '../../time-utils.js';
import type { SchedStrings } from '../strings.js';
import { useNow } from '../useCountdown.js';
import { useSchedT, type SchedTranslate } from '../useSchedT.js';
import type { CommandOutcome } from '../../command-outcome.js';
import { classifyAttachmentFailure, type AttachmentImageFailure } from '../../attachment-failure.js';
import {
  barSegments,
  barWindow,
  frozenBarSegments,
  planBarAnimation,
  type BarAnimationPlan,
} from '../../bar-geometry.js';
import type { ClientAttachment, ClientSchedule } from '../types.js';

/** 精确剩余时长：超过 1 小时 `H:MM:SS`，否则 `MM:SS`（负值截为 00:00）。 */
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * 用户是否要求「减少动态效果」。
 *
 * 若为 true，活动期**不用** CSS 动画推进，直接给静态宽度——否则 `@media
 * (prefers-reduced-motion)` 里把动画一关，`animation-fill-mode` 会让宽度停在
 * keyframes 的起始值（0%），进度条整条消失。故必须在 JS 侧就改走静态路径。
 */
function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/**
 * 活动期动画计划：把「起点 → 目标时刻」交给 CSS 线性推进。
 *
 * 两个参数各司其职，**缺一不可**（两边都踩过坑）：
 *
 *  - `duration` 必须是**固定的完整窗口**（`end - start`）。若让它随 tick 变化，
 *    浏览器每次都视为新动画并**重启**，产生每秒一次的固定跳变
 *    （实测 deltas 呈 `1.7×5, 10.2` 周期尖峰）。
 *
 *  - `delay` 必须用**当前时刻**算出「已过去」量（`-(now - start)`），把播放头
 *    定位到正确的绝对相位。CSS 动画在元素被重建时会从头播放，而"切走会话再切回"
 *    会卸载并重挂载 dock；若 delay 不用 now，重挂载后相位就退回起点
 *    （实测：真实已过 70s 的 30 分钟任务，切回后仍显示 1.96%，应为 7.56%）。
 *
 * 曾把 delay 也改成"恒定值"以求参数稳定——那是错的：恒定值会让「已过去」恒为 0，
 * 负 delay 形同虚设，重挂载必然回到起点。**duration 固定 + delay 随 now 变化**
 * 才是同时满足"不重启"与"不归零"的唯一组合。
 */
function planBarAnimationFor(
  item: ClientSchedule,
  now: number,
  firstSeen: ReadonlyMap<string, number>,
): BarAnimationPlan | undefined {
  const end = Date.parse(item.scheduled_at);
  if (!Number.isFinite(end)) return undefined;
  const { start, totalMs } = barWindow(item, end, now, firstSeen);
  return planBarAnimation(totalMs, now - start);
}

/** 应用层注入的调用能力。 */
export interface ScheduleDockInjected {
  /** 向宿主执行一条 slash 命令；返回是否受理（`matched`）。 */
  callCommand: (sessionId: string, line: string) => Promise<CommandOutcome>;
  /**
   * 把一条附件引用解析成浏览器可显示的 URL（#38）。
   *
   * 背后是宿主的 `uiConversation.imageUrl(sessionId, ref)`。声明为**可选**是有意的：
   * 该服务只能按会话绑定，且旧宿主组合可能压根没有它——拿不到时 dock 必须**照常
   * 渲染文字与文件 chip**，只是没有缩略图，绝不能整块不渲染。
   *
   * ⚠️ 提供它的地方（index.tsx）**不许**把 `uiConversation` 写进模块级 `inject`：
   * 顶层 inject 是激活门控，服务缺失会让整个插件永久 pending（issue #34 的事故）。
   *
   * 首参是 `sessionId`：本仓 dock 的注入面已经是「首参传 sessionId、inject 零参」
   * 的形状（`callCommand` 同理），且 `ClientSlotDeclaration.inject` 的镜像声明不收
   * 参数。宿主 `queueDockEntry` 用的是 `inject: (sessionId) => …`，那条路要先改宽
   * 镜像声明，属另一处修正。
   */
  loadImage?: (sessionId: string, ref: ClientAttachment) => Promise<string>;
  /**
   * 同步取宿主的图片缓存（`uiConversation.peekImageUrl`）。
   *
   * 有它就能在**不发请求**的情况下直接显示缩略图（例如同一会话里刚上传过、宿主缓存
   * 还热着）。取不到时返回 undefined，组件照常走 `loadImage`。
   */
  peekImage?: (sessionId: string, ref: ClientAttachment) => string | undefined;
  /**
   * 把内核带出的 `host_path` 换算成浏览器可显示的 URL（宿主 `GET /api/file`）。
   *
   * **待发附件只有这条路**：代发前附件不被会话日志引用，`loadImage` / `peekImage`
   * 背后那条 `readAttachment` 要求「已被本会话引用」，必然被拒（#73 那个
   * 「发送后可见」chip 就是这么来的）。所以取图顺序是 host_path 优先、异步通道兜底。
   *
   * 声明为可选：非文件后端（`imageHostPath` 返回 undefined）时内核根本不带
   * `host_path`，此时行为与改动前完全一致。
   */
  localMediaUrl?: (path: string) => string | undefined;
}

/**
 * dock 的取词函数类型：`SchedStrings` 的键集卡住 key。
 *
 * 这是本次「属性式取词改成函数式取词」机械迁移的主要防错手段——拼错的键会在这里编译
 * 失败，而不是把键名（`panelCount`）直接渲染到界面上。
 */
export type ScheduleDockTranslate = (key: keyof SchedStrings, params?: Record<string, string | number>) => string;

/** 会话作用域插槽条目收到的标准 props + 注入。 */
export interface ScheduleDockProps extends ScheduleDockInjected {
  /**
   * 宿主 locale seat 给的取值函数（条目声明了 `locale: NS` 才会被挂上，见
   * index.tsx 的 dock 注册）。形状镜像 `useSchedT.SeatTranslate`。
   *
   * 声明为可选：旧 renderer 不认 `locale` 声明、压根不给 seat；此时整体回落
   * strings.ts 的本地字典（见 useSchedT.schedTranslate）。
   */
  t?: (key: string, params?: Record<string, unknown>) => string;
  /** 会话作用域标准 hook：读取投影。 */
  useProjection?: (key: string) => { schedules?: readonly ClientSchedule[] } | undefined;
  /** 会话 id。 */
  sessionId?: string;
  /**
   * 宿主 factory slot 渲染器（标准 kit **无条件**提供，见 `ui-renderer` 的
   * `scoped-slots.tsx:556`：`kit = { ...standard, renderFactorySlot: boundRenderFactorySlot(entry) }`）。
   *
   * 本插件用它把正文走宿主的 `conversation.user.text` 投影，于是 `@[标签](dsh-session:…)`
   * 这类线格式渲染成引用 chip，而不是在行里露出 base64 —— 与原生队列同源。
   *
   * 声明为可选：更老的 renderer 可能压根不给这一项，此时 `DockPrompt` 退回原文。
   * 身份**按 entry 稳定**（宿主用 `WeakMap` 缓存，注释明写是为了让 memo 组件不因
   * 无关重渲染而重订阅），所以可以进 `useMemo` 依赖 —— 本仓 dock 每秒 tick，这点必须成立。
   */
  renderFactorySlot?: (
    name: string,
    props: object,
    options?: { fallback?: JSX.Element | string },
  ) => JSX.Element | string | null;
}

const deleteLine = (id: string): string => `/user-schedule-delete ${JSON.stringify({ id })}`;
const editLine = (id: string, prompt: string): string =>
  `/user-schedule-edit ${JSON.stringify({ id, prompt })}`;
const steerLine = (id: string): string => `/user-schedule-steer-now ${JSON.stringify({ id })}`;
/**
 * 插话投递对账窗口。
 *
 * 略大于宿主侧的确认预算（`DELIVERY_CONFIRM_TIMEOUT_MS = 2000`），给命令往返与
 * 投影帧留余量。窗口结束行若仍在 → 判「未确认，已保留」。
 */
const STEER_CONFIRM_WINDOW_MS = 2600;
const pauseLine = (id: string): string => `/user-schedule-pause ${JSON.stringify({ id })}`;
const resumeLine = (uid: string): string => `/user-schedule-resume ${JSON.stringify({ uid })}`;

/** 仅 after 且未到点可暂停（与 host 校验一致）。 */
function canPause(item: ClientSchedule, now: number): boolean {
  if (item.status === 'paused') return false;
  if (item.kind !== 'after') return false;
  const epoch = Date.parse(item.scheduled_at);
  return Number.isFinite(epoch) && epoch > now;
}

export function ScheduleDock({ callCommand, loadImage, peekImage, localMediaUrl, sessionId, useProjection, renderFactorySlot, t: seatT }: ScheduleDockProps): JSX.Element | null {
  const now = useNow(1000);
  // seat 优先取词。第一个参数传 undefined：dock 不再注入原始 locale face，所以兜底
  // 路径按 v1 行为取中文——它只在「宿主压根不给 seat」或「key 没进字典」时才走到。
  const { tr: t } = useSchedT(undefined, seatT);
  const projection = typeof useProjection === 'function' ? useProjection('userSchedules') : undefined;
  /**
   * 删除暂停项的本地摘除集合。
   *
   * 根因修复已在宿主侧（`viewUserScheduleProjection` 以 sidecar 为准重读
   * `paused`），正常路径下宿主一清 sidecar，投影帧就把该行摘掉，这里只是让
   * 「点了删除」在命令往返期间立刻有反馈，不必等下一帧。
   *
   * 为什么仍需客户端兜底：客户端按 seq「更高者胜」消费投影帧，若宿主那份 cell
   * 尚未刷新，行可能短暂复活。摘除因此是**粘性**的，只在投影确实变化时解除：
   *   - 投影里该 id 以 active 复现（resume 复用同一 uid）→ 立即解除；
   *   - 该 id 在投影中消失或不再是 paused → 宿主已重算，摘除自然失效。
   * 不按时间过期：投影没变就说明仍是同一份快照，过期只会让已删行复活。
   */
  const [dismissedPaused, setDismissedPaused] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const live = projection?.schedules;
    if (live === undefined) return;
    setDismissedPaused((current) => {
      if (current.size === 0) return current;
      let changed = false;
      const nextSet = new Set(current);
      for (const item of live) {
        // 只有「以 active 复现」才解除；仍是 paused 说明是同一份陈旧投影
        if (item.status !== 'paused' && nextSet.delete(item.id)) changed = true;
      }
      return changed ? nextSet : current;
    });
  }, [projection]);
  /**
   * 本地文案覆盖：编辑**暂停项**时宿主只改 sidecar、不写会话事件，因此投影里的
   * `prompt` 仍是旧值——只依赖投影的话，保存后行内还显示旧文案。这里按 id 记住
   * 新文案；一旦投影给出的 prompt 与之相同（说明宿主已重算）或该行消失，即失效。
   */
  const [promptOverrides, setPromptOverrides] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    const live = projection?.schedules;
    if (live === undefined || promptOverrides.size === 0) return;
    setPromptOverrides((current) => {
      if (current.size === 0) return current;
      let changed = false;
      const nextMap = new Map(current);
      for (const [id, text] of current) {
        const item = live.find((s) => s.id === id);
        // 行消失，或投影已采纳新文案 → 覆盖不再需要
        if (item === undefined || item.prompt === text) {
          nextMap.delete(id);
          changed = true;
        }
      }
      return changed ? nextMap : current;
    });
  }, [projection, promptOverrides]);
  const schedules = useMemo(
    () =>
      (projection?.schedules ?? [])
        .filter((item) => !(item.status === 'paused' && dismissedPaused.has(item.id)))
        .map((item) => {
          const override = promptOverrides.get(item.id);
          return override === undefined ? item : { ...item, prompt: override };
        })
        .sort(
          (a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at),
        ) as ClientSchedule[],
    [projection, dismissedPaused, promptOverrides],
  );

  const [collapsed, setCollapsed] = useState(true);
  /** 折叠头与列表的关联 id（`aria-controls` ↔ `id`），宿主同款做法。 */
  const listId = useId();
  /**
   * 全局唯一在途标记（issue #31/#32 收敛，对齐宿主 `busy: MessageId | null`，
   * client.js:15409 与 :15417 的 `setBusy((current) => current === itemId ? null : current)`）。
   *
   * 旧形态是四个按动作分开的 id 集合（`cancelling`/`steering`/`pausing`/`resuming`）。
   * 它们只有两个用处：派生全局锁、标注「本行在途」；而后者早已没有视觉承载
   * （#32-② 清掉的那三个空挂类名），留着只是两套规则的风险面——
   * `cancelling` 当初正因漏被读取而变成死状态（#32-①），它的清尾又带 2.5s 延时，
   * 并入全局锁会让一次删除把整块 dock 锁死 2.5 秒。宿主没这个负担：一条命令在途、
   * 其余全部禁用、回执落地立即释放。这里照同一形态做。
   */
  const [busyId, setBusyId] = useState<string | null>(null);
  // 行内编辑状态：正在编辑的 schedule id → 当前输入
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editErr, setEditErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 插话发送的完成/失败态跟踪（在途态已并入上面的 `busyId`）。
  const [steerDone, setSteerDone] = useState<ReadonlySet<string>>(new Set());
  const [steerErr, setSteerErr] = useState<ReadonlyMap<string, string>>(new Map());
  /**
   * 投递未确认的 id（宿主 `onUnconfirmed='keep'` 时提醒被留在 active）。
   *
   * 客户端拿不到业务失败码（`callCommand` 只有 admission 的 `matched`），
   * 所以靠投影对账推断：标记已发送后开一个观察窗，行若仍在 → 判「未确认」。
   * 这样即便核心/宿主的行为再变，用户看到的提示也与「行还在」这一事实一致。
   */
  const [steerUnconfirmed, setSteerUnconfirmed] = useState<ReadonlySet<string>>(new Set());

  /**
   * 投递结果对账（观察窗）。
   *
   * 插话成功后行应当随投影更新消失；若观察窗结束仍在，说明宿主判定「未确认」
   * 并保留了条目（`onUnconfirmed='keep'`）—— 此时给出明确提示，而不是静默。
   * 窗口略大于宿主侧 2s 确认预算，留出命令往返与投影帧的余量。
   *
   * 反向也对：若行确实消失了，清掉 done 态（否则同一 id 将来复用时按钮会误显示
   * 「已发送」）。
   */
  useEffect(() => {
    const live = projection?.schedules;
    if (live === undefined) return;
    const present = new Set(live.filter((item) => item.status !== 'paused').map((item) => item.id));
    setSteerDone((current) => {
      if (current.size === 0) return current;
      let changed = false;
      const next = new Set(current);
      for (const id of current) {
        if (!present.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [projection]);

  useEffect(() => {
    if (steerDone.size === 0) return undefined;
    const timer = window.setTimeout(() => {
      const live = projection?.schedules;
      if (live === undefined) return;
      const present = new Set(live.filter((item) => item.status !== 'paused').map((item) => item.id));
      setSteerUnconfirmed((current) => {
        let changed = false;
        const next = new Set(current);
        for (const id of steerDone) {
          // 仍在投影里 → 宿主保留了条目 = 未确认送达
          if (present.has(id) && !next.has(id)) {
            next.add(id);
            changed = true;
          }
          // 已消失 → 送达成功，清掉可能存在的旧提示
          if (!present.has(id) && next.delete(id)) changed = true;
        }
        return changed ? next : current;
      });
    }, STEER_CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [steerDone, projection]);

  // 暂停 / 恢复的失败原因（在途标记已并入 `busyId`）。
  const [pauseErr, setPauseErr] = useState<ReadonlyMap<string, string>>(new Map());

  // 进度条起点：首次见到任务 id 的本地时刻（仅 at 类任务需要）。
  const firstSeenRef = useRef<ReadonlyMap<string, number>>(new Map());
  /**
   * 每个任务「最后一次以 active 渲染」的墙钟时刻（按 id 记账）。
   *
   * 仅用于给冻结帧做**上界钳制**：宿主 `paused_at` 是命令到达宿主的时刻，比用户
   * 点击晚（命令往返），钳一下可让暂停瞬间的条长等于点击前最后一帧。
   *
   * 注意这只是「锦上添花」——冻结比本身由 `(窗口 - 剩余) / 窗口` 纯算术得出
   * （见 bar-geometry），不依赖本 map。因此即便记账缺失/过期，最坏也只是多显示
   * 一点进度，不会出现塌缩或漂移（早期版本把冻结比建在这个上界上，
   * 导致 resume 换窗口后 25.7% → 3.3% 的塌缩）。
   */
  const lastActiveAtRef = useRef<ReadonlyMap<string, number>>(new Map());
  const wallClock = Date.now();
  {
    const next = new Map(lastActiveAtRef.current);
    let changed = false;
    for (const item of schedules) {
      if (item.status === 'paused') continue; // 暂停后停止更新，避免上界前进
      const prev = next.get(item.id);
      if (prev === undefined || wallClock > prev) {
        next.set(item.id, wallClock);
        changed = true;
      }
    }
    for (const id of [...next.keys()]) {
      if (!schedules.some((item) => item.id === id)) {
        next.delete(id);
        changed = true;
      }
    }
    if (changed) lastActiveAtRef.current = next;
  }

  const byId = useMemo(() => new Map(schedules.map((item) => [item.id, item] as const)), [schedules]);
  useEffect(() => {
    // 记录新任务的首次可见时刻（进度条近似起点）
    let changed = false;
    const next = new Map(firstSeenRef.current);
    for (const [id] of byId) {
      if (!next.has(id)) {
        next.set(id, Date.now());
        changed = true;
      }
    }
    for (const id of [...next.keys()]) {
      if (!byId.has(id)) {
        next.delete(id);
        changed = true;
      }
    }
    if (changed) firstSeenRef.current = next;
  }, [byId]);

  /**
   * `editingId` 的清理（issue #31）。
   *
   * 编辑行是条件挂载的：`editingId` 指向的行一旦被收起、从投影里消失，或随会话切换
   * 离开，编辑器就没了，但 `editingId` 还留着旧草稿。可复现的表现是「收起再展开 →
   * 旧输入复活」，用户以为已经丢弃的文本会在下一次保存时被写回。
   *
   * 四条退出路径，各自都有归宿：
   *  - 保存成功 → `submitEdit` 末尾调 `cancelEdit()`；
   *  - 取消（按钮或 Esc）→ `cancelEdit()`；
   *  - 该行从投影消失 → 下面第一个 effect；
   *  - 切换会话 → 下面第二个 effect（`sessionId` 变化）。
   *
   * 判据用 `schedules`（已过滤/已排序的渲染源）而不是原始投影，与宿主一致：宿主也
   * 是拿它渲染中的那份队列判断行是否还在（client.js:15397-15401）。
   */
  useEffect(() => {
    if (editingId === null) return;
    if (schedules.some((item) => item.id === editingId)) return;
    setEditingId(null);
    setEditingText('');
    setEditErr(null);
    setSaving(false);
  }, [editingId, schedules]);

  useEffect(() => {
    // 会话切换：投影换成了另一整套行，旧草稿不属于这个会话。
    setEditingId(null);
    setEditingText('');
    setEditErr(null);
    setSaving(false);
  }, [sessionId]);

  /**
   * 折叠态复位口径（issue #31/#32）：与宿主对齐后**不再需要 effect**。
   *
   * 旧实现的条件是 `schedules.length <= 1`，但单条本来就被 `expanded` 强制直出，
   * 复位与不复位对界面无差异；反而是「多条展开 → 删到一条 → 再加回多条」这条路会
   * 把用户自己展开的状态被抹掉。宿主的复位条件是队列为空（client.js:15397-15401），
   * 而本组件在 `length === 0` 时整体返回 null（卸载），复位自然由下一次挂载的初始
   * 值 `true` 完成——与宿主同形，所以这里两条路径都不需要 effect。
   */

  if (schedules.length === 0 || sessionId === undefined) return null;

  const next = schedules[0];
  if (next === undefined) return null;
  /**
   * 整块 dock 是否有命令在途——宿主的同一条判据（`disabled: busy !== null`）。
   * `saving` 是行内编辑的「保存中」标记，属 dock-editor 的区，这里只读并入。
   */
  const busy = busyId !== null || saving;
  /**
   * 释放全局锁。**按 id 释放**：迟到的回执只能清掉自己那一次，不得顶掉期间新发起的
   * 请求（宿主同款写法，client.js:15417）。这也是去掉删除的 2.5s 尾巴后仍然安全的
   * 前提——`handleCancel` 的 `restore()` 回滚与 `finally` 走同一条释放路径，
   * 不会留下永久禁用的按钮。
   */
  const releaseBusy = (id: string): void => {
    setBusyId((current) => (current === id ? null : current));
  };
  /**
   * 交互进行中：正在编辑，或有命令在途。宿主用的是同一条判据
   * （client.js:15405-15407 `interactionActive`），它同时做两件事——强制展开列表，
   * 并禁用折叠头。少了后者才会有 #31 那个缺陷：编辑中点折叠把编辑器卸载，
   * 而 `editingId` 与草稿都还在。
   */
  const interactionActive = editingId !== null || busy;
  const expanded = schedules.length === 1 || !collapsed || interactionActive;

  const handleCancel = (id: string, status?: 'active' | 'paused'): void => {
    setBusyId(id);
    /** 撤销本地摘除（命令未被受理时回滚，避免行无谓消失）。 */
    const restore = (): void => {
      setDismissedPaused((current) => {
        if (!current.has(id)) return current;
        const nextSet = new Set(current);
        nextSet.delete(id);
        return nextSet;
      });
    };
    // 暂停项：先本地摘除给出即时反馈；宿主清 sidecar 后投影帧会自然收敛。
    if (status === 'paused') {
      setDismissedPaused((current) => new Set(current).add(id));
    }
    void callCommand(sessionId, deleteLine(id))
      .then((outcome) => {
        // 未被受理（无会话面/网络异常）→ 回滚，别让行白消失。
        if (!outcome.matched) restore();
      })
      .catch(restore)
      /**
       * 回执落地**立即**释放全局锁，不再等 2.5s。
       *
       * 那 2.5s 原本是留给「删除暂停项 → 本地摘除 → 投影帧收敛」的观察窗，但暂停项的
       * 摘除已由 `dismissedPaused` 的粘性保证、未被受理时 `restore()` 又会把行放回来，
       * 锁不需要替它代班。并入 `busy` 之后若还留这条尾巴，一次删除会把整块 dock
       * 按住 2.5 秒——比它原本要防的问题更糟（issue #31/#32）。
       */
      .finally(() => releaseBusy(id));
  };

  /**
   * 用户主动插话（QueueDock「插话发送」语义）：把这条提醒**立即**推给 agent。
   * - 不要求已到点：与 QueueDock 一致，排队中的内容随时可提前送达；成功后出列。
   * - 命令返回 success → 记入 steerDone（短暂展示已发送），server 真实 fold 会自然移除 row。
   * - 返回 error → 在行内展示具体原因（every 暂不支持 / 其他）。
   *
   * **投递未确认**（宿主确认失败且 `onUnconfirmed='keep'`）时条目**留在** active，
   * 投影不变，行自然继续显示 —— 这正是我们要的：不消失就不会丢。
   * 但 `callCommand` 只暴露 `matched`（admission 语义，见 command-outcome.ts），
   * 业务失败到不了这里，因此客户端无法直接知道「未确认」。改用一个**观察窗**：
   * 标记已发送后若行在窗口内仍在投影中，就按「未确认」处理 —— 撤掉 done 态、
   * 给出明确提示而非静默（这次的教训正是「静默」最伤人）。
   */
  const handleSteer = (item: ClientSchedule): void => {
    const id = item.id;
    const wasPaused = item.status === 'paused';
    setBusyId(id);
    setSteerErr((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    void callCommand(sessionId, steerLine(id))
      .then((outcome) => {
        if (outcome.matched) {
          setSteerDone((current) => new Set(current).add(id));
          /**
           * 暂停项插话成功后，宿主会清掉 sidecar 留档（提醒已送达、应出列），
           * 但**不写会话事件** → 投影不会立刻刷新，该行会继续显示。
           * 与"删除暂停项"同源，故复用同一套本地摘除。
           */
          if (wasPaused) {
            setDismissedPaused((current) => new Set(current).add(id));
          }
        } else {
          setSteerErr((current) => new Map(current).set(id, t('editErrNotAccepted')));
        }
      })
      .catch(() => {
        setSteerErr((current) => new Map(current).set(id, t('editErrCommandFailed')));
      })
      .finally(() => releaseBusy(id));
  };

  /**
   * 重试投递：清掉「未确认」提示与 done 态，再走一次 `handleSteer`。
   *
   * 之所以能重试：宿主在未确认时**不写 dispatch**，条目仍在 active，插话是幂等的
   * 再投递（不会双触发 —— 只有确认成功才出列）。
   */
  const handleSteerRetry = (item: ClientSchedule): void => {
    const id = item.id;
    setSteerUnconfirmed((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setSteerDone((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    handleSteer(item);
  };

  const handlePause = (item: ClientSchedule): void => {
    const id = item.id;
    if (!canPause(item, now)) return;
    setBusyId(id);
    setPauseErr((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    void callCommand(sessionId, pauseLine(id))
      .then((outcome) => {
        if (!outcome.matched) {
          setPauseErr((current) => new Map(current).set(id, t('editErrNotAccepted')));
        }
      })
      .catch(() => {
        setPauseErr((current) => new Map(current).set(id, t('editErrCommandFailed')));
      })
      .finally(() => releaseBusy(id));
  };

  const handleResume = (item: ClientSchedule): void => {
    const uid = item.id;
    setBusyId(uid);
    setPauseErr((current) => {
      const next = new Map(current);
      next.delete(uid);
      return next;
    });
    void callCommand(sessionId, resumeLine(uid))
      .then((outcome) => {
        if (!outcome.matched) {
          setPauseErr((current) => new Map(current).set(uid, t('editErrNotAccepted')));
        }
      })
      .catch(() => {
        setPauseErr((current) => new Map(current).set(uid, t('editErrCommandFailed')));
      })
      .finally(() => releaseBusy(uid));
  };

  const startEdit = (item: ClientSchedule): void => {
    setEditingId(item.id);
    setEditingText(item.prompt);
    setEditErr(null);
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setEditErr(null);
    setSaving(false);
  };

  /**
   * 保存行内编辑。**入参是整条任务**而不是 id：只有暂停项才需要本地文案覆盖。
   *
   * 长度上限**不在这里校验**，也不该由输入框 `maxLength` 截断——1000 在仓内已是
   * 第三处硬编码（另两处 `src/commands.ts:718/875/884`），而 host 有
   * `allowLongPrompts` / `maxPromptChars` 设置（`src/index.ts:64-65`）。客户端静默
   * 截断、创建路径不截，同一字段就会有两套规则。改成不设上限，交给 host 的
   * `validatePrompt`（`src/user-tools.ts:93-110`：超限回 `invalid_prompt` + 实际
   * 上限数字）判定。
   */
  const submitEdit = (item: ClientSchedule): void => {
    const trimmed = editingText.trim();
    if (trimmed.length === 0) {
      setEditErr(t('editErrEmpty'));
      return;
    }
    setSaving(true);
    setEditErr(null);
    void callCommand(sessionId, editLine(item.id, trimmed)).then((outcome) => {
      if (!outcome.matched) {
        setEditErr(t('editErrFailed', { message: t('editErrNotAccepted') }));
        return;
      }
      /**
       * 只有暂停项需要本地覆盖，未暂停的一律交给投影。
       *
       * 暂停项的编辑只改 sidecar、**不写会话事件** → 不会有新投影帧，行内会一直显示
       * 旧文案，所以本地先覆盖（失效条件见上方 `promptOverrides` 的 effect：投影一旦
       * 采纳同一文案就自动退场）。
       *
       * 未暂停的项相反：成功必有 `schedule/change` 帧、投影就是权威文案；被拒（例如
       * 超长）则不会有帧。两种情况都**不能**盖本地覆盖——客户端拿不到业务结果
       * （`RemoteResult<{matched}>`，见 `src/command-outcome.ts`），一旦被拒还把用户
       * 刚输入的文案贴到行上，界面就在宣称「改好了」而 host 里仍是旧值。宁可显示
       * 未变的旧文案。
       */
      if (item.status === 'paused') {
        setPromptOverrides((current) => new Map(current).set(item.id, trimmed));
      }
      cancelEdit();
    }).catch(() => {
      setEditErr(t('editErrFailed', { message: t('editErrCommandFailed') }));
    }).finally(() => setSaving(false));
  };

  const renderRow = (item: ClientSchedule): JSX.Element => {
    const epoch = Date.parse(item.scheduled_at);
    const state = epoch <= now ? 'overdue' : 'scheduled';
    if (editingId === item.id) {
      return (
        <li key={item.id} className="ss-dock-row ss-editing" data-ss-dock-row={item.id}>
          <DockEditor
            text={editingText}
            label={t('editTask')}
            disabled={saving}
            onChange={setEditingText}
            onSave={() => submitEdit(item)}
            onCancel={cancelEdit}
          />
          <button
            type="button"
            className="ss-dock-row-save"
            disabled={saving || editingText.trim().length === 0}
            onClick={() => submitEdit(item)}
          >
            {saving ? '…' : t('editSave')}
          </button>
          <button type="button" className="ss-dock-action" onClick={cancelEdit} aria-label={t('editCancel')}>
            <IconCloseOutlineRegular size={14} />
          </button>
          {editErr !== null && <span className="ss-dock-edit-err">{editErr}</span>}
        </li>
      );
    }
    const isPaused = item.status === 'paused';
    const frozenLeft = isPaused
      ? (item.remaining_seconds ?? 0) * 1000
      : epoch - now;
    const countdownText = isPaused
      ? t('pausedLabel')
      : state === 'overdue'
        ? t('dueAnyMoment')
        : `${t('countdownLeft')} ${formatCountdown(Math.max(0, frozenLeft))}`;
    return (
      <li
        key={item.id}
        className={`ss-dock-row${isPaused ? ' ss-paused' : ''}`}
        data-ss-dock-row={item.id}
      >
        {/*
          附件带（#38）：**行的第一个子元素**，在正文左侧同一行 —— 与宿主 QueueDock
          同位置（宿主是 `[lead] [attachments] [preview] [status] [actions]`）。
          原先放在正文下方独占第三带，两 dock 叠在一起时（原生队列就在我们上面）
          观感明显不是一族，故改回行首。
          仍然**不抄**宿主的 `max-width:55% + overflow:hidden`（那是给它单行正文让路的
          折中，代价是静默裁切）：我们靠可收缩 + 横向滚动兜住，见 styles.ts。
        */}
        {/*
          单条时行首补一个时钟 glyph。宿主 QueueDock 就是这么做的（`QueueDock.tsx:197`
          「Single-item strip has no count header, so the row itself carries the queue
          glyph」）：多条时图标在计数 header 里，单条时 header 不渲染，行首就空了。
          图标用**官方时钟** `IconClockOutlineRegular`（与 header 同一个，零新增依赖）：
          宿主自己的定时任务 UI 全程用它（`ui-schedule/ScheduleTaskTab.tsx:121`、
          `DeliveryHistory.tsx:152` 的行级 `deliveryGlyph`），而图标集里的闹钟
          `IconAlarmClockOutline*` 在上游**零消费方** —— 官方选的"定时/提醒"就是时钟。
        */}
        {schedules.length === 1 && (
          <span className="ss-dock-lead" aria-hidden="true">
            <IconClockOutlineRegular size={16} />
          </span>
        )}
        <DockAttachments item={item} t={t} sessionId={sessionId} loadImage={loadImage} peekImage={peekImage} localMediaUrl={localMediaUrl} />
        <div className="ss-dock-preview">
          <div className="ss-dock-row-line">
            <span className="ss-dock-row-time">{formatHhmm(epoch, detectTimeZone())}</span>
            <span className={`ss-dock-row-countdown${!isPaused && state === 'overdue' ? ' ss-due' : ''}${isPaused ? ' ss-paused-label' : ''}`}>
              {countdownText}
            </span>
            {/*
              正文走宿主的 conversation.user.text 投影（与原生队列同源），于是
              `@[标签](dsh-session:…)` 渲染成引用 chip 而不是在行里露出 base64。
              必须是**独立组件**而不是在这里直接调：`renderRow` 是被 `.map()` 调用的
              普通函数，不是组件，在里面写 `useMemo` 直接违反 hooks 规则。
            */}
            <DockPrompt text={item.prompt} renderFactorySlot={renderFactorySlot} />
          </div>
          <MultiBar item={item} now={wallClock} firstSeen={firstSeenRef.current} t={t} frozen={isPaused} frozenLeftMs={frozenLeft} renderedAt={lastActiveAtRef.current.get(item.id) ?? wallClock} />
          {(steerErr.get(item.id) ?? pauseErr.get(item.id)) !== undefined && (
            <span className="ss-dock-steer-err">{steerErr.get(item.id) ?? pauseErr.get(item.id)}</span>
          )}
          {/*
            投递未确认：条目已被宿主保留（未写 dispatch），行仍在台上。
            这里明说「可重试」并提供按钮 —— 旧实现在这种情况下会静默丢失。
          */}
          {steerUnconfirmed.has(item.id) && (
            <span className="ss-dock-steer-warn" role="status">
              <span>{t('steerUnconfirmed')}</span>
              <button type="button" className="ss-dock-steer-retry" onClick={() => handleSteerRetry(item)}>
                {t('steerRetry')}
              </button>
            </span>
          )}
        </div>
        {/* 图标：编辑 → 暂停/恢复 → 删除 → 插话（暂停保留槽位宽度） */}
        <DockActions
          item={item}
          t={t}
          paused={isPaused}
          canPauseNow={canPause(item, now)}
          busy={busy}
          steerDone={steerDone.has(item.id)}
          onEdit={() => startEdit(item)}
          onPause={() => handlePause(item)}
          onResume={() => handleResume(item)}
          onDelete={() => handleCancel(item.id, isPaused ? 'paused' : 'active')}
          onSteer={() => handleSteer(item)}
        />
      </li>
    );
  };

  return (
    <div className="ss-dock-root" data-ss-dock="">
      <div className="ss-dock-body">
        {schedules.length > 1 && (
          <button
            type="button"
            className="ss-dock-header"
            aria-expanded={expanded}
            aria-controls={listId}
            disabled={interactionActive}
            onClick={() => setCollapsed((value) => !value)}
          >
            <span className="ss-dock-lead" aria-hidden="true">
              <IconClockOutlineRegular size={16} />
            </span>
            <span className="ss-dock-count">{t('panelCount', { n: schedules.length })}</span>
            {/*
              折叠态也要播报异常（issue #31）：收起恰恰发生在用户不想看细节的时候，
              而「投递未确认」正是最需要被看见的状态。位置与优先级对齐宿主 header 里的
              `queue.sending`（client.js:15455-15458）：未确认优先于在途。
            */}
            {!expanded && steerUnconfirmed.size > 0 && (
              <span className="ss-dock-status" role="status">
                {t('statusUnconfirmed', { n: steerUnconfirmed.size })}
              </span>
            )}
            {!expanded && steerUnconfirmed.size === 0 && busy && (
              <span className="ss-dock-status" role="status">{t('sending')}</span>
            )}
            <span className={expanded ? 'ss-dock-chevron ss-open' : 'ss-dock-chevron'} aria-hidden="true">
              <IconChevronDownOutlineRegular size={14} />
            </span>
          </button>
        )}
        {/*
          列表常驻 DOM、用 `hidden` 控可见（宿主同款：client.js:15466-15468），这样
          `aria-controls` 永远指向一个真实存在的目标，读屏也能跳到它。

          代价与对策：进度条的相位是在**挂载那一刻**冻结的（见本文件头部 #13/#16 那条结论：
          「CSS 动画在元素被重建时会从头播放」）。列表常驻 DOM 后，收起/展开不再触发重挂载，
          相位就停在第一次挂载时的值。`display:none` 期间动画究竟推不推进，我没有在本机验证
          （规范页取不到：w3.org 403、drafts.csswg.org 404），因此不作断言——但两种行为下这个
          `key` 都是对的：展开即整列重挂载、`MultiBar` 相位按当前时刻重算，与「收起即卸载」的
          旧行为等价，同时保住 `aria-controls` 指向一个真实存在的列表。
        */}
        <ul
          id={listId}
          className="ss-dock-list"
          key={expanded ? 'open' : 'closed'}
          hidden={!expanded}
        >
          {schedules.map(renderRow)}
        </ul>
      </div>
    </div>
  );
}

/** Boss 血条：单根长管 + 等比分隔线（每段代表 1h，刻度仅作视觉分隔）。
 *  - `.ss-dock-bar`：进度容器（轨道 + 填充）
 *  - `.ss-dock-bar-fill`：实际进度，按 totalRatio 收缩
 *  - `.ss-dock-bar-divider`：覆盖在最上层的等比分隔线，1 根 element 内画 N-1 条竖线，
 *    避免被前景 fill 遮挡（之前用 background-image 被 fill 完全遮住，看不见）。
 */
function MultiBar({
  item,
  now,
  firstSeen,
  t,
  frozen = false,
  frozenLeftMs,
  renderedAt,
}: {
  item: ClientSchedule;
  now: number;
  firstSeen: ReadonlyMap<string, number>;
  t: ScheduleDockTranslate;
  frozen?: boolean;
  frozenLeftMs?: number;
  /** 客户端已渲染过的最新时刻；冻结帧据此钳位，避免暂停瞬间条长跳增。 */
  renderedAt: number;
}): JSX.Element {
  const frozenSeg = frozen
    ? frozenBarSegments(item, frozenLeftMs ?? 0, firstSeen, renderedAt)
    : undefined;
  const activeSeg = frozen ? undefined : barSegments(item, now, firstSeen);
  const { totalRatio, count } = frozenSeg ?? activeSeg ?? { totalRatio: 0, count: 1 };

  /**
   * 活动期：用 CSS 动画推进，替代「每秒一次 JS 重渲染 + transition 补间」。
   *
   * ⚠️ 关键：动画参数必须**只依赖任务自身的时间轴**（起点 + 目标时刻），
   * 绝不能依赖 `now`。否则每次 tick 重渲染都会算出新的 `from`/`duration`，
   * 浏览器会把动画**重启**——表现为每秒一次固定跳变（实测 deltas 呈
   * `1.7,1.7,1.7,1.7,1.7,10.2` 的周期性尖峰，仍是肉眼可见的顿挫）。
   *
   * 因此这里用 `windowStart`（由窗口与目标时刻反推的固定起点）而非 `now` 求相位：
   * 参数在任务生命周期内恒定，动画一次性挂上后由合成器连续跑完，
   * 中间任何重渲染都不会打断它。
   *
   * 暂停（`frozen`）时**不用**动画：直接给静态宽度，避免动画继续跑。
   */
  /**
   * 相位只在**挂载时**定一次，之后不再变（`paused`/`ratio` 变化时按需重定）。
   *
   * ⚠️ 为什么不能每次渲染都用 `now` 重算（这是「速度不均衡」的根因）：
   * CSS 动画挂上后会**自行推进**。若每秒 tick 重渲染时把
   * `delay = -(now - start)` 重算一遍，浏览器会把播放头又往前挪 1 秒——
   * 而这一秒动画本来已经走过了，等于**双倍计数**，表现为每秒一次的跳变。
   * 实测：`--ss-bar-delay` 每约 1s 精确变化 -1000ms，宽度增量出现
   * `0.0153 → 0.3485`（约 23 倍）的周期尖刺，与 tick 周期一致。
   *
   * 因此用 ref 把「挂载时刻」冻结，delay 只由它算：
   *  - 重渲染（含每秒 tick）→ delay 不变 → 动画不被打断、也不会多跳；
   *  - 重新挂载（切会话回来）→ ref 重取当前时刻 → 相位按绝对时间重新对齐
   *    （这正是「切回来不归零」所需的行为）。
   */
  const phaseAtRef = useRef<number | null>(null);
  if (frozen || prefersReducedMotion()) {
    phaseAtRef.current = null; // 暂停/降级：清掉，恢复时重新取
  } else if (phaseAtRef.current === null) {
    phaseAtRef.current = now;
  }
  const anim = frozen || prefersReducedMotion()
    ? undefined
    : planBarAnimationFor(item, phaseAtRef.current ?? now, firstSeen);
  const fillStyle: CSSProperties = anim === undefined
    ? { width: `${totalRatio * 100}%` }
    : {
        /**
         * 只注入**参数**（CSS 变量），动画的组装交给 CSS（见 styles.ts）。
         *
         * 这样做的原因：动画声明留在 CSS 里，JS 不碰 `animationName` 等简写属性
         * ——否则会整条覆盖 CSS 的声明。当前只有进度推进一个动画，但保持这个
         * 分工，将来若再加纹理/状态动效不必回头改 JS。
         */
        ['--ss-bar-duration' as string]: `${anim.durationMs}ms`,
        // 负 delay 把播放头定位到挂载时刻的绝对相位；此后恒定不变
        // （重算会让动画多跳——见上方 phaseAtRef 注释）。
        ['--ss-bar-delay' as string]: `${anim.delayMs}ms`,
      };
  return (
    <div
      className={`ss-dock-bars${count > 4 ? ' ss-dock-bars-compact' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(totalRatio * 100)}
      aria-label={t('panelTitle')}
    >
      <div className="ss-dock-bar">
        {/* 分隔线先画：跨整个 bar、画 N-1 条等比分隔；fill 之后用 z-index 盖住「已填充段」上的分隔线，只剩「轨道段」上可见刻度 */}
        {count > 1 && (
          <div
            className="ss-dock-bar-divider"
            style={{
              backgroundImage:
                `repeating-linear-gradient(to right, transparent 0, transparent calc((100% - 1px) / ${count}), var(--ss-bar-divider, rgba(0,0,0,0.45)) calc((100% - 1px) / ${count}), var(--ss-bar-divider, rgba(0,0,0,0.45)) calc(100% / ${count}))`,
            }}
          />
        )}
        <div className="ss-dock-bar-fill" style={fillStyle} />
      </div>
    </div>
  );
}

/* ==================== DockActions：动作按钮区（tooltip 用 primitives 的官方 Tooltip） ==================== */
/**
 * 宿主 QueueDock 给每个动作按钮包的是 `Tooltip({ portal: true, side: "bottom", delayMs: 500 })`，
 * 这里换成同一个官方组件（issue #29），原先自研的 `DockTip` 已删除。
 *
 * 顺带纠正一处旧注释的错误说法：「官方 Tooltip 的完整 API 依赖宿主 slots/portal 上下文」
 * **不成立**——它内部只 `useContext(TooltipSuppression)`，而该 context 默认值是 `null`，
 * 没有 provider 时照常工作（宿主 ui-goal / ui-conversation 的 dock 都是直接这么用的）。
 *
 * 两个影响布局与状态的行为值得记下：
 *  - Tooltip 用 `cloneElement` 把 ref 与 hover/focus handler 注到**子元素自身**，不额外插
 *    包装节点。因此 `.ss-dock-actions` 的 flex 子元素仍是这四个按钮、`gap: 10px` 不变
 *    （原先为自研气泡加的包装 span 连同其 CSS 一起删除）。
 *  - `portal` 把气泡挂到 `document.body`，隐藏时也不会变成 dock 的 flex 子项。
 *  - `focusDelayMs` 与 `maxWidth` 都留默认，与宿主 dock 一致（宿主两处都没传）。
 */
interface DockActionsProps {
  /** 本行任务；只用 `kind` 决定插话按钮是否出现（`every` 不支持）。 */
  item: ClientSchedule;
  /** 文案字典。 */
  t: SchedTranslate;
  /** 本行是否处于暂停态（决定渲染「恢复」还是「暂停」）。 */
  paused: boolean;
  /** 本行此刻是否可暂停（与 host 校验一致，由调用方算好）。 */
  canPauseNow: boolean;
  /**
   * 整块 dock 是否有命令在途。对齐宿主 QueueDock 的 `disabled: busy !== null`
   * （client.js:15523/15552/15571/15592）：任一动作在途时**所有**行的动作按钮都不可点。
   *
   * **口径变更（issue #31/#32，勿当成误删）**：这里曾有 `pausingNow` / `resumingNow` /
   * `steeringNow` / `cancellingNow` 四个「本行在途」标记，其中 `cancellingNow` 是
   * **故意不并入**全局锁的——删除的清尾带着命令返回后 2.5s 的延时，并入会让一次删除
   * 把整块 dock 锁住 2.5 秒。现在那条尾巴已去掉、在途标记收敛成单一 `busyId`
   * （按 id 释放，见组件内 `releaseBusy`），四个标记同时失去了两个用处：禁用判据
   * `busy` 已覆盖它们，而「本行在途」早没有视觉承载（#32-② 清掉了那几个空挂类名）。
   * 留着只会长出第二套规则——`cancelling` 变成死状态（#32-①）就是这么来的。
   */
  busy: boolean;
  /** 本行是否已插话成功（按钮转完成态并禁用）。 */
  steerDone: boolean;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  onSteer: () => void;
}

function DockActions({
  item,
  t,
  paused,
  canPauseNow,
  busy,
  steerDone,
  onEdit,
  onPause,
  onResume,
  onDelete,
  onSteer,
}: DockActionsProps): JSX.Element {
  return (
    <div className="ss-dock-actions">
      <Tooltip label={t('editTask')} side="bottom" delayMs={500} portal>
        <button
          type="button"
          className="ss-dock-action"
          aria-label={t('editTask')}
          disabled={busy}
          onClick={onEdit}
        >
          <IconEditOutlineRegular size={14} />
        </button>
      </Tooltip>
      {paused ? (
        <Tooltip label={t('resumeTask')} side="bottom" delayMs={500} portal>
          <button
            type="button"
            className="ss-dock-action"
            aria-label={t('resumeTask')}
            disabled={busy}
            onClick={onResume}
          >
            <IconPlayOutlineRegular size={16} />
          </button>
        </Tooltip>
      ) : (
        /* 不可用的原因走宿主那套分工：Tooltip `disabled` 抑制气泡，原生 `title` 承载原因，
         * `aria-label` 只留动作名——避免同一句话在气泡与读屏里各念一遍。 */
        <Tooltip label={t('pauseTask')} side="bottom" delayMs={500} portal disabled={!canPauseNow}>
          <button
            type="button"
            className="ss-dock-action"
            aria-label={t('pauseTask')}
            title={canPauseNow ? undefined : t('pauseUnsupportedKind')}
            disabled={!canPauseNow || busy}
            onClick={onPause}
          >
            <IconPauseOutlineRegular size={16} />
          </button>
        </Tooltip>
      )}
      <Tooltip label={t('deleteTask')} side="bottom" delayMs={500} portal>
        <button
          type="button"
          className="ss-dock-action"
          aria-label={t('deleteTask')}
          disabled={busy}
          onClick={onDelete}
        >
          <IconTrashOutlineRegular size={14} />
        </button>
      </Tooltip>
      {item.kind !== 'every' && (
        <Tooltip label={steerDone ? t('steerAlreadySent') : t('steerTask')} side="bottom" delayMs={500} portal>
          <button
            type="button"
            className={`ss-dock-action ss-dock-action-steer${steerDone ? ' ss-done' : ''}`}
            aria-label={steerDone ? t('steerAlreadySent') : t('steerTask')}
            disabled={busy || steerDone}
            onClick={onSteer}
          >
            <IconSendOutlineRegular size={16} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

/* ==================== DockEditor：行内编辑器（宿主 QueueDock 的 QueueEditor 同款） ==================== */

/**
 * dock 的行内编辑器。为什么单独成组件、为什么必须是 `textarea`、为什么没有
 * `stopPropagation()`：
 *
 *  - **textarea 而非 input**：HTML 会从单行 `input` 的 value 里剥掉换行，于是「编辑
 *    一条多行提醒」实际等于把它改写成一整行——正文被静默改坏。宿主 QueueEditor 的
 *    注释写明了同一点（`@deepseek-ai/dsh-client-ui-conversation`，QueueDock.js）。
 *
 *  - **自适应高度用宿主算法**：先 `height='auto'`，再回填 `scrollHeight + offsetHeight
 *    - clientHeight`（= 内容高度 + 边框/上下 padding 的差额）。上限交给 CSS
 *    `max-height`（宿主 127px），到顶后 textarea 自己滚动，行高不再长。
 *
 *  - **IME 守卫**：`Enter` 保存必须先挡 `event.nativeEvent.isComposing`。中文输入法
 *    里「按 Enter 把候选词上屏」与「按 Enter 提交」是同一个 keydown，缺这道守卫就会
 *    在打完第一个词时把半截正文提交掉（#30 的核心缺陷）。`shiftKey` 走换行、不提交。
 *
 *  - **不调 `stopPropagation()`**（旧代码有、宿主没有）。逐条查过：它挡不住任何本该
 *    挡的东西，却会挡住不该挡的东西。
 *    1) composer 的 Enter 提交绑在草稿编辑器元素上（`ui-conversation` 里的
 *       `keyboard.submit(…)`），而 dock 是 `.composerStack` 下 `inputBar` 的**兄弟**
 *       子树（`renderSlot("conversation.input.dock", zone)`），事件不会经过它；
 *    2) 全局快捷键监听在 window **捕获阶段**（`dsh-client-shortcuts`：
 *       `addEventListener("keydown", capture, true)`），冒泡阶段的 stopPropagation
 *       对已经执行完的捕获监听无效；且它自带 `region: "editable"` 判定
 *       （`closest("input, textarea, select, [contenteditable…]")`），裸 Enter 也不在
 *       允许注册的组合里；
 *    3) 反过来，冒泡阶段的 document 监听**确实**会被掐掉——宿主 ContextMeter 的 Esc、
 *       agent-team 的 dismiss、`ui-schedule` 的 document keydown 都在这一层。旧写法把
 *       它放在 if/else **之外**，等于编辑框里每一个键（含普通打字与 Esc）都不再冒泡到
 *       document。
 *
 *    所以只保留 `preventDefault()`（不加的话 textarea 的 Enter 默认会往正文里插一个
 *    换行），去掉 `stopPropagation()`。
 */
function DockEditor({
  text,
  label,
  disabled,
  onChange,
  onSave,
  onCancel,
}: {
  /** 当前编辑中的正文。 */
  text: string;
  /** 无障碍标签：与宿主一致只描述动作，正文本身就在框里，不重复进标签。 */
  label: string;
  /** 提交在途：禁编辑，避免重复提交。 */
  disabled: boolean;
  /** 正文变化。 */
  onChange: (value: string) => void;
  /** Enter 或保存按钮。 */
  onSave: () => void;
  /** Esc。 */
  onCancel: () => void;
}): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    /* v8 ignore next -- ref 在 layout effect 之前已经挂上 */
    if (node === null) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`;
  }, [text]);
  return (
    <textarea
      ref={ref}
      autoFocus
      rows={1}
      className="ss-dock-edit-input"
      aria-label={label}
      value={text}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onCancel();
          return;
        }
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        onSave();
      }}
    />
  );
}

/* ==================== DockPrompt：正文（走宿主 user-text 投影） ==================== */

/**
 * 投影的显示期事实。取值**照抄宿主 `QUEUE_TEXT_FACTS`**（`ui-conversation` 的
 * `queue/QueueDock.tsx:19`）：只做空白归一，**不给 `sessionLabels`** —— 给了会让
 * dock 每秒 tick 时去读会话标签列表，白涨成本，而显式线格式本来就能被规则匹配。
 */
const DOCK_TEXT_FACTS = { collapseWhitespace: true, trimWhitespace: true } as const;

/**
 * 一行正文。
 *
 * 为什么必须单独成组件：`renderRow` 是被 `.map()` 调用的**普通函数**，不是组件，
 * hooks 写在里面直接违反规则；而这里又**必须** memo —— dock 每秒 tick 重渲染每一行，
 * 不缓存等于每秒把每行正文重解析一遍（宿主 dock 没有 tick，所以它能直接内联。
 * 这与 I9「依赖不能用块对象」是同一类前提差异，照抄宿主形状就会踩）。
 *
 * 三层降级，任一层缺失都只是「少个 chip」，不炸行：
 *  1. `renderFactorySlot` 不存在（更老 renderer）→ 原文；
 *  2. factory 未注册（宿主没挂 user-text）→ 我们传的 `fallback`，即原文
 *     （`FactoryOutlet`：`if (definition === undefined) return <>{fallback ?? null}</>`）；
 *  3. 投影渲染期抛错 → 宿主外层 `FactoryErrorBoundary` 吞成 `<div data-factory-error>`，
 *     只影响这一块。
 * 另加 try/catch 兜**调用期**抛错（kit 来自上一次热重载的残留闭包时可能发生）。
 */
function DockPrompt({
  text,
  renderFactorySlot,
}: {
  text: string;
  renderFactorySlot?: ScheduleDockProps['renderFactorySlot'];
}): JSX.Element {
  const projected = useMemo(() => {
    if (renderFactorySlot === undefined) return text;
    try {
      return renderFactorySlot('conversation.user.text', {
        text,
        facts: DOCK_TEXT_FACTS,
        interactive: false,
        ellipsis: true,
      }, { fallback: text }) ?? text;
    } catch {
      return text;
    }
  }, [text, renderFactorySlot]);
  // title 仍给原文：chip 化之后没有别的途径能还原整行文本。
  return <span className="ss-dock-row-prompt" title={text}>{projected}</span>;
}

/* ==================== DockAttachments：行内附件带（issue #38） ==================== */
/**
 * 一行提醒的附件带：图片缩略图与文件 chip **横向铺开**。
 *
 * 为什么是「铺开」而不是「收成一个回形针入口」：本插件的行本来就是两带
 * （正文 / 进度条），再加一带不与正文竞争横向——dock 实测宽 696px，24px 缩略图
 * 一行可容约 20 张，而每任务上限是 8。宿主 `.attachments` 的 `max-width:55%`
 * 折中是给它单行正文让路的，我们没有那个约束。（初稿判断相反，已在 #38 撤回。）
 *
 * 约束方向因此是**纵向**：附件带必须排在进度条**之前**，让进度条保持贴底，
 * 不被附件挤出 `max-height:180px` 的可视区。
 */
function DockAttachments({
  item,
  t,
  sessionId,
  loadImage,
  peekImage,
  localMediaUrl,
}: {
  item: ClientSchedule;
  t: ScheduleDockTranslate;
  sessionId?: string;
  loadImage?: (sessionId: string, ref: ClientAttachment) => Promise<string>;
  peekImage?: (sessionId: string, ref: ClientAttachment) => string | undefined;
  localMediaUrl?: (path: string) => string | undefined;
}): JSX.Element | null {
  const blocks = item.attachments;
  // 无附件时该键根本不出现（#37 契约）；元数据缺失也走这条，行回到两带，不占位不报错。
  if (blocks === undefined || blocks.length === 0) return null;
  /*
   * 拿不到解析能力时（旧宿主无 uiConversation face / 无会话上下文）图片位没有意义，
   * 只留文件 chip——文字与文件照常可读，**不得**因为没服务就整块不渲染（#38 硬约束）。
   * 若这一行了只剩图片，整带不渲染，避免留下一个空的 flex 容器。
   */
  const canResolve = loadImage !== undefined && sessionId !== undefined;
  /*
   * 一条图片能不能出图，现在有两个独立来源，任一成立即可：
   *  - `canResolve`：宿主的异步通道（imageUrl / peekImageUrl）可用；
   *  - `host_path` 能换算成 URL：走宿主 `/api/file`，**不依赖任何服务**，
   *    所以旧宿主没有 uiConversation face 时，待发附件照样有缩略图。
   */
  const imageRenderable = (block: ClientAttachment): boolean =>
    canResolve || (block.host_path !== undefined && localMediaUrl?.(block.host_path) !== undefined);
  const shown = blocks.filter((block) => block.kind === 'file' || imageRenderable(block));
  if (shown.length === 0) return null;
  const total = item.attachments_total ?? blocks.length;
  const extra = total - blocks.length;
  return (
    <div className="ss-dock-attachments" data-ss-dock-attachments={item.id}>
      {shown.map((block, index) => (
        // 同一附件可能被多次写法逐条复用，key 用「引用 + 序号」保证同带内唯一。
        // ⚠️ 这里不能用 `ref` 当 prop 名——React 会把它当 callback ref 吃掉。
        block.kind === 'image'
          ? <DockThumb key={`${block.attachment_id}:${index}`} block={block} t={t} sessionId={sessionId} loadImage={loadImage} peekImage={peekImage} localMediaUrl={localMediaUrl} />
          : <DockFileChip key={`${block.attachment_id}:${index}`} block={block} t={t} />
      ))}
      {extra > 0 && (
        <span className="ss-dock-more" data-ss-attach="more" aria-label={t('attachmentMore', { n: extra })}>
          {`+${extra}`}
        </span>
      )}
    </div>
  );
}

/**
 * 一张图片缩略图。每块**独立**异步加载：单块失败只让它自己退化成占位，
 * 不牵连同带其它附件（宿主 `QueueThumb` 就是这个形状）。
 */
function DockThumb({
  block,
  t,
  sessionId,
  loadImage,
  peekImage,
  localMediaUrl,
}: {
  block: ClientAttachment;
  t: ScheduleDockTranslate;
  sessionId?: string;
  loadImage?: (sessionId: string, ref: ClientAttachment) => Promise<string>;
  peekImage?: (sessionId: string, ref: ClientAttachment) => string | undefined;
  localMediaUrl?: (path: string) => string | undefined;
}): JSX.Element | null {
  const [url, setUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<AttachmentImageFailure | null>(null);
  /**
   * 依赖里放 `attachment_id` 而**不是 block 对象**：dock 每秒 tick 重渲染，
   * 而 `schedules` 每帧都由 `.map()` 造出新的块对象——按对象依赖等于每秒重启一次
   * 加载（宿主 dock 没有 tick，所以它可以直接依赖对象）。
   */
  const blockRef = useRef(block);
  blockRef.current = block;
  const attachmentId = block.attachment_id;
  /*
   * host_path 通道：同步、无服务依赖、无异步竞态。放在异步通道**之前**，因为
   * 待发提醒走 `imageUrl` 必然被宿主拒绝（附件还没被会话日志引用），那条路只会
   * 得到「发送后可见」chip；而这条直接就是真缩略图。
   * 换算失败（宿主 `fileMediaUrl` 判基址/路径不合法）返回 undefined，自动落回原路径。
   */
  const hostPath = block.host_path;
  const localUrl = hostPath === undefined ? undefined : localMediaUrl?.(hostPath);
  useEffect(() => {
    // host_path 已经能出图：不发请求，也不去写 failure（否则会留下无意义的降级态）。
    if (localUrl !== undefined) return undefined;
    // 服务缺失（旧宿主组合）或没有会话上下文：不发请求，直接走可读降级。
    if (loadImage === undefined || sessionId === undefined) return undefined;

    // 宿主缓存命中就同步显示 —— 既不闪占位，也避开「未被会话引用」的拒绝。
    const cached = peekImage?.(sessionId, blockRef.current);
    if (cached !== undefined) {
      setUrl(cached);
      return undefined;
    }

    let alive = true;
    loadImage(sessionId, blockRef.current).then(
      (resolved) => {
        if (alive) setUrl(resolved);
      },
      (error: unknown) => {
        // 「未被本会话引用」= 待发送提醒的**预期状态**（到点发送后才可见），
        // 与真正的读取失败分开渲染，别把预期说成损坏。
        if (alive) setFailure(classifyAttachmentFailure(error));
      },
    );
    // 卸载后不得 setState（宿主 QueueThumb 同款 alive 标志）。
    return () => {
      alive = false;
    };
  }, [attachmentId, sessionId, loadImage, localUrl]);

  /*
   * 能力缺失（这台宿主没有 uiConversation face，或拿不到会话上下文）**且** host_path
   * 通道也不可用 → 图片位直接不渲染。与下面的 `failed` 区分开：那不是异常，是这个
   * 部署本来没这能力，满屏「图片不可用」反而是噪音；而 failed 是「本该有却读不到」，
   * 才值得明说。
   */
  if (localUrl !== undefined) {
    // `data-ss-attach` 的取值集合是**锁住的验证接口**（见 docs/notes/dock-alignment.md
    // 第 8 条）：这条通道产出的就是正常缩略图，不新增取值，来源差异不进探针。
    return <img className="ss-dock-thumb" data-ss-attach="image" src={localUrl} alt={t('attachmentImage')} />;
  }
  if (loadImage === undefined || sessionId === undefined) return null;

  if (url !== null) {
    return <img className="ss-dock-thumb" data-ss-attach="image" src={url} alt={t('attachmentImage')} />;
  }
  if (failure !== null) {
    /*
     * 字节读不到时退化成「文字 + 大小」的可读 chip，而不是像宿主那样无声消失。
     * 两种性质必须分开说（见 attachment-failure.ts）：
     * - pending-send：待发送提醒的附件在发出前不会被日志引用，宿主据此拒绝读取。
     *   这是预期状态，到点会随消息一起发出（实测过），说成「不可用」会误导。
     * - unavailable：真读不到（服务缺失/字节损坏），那才是异常。
     */
    const pending = failure === 'pending-send';
    const label = pending ? t('attachmentPendingSend') : t('attachmentUnavailable');
    return (
      <span
        className="ss-dock-file ss-dock-thumb-fallback"
        data-ss-attach={pending ? 'image-pending-send' : 'image-unavailable'}
        aria-label={label}
      >
        <span className="ss-dock-file-name">{label}</span>
        {block.bytes !== undefined && <span className="ss-dock-file-size">{fileSizeText(block.bytes)}</span>}
      </span>
    );
  }
  // 加载中：等尺寸空占位，避免 URL 到位时行高跳动。
  return <span className="ss-dock-thumb" data-ss-attach="pending" aria-hidden="true" />;
}

/** 一个文件 chip：图标 + 名 + 大小。取值照抄宿主 `.file`（`flex: 0 180px` 等）。 */
function DockFileChip({
  block,
  t,
}: {
  block: ClientAttachment;
  t: ScheduleDockTranslate;
}): JSX.Element {
  const name = block.name ?? '';
  // 名字缺失时不硬造：留空让 chip 只表达「有个文件 + 多大」，比显示附件 id 诚实。
  const label = name.length > 0 ? t('attachmentFile', { name }) : t('attachmentFile', { name: '' }).trim();
  return (
    <span className="ss-dock-file" data-ss-attach="file" aria-label={label} title={name.length > 0 ? name : undefined}>
      {name.length > 0 && (
        <span className="ss-dock-file-icon" aria-hidden="true">
          <FileTypeIcon path={name} size={16} />
        </span>
      )}
      <span className="ss-dock-file-name">{name}</span>
      {block.bytes !== undefined && <span className="ss-dock-file-size">{fileSizeText(block.bytes)}</span>}
    </span>
  );
}
