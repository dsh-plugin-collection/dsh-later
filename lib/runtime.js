import { createUserMessage, boundContextSummary } from '@deepseek-ai/dsh-llm';
import { renderReminderFraming, resolveEveryOccurrence, ScheduleId, } from '@deepseek-ai/dsh-schedule';
import { renderRecurringBatchFraming as renderEveryReminderBatchFraming, messageSourceDecision, allocateScheduleIdCompat as allocateScheduleId, createAtRecord, scheduleMessageSource, toChangePayload, } from './schedule-compat.js';
import { findScheduleIdByUid, getOwnership, getPaused, recordOwnership, removeOwnership, removePaused } from './ownership-store.js';
import { appendAttachmentBlocks, contentWithAttachmentBlocks } from './attachment-blocks.js';
import { foldUserState } from './user-tools.js';
import { confirmDelivery, messageIdOf } from './delivery.js';
import { detectTimeZone, formatHhmm } from './time-utils.js';
import { laterUserSource } from './later-message-source.js';
/** Node timers 能表示的最大延迟。 */
const MAX_TIMER_DELAY_MS = 2147483647;
/** 渲染未知错误（仅进程内诊断）。 */
function renderThrown(value) {
    return value instanceof Error ? value.message : String(value);
}
export function dueUserDecision(active, now, delivery) {
    const indexed = active.map((record, index) => ({ record, index }));
    const byTargetThenCreate = (a, b) => Date.parse(a.record.scheduledAt) - Date.parse(b.record.scheduledAt) || a.index - b.index;
    const overdueOneShots = indexed
        .filter((entry) => entry.record.kind !== 'every' && Date.parse(entry.record.scheduledAt) <= now)
        .sort(byTargetThenCreate);
    if (overdueOneShots.length > 0) {
        const asUser = (record) => record.kind !== 'every' && delivery?.get(record.id) === 'user';
        const userGroup = overdueOneShots.filter((entry) => asUser(entry.record));
        const contextGroup = overdueOneShots.filter((entry) => !asUser(entry.record));
        // 两组都非空时取最早到期的一组，另一组由下一次 drive 接续派发。
        const chosen = userGroup.length > 0 && contextGroup.length > 0
            ? Date.parse(userGroup[0].record.scheduledAt) <= Date.parse(contextGroup[0].record.scheduledAt)
                ? userGroup
                : contextGroup
            : overdueOneShots;
        return {
            kind: 'one-shot',
            delivery: chosen.length > 0 && asUser(chosen[0].record) ? 'user' : 'context',
            records: chosen.map(({ record }) => record),
        };
    }
    const every = indexed
        .filter((entry) => entry.record.kind === 'every' && Date.parse(entry.record.scheduledAt) <= now)
        .sort(byTargetThenCreate);
    if (every.length > 0) {
        return {
            kind: 'every',
            acceptedAt: new Date(now).toISOString(),
            reminders: every.map(({ record }) => ({
                record: record,
                occurrenceAt: resolveEveryOccurrence(record, now).occurrenceAt,
            })),
        };
    }
    const target = active.reduce((selected, record) => {
        const candidate = Date.parse(record.scheduledAt);
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
export function renderOneShotBatchFraming(records) {
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
    ctx;
    agent;
    /**
     * 读取当前生效设置（每次调用按需取值，与工具/命令同源）。
     *
     * 注入而非直接读 ctx.settings：settings 的注册在 index 的 `ctx.inject(['settings'])`
     * 回调里完成，runtime 拿不到那个 scope；把它做成闭包注入，保证「设置 UI 改了立刻生效」
     * 这一既有语义（`applies: 'live'`）在插话路径上同样成立。
     */
    getSettings;
    stop;
    resolveStop;
    timer;
    run;
    requested = false;
    stopping = false;
    /** 连续 run 级失败次数（P0-3：用于指数退避，成功一次即清零）。 */
    failures = 0;
    idleWait;
    disposal;
    constructor(ctx, agent, getSettings) {
        this.ctx = ctx;
        this.agent = agent;
        this.getSettings = getSettings;
        this.stop = new Promise((resolve) => {
            this.resolveStop = resolve;
        });
    }
    /** 是否仍为活动 root agent。 */
    isLive() {
        try {
            return this.ctx.agents.get(this.agent.id) === this.agent && this.ctx.agents.roots().includes(this.agent);
        }
        catch {
            return false;
        }
    }
    /** 发起一次重算（合并多个触发为一次）。 */
    requestDrive() {
        if (this.stopping)
            return;
        this.clearTimer();
        this.requested = true;
        if (this.run !== undefined)
            return;
        const run = this.runRequested();
        this.run = run;
        run.then(() => {
            this.failures = 0;
            if (this.run === run)
                this.run = undefined;
        }, () => {
            // P0-3：run 级异常不再永久自废（旧实现 disabled=true 直到 agent 重建，
            // 一次瞬时故障就让该会话所有提醒停摆且无感知）。正常路径 driveOnce
            // 已自捕获全部预期错误，此分支只应被真正的编程错误触达——按指数
            // 退避自动重试（1s→2s→4s→…封顶 30s），用户下次创建/删除也会立即重驱。
            this.failures += 1;
            const delay = Math.min(1000 * 2 ** Math.min(this.failures - 1, 5), 30_000);
            this.ctx.logger.warn(`later: 调度器驱动失败 agent "${this.agent.id}"（${this.failures} 次，${delay}ms 后重试）: 未知异常`);
            this.clearTimer();
            this.arm(Date.now() + delay, Date.now());
            if (this.run === run)
                this.run = undefined;
        });
    }
    /** 清空已武装的 timer。 */
    clearTimer() {
        if (this.timer === undefined)
            return;
        clearTimeout(this.timer);
        this.timer = undefined;
    }
    /** 武装一次到下次目标的 timer。 */
    arm(target, now) {
        const delay = Math.min(target - now, MAX_TIMER_DELAY_MS);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.requestDrive();
        }, delay);
        // v8 ignore next -- 仅在测试环境需要
        if (this.timer.unref) {
            this.timer.unref();
        }
    }
    /** 串行 drain 合并的触发。 */
    async runRequested() {
        while (this.requested && !this.stopping) {
            this.requested = false;
            await this.driveOnce();
        }
    }
    /** 等待一次 public 的 idle 边界（供 agent 忙碌时重试）。 */
    waitForIdle() {
        if (this.idleWait !== undefined)
            return;
        const wait = Promise.race([
            Promise.resolve().then(() => this.agent.whenIdle()),
            this.stop,
        ]);
        this.idleWait = wait;
        wait.then(() => {
            this.idleWait = undefined;
            if (!this.stopping)
                this.requestDrive();
        }, () => {
            this.idleWait = undefined;
        });
    }
    /** 停止调度器、取消 timer、等待在途派发收敛。 */
    dispose() {
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
    async steerById(id) {
        if (this.stopping || this.disposal !== undefined) {
            return { ok: false, code: 'stopping', message: '调度器已停止。' };
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
        if (pausedHit !== undefined)
            return pausedHit;
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
        const scheduleId = (() => {
            // 先按 uid 找当前活动的日志 id；找不到再当作日志 id 原样使用
            //（无 uid 的旧数据 / 调用方直接传 schedule-N）。
            const byUid = sessionId === undefined ? undefined : findScheduleIdByUid(sessionId, id);
            return ScheduleId(byUid ?? id);
        })();
        let claimed = null;
        try {
            const claimedState = foldUserState(this.agent.session);
            const folded = claimedState.folded.active.filter((record) => claimedState.owned.has(record.id));
            const record = folded.find((r) => r.id === scheduleId);
            if (record === undefined) {
                return { ok: false, code: 'schedule_not_found', message: '指定的提醒不存在或已派发。' };
            }
            if (record.kind !== 'after' && record.kind !== 'at') {
                return { ok: false, code: 'unsupported_kind', message: 'every 类提醒的插话暂未支持。' };
            }
            const delivery = claimedState.delivery.get(scheduleId) ?? 'context';
            claimed = { kind: 'one-shot', records: [record], delivery };
        }
        catch (error) {
            this.ctx.logger.warn(`later: steer fold 失败: ${renderThrown(error)}`);
            return { ok: false, code: 'internal_error', message: '会话定时日志读取失败。' };
        }
        let message;
        /** 供「未确认 + keep」补偿路径重建记录用；与 message 在同一同步块里取。 */
        let steeredRecord;
        let steeredDelivery = 'context';
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
            steeredRecord = reRecord;
            steeredDelivery = reState.delivery.get(scheduleId) ?? 'context';
        }
        catch (error) {
            this.ctx.logger.warn(`later: steer 失败 agent "${this.agent.id}": ${renderThrown(error)}`);
            return { ok: false, code: 'internal_error', message: '插话执行失败。' };
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
                    ? { ok: false, code: 'delivery_unconfirmed', message: '投递未确认，且重新挂回失败——请到面板确认这条提醒是否还在。' }
                    : { ok: false, code: 'delivery_unconfirmed', message: '投递未确认，提醒已保留，可重试。' };
            }
            // 策略为「丢弃」：与旧实现一致，确认失败也认作已出列。
            try {
                await this.ctx.sessions.flush(this.agent.session);
            }
            catch {
                /* 落盘失败不改变「已丢弃」的端态 */
            }
            return { ok: true, id, steered: true };
        }
        // 同步落盘，确保 fold 路径下次扫描看到 dispatch 标记。
        try {
            await this.ctx.sessions.flush(this.agent.session);
        }
        catch {
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
    async rearmOneShot(sessionId, dispatchedId, record, delivery) {
        if (typeof sessionId !== 'string' || sessionId.length === 0 || record === undefined)
            return undefined;
        let state;
        try {
            state = foldUserState(this.agent.session);
        }
        catch (error) {
            this.ctx.logger.warn(`later: 补偿重挂 fold 失败: ${renderThrown(error)}`);
            return undefined;
        }
        const newId = allocateScheduleId(state.folded);
        // 旧条目里取 uid 与附件：必须在撤销旧条目**之前**读。
        const previous = getOwnership(sessionId, dispatchedId);
        recordOwnership(sessionId, newId, delivery, previous?.uid, record.kind === 'after' ? record.afterSeconds : previous?.windowSeconds, previous?.attachments);
        let nextRecord;
        try {
            nextRecord = createAtRecord(newId, record.prompt, record.scheduledAt, Date.now());
            this.agent.session.append('schedule/change', {
                version: 1,
                operation: 'create',
                schedule: toChangePayload(nextRecord),
            });
        }
        catch (error) {
            removeOwnership(sessionId, newId);
            this.ctx.logger.warn(`later: 补偿重挂写事件失败 agent "${this.agent.id}": ${renderThrown(error)}`);
            return undefined;
        }
        try {
            if ((await this.ctx.sessions.flush(this.agent.session)) !== true) {
                removeOwnership(sessionId, newId);
                return undefined;
            }
        }
        catch {
            removeOwnership(sessionId, newId);
            return undefined;
        }
        try {
            removeOwnership(sessionId, dispatchedId);
        }
        catch (error) {
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
    deliver(message) {
        if (this.getSettings().steerDelivery === 'steer') {
            this.agent.steer(message);
        }
        else {
            this.agent.followup(message);
        }
    }
    /**
     * 核对投递是否真正进入会话日志。
     *
     * 关闭确认时直接返回 true（fire-and-forget，保持旧语义）。
     */
    async verifyDelivery(message) {
        if (!this.getSettings().confirmDelivery)
            return true;
        const messageId = messageIdOf(message);
        if (messageId.length === 0)
            return false;
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
    noteUnconfirmed() {
        const decision = messageSourceDecision();
        this.ctx.logger.warn(`later: 投递未确认（消息 source kind=${decision.kind}；判定依据：${decision.detail}）`);
    }
    /** 执行一次用户提醒决策与派发。 */
    async driveOnce() {
        this.clearTimer();
        if (!this.isLive())
            return;
        // 持久化 barrier 预检（失败则本轮回合放弃）
        try {
            if ((await this.ctx.sessions.flush(this.agent.session)) !== true)
                return;
        }
        catch {
            return;
        }
        if (!this.isLive())
            return;
        let active;
        try {
            const state = foldUserState(this.agent.session);
            active = state.folded.active.filter((record) => state.owned.has(record.id));
        }
        catch (error) {
            this.ctx.logger.warn(`later: fold 失败 agent "${this.agent.id}": ${renderThrown(error)}`);
            return;
        }
        const now = Date.now();
        const decision = dueUserDecision(active, now, undefined);
        if (decision.kind === 'wait') {
            if (decision.target !== undefined)
                this.arm(decision.target, now);
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
                    if (decisionAtClaim.target !== undefined)
                        this.arm(decisionAtClaim.target, decisionNow);
                    return Promise.resolve(false);
                }
                try {
                    const message = this.buildMessage(decisionAtClaim, delivery);
                    this.agent.followup(message);
                }
                catch (error) {
                    this.ctx.logger.warn(`later: framing/followup 失败 agent "${this.agent.id}": ${renderThrown(error)}`);
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
                    }
                    else {
                        for (const reminder of decisionAtClaim.reminders) {
                            this.agent.session.append('schedule/change', {
                                version: 1,
                                operation: 'dispatch',
                                id: reminder.record.id,
                                acceptedAt: decisionAtClaim.acceptedAt,
                            });
                        }
                    }
                }
                catch (error) {
                    this.ctx.logger.warn(`later: dispatch append 失败 agent "${this.agent.id}": ${renderThrown(error)}`);
                    return Promise.resolve(false);
                }
                return Promise.resolve(true);
            });
        }
        catch (_busy) {
            this.waitForIdle();
            return;
        }
        if (!(await maintenance))
            return;
        try {
            if ((await this.ctx.sessions.flush(this.agent.session)) !== true)
                return;
        }
        catch {
            return;
        }
        if (this.isLive())
            this.requestDrive();
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
    async steerPausedById(id) {
        const sessionId = this.agent.session.header?.id;
        if (typeof sessionId !== 'string' || sessionId.length === 0)
            return undefined;
        const paused = getPaused(sessionId, id);
        if (paused === undefined)
            return undefined;
        const asUser = paused.delivery === 'user';
        // 附件随留档冻结（pause 时带出），代发/插话时原样拼回，与 buildMessage 同形。
        // 拼接统一走 `contentWithAttachmentBlocks`：0.1.2 那代 `ContentBlock` 没有 file
        // 变体，file 块在那一代降级成 `[附件] <name>` 文本；图片块与 ≥0.1.5 的 file 块
        // 仍原样透传（见 attachment-blocks.ts）。
        const attachmentBlocks = paused.attachments ?? [];
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
                        }) }],
                source: scheduleMessageSource(boundContextSummary(paused.prompt)),
            });
        try {
            this.deliver(message);
        }
        catch (error) {
            this.ctx.logger.warn(`later: 暂停项插话失败 agent "${this.agent.id}": ${renderThrown(error)}`);
            return { ok: false, code: 'internal_error', message: '插话执行失败。' };
        }
        // 投递成功即出列：清掉留档，避免已送达的提醒继续显示为"待发送"。
        // 未确认时（onUnconfirmed='keep'）**不清留档** —— 留档就是暂停项的「active」，
        // 清掉等于让提醒消失而消息没到，与日志路径同样的丢失。
        const confirmed = await this.verifyDelivery(message);
        if (!confirmed && this.getSettings().onUnconfirmed === 'keep') {
            this.noteUnconfirmed();
            return { ok: false, code: 'delivery_unconfirmed', message: '投递未确认，提醒已保留，可重试。' };
        }
        try {
            removePaused(sessionId, id);
        }
        catch (error) {
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
    buildMessage(decision, delivery) {
        if (decision.kind === 'one-shot') {
            const records = decision.records;
            // one-shot 批次在决策期已按形态分组（decision.delivery），组内必然同源；
            // 兜底：任一条带 user 标记即按代发处理，与旧语义一致。
            const asUser = decision.delivery === 'user' || records.some((record) => delivery.get(record.id) === 'user');
            if (asUser) {
                const content = [
                    { type: 'text', text: records.map((record) => record.prompt).join('\n') },
                ];
                for (const record of records)
                    appendAttachmentBlocks(content, this.attachmentsOf(record.id));
                return createUserMessage({
                    content,
                    source: laterUserSource({ delivery: 'one-shot', count: records.length }),
                });
            }
            const text = records.length === 1
                ? renderReminderFraming(records[0])
                : renderOneShotBatchFraming(records);
            return createUserMessage({
                content: [{ type: 'text', text }],
                source: scheduleMessageSource(boundContextSummary(noticeSummary(records))),
            });
        }
        const records = decision.reminders.map((reminder) => reminder.record);
        // 固定间隔批次里任一条以「代发」为准（当前入口不会产生该组合，防御性保留）
        if (records.some((record) => delivery.get(record.id) === 'user')) {
            const content = [
                { type: 'text', text: records.map((record) => record.prompt).join('\n') },
            ];
            for (const record of records)
                appendAttachmentBlocks(content, this.attachmentsOf(record.id));
            return createUserMessage({
                content,
                source: laterUserSource({ delivery: 'every', count: records.length }),
            });
        }
        return createUserMessage({
            content: [{ type: 'text', text: renderEveryReminderBatchFraming(decision.reminders) }],
            source: scheduleMessageSource(boundContextSummary(noticeSummary(records))),
        });
    }
    /**
     * 读某条提醒随命令提交的附件（sidecar 权威；无会话 id / 无条目时为空）。
     *
     * 只在 `user` 代发路径调用——context 注入通道从未声明接受附件（见 commands.ts），
     * 不会把图片拼进防护 framing。sidecar 读路径已做块级收窄（sanitizeAttachments）。
     */
    attachmentsOf(scheduleId) {
        const sessionId = this.agent.session.header?.id;
        if (typeof sessionId !== 'string' || sessionId.length === 0)
            return [];
        try {
            return getOwnership(sessionId, scheduleId)?.attachments ?? [];
        }
        catch {
            return [];
        }
    }
}
/** notice 摘要：每条 `HH:mm · 内容`，最多列 3 条，余者以计数收尾。 */
function noticeSummary(records) {
    const tz = detectTimeZone();
    const lines = records.slice(0, 3).map((record) => `${formatHhmm(Date.parse(record.scheduledAt), tz)} · ${record.prompt}`);
    if (records.length > 3)
        lines.push(`等共 ${records.length} 条`);
    return lines.join('；');
}
