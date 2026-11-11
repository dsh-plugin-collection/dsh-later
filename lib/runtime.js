import { createUserMessage, boundContextSummary } from '@deepseek-ai/dsh-llm';
import { renderReminderFraming, resolveEveryOccurrence, ScheduleId, } from '@deepseek-ai/dsh-schedule';
import { renderRecurringBatchFraming as renderEveryReminderBatchFraming, messageSourceDecision, allocateScheduleIdCompat as allocateScheduleId, createAtRecord, scheduleMessageSource, toChangePayload, } from './schedule-compat.js';
import { allOwnership, findScheduleIdByUid, getOwnership, getPaused, mirrorDueIndex, recordOwnership, removeOwnership, removePaused, } from './ownership-store.js';
import { appendAttachmentBlocks, contentWithAttachmentBlocks } from './attachment-blocks.js';
import { foldUserState } from './user-tools.js';
import { confirmDelivery, messageIdOf } from './delivery.js';
import { detectTimeZone, formatHhmm } from './time-utils.js';
import { laterUserSource } from './later-message-source.js';
import { dueTargetOf, isDue } from './due.js';
const MAX_TIMER_DELAY_MS = 2147483647;
function renderThrown(value) {
    return value instanceof Error ? value.message : String(value);
}
export function dueUserDecision(active, now, delivery) {
    const indexed = active.map((record, index) => ({ record, index }));
    const byTargetThenCreate = (a, b) => Date.parse(a.record.scheduledAt) - Date.parse(b.record.scheduledAt) || a.index - b.index;
    const overdueOneShots = indexed
        .filter((entry) => entry.record.kind !== 'every' && isDue(entry.record, now))
        .sort(byTargetThenCreate);
    if (overdueOneShots.length > 0) {
        const asUser = (record) => record.kind !== 'every' && delivery?.get(record.id) === 'user';
        const userGroup = overdueOneShots.filter((entry) => asUser(entry.record));
        const contextGroup = overdueOneShots.filter((entry) => !asUser(entry.record));
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
        .filter((entry) => entry.record.kind === 'every' && isDue(entry.record, now))
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
        const candidate = dueTargetOf(record.scheduledAt) ?? Number.NaN;
        return candidate > now && (selected === undefined || candidate < selected) ? candidate : selected;
    }, undefined);
    return { kind: 'wait', ...(target === undefined ? {} : { target }) };
}
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
export class UserScheduleRuntime {
    ctx;
    agent;
    getSettings;
    stop;
    resolveStop;
    timer;
    run;
    requested = false;
    stopping = false;
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
    isLive() {
        try {
            return this.ctx.agents.get(this.agent.id) === this.agent && this.ctx.agents.roots().includes(this.agent);
        }
        catch {
            return false;
        }
    }
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
            this.failures += 1;
            const delay = Math.min(1000 * 2 ** Math.min(this.failures - 1, 5), 30_000);
            this.ctx.logger.warn(`later: 调度器驱动失败 agent "${this.agent.id}"（${this.failures} 次，${delay}ms 后重试）: 未知异常`);
            this.clearTimer();
            this.arm(Date.now() + delay, Date.now());
            if (this.run === run)
                this.run = undefined;
        });
    }
    clearTimer() {
        if (this.timer === undefined)
            return;
        clearTimeout(this.timer);
        this.timer = undefined;
    }
    arm(target, now) {
        const delay = Math.min(target - now, MAX_TIMER_DELAY_MS);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.requestDrive();
        }, delay);
        if (this.timer.unref) {
            this.timer.unref();
        }
    }
    async runRequested() {
        while (this.requested && !this.stopping) {
            this.requested = false;
            await this.driveOnce();
        }
    }
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
    async steerById(id) {
        if (this.stopping || this.disposal !== undefined) {
            return { ok: false, code: 'stopping', message: '调度器已停止。' };
        }
        const pausedHit = await this.steerPausedById(id);
        if (pausedHit !== undefined)
            return pausedHit;
        const sessionId = this.agent.session.header?.id;
        const scheduleId = (() => {
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
        let steeredRecord;
        let steeredDelivery = 'context';
        try {
            const reState = foldUserState(this.agent.session);
            const reRecord = reState.folded.active.find((r) => r.id === scheduleId);
            if (reRecord === undefined || claimed === null) {
                return { ok: true, id, steered: true };
            }
            message = this.buildMessage(claimed, reState.delivery);
            this.deliver(message);
            this.agent.session.append('schedule/change', { version: 1, operation: 'dispatch', id: scheduleId });
            this.reconcileDueIndex();
            steeredRecord = reRecord;
            steeredDelivery = reState.delivery.get(scheduleId) ?? 'context';
        }
        catch (error) {
            this.ctx.logger.warn(`later: steer 失败 agent "${this.agent.id}": ${renderThrown(error)}`);
            return { ok: false, code: 'internal_error', message: '插话执行失败。' };
        }
        const confirmed = await this.verifyDelivery(message);
        if (!confirmed) {
            this.noteUnconfirmed();
            if (this.getSettings().onUnconfirmed === 'keep') {
                const rearmedId = await this.rearmOneShot(this.agent.session.header?.id, scheduleId, steeredRecord, steeredDelivery);
                return rearmedId === undefined
                    ? { ok: false, code: 'delivery_unconfirmed', message: '投递未确认，且重新挂回失败——请到面板确认这条提醒是否还在。' }
                    : { ok: false, code: 'delivery_unconfirmed', message: '投递未确认，提醒已保留，可重试。' };
            }
            try {
                await this.ctx.sessions.flush(this.agent.session);
            }
            catch {
            }
            return { ok: true, id, steered: true };
        }
        try {
            await this.ctx.sessions.flush(this.agent.session);
        }
        catch {
        }
        return { ok: true, id, steered: true };
    }
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
        const previous = getOwnership(sessionId, dispatchedId);
        recordOwnership(sessionId, newId, delivery, previous?.uid, record.kind === 'after' ? record.afterSeconds : previous?.windowSeconds, previous?.attachments, Date.parse(record.scheduledAt));
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
            this.ctx.logger.warn(`later: 补偿重挂后撤销旧所有权失败 uid "${dispatchedId}": ${renderThrown(error)}`);
        }
        return newId;
    }
    deliver(message) {
        if (this.getSettings().steerDelivery === 'steer') {
            this.agent.steer(message);
        }
        else {
            this.agent.followup(message);
        }
    }
    async verifyDelivery(message) {
        if (!this.getSettings().confirmDelivery)
            return true;
        const messageId = messageIdOf(message);
        if (messageId.length === 0)
            return false;
        return confirmDelivery(this.agent.session, messageId);
    }
    noteUnconfirmed() {
        const decision = messageSourceDecision();
        this.ctx.logger.warn(`later: 投递未确认（消息 source kind=${decision.kind}；判定依据：${decision.detail}）`);
    }
    reconcileDueIndex() {
        const sessionId = this.agent.session.header?.id;
        if (typeof sessionId !== 'string' || sessionId.length === 0)
            return 0;
        let targets;
        try {
            const active = foldUserState(this.agent.session).folded.active;
            const activeById = new Map(active.map((record) => [record.id, record]));
            targets = new Map();
            for (const id of Object.keys(allOwnership(sessionId))) {
                const record = activeById.get(id);
                if (record === undefined) {
                    targets.set(id, undefined);
                    continue;
                }
                const target = dueTargetOf(record.scheduledAt);
                if (target === undefined)
                    continue;
                targets.set(id, target);
            }
        }
        catch (error) {
            this.ctx.logger.warn(`later: 到期索引进账失败（不影响投递）: ${renderThrown(error)}`);
            return 0;
        }
        try {
            return mirrorDueIndex(sessionId, targets);
        }
        catch (error) {
            this.ctx.logger.warn(`later: 到期索引落盘失败（不影响投递）: ${renderThrown(error)}`);
            return 0;
        }
    }
    async driveOnce() {
        this.clearTimer();
        if (!this.isLive())
            return;
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
        this.reconcileDueIndex();
        if (decision.kind === 'wait') {
            if (decision.target !== undefined)
                this.arm(decision.target, now);
            return;
        }
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
                this.reconcileDueIndex();
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
    async steerPausedById(id) {
        const sessionId = this.agent.session.header?.id;
        if (typeof sessionId !== 'string' || sessionId.length === 0)
            return undefined;
        const paused = getPaused(sessionId, id);
        if (paused === undefined)
            return undefined;
        const asUser = paused.delivery === 'user';
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
    buildMessage(decision, delivery) {
        if (decision.kind === 'one-shot') {
            const records = decision.records;
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
function noticeSummary(records) {
    const tz = detectTimeZone();
    const lines = records.slice(0, 3).map((record) => `${formatHhmm(Date.parse(record.scheduledAt), tz)} · ${record.prompt}`);
    if (records.length > 3)
        lines.push(`等共 ${records.length} 条`);
    return lines.join('；');
}
