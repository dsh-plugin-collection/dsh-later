/**
 * `useSchedules` hook：封装投影读取、命令调用、面板定位与 localStorage 降级。
 *
 * 职责：
 *  - 读取 `userSchedules` 会话投影（实时任务列表）
 *  - 计算下次任务时间、任务数量、按钮启用状态
 *  - 提供创建/删除/取消全部的命令通道
 *  - 提供面板定位（相对视口底部）
 *  - 网络降级：命令失败时暂存 localStorage，网络恢复后自动同步
 *
 * 这样 `SchedButton` 只需负责渲染，逻辑复用（v1.1 跨 session 聚合视图可复用此 hook）。
 * @module dsh-later/client/hooks/useSchedules
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientSchedule, CreateCommandPayload } from '../types.js';
import type { CommandOutcome } from '../command-outcome.js';
import { detectTimeZone } from '../../time-utils.js';
import {
  appendPending,
  readPending,
  removePending,
  writePending,
  type PendingSchedule,
} from '../local-store.js';
import { CLIENT_ERR } from '../strings.js';
import { useStableHook } from './useStableHook.js';

/** 应用层注入的调用能力。 */
export interface UseSchedulesInject {
  /** 向宿主执行一条 slash 命令；返回是否受理（`matched`）。 */
  callCommand: (sessionId: string, line: string) => Promise<CommandOutcome>;
  /** 会话 id。 */
  sessionId?: string;
  /** 输入动作：清空输入框。 */
  inputActions?: { setDraft(text: string): void };
  /** 会话作用域标准 hook：读取草稿。 */
  useInput?: (selector: (state: { draft: string }) => string) => string;
  /** 会话作用域标准 hook：读取投影。 */
  useProjection?: (key: string) => { schedules?: readonly ClientSchedule[] } | undefined;
  /** InputZone owner 提供的输入快照。 */
  input?: { readonly draft: string };
}

/** 解析投影值为任务数组（容错）。 */
function schedulesOf(projection: { schedules?: readonly ClientSchedule[] } | undefined): ClientSchedule[] {
  return (projection?.schedules ?? []) as ClientSchedule[];
}

/** 构造创建/删除命令行（序列化全部非空选择器字段）。 */
const createLine = (input: CreateCommandPayload): string => {
  const body: Record<string, unknown> = { prompt: input.prompt, time_zone: detectTimeZone() };
  if (input.at !== undefined) body['at'] = input.at;
  if (input.after_seconds !== undefined) body['after_seconds'] = input.after_seconds;
  return `/user-schedule-create ${JSON.stringify(body)}`;
};
const deleteLine = (id: string): string => `/user-schedule-delete ${JSON.stringify({ id })}`;

export interface UseSchedulesResult {
  /** 当前草稿。 */
  draft: string;
  /** 当前任务列表。 */
  schedules: ClientSchedule[];
  /** 下次任务目标 epoch；undefined 表示无任务。 */
  nextEpoch: number | undefined;
  /** 按钮是否启用。 */
  enabled: boolean;
  /** 是否正在执行命令。 */
  busy: boolean;
  /** 面板底部定位（相对视口）。 */
  anchorBottom: number;
  /** 重新计算面板定位。 */
  reposition: () => void;
  /** 创建任务（带 localStorage 降级）。 */
  handleCreate: (input: CreateCommandPayload) => Promise<void>;
  /** 删除单个任务。 */
  handleDelete: (id: string) => Promise<void>;
  /** 取消全部任务。 */
  handleCancelAll: () => Promise<void>;
  /** 清空输入框。 */
  handleClearDraft: () => void;
  /** 行内 ref（用于定位）。 */
  rowRef: React.RefObject<HTMLSpanElement | null>;
}

/**
 * 草稿选择器：模块级常量，不是每帧新建的箭头函数。
 *
 * `useInput` 把选择器的**引用**当作订阅依赖（`useSyncExternalStore` 家族的路由），
 * 每帧新闭包会让它每帧重订阅。与 {@link draftOf} 的判据无关，纯粹是稳定性。
 */
const SELECT_DRAFT = (state: { draft: string }): string => state.draft;

/** 从草稿投影里取字符串；形状不对按空串（`useInput` 的返回值也可能是 undefined）。 */
function draftOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function useSchedules(inject: UseSchedulesInject): UseSchedulesResult {
  const { callCommand, sessionId, inputActions, input, useProjection, useInput } = inject;

  /**
   * 两个可选 hook 的身份**在首挂载时冻结**（#203）。
   *
   * 旧写法是 `typeof useInput === 'function' ? useInput(select) : ''`：判据本身没问题，
   * 问题是它**按帧求值**——宿主某帧不给 input 快照（或 `useProjection` 那一项没装配），
   * 槽位数就从 N 掉到 N-1，React 抛 `Rendered more/fewer hooks`，按钮与面板整棵子树
   * 被卸载。冻结身份后分支结果逐帧一致，槽位恒定，而「缺失时安静降级」照旧。
   *
   * 配套约定：**有值就无条件调用**，不得再叠加第二重条件（见 `useStableHook` 的注释）。
   */
  const stableInputHook = useStableHook(useInput);
  const stableProjectionHook = useStableHook(useProjection);

  const [busy, setBusy] = useState(false);
  const [anchorBottom, setAnchorBottom] = useState<number>(80);
  const rowRef = useRef<HTMLSpanElement | null>(null);
  /**
   * 这里原本有一行裸的 `useNow`（间隔 1 秒，返回值不读）：纯粹把「消费本 hook 的组件」
   * 每秒重渲染一次，注释写的是「让列表里的相对时间/紧急度随时间重渲染」。删掉它，因为那个
   * 职责已经有两处更准确的落点，而这条是第三条、且相位与它们不同：
   *  - 面板：`SchedPanel` 自己 tick，`TaskList` 的 `now` 是它传的 prop
   *    （TaskListProps 上就写着「倒计时刷新由上层驱动」）；
   *  - dock：`ScheduleDock` 自己 tick，进度条与 `canPause` 都读它。
   * 唯一的消费方 `SchedButton` 不渲染任何随时间变化的东西——按钮里只有 `IconClock`，
   * `nextEpoch` 根本没被解构使用。留着它的净效果只是让面板开着时整棵树每秒被渲染两遍。
   */

  /*
   * 两个 hook 都**无条件调用**（冻结后可能是 undefined，调用点只在有值时调）。
   *
   * 注意 `input?.draft ?? …` 这条链的语义没变：owner 给的快照优先，没有才问 hook。
   * 变的只是「问不问 hook」这件事不再取决于这一帧有没有快照。
   */
  const hookDraft = stableInputHook === undefined ? '' : draftOf(stableInputHook(SELECT_DRAFT));
  const draft = input?.draft ?? hookDraft;

  const projection = stableProjectionHook === undefined ? undefined : stableProjectionHook('userSchedules');
  const schedules = useMemo(() => schedulesOf(projection), [projection]);

  const nextEpoch = useMemo(() => {
    return schedules
      .map((item) => Date.parse(item.scheduled_at))
      .filter((value) => !Number.isNaN(value))
      .sort((a, b) => a - b)[0];
  }, [schedules]);

  const enabled = draft.trim().length > 0 || schedules.length > 0;

  // 注意：这里【有意没有】「草稿变更 → 自动取消任务」的逻辑（AC-06 已废弃）。
  // 该逻辑曾把「提交 /schedule 后输入框被清空」误判为草稿变更，导致刚创建的
  // 提醒在 ~40ms 内被自动删除；且与 README 的既定取舍冲突（已排定的提醒不因
  // 草稿变化而静默取消）。取消只能通过 dock ✕ / 面板列表 / 取消全部 显式触发。

  const reposition = useCallback(() => {
    const el = rowRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    setAnchorBottom(Math.max(12, window.innerHeight - rect.top + 10));
  }, []);

  /* ── 本地暂存队列（#203）────────────────────────────────────────────────
   *
   * 队列与「在途集合」都放在 **ref** 里，不放 state。旧实现把它们放进 `pendingSync`
   * 这个 state 并让它成为投递 effect 的依赖，于是同一条链上出现了自噬：
   *
   *   一条投递成功 → setPendingSync → 重渲染 → effect 依赖变了 → cleanup 把
   *   `cancelled` 置真 → 正在 `await` 的下一条回来时 `if (matched && !cancelled)` 不成立
   *   → 它的 clientSeq 没被 removePending（**但命令已经送达**）→ 下一轮再投一次。
   *
   * 三处修正，缺一处都还会漏：
   *  1. 队列放 ref：投递过程不再依赖自己写出去的 state，也就不会自噬；
   *  2. **受理即清本地**（{@link consumePending}）不再看「本轮是否被取消」——送达是事实，
   *     与 effect 有没有被重跑无关；
   *  3. 在途 clientSeq 进 {@link inFlightRef}：effect 因新增/成交而重跑时，重入的投递
   *     循环跳过正在飞的那几条，不会同一条投两遍。
   *
   * 与 'online' 订阅的拆分见下面两个 effect：**监听活到组件卸载，投递活到本轮**。
   * 合在一个 effect 里是旧实现的写法，cleanup 一跑连「监听还在不在」都变得含混。
   */
  // 初值用 `useState` 的惰性初始化器求一次：`useRef(readPending())` 会在**每次渲染**都
  // 读一遍 localStorage 并 JSON.parse（结果被丢弃），白白把一个同步 IO 放进渲染路径。
  const [initialPending] = useState<PendingSchedule[]>(() => readPending());
  const pendingRef = useRef<PendingSchedule[]>(initialPending);
  /** 正在投递中的 clientSeq（去重键，见上面第 3 条）。 */
  const inFlightRef = useRef<ReadonlySet<number>>(new Set());
  /** 队列版本号：变化即让投递 effect 重跑一轮（它是 effect 依赖里唯一的「队列」信号）。 */
  const [pendingTick, setPendingTick] = useState(0);
  const bumpPending = useCallback((): void => {
    setPendingTick((value) => value + 1);
  }, []);

  /**
   * 一条暂存被宿主受理后的本地收尾（**幂等**：重复调用无副作用）。
   *
   * 先写盘再改 ref：localStorage 是跨页面重载的唯一记忆，进程内 ref 只是它的镜像。
   * 页面上同时开着两个 tab 时谁先写谁赢——这与旧实现同口径，不是本次要解决的。
   */
  const consumePending = useCallback(
    (clientSeq: number): void => {
      removePending(clientSeq);
      pendingRef.current = pendingRef.current.filter((item) => item.clientSeq !== clientSeq);
      const nextInFlight = new Set(inFlightRef.current);
      nextInFlight.delete(clientSeq);
      inFlightRef.current = nextInFlight;
      bumpPending();
    },
    [bumpPending],
  );

  // 清理已同步的本地暂存（投影中已见的 prompt 视为已同步）。
  const syncedPrompts = useMemo(() => {
    return new Set(schedules.map((item) => item.prompt));
  }, [schedules]);

  useEffect(() => {
    const pending = pendingRef.current;
    if (pending.length === 0) return;
    const remaining = pending.filter((item) => !syncedPrompts.has(item.payload.prompt));
    if (remaining.length === pending.length) return;
    pendingRef.current = remaining;
    writePending(remaining);
    bumpPending();
  }, [syncedPrompts, bumpPending]);

  /**
   * 网络恢复：**只负责「提醒该重投了」**（版本号 +1），不自己投。
   *
   * 拆成两个 effect 的理由是生命周期不同：监听要活到组件卸载（重投机会不该随某轮
   * 投递结束而消失），而投递循环只活到本轮结束。合成一个时 cleanup 同时管两件事，
   * 「cancelled 置真」这种写法就是那么长出来的。
   */
  useEffect(() => {
    const onOnline = (): void => bumpPending();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [bumpPending]);

  /**
   * 投递循环：挂载时跑一轮，`pendingTick` 变化时再跑一轮。
   *
   * 循环体内所有判据都读 ref 的**当下值**，不用闭包里的快照——旧实现 `const items =
   * [...pendingSync]` 拿的是本轮 effect 成立那一刻的数组，中途成交的条目仍在循环里。
   */
  useEffect(() => {
    if (!sessionId) return;
    const flush = async (): Promise<void> => {
      // 快照的是「要试哪些序号」，每条是否还在队列里/是否在途，循环内再查。
      const seqs = pendingRef.current.map((item) => item.clientSeq);
      for (const seq of seqs) {
        if (inFlightRef.current.has(seq)) continue;
        const item = pendingRef.current.find((entry) => entry.clientSeq === seq);
        if (item === undefined) continue; // 投影对账已经把它清掉了
        inFlightRef.current = new Set(inFlightRef.current).add(seq);
        let accepted = false;
        try {
          accepted = (await callCommand(sessionId, createLine(item.payload))).matched;
        } catch {
          accepted = false;
        }
        if (accepted) {
          consumePending(seq);
          continue;
        }
        // 未被受理（断网 / 宿主异常）：撤掉在途标记并**停下**，剩下的等下一次 'online'。
        // 继续往下投只会把同一批错误重放一遍，而队列顺序（先建先投）是用户可观察的。
        const nextInFlight = new Set(inFlightRef.current);
        nextInFlight.delete(seq);
        inFlightRef.current = nextInFlight;
        return;
      }
    };
    void flush();
  }, [pendingTick, sessionId, callCommand, consumePending]);

  const handleCreate = useCallback(async (inputPayload: CreateCommandPayload): Promise<void> => {
    if (!sessionId) {
      // 抛稳定令牌（P1-7）：UI 层按当前 locale 翻译，hook 不依赖 locale 服务。
      throw new Error(CLIENT_ERR.NO_SESSION);
    }
    setBusy(true);
    try {
      const accepted = await callCommand(sessionId, createLine(inputPayload));
      if (!accepted.matched) {
        /*
         * 命令未被受理（网络/宿主异常）→ 降级暂存本地。
         *
         * 必须用 `appendPending` 交回来的那条记录：它身上的 `clientSeq` 是**写进
         * localStorage 的那一个**（自增序号）。旧实现在这里另造了一个
         * `clientSeq: Date.now()` 塞进 state，于是内存里的去重键与盘上的对不上——
         * 即便投递成功，`removePending(clientSeq)` 也删不掉盘上那条，下次重载又活。
         */
        const item = appendPending(inputPayload);
        pendingRef.current = [...pendingRef.current, item];
        bumpPending();
        throw new Error(CLIENT_ERR.NOT_ACCEPTED);
      }
    } finally {
      setBusy(false);
    }
  }, [sessionId, callCommand, bumpPending]);

  const handleDelete = useCallback(async (id: string): Promise<void> => {
    if (!sessionId) return;
    await callCommand(sessionId, deleteLine(id));
  }, [sessionId, callCommand]);

  const handleCancelAll = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    await Promise.all(schedules.map((item) => callCommand(sessionId, deleteLine(item.id))));
  }, [sessionId, schedules, callCommand]);

  const handleClearDraft = useCallback((): void => {
    inputActions?.setDraft('');
  }, [inputActions]);

  return {
    draft,
    schedules,
    nextEpoch,
    enabled,
    busy,
    anchorBottom,
    reposition,
    handleCreate,
    handleDelete,
    handleCancelAll,
    handleClearDraft,
    rowRef,
  };
}
