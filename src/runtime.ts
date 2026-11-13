/**
 * 用户提醒的独立调度器（per root agent）。
 *
 * 为什么需要它：dsh-schedule 的 runtime 只在三类时机重驱——agent 创建、**其
 * 自身工具**的持久化变更、agent 转 idle。用户经本插件命令/工具创建的提醒不会
 * 触发这三类，导致 timer 不武装、不到期触发（GUI 显示任务但永远不 fire）。
 *
 * 本调度器只处理**用户创建**的提醒，复用 dsh-schedule 导出的领域函数
 * （fold / resolveEveryOccurrence / render*Framing）和 `agent.followup`。
 * 防重复：两套调度器（本插件 + dsh-schedule）都通过**同一份持久化日志**做
 * 「fold → append dispatch」的原子判断（同一 JS 线程内同步完成），先到者写入
 * dispatch 事件后，后者 fold 即见已被派发 → 跳过，不会双触发。
 *
 * 触发点：用户 create/delete 成功后 requestDrive；agent 转 idle 时也
 * requestDrive（自愈）；agent 创建时启动。
 * @module dsh-later/runtime
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage, boundContextSummary } from '@deepseek-ai/dsh-llm';
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm';
import {
  renderReminderFraming,
  resolveEveryOccurrence,
  ScheduleId,
} from '@deepseek-ai/dsh-schedule';
import {
  renderRecurringBatchFraming as renderEveryReminderBatchFraming,
  messageSourceDecision,
  allocateScheduleIdCompat as allocateScheduleId,
  createAtRecord,
  scheduleMessageSource,
  toChangePayload,
} from './schedule-compat.js';
import type { ScheduleRecord, OneShotScheduleRecord, EveryScheduleRecord } from '@deepseek-ai/dsh-schedule';
import {
  allOwnership,
  findScheduleIdByUid,
  getOwnership,
  getPaused,
  mirrorDueIndex,
  recordOwnership,
  removeOwnership,
  removePaused,
} from './ownership-store.js';
import type { ScheduledAttachment } from './ownership-store.js';
import { appendAttachmentBlocks, contentWithAttachmentBlocks } from './attachment-blocks.js';
import type { UserScheduleDelivery } from './domain.js';
import { foldUserState } from './user-tools.js';
import { confirmDelivery, messageIdOf } from './delivery.js';
import type { DeliveryMode } from './delivery.js';
import { detectTimeZone, formatHhmm } from './time-utils.js';
import { laterUserSource } from './later-message-source.js';
import { dueTargetOf, isDue } from './due.js';
import { isRootAgent } from './upstream-compat.js';
import { hostDictFor } from './strings.js';

/** runtime 关心的设置子集（插话投递策略）。 */
export interface SteerDeliverySettings {
  readonly steerDelivery: DeliveryMode;
  readonly confirmDelivery: boolean;
  readonly onUnconfirmed: 'keep' | 'discard';
}

/** Node timers 能表示的最大延迟。 */
const MAX_TIMER_DELAY_MS = 2147483647;

/** 渲染未知错误（仅进程内诊断）。 */
function renderThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/** 一次「用户提醒决策」：一批同形态到期一次性、或一批到期固定间隔、或下一次等待目标。
 *
 * P1-5：one-shot 从单条改为**同投递形态的批次**——网页关闭期间积压的多条
 * 到期提醒合并为一条注入消息，而不是逐条刷屏。批次内投递形态必然一致
 * （`/later` 与 `/schedule` 不同组，各组按时间先后分轮派发）。
 */
type UserDecision =
  | {
      kind: 'one-shot';
      delivery: UserScheduleDelivery;
      records: readonly OneShotScheduleRecord[];
    }
  | {
      kind: 'every';
      acceptedAt: string;
      reminders: readonly { record: EveryScheduleRecord; occurrenceAt: string }[];
    }
  | { kind: 'wait'; target?: number };

export function dueUserDecision(
  active: readonly ScheduleRecord[],
  now: number,
  delivery?: ReadonlyMap<string, UserScheduleDelivery>,
): UserDecision {
  const indexed = active.map((record, index) => ({ record, index }));
  const byTargetThenCreate = (a: { record: ScheduleRecord; index: number }, b: { record: ScheduleRecord; index: number }) =>
    Date.parse(a.record.scheduledAt) - Date.parse(b.record.scheduledAt) || a.index - b.index;

  const overdueOneShots = indexed
    .filter((entry) => entry.record.kind !== 'every' && isDue(entry.record, now))
    .sort(byTargetThenCreate);
  if (overdueOneShots.length > 0) {
    const asUser = (record: ScheduleRecord): boolean =>
      record.kind !== 'every' && delivery?.get(record.id) === 'user';
    const userGroup = overdueOneShots.filter((entry) => asUser(entry.record));
    const contextGroup = overdueOneShots.filter((entry) => !asUser(entry.record));
    // 两组都非空时取最早到期的一组，另一组由下一次 drive 接续派发。
    const chosen =
      userGroup.length > 0 && contextGroup.length > 0
        ? Date.parse(userGroup[0]!.record.scheduledAt) <= Date.parse(contextGroup[0]!.record.scheduledAt)
          ? userGroup
          : contextGroup
        : overdueOneShots;
    return {
      kind: 'one-shot',
      delivery: chosen.length > 0 && asUser(chosen[0]!.record) ? 'user' : 'context',
      records: chosen.map(({ record }) => record as OneShotScheduleRecord),
    };
  }

  const every = indexed
    .filter((entry) => entry.record.kind === 'every' && isDue(entry.record, now))
    .sort(byTargetThenCreate);
  if (every.length > 0) {
    return {
      kind: 'every',
      acceptedAt: new Date(now).toISOString(),
      reminders: every.map(({ record }) => ({
        record: record as EveryScheduleRecord,
        occurrenceAt: resolveEveryOccurrence(record as EveryScheduleRecord, now).occurrenceAt,
      })),
    };
  }

  const target = active.reduce<number | undefined>((selected, record) => {
    const candidate = dueTargetOf(record.scheduledAt) ?? Number.NaN;
    return candidate > now && (selected === undefined || candidate < selected) ? candidate : selected;
  }, undefined);
  return { kind: 'wait', ...(target === undefined ? {} : { target }) };
}

/**
 * 多条到期一次性提醒的合并注入 framing（P1-5）。
 * 形状与 dsh-schedule 的固定间隔批次 framing 完全一致：
 * 动态字段全部经 JSON 转义，保持「非信任提醒内容」的防护语义。
 *
 * ⚠️ 这是**上游文案的本地副本**。0.2.0 起 dsh-schedule 把 one-shot 与 recurring
 * 两条 framing 统一收敛为一句 `SCHEDULED_MESSAGE_FRAMING`，取代了此前
 * 「Present all due reminders … not new user instructions.」的长句。
 * 本插件只对**多条合并**这一种上游不提供的形态自渲染（单条走
 * `renderReminderFraming`，自动跟随上游），故此处需手工对齐，否则同一会话里
 * 单条与批次的防护措辞会不一致。
 */
export function renderOneShotBatchFraming(records: readonly OneShotScheduleRecord[]): string {
  const payload = records.map((record) => ({
    schedule_id: record.id,
    occurrence_at: record.scheduledAt,
    reminder_prompt: record.prompt,
  }));
  return [
    '[SCHEDULE REMINDER BATCH]',
    'This is a scheduled message from the user',
    `reminders_json: ${JSON.stringify(payload)}`,
  ].join('\n');
}

/** 每个 agent 的独立调度器。 */
export class UserScheduleRuntime {
  private readonly ctx: Context;
  private readonly agent: Agent;
  /**
   * 读取当前生效设置（每次调用按需取值，与工具/命令同源）。
   *
   * 注入而非直接读 ctx.settings：settings 的注册在 index 的 `ctx.inject(['settings'])`
   * 回调里完成，runtime 拿不到那个 scope；把它做成闭包注入，保证「设置 UI 改了立刻生效」
   * 这一既有语义（`applies: 'live'`）在插话路径上同样成立。
   */
  private readonly getSettings: () => SteerDeliverySettings;
  private readonly stop: Promise<void>;
  private resolveStop: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private run: Promise<void> | undefined;
  private requested = false;
  private stopping = false;
  /** 连续 run 级失败次数（P0-3：用于指数退避，成功一次即清零）。 */
  private failures = 0;
  private idleWait: Promise<void> | undefined;
  private disposal: Promise<void> | undefined;

  constructor(ctx: Context, agent: Agent, getSettings: () => SteerDeliverySettings) {
    this.ctx = ctx;
    this.agent = agent;
    this.getSettings = getSettings;
    this.stop = new Promise<void>((resolve) => {
      this.resolveStop = resolve;
    });
  }

  /**
   * 当前语言的宿主字典。
   *
   * 为什么不走 `user-tools.ts` 的 `enterHostLocale` 作用域栈：那套是「一次调用内」的，
   * 而 runtime 对象**跨多次调用存活**（每个 root agent 一个），它的回执在任意时刻被
   * 命令层取用。所以这里每次现取，与 `src/index.ts` 工具描述那侧的取法一致：
   * ctx.get 的可选链（**不能**写进 inject，见 index.ts 那段说明），拿不到回退中文。
   */
  private dict(): ReturnType<typeof hostDictFor> {
    try {
      return hostDictFor(this.ctx.get('locale')?.getSnapshot().active);
    } catch {
      return hostDictFor(undefined);
    }
  }

  /** 是否仍为活动 root agent。 */
  private isLive(): boolean {
    try {
      // 「还活着」看 get(id) 是不是同一个实例；「是 root」交给跨代判定统一回答
      // （rc.1 用宿主 roots()，rc.2 起宿主已删，改读会话头 delegationDepth）。
      return (
        this.ctx.agents.get(this.agent.id) === this.agent && isRootAgent(this.ctx.agents, this.agent)
      );
    } catch {
      return false;
    }
  }

  /** 发起一次重算（合并多个触发为一次）。 */
  requestDrive(): void {
    if (this.stopping) return;
    this.clearTimer();
    this.requested = true;
    if (this.run !== undefined) return;
    const run = this.runRequested();
    this.run = run;
    run.then(
      () => {
        this.failures = 0;
        if (this.run === run) this.run = undefined;
      },
      () => {
        // P0-3：run 级异常不再永久自废（旧实现 disabled=true 直到 agent 重建，
        // 一次瞬时故障就让该会话所有提醒停摆且无感知）。正常路径 driveOnce
        // 已自捕获全部预期错误，此分支只应被真正的编程错误触达——按指数
        // 退避自动重试（1s→2s→4s→…封顶 30s），用户下次创建/删除也会立即重驱。
        this.failures += 1;
        const delay = Math.min(1000 * 2 ** Math.min(this.failures - 1, 5), 30_000);
        this.ctx.logger.warn(
          `later: 调度器驱动失败 agent "${this.agent.id}"（${this.failures} 次，${delay}ms 后重试）: 未知异常`,
        );
        this.clearTimer();
        this.arm(Date.now() + delay, Date.now());
        if (this.run === run) this.run = undefined;
      },
    );
  }

  /** 清空已武装的 timer。 */
  private clearTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** 武装一次到下次目标的 timer。 */
  private arm(target: number, now: number): void {
    const delay = Math.min(target - now, MAX_TIMER_DELAY_MS);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.requestDrive();
    }, delay);
    // v8 ignore next -- 仅在测试环境需要
    if ((this.timer as unknown as { unref?: () => void }).unref) {
      (this.timer as unknown as { unref: () => void }).unref();
    }
  }

  /** 串行 drain 合并的触发。 */
  private async runRequested(): Promise<void> {
    while (this.requested && !this.stopping) {
      this.requested = false;
      await this.driveOnce();
    }
  }

  /**
   * 非 live 时的到期探测：只有**确实**有到期条目才向宿主扫描器举手。
   *
   * 刻意用「fold 出来的 active 里有没有到期的」当判据，而不是"反正我有 sidecar 里的
   * 条目就喊一声"：后者会让扫描器的静默期形同虚设（每个开了提醒的会话每轮都会被要求唤醒）。
   * 读日志失败时**不**举手——宁可由扫描器按常规节奏自己判定，也不要发出一个没有依据的请求。
   */
  /** 等待一次 public 的 idle 边界（供 agent 忙碌时重试）。 */
  private waitForIdle(): void {
    if (this.idleWait !== undefined) return;
    const wait = Promise.race([
      Promise.resolve().then(() => this.agent.whenIdle()),
      this.stop,
    ]);
    this.idleWait = wait;
    wait.then(
      () => {
        this.idleWait = undefined;
        if (!this.stopping) this.requestDrive();
      },
      () => {
        this.idleWait = undefined;
      },
    );
  }

  /** 停止调度器、取消 timer、等待在途派发收敛。 */
  dispose(): Promise<void> {
    this.disposal ??= (async () => {
      this.stopping = true;
      this.requested = false;
      this.clearTimer();
      this.resolveStop?.();
      const pending = [this.run, this.idleWait].filter((value) => value !== undefined);
      await Promise.allSettled(pending);
    })();
    return this.disposal;
  }

  /**
   * 用户主动插话（QueueDock「插话发送」语义）：把指定 id 的提醒内容**立即**推给 agent。
   * - 仅 one-shot（at / after）支持；every 类型因 batch framing 需要更多 plumbing，留待后续
   * - **不要求已到点**：与 QueueDock 一致，排队中的内容随时可被主动插话提前送达；
   *   成功即出列（写 dispatch），不会到点再 fire 一次
   * - 与 fold/dispatch 共享「单一真相」：steer 成功后立即写 `schedule/change: dispatch`，
   *   否则后续 fold 路径会再 fire 一次（双触发）
   *
   * 为什么不用 `runMaintenance`：插话按钮只在 overdue 时出现，而 overdue 恰恰发生在
   * agent 正在跑（auto-driver 只能 waitForIdle）——`runMaintenance` 在 agent 有活跃工作
   * 时直接 throw（`agent "..." already has active work`），会让插话在唯一可见的场景里
   * 必然失败（曾以 `internal_error: 插话执行失败` 落日志）。`agent.steer` 是为「in-flight
   * 也要在下一个 step boundary 立即消费」设计的原语：空闲则开 turn、忙碌则排到边界，
   * 不需要空闲。
   *
   * ⚠️ **`deliver` 与 `append(dispatch)` 之间永远不能插 await。** 这句话曾经只是注释、
   * 代码并不成立（中间隔着 `await verifyDelivery`，最长 2s），后果是窗口里记录仍 active，
   * 而共用同一份日志的另一个读者（dsh-schedule 自己的调度器、以及本插件到点的 timer）
   * 会把它再派发一次——去重契约从来是「日志里有没有 dispatch」，进程内的 in-flight 集合
   * 拦不住另一个插件。这条由 `tests/delivery.test.mjs`「确认窗口里记录必须已经出列」守着。
   *
   * 正因为出列挪到了确认之前，「未确认 + 保留可重试」不能再靠「不写 dispatch」实现，
   * 改为补偿重挂一条，见 {@link rearmOneShot}。
   */
  async steerById(id: string): Promise<{ ok: true; id: string; steered: true } | { ok: false; code: string; message: string }> {
    if (this.stopping || this.disposal !== undefined) {
      return { ok: false, code: 'stopping', message: this.dict().errRtStopping };
    }
    /**
     * 暂停项的插话：直接从 sidecar 留档取材，不经过日志。
     *
     * 暂停 = 日志 `delete` + sidecar 留档，所以暂停项**不在日志里**，下面的
     * `folded.active` 必然找不到它。但"插话"的语义是「不等倒计时、立刻推送」，
     * 对暂停项恰恰是最需要的（暂停了但想马上发）。留档里已有 prompt 与 delivery，
     * 足够构造消息。
     *
     * 投递成功后**清掉留档**：该提醒已经送达，不应再留在"待发送"列表里
     * （与 dispatch 会把记录移出 active 的语义一致）。
     */
    const pausedHit = await this.steerPausedById(id);
    if (pausedHit !== undefined) return pausedHit;

    /**
     * wire id → 日志 schedule id。
     *
     * ⚠️ GUI 传过来的是**投影里的 `id`**，而那是「稳定 uid 优先」的
     * （见 projection 的 `wireItemOf`：`id: uid ?? record.id`）。而日志的
     * `schedule/change` 记录用 `schedule-N` 作 id。两者不同，必须换算。
     *
     * 此前直接 `ScheduleId(id)` 并 `r.id === scheduleId` 比对，于是**所有**由
     * 用户工具创建的活动任务插话都报 `schedule_not_found`（实测复现：
     * uid `f0fc0c90…` vs 日志 id `schedule-1`）。删除/暂停路径早已用
     * `resolveActiveScheduleId` 做了这层换算，插话是漏网的。
     */
    const sessionId = this.agent.session.header?.id;
    const scheduleId: ReturnType<typeof ScheduleId> = (() => {
      // 先按 uid 找当前活动的日志 id；找不到再当作日志 id 原样使用
      //（无 uid 的旧数据 / 调用方直接传 schedule-N）。
      const byUid = sessionId === undefined ? undefined : findScheduleIdByUid(sessionId, id);
      return ScheduleId(byUid ?? id);
    })();
    let claimed: { kind: 'one-shot'; records: readonly OneShotScheduleRecord[]; delivery: UserScheduleDelivery } | null = null;
    try {
      const claimedState = foldUserState(this.agent.session);
      const folded = claimedState.folded.active.filter((record) => claimedState.owned.has(record.id));
      const record = folded.find((r) => r.id === scheduleId);
      if (record === undefined) {
        return { ok: false, code: 'schedule_not_found', message: this.dict().errRtScheduleNotFound };
      }
      if (record.kind !== 'after' && record.kind !== 'at') {
        return { ok: false, code: 'unsupported_kind', message: this.dict().errRtSteerUnsupportedKind };
      }
      const delivery = claimedState.delivery.get(scheduleId) ?? 'context';
      claimed = { kind: 'one-shot', records: [record], delivery };
    } catch (error) {
      this.ctx.logger.warn(`later: steer fold 失败: ${renderThrown(error)}`);
      return { ok: false, code: 'internal_error', message: this.dict().errRtLogUnreadable };
    }

    let message: ReturnType<typeof this.buildMessage>;
    /** 供「未确认 + keep」补偿路径重建记录用；与 message 在同一同步块里取。 */
    let steeredRecord: OneShotScheduleRecord | undefined;
    let steeredDelivery: UserScheduleDelivery = 'context';
    try {
      // 同一同步块内：重 fold（防 auto-driver 刚把 dispatch 写掉的竞态）→ 投递 →
      // **立刻** append dispatch。
      const reState = foldUserState(this.agent.session);
      const reRecord = reState.folded.active.find((r) => r.id === scheduleId);
      if (reRecord === undefined || claimed === null) {
        // 已被并发 fold 派发（auto-driver 抢先），端态与插话成功一致，不重复投。
        return { ok: true, id, steered: true };
      }
      message = this.buildMessage(claimed, reState.delivery);
      this.deliver(message);
      /**
       * 出列标记必须紧跟 `deliver`，两者之间**不能有 await**。
       *
       * 原先这里是 `deliver → await verifyDelivery（最长 2s）→ append dispatch`，而本
       * 方法头声称「dispatch 事件在同一同步块内 append，与 auto-driver 的 fold 无并发
       * 窗口」——那句注释在代码上是错的，中间隔着整整一个 await。窗口里这条记录仍然
       * active，于是同一份日志的**另一个读者**会把它再派发一次：dsh-schedule 自己的
       * 调度器（本插件与它共用同一份持久化日志，去重契约从头到尾就是「日志里有没有
       * dispatch」），以及本插件到点的 timer。用户侧的表现是重复消息。
       *
       * 为什么不用进程内的 in-flight 集合来堵：那只能拦本组件，拦不住 peer——peer 是
       * 另一个插件，它不认我们的内存，只认持久化事件。所以修法只能是把 dispatch 写进
       * 那个同步块本身。
       */
      this.agent.session.append('schedule/change', { version: 1, operation: 'dispatch', id: scheduleId });
      /**
       * 索引面同步跟上这一次 dispatch（与 `driveOnce` 同一条纪律，#139）。
       *
       * GUI「插话发送」也是一次投递：不镜像的话条目在扫描器眼里继续「到期且未消化」，
       * 于是每插话一次就给那个会话攒一次假失败，攒满 5 次整个会话从此不再被冷唤醒。
       * 位置在 `steerPausedById` 那条「出列紧跟 deliver」的纪律之内——这一步是同步的。
       */
      this.reconcileDueIndex();
      steeredRecord = reRecord as OneShotScheduleRecord;
      steeredDelivery = reState.delivery.get(scheduleId) ?? 'context';
    } catch (error) {
      this.ctx.logger.warn(`later: steer 失败 agent "${this.agent.id}": ${renderThrown(error)}`);
      return { ok: false, code: 'internal_error', message: this.dict().errRtSteerFailed };
    }

    // 送达确认：默认开启。
    const confirmed = await this.verifyDelivery(message);
    if (!confirmed) {
      this.noteUnconfirmed();
      if (this.getSettings().onUnconfirmed === 'keep') {
        /**
         * 未确认 + 「保留可重试」：出列已经写进日志了（上面不再为此留窗口），所以
         * 「保留」只能靠**重新挂一条**来实现，而不是靠不写 dispatch。
         *
         * 这是把「可能重复投递」换成「异常路径上多一次重挂」：前者是用户可见的重复
         * 消息且发生在正常时序里，后者只在投递已经失败时走到，且端态与旧行为等价
         * （条目仍在、仍可触发）。
         */
        const rearmedId = await this.rearmOneShot(this.agent.session.header?.id, scheduleId, steeredRecord, steeredDelivery);
        return rearmedId === undefined
          ? { ok: false, code: 'delivery_unconfirmed', message: this.dict().errRtDeliveryLost }
          : { ok: false, code: 'delivery_unconfirmed', message: this.dict().errRtDeliveryRetryable };
      }
      // 策略为「丢弃」：与旧实现一致，确认失败也认作已出列。
      try {
        await this.ctx.sessions.flush(this.agent.session);
      } catch {
        /* 落盘失败不改变「已丢弃」的端态 */
      }
      return { ok: true, id, steered: true };
    }

    // 同步落盘，确保 fold 路径下次扫描看到 dispatch 标记。
    try {
      await this.ctx.sessions.flush(this.agent.session);
    } catch {
      /* 落盘失败不影响投递已确认的语义；下次 fold 仍可能重触发，作为最坏情况接受 */
    }
    return { ok: true, id, steered: true };
  }

  /**
   * 投递未确认且策略为 `keep` 时，把这条**已经出列**的一次性提醒重新挂回。
   *
   * 为什么必须新建而不能撤销那条 dispatch：上游 `applyScheduleChanges`
   * （dsh-schedule/lib/index.js:918 起）对 `create` 复用 id 直接抛
   * `schedule id ... was reused`，对已 dispatch 的 id 再 `delete` 也抛
   * `delete targets inactive id`——一条一次性记录派发过就是派发过，日志面无法回退。
   * 所以沿用编辑路径的做法：**换新日志 id、uid 保持不变**（wire 面以 uid 优先，
   * GUI 看不出这条换过 id；`findScheduleIdByUid` 也仍能按 uid 命中新 id）。
   *
   * 时刻按原 `scheduledAt` 落成 `at` 记录：编辑路径已确认 `createAtRecord` 接受过去
   * 的时刻（注释原话「保留原时刻（不重置到未来）」），这样端态与旧行为「留在 active、
   * 已 overdue、下次 drive 再派发」等价。代价是这条补偿项的 `kind` 由 `after` 变成
   * `at`，而 GUI 的暂停只收 `after`（`canPause`）——补偿本来就在异常路径上，宁可少
   * 一个「可暂停」能力，也不要在「可能丢提醒」上让步。进度窗口沿用 sidecar 里的
   * `windowSeconds`，不受 kind 变化影响。
   *
   * 顺序沿用 create/edit 两处：**新所有权先写 sidecar，再写 create 事件**（投影 fold
   * 在事件到达时按 sidecar 判定归属，反过来会冒出一条无人认领的记录）；旧条目只在
   * flush 成功之后才撤销（否则新旧两条都归本插件，面板上会同时出现两行——那正是
   * 「同一个 uid 出现两条」的已知成因）。
   *
   * @returns 新日志 id；任何一步失败返回 `undefined`，调用方保留原错误码并明确告诉
   *   用户「重挂失败、需人工确认」，绝不假装成功。
   */
  private async rearmOneShot(
    sessionId: string | undefined,
    dispatchedId: string,
    record: OneShotScheduleRecord | undefined,
    delivery: UserScheduleDelivery,
  ): Promise<string | undefined> {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || record === undefined) return undefined;

    let state;
    try {
      state = foldUserState(this.agent.session);
    } catch (error) {
      this.ctx.logger.warn(`later: 补偿重挂 fold 失败: ${renderThrown(error)}`);
      return undefined;
    }
    const newId = allocateScheduleId(state.folded);
    // 旧条目里取 uid 与附件：必须在撤销旧条目**之前**读。
    const previous = getOwnership(sessionId, dispatchedId);
    recordOwnership(
      sessionId,
      newId,
      delivery,
      previous?.uid,
      record.kind === 'after' ? record.afterSeconds : previous?.windowSeconds,
      previous?.attachments,
      // 补偿重挂保住的是**同一个时刻**（`createAtRecord` 用的就是 `record.scheduledAt`），
      // 所以到期索引跟着走；漏了它，宿主级扫描器就再也不会来叫醒这条提醒。
      Date.parse(record.scheduledAt),
    );

    let nextRecord;
    try {
      nextRecord = createAtRecord(newId, record.prompt, record.scheduledAt, Date.now());
      this.agent.session.append('schedule/change', {
        version: 1,
        operation: 'create',
        schedule: toChangePayload(nextRecord),
      });
    } catch (error) {
      removeOwnership(sessionId, newId);
      this.ctx.logger.warn(`later: 补偿重挂写事件失败 agent "${this.agent.id}": ${renderThrown(error)}`);
      return undefined;
    }

    try {
      if ((await this.ctx.sessions.flush(this.agent.session)) !== true) {
        removeOwnership(sessionId, newId);
        return undefined;
      }
    } catch {
      removeOwnership(sessionId, newId);
      return undefined;
    }

    try {
      removeOwnership(sessionId, dispatchedId);
    } catch (error) {
      // 旧条目撤不掉只会在 sidecar 里多留一行，不影响新记录可见；新记录已成功且
      // 已落盘，这里不能反过来把成功说成失败。
      this.ctx.logger.warn(`later: 补偿重挂后撤销旧所有权失败 uid "${dispatchedId}": ${renderThrown(error)}`);
    }
    return newId;
  }

  /**
   * 按配置把消息投进队列。
   *
   * `followup`（默认）入 `next-turn`：与 `next-step` 是两条独立队列，
   * `claim('next-step', …)` 不触碰它，**结构上不存在**与 `turn/start` 竞争的窗口。
   * `steer` 入 `next-step`，更快但会在撞上回合启动时被吞（见 delivery.ts 注释）。
   */
  private deliver(message: UserMessage): void {
    if (this.getSettings().steerDelivery === 'steer') {
      this.agent.steer(message);
    } else {
      this.agent.followup(message);
    }
  }

  /**
   * 核对投递是否真正进入会话日志。
   *
   * 关闭确认时直接返回 true（fire-and-forget，保持旧语义）。
   */
  private async verifyDelivery(message: UserMessage): Promise<boolean> {
    if (!this.getSettings().confirmDelivery) return true;
    const messageId = messageIdOf(message);
    if (messageId.length === 0) return false;
    return confirmDelivery(this.agent.session, messageId);
  }

  /**
   * 投递未确认时，把「插件当时凭什么决定这个 source kind」写进宿主日志（issue #75 建议 3）。
   *
   * 为什么只能记这个、记不了「真实错误」：`confirmDelivery` 的全部观测面是会话日志里
   * 有没有那条 message id，它回答不了「为什么没有」。rc.1 那类代次的真因是消息被
   * **宿主写入路径的 v4 准入**拒绝（`format v4 message requires a producer-owned source kind`），
   * 实测那句只出现在宿主 stdout，插件侧 `deliver()` 不抛、会话日志里既无 dispatch 也无校验行
   * ——所以插件唯一能补上的信息就是自己的判定依据。把 `kind=` 与内核版本留在线上，
   * 下次这类事不用再跑一遍跨代次实测才能定位。
   */
  private noteUnconfirmed(): void {
    const decision = messageSourceDecision();
    this.ctx.logger.warn(
      `later: 投递未确认（消息 source kind=${decision.kind}；判定依据：${decision.detail}）`,
    );
  }

  /**
   * 索引面镜像：把 fold 的端态写回 sidecar（issue #139 的根治点）。
   *
   * ## 为什么这件事必须由 runtime 做
   *
   * 扫描器的到期视图只能读 sidecar：`ctx.sessions.get(id)` 按内核定义只返回**已发布
   * （live）**的会话（`dsh-session` 的 `SessionStore.get`），而「要不要叫醒这条冷会话」
   * 的判定恰恰发生在会话还冷的时候——让扫描器去读 fold 是一条循环依赖。所以「到期视图与
   * 投递真相同源」只能反过来实现：**能读日志的那一方（runtime）在 dispatch 之后把日志
   * 端态镜像进索引**，扫描器继续只读索引，但读的是带消化状态的索引（`due.ts` 的
   * {@link readDueIndex}）。
   *
   * 端态直接取自已有的 fold 结果，本方法**不折 occurrence、不推下一次**：日志里该 id 还
   * active 就用它的 `scheduledAt`（`every` 的 dispatch 已由 fold 推进到下一次），已经不
   * active 就是「已消化」。再算第三遍就是本仓最贵的那类错误（两条通道口径分叉）。
   *
   * ## 三个调用点，各自钉住一条路径
   *
   *  1. `driveOnce` 派发之后（维护事务内、与 `append(dispatch)` 同一个同步块）——正常到点；
   *  2. `steerById` 派发之后——GUI「插话发送」也是投递，不镜像就成了「投完了但索引还
   *     写着到期」，与 `driveOnce` 同一种病；
   *  3. `driveOnce` 决策之前——**遗留数据的自愈点**。1.12.1 及以下写下的条目没有标记，
   *     重启后扫描器只能按旧时刻判定，于是每条最多**再白拉一次**；那一次唤醒里会话被附着，
   *     本调用把标记补上，此后同一条目永不再叫。这条是「修复不追溯」的边界，写在
   *     `docs/design-decisions.md` 的 D2，不许假装它不存在。
   *
   * 全程不抛：镜像失败（fold 读不动、磁盘写坏）只影响「下一次扫描看得见它吗」，绝不能把
   * **已经发生的投递**说成失败——那是 #71 那一类「把成功报成失败」的回归。
   *
   * @returns 实际改动的条目数（`0` = 索引本来就和 fold 一致，没碰磁盘）。
   */
  private reconcileDueIndex(): number {
    const sessionId = this.agent.session.header?.id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) return 0;
    let targets: Map<string, number | undefined>;
    try {
      const active = foldUserState(this.agent.session).folded.active;
      // 键写成裸 `string`：`record.id` 是 `ScheduleId` 品牌类型，而 sidecar 的键是磁盘上的
      // 普通字符串（`allOwnership` 返回 `Record<string, …>`）。品牌只在本仓类型层存在，
      // 运行时两边都是同一个 id；不做这层收窄就得在每个调用点 `ScheduleId(...)` 一次。
      const activeById = new Map<string, ScheduleRecord>(
        active.map((record) => [record.id as string, record]),
      );
      targets = new Map<string, number | undefined>();
      for (const id of Object.keys(allOwnership(sessionId))) {
        const record = activeById.get(id);
        if (record === undefined) {
          // 日志里已经没有这条：一次性投完出列 / 被删除。两种都该从到期视图里消失。
          targets.set(id, undefined);
          continue;
        }
        const target = dueTargetOf(record.scheduledAt);
        // 时刻解析不出来 ⇒ **不**进镜像表（不是"已消化"）：缺时刻的老条目仍走读侧的
        // 「回算，回算不出就保守跳过并告警」那条路，这里越权写标记只会把它变成静默丢失。
        if (target === undefined) continue;
        targets.set(id, target);
      }
    } catch (error) {
      this.ctx.logger.warn(`later: 到期索引进账失败（不影响投递）: ${renderThrown(error)}`);
      return 0;
    }
    try {
      return mirrorDueIndex(sessionId, targets);
    } catch (error) {
      this.ctx.logger.warn(`later: 到期索引落盘失败（不影响投递）: ${renderThrown(error)}`);
      return 0;
    }
  }

  /** 执行一次用户提醒决策与派发。 */
  private async driveOnce(): Promise<void> {
    this.clearTimer();
    if (!this.isLive()) return;
    // 持久化 barrier 预检（失败则本轮回合放弃）
    try {
      if ((await this.ctx.sessions.flush(this.agent.session)) !== true) return;
    } catch {
      return;
    }
    if (!this.isLive()) return;

    let active: readonly ScheduleRecord[];
    try {
      const state = foldUserState(this.agent.session);
      active = state.folded.active.filter((record) => state.owned.has(record.id));
    } catch (error) {
      this.ctx.logger.warn(
        `later: fold 失败 agent "${this.agent.id}": ${renderThrown(error)}`,
      );
      return;
    }
    const now = Date.now();
    const decision = dueUserDecision(active, now, undefined);
    /**
     * 决策之前先对账一次（#139 的遗留数据自愈点，见 {@link reconcileDueIndex} 第 3 个调用点）。
     *
     * 走到这里意味着会话**已经附着**、日志读得动——这是唯一能把「1.12.1 之前写下的、没有
     * 消化标记的条目」补上的时机。不加这一处，那种条目会让扫描器每次兜底 tick 都白拉一次
     * 会话（拉起来又什么都投不出去），而用户看到的是一条早就发过的提醒反复叫醒会话。
     */
    this.reconcileDueIndex();

    if (decision.kind === 'wait') {
      if (decision.target !== undefined) this.arm(decision.target, now);
      return;
    }

    // 派发：与 dsh-schedule 同构——先注入用户消息，再 append dispatch，再 flush。
    let maintenance;
    try {
      maintenance = this.agent.runMaintenance(() => {
        const claimedState = foldUserState(this.agent.session);
        const claimed = claimedState.folded.active.filter((record) => claimedState.owned.has(record.id));
        const delivery = claimedState.delivery;
        const decisionNow = Date.now();
        const decisionAtClaim = dueUserDecision(claimed, decisionNow, delivery);
        if (decisionAtClaim.kind === 'wait') {
          if (decisionAtClaim.target !== undefined) this.arm(decisionAtClaim.target, decisionNow);
          return Promise.resolve(false);
        }
        try {
          const message = this.buildMessage(decisionAtClaim, delivery);
          this.agent.followup(message);
        } catch (error) {
          this.ctx.logger.warn(
            `later: framing/followup 失败 agent "${this.agent.id}": ${renderThrown(error)}`,
          );
          return Promise.resolve(false);
        }
        try {
          if (decisionAtClaim.kind === 'one-shot') {
            // P1-5：整批同形态一次性提醒在同一维护事务内逐条写 dispatch，
            // 共享一条注入消息；fold 去重语义不变（写完即不再 active）。
            for (const record of decisionAtClaim.records) {
              this.agent.session.append('schedule/change', {
                version: 1,
                operation: 'dispatch',
                id: record.id,
              });
            }
          } else {
            for (const reminder of decisionAtClaim.reminders) {
              this.agent.session.append('schedule/change', {
                version: 1,
                operation: 'dispatch',
                id: reminder.record.id,
                acceptedAt: decisionAtClaim.acceptedAt,
              });
            }
          }
        } catch (error) {
          this.ctx.logger.warn(
            `later: dispatch append 失败 agent "${this.agent.id}": ${renderThrown(error)}`,
          );
          return Promise.resolve(false);
        }
        /**
         * 投递已经落进日志，索引面必须**在同一同步块里**跟上（#139）。
         *
         * 为什么不能挪到 `driveOnce` 末尾的 flush 之后：那里隔着 `await`，而扫描器的
         * 宽限期只有 250ms——窗口里条目在索引上仍然"到期且未消化"，一次成功的唤醒就会被
         * 记成一次失败。留痕的口径也与日志一致：这里读的是刚 append 过 dispatch 的同一份
         * 日志，一次性已出列、`every` 已推进。
         */
        this.reconcileDueIndex();
        return Promise.resolve(true);
      });
    } catch (_busy) {
      this.waitForIdle();
      return;
    }
    if (!(await maintenance)) return;
    try {
      if ((await this.ctx.sessions.flush(this.agent.session)) !== true) return;
    } catch {
      return;
    }
    if (this.isLive()) this.requestDrive();
  }

  /**
   * 暂停项的插话投递。
   *
   * 暂停项不在日志里（其日志记录在 pause 时被删），所以从 sidecar 留档取材：
   * `PausedEntry` 已含 `prompt` 与 `delivery`，足以构造消息。呈现方式与
   * {@link buildMessage} 的 one-shot 分支保持一致（`user` 代发 vs `context` 注入），
   * 避免两条路径的语义分叉。
   *
   * 投递成功后清掉留档：提醒已送达，不应再留在待发送列表。这与 dispatch 会把记录
   * 移出 `active` 语义一致。（清留档不写会话事件，故投影不会自动刷新——客户端已用
   * 本地摘除 + 投影对账处理同类情况，与"删除暂停项"同源。）
   *
   * @returns `undefined` 表示该 id 不是暂停项，交由调用方走常规日志路径。
   */
  private async steerPausedById(
    id: string,
  ): Promise<
    { ok: true; id: string; steered: true } | { ok: false; code: string; message: string } | undefined
  > {
    const sessionId = this.agent.session.header?.id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined;
    const paused = getPaused(sessionId, id);
    if (paused === undefined) return undefined;

    const asUser = paused.delivery === 'user';
    // 附件随留档冻结（pause 时带出），代发/插话时原样拼回，与 buildMessage 同形。
    // 拼接统一走 `contentWithAttachmentBlocks`：0.1.2 那代 `ContentBlock` 没有 file
    // 变体，file 块在那一代降级成 `[附件] <name>` 文本；图片块与 ≥0.1.5 的 file 块
    // 仍原样透传（见 attachment-blocks.ts）。
    const attachmentBlocks: readonly ScheduledAttachment[] = paused.attachments ?? [];
    const message = asUser
      ? createUserMessage({
          content: contentWithAttachmentBlocks({ type: 'text', text: paused.prompt }, attachmentBlocks),
          source: laterUserSource({ delivery: 'one-shot', count: 1 }),
        })
      : createUserMessage({
          content: [{ type: 'text', text: renderReminderFraming({
            id: paused.lastScheduleId,
            kind: 'after',
            prompt: paused.prompt,
            afterSeconds: paused.originalAfterSeconds ?? paused.remainingSeconds,
            scheduledAt: paused.originalScheduledAt,
          } as never) }],
          source: scheduleMessageSource(boundContextSummary(paused.prompt)) as never,
        });

    try {
      this.deliver(message);
    } catch (error) {
      this.ctx.logger.warn(`later: 暂停项插话失败 agent "${this.agent.id}": ${renderThrown(error)}`);
      return { ok: false, code: 'internal_error', message: this.dict().errRtSteerFailed };
    }
    // 投递成功即出列：清掉留档，避免已送达的提醒继续显示为"待发送"。
    // 未确认时（onUnconfirmed='keep'）**不清留档** —— 留档就是暂停项的「active」，
    // 清掉等于让提醒消失而消息没到，与日志路径同样的丢失。
    const confirmed = await this.verifyDelivery(message);
    if (!confirmed && this.getSettings().onUnconfirmed === 'keep') {
      this.noteUnconfirmed();
      return { ok: false, code: 'delivery_unconfirmed', message: this.dict().errRtDeliveryRetryable };
    }
    try {
      removePaused(sessionId, id);
    } catch (error) {
      this.ctx.logger.warn(`later: 清理暂停留档失败 uid "${id}": ${renderThrown(error)}`);
    }
    return { ok: true, id, steered: true };
  }

  /**
   * 构造注入的消息，按投递形态分流：
   *  - `user`（`/later` 显式请求的延迟发送）：原样内容 + `source.kind='user'`，
   *    让 GUI 呈现为「我」发出的普通气泡（产品取舍：用户明确要求以本人身份）。
   *    跳过 framing 防护 —— 这是「代发」语义，不是注入。随命令提交的附件
   *    （图片/文件耐久引用，存于 sidecar）按记录顺序拼在文本块之后，
   *    与用户自己发「文字+图」的消息形状一致。拼接走 `appendAttachmentBlocks`：
   *    0.1.2 那代 `ContentBlock` 没有 file 变体，file 块在那里降级成
   *    `[附件] <name>` 文本块（图片块两代都原样透传）。
   *  - `context`（默认）：复用 dsh-schedule 的注入防护 framing + notice 表单，
   *    保持「上下文注入」的可信审计线；多条一次性到期合并为批次 framing（P1-5），
   *    形状与 dsh-schedule 的固定间隔批次一致。
   */
  private buildMessage(
    decision: Extract<UserDecision, { kind: 'one-shot' | 'every' }>,
    delivery: ReadonlyMap<string, UserScheduleDelivery>,
  ) {
    if (decision.kind === 'one-shot') {
      const records = decision.records;
      // one-shot 批次在决策期已按形态分组（decision.delivery），组内必然同源；
      // 兜底：任一条带 user 标记即按代发处理，与旧语义一致。
      const asUser =
        decision.delivery === 'user' || records.some((record) => delivery.get(record.id) === 'user');
      if (asUser) {
        const content: ContentBlock[] = [
          { type: 'text', text: records.map((record) => record.prompt).join('\n') },
        ];
        for (const record of records) appendAttachmentBlocks(content, this.attachmentsOf(record.id));
        return createUserMessage({
          content,
          source: laterUserSource({ delivery: 'one-shot', count: records.length }),
        });
      }
      const text =
        records.length === 1
          ? renderReminderFraming(records[0]!)
          : renderOneShotBatchFraming(records);
      return createUserMessage({
        content: [{ type: 'text', text }],
        source: scheduleMessageSource(boundContextSummary(noticeSummary(records))) as never,
      });
    }
    const records = decision.reminders.map((reminder) => reminder.record);
    // 固定间隔批次里任一条以「代发」为准（当前入口不会产生该组合，防御性保留）
    if (records.some((record) => delivery.get(record.id) === 'user')) {
      const content: ContentBlock[] = [
        { type: 'text', text: records.map((record) => record.prompt).join('\n') },
      ];
      for (const record of records) appendAttachmentBlocks(content, this.attachmentsOf(record.id));
      return createUserMessage({
        content,
        source: laterUserSource({ delivery: 'every', count: records.length }),
      });
    }
    return createUserMessage({
      content: [{ type: 'text', text: renderEveryReminderBatchFraming(decision.reminders) }],
      source: scheduleMessageSource(boundContextSummary(noticeSummary(records))) as never,
    });
  }

  /**
   * 读某条提醒随命令提交的附件（sidecar 权威；无会话 id / 无条目时为空）。
   *
   * 只在 `user` 代发路径调用——context 注入通道从未声明接受附件（见 commands.ts），
   * 不会把图片拼进防护 framing。sidecar 读路径已做块级收窄（sanitizeAttachments）。
   */
  private attachmentsOf(scheduleId: string): readonly ScheduledAttachment[] {
    const sessionId = this.agent.session.header?.id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) return [];
    try {
      return getOwnership(sessionId, scheduleId)?.attachments ?? [];
    } catch {
      return [];
    }
  }
}

/** notice 摘要：每条 `HH:mm · 内容`，最多列 3 条，余者以计数收尾。 */
function noticeSummary(records: readonly ScheduleRecord[]): string {
  const tz = detectTimeZone();
  const lines = records.slice(0, 3).map((record) => `${formatHhmm(Date.parse(record.scheduledAt), tz)} · ${record.prompt}`);
  if (records.length > 3) lines.push(`等共 ${records.length} 条`);
  return lines.join('；');
}
