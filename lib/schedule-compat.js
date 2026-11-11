import * as sched from '@deepseek-ai/dsh-schedule';
import { randomUUID } from 'node:crypto';
import { PLUGIN_KIND_RETIRED_SINCE, readKernelVersion, versionAtLeast, } from './upstream-compat.js';
const { ScheduleId } = sched;
export const SCHEDULE_TITLE_MAX = 120;
function pick(name) {
    return sched[name];
}
export function allocateScheduleIdCompat(_folded) {
    return ScheduleId(`schedule-${randomUUID()}`);
}
export function deriveScheduleTitle(prompt) {
    const normalized = prompt.trim();
    if (normalized.length === 0)
        return '定时提醒';
    if (normalized.length <= SCHEDULE_TITLE_MAX)
        return normalized;
    const clipped = normalized.slice(0, SCHEDULE_TITLE_MAX - 1);
    const lastBreak = Math.max(clipped.lastIndexOf(' '), clipped.lastIndexOf('　'));
    const body = lastBreak >= SCHEDULE_TITLE_MAX * 0.6 ? clipped.slice(0, lastBreak) : clipped;
    return `${body.trimEnd()}…`;
}
function createRecord(name, id, prompt, selector, now) {
    const fn = pick(name);
    if (typeof fn !== 'function') {
        throw new Error(`dsh-later: dsh-schedule does not export ${name} — unsupported kernel generation.`);
    }
    return fn.length >= 5
        ? fn(id, prompt, selector, now, deriveScheduleTitle(prompt))
        : fn(id, prompt, selector, now);
}
export function createAfterRecord(id, prompt, afterSeconds, now) {
    return createRecord('createAfterScheduleRecord', id, prompt, afterSeconds, now);
}
export function createAtRecord(id, prompt, scheduledAt, now) {
    return createRecord('createAtScheduleRecord', id, prompt, scheduledAt, now);
}
export function createEveryRecord(id, prompt, everySeconds, now) {
    return createRecord('createEveryScheduleRecord', id, prompt, everySeconds, now);
}
export function renderRecurringBatchFraming(reminders) {
    const render = pick('renderEveryReminderBatchFraming') ??
        pick('renderRecurringReminderBatchFraming');
    if (typeof render !== 'function') {
        throw new Error('dsh-later: dsh-schedule exposes neither renderEveryReminderBatchFraming ' +
            'nor renderRecurringReminderBatchFraming — unsupported kernel generation.');
    }
    return render(reminders);
}
let decisionCache;
let warnedFallback = false;
export function resetMessageSourceDecision() {
    decisionCache = undefined;
    warnedFallback = false;
}
export function messageSourceDecision(options = {}) {
    if (decisionCache !== undefined)
        return decisionCache;
    const readKernel = options.readKernel ?? readKernelVersion;
    const kernel = readKernel();
    if (kernel !== undefined) {
        const retired = versionAtLeast(kernel.version, PLUGIN_KIND_RETIRED_SINCE);
        if (retired !== undefined) {
            decisionCache = {
                kind: retired ? 'schedule' : 'plugin',
                via: 'kernel-version',
                detail: `内核 ${kernel.version}（读自 ${kernel.specifier}），plugin kind ${retired ? '已淘汰' : '仍受支持'}（阈值 ${PLUGIN_KIND_RETIRED_SINCE}）`,
            };
            return decisionCache;
        }
    }
    const hasModernRenderName = options.hasModernRenderName
        ?? (() => pick('renderRecurringReminderBatchFraming') !== undefined);
    const kind = hasModernRenderName() ? 'schedule' : 'plugin';
    if (!warnedFallback) {
        warnedFallback = true;
        const warn = options.warn ?? ((message) => console.warn(message));
        warn('dsh-later: 读不到内核版本，退回符号探测判定消息 source kind。在 0.1.7-rc.1 这类'
            + '「旧符号仍在、plugin kind 已淘汰」的组合代上这会选错（issue #75），表现为提醒到点'
            + '不投递且无报错。排查：确认插件的解析根能解析到 @deepseek-ai/dsh 或 dsh-schedule 的 package.json。');
    }
    const decision = {
        kind,
        via: 'symbol-probe',
        detail: `符号探测（内核版本读不到，阈值 ${PLUGIN_KIND_RETIRED_SINCE} 无法应用）`,
    };
    decisionCache = decision;
    return decision;
}
export function scheduleMessageSource(boundedSummary) {
    const base = { form: 'notice', summary: boundedSummary };
    const { kind } = messageSourceDecision();
    return kind === 'schedule'
        ? { kind, ...base }
        : { kind, plugin: PLUGIN_LABEL, ...base };
}
export function asLegacySchedules(folded) {
    return folded;
}
const PLUGIN_LABEL = '定时提醒';
export function toChangePayload(record) {
    return record;
}
