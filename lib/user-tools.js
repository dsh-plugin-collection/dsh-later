import * as schedNs from '@deepseek-ai/dsh-schedule';
import { resolveEveryOccurrence } from '@deepseek-ai/dsh-schedule';
import { ScheduleId, ScheduleInputError } from '@deepseek-ai/dsh-schedule';
function pickExport(name) {
    return schedNs[name];
}
const upstreamFold = pickExport('foldScheduleEvents');
const upstreamView = pickExport('scheduleView');
const decodeChange = pickExport('decodeScheduleChange');
function decodeChangeCompat(data) {
    const upstream = decodeChange;
    if (upstream !== undefined)
        return upstream(data);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new TypeError('schedule change must be an object');
    }
    const payload = data;
    const operation = payload['operation'];
    if (operation === 'create') {
        const raw = payload['schedule'];
        const record = decodeRecordTolerant(raw);
        if (typeof record?.id !== 'string') {
            throw new TypeError('schedule change create requires a record with a string id');
        }
        return { operation: 'create', schedule: record };
    }
    if (operation === 'delete') {
        const id = payload['id'];
        if (typeof id !== 'string')
            throw new TypeError('schedule change delete requires a string id');
        return { operation: 'delete', id };
    }
    if (operation === 'dispatch') {
        const id = payload['id'];
        if (typeof id !== 'string')
            throw new TypeError('schedule change dispatch requires a string id');
        const acceptedAt = payload['acceptedAt'];
        return typeof acceptedAt === 'string'
            ? { operation: 'dispatch', id, acceptedAt }
            : { operation: 'dispatch', id };
    }
    throw new TypeError(`unknown schedule change operation ${String(operation)}`);
}
function scheduleViewCompat(record, now) {
    if (upstreamView !== undefined)
        return upstreamView(record, now);
    return Object.freeze({
        ...record,
        state: now >= Date.parse(record.scheduledAt) ? 'overdue' : 'scheduled',
        deliveryMode: 'host',
    });
}
function foldScheduleEventsCompat(events, inheritedEventCount = 0) {
    if (upstreamFold !== undefined)
        return upstreamFold(events, inheritedEventCount);
    const start = Number.isSafeInteger(inheritedEventCount) && inheritedEventCount >= 0 && inheritedEventCount <= events.length
        ? inheritedEventCount
        : events.length;
    const active = new Map();
    const seen = new Set();
    for (const event of events.slice(start)) {
        if (event.type !== 'schedule/change')
            continue;
        let change;
        try {
            change = decodeChangeCompat(event.data);
        }
        catch {
            continue;
        }
        if (change.operation === 'create') {
            if (seen.has(change.schedule.id))
                continue;
            seen.add(change.schedule.id);
            active.set(change.schedule.id, change.schedule);
            continue;
        }
        if (change.operation === 'delete') {
            active.delete(change.id);
            continue;
        }
        const record = active.get(change.id);
        if (record === undefined)
            continue;
        if (record.kind !== 'every') {
            active.delete(change.id);
            continue;
        }
        const acceptedAt = change.acceptedAt;
        if (acceptedAt === undefined)
            continue;
        const occurrence = resolveEveryOccurrence(record, Date.parse(acceptedAt));
        if (occurrence.nextScheduledAt === undefined)
            active.delete(change.id);
        else
            active.set(change.id, Object.freeze({ ...record, scheduledAt: occurrence.nextScheduledAt }));
    }
    return { active: [...active.values()], seenIds: [...seen] };
}
export function foldScheduleEventsLikeUpstream(events, inheritedEventCount) {
    return foldScheduleEventsCompat(events, inheritedEventCount ?? 0);
}
import { allocateScheduleIdCompat as allocateScheduleId, decodeRecordTolerant, createAfterRecord as createAfterScheduleRecord, createAtRecord as createAtScheduleRecord, createEveryRecord as createEveryScheduleRecord, toChangePayload, asLegacySchedules, } from './schedule-compat.js';
import { OWNED_EVENT } from './domain.js';
import { hostDictFor, hostFormat } from './locales/host.js';
import { allOwnership, findScheduleIdByUid, getOwnership, getPaused, ownershipGeneration, newTaskUid, recordOwnership, recordPaused, removeOwnership, removePaused, sanitizeAttachments, } from './ownership-store.js';
import { canonicalInstantString, canonicalLocalClock, canonicalLocalDate, detectTimeZone, } from './time-utils.js';
import { epochFromLocal } from './smart-window.js';
import { readFoldInput, readLogCursor } from './upstream-compat.js';
export const DEFAULT_MAX_SCHEDULES = 100;
export const DEFAULT_MAX_PROMPT_CHARS = 1000;
let hostLocaleStack = [];
export function currentHostLocale() {
    return hostLocaleStack.length > 0 ? hostLocaleStack[hostLocaleStack.length - 1] : undefined;
}
export function enterHostLocale(locale) {
    hostLocaleStack.push(locale ?? 'zh');
    let popped = false;
    return () => {
        if (popped)
            return;
        popped = true;
        hostLocaleStack.pop();
    };
}
export function resetHostLocaleForTest() {
    hostLocaleStack = [];
}
function hostT() {
    return hostDictFor(currentHostLocale());
}
function hostTf(key, params) {
    return hostFormat(hostT()[key], params);
}
export function resolvePromptLimits(settings) {
    const allowLong = settings?.allowLongPrompts === true;
    const raw = settings?.maxPromptChars;
    const valid = typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 && Math.floor(raw) === raw;
    if (allowLong && valid)
        return { allowLong: true, maxChars: raw };
    return { allowLong: false, maxChars: DEFAULT_MAX_PROMPT_CHARS };
}
export function validatePrompt(raw, limits) {
    const prompt = typeof raw === 'string' ? raw : '';
    const trimmed = prompt.trim();
    if (trimmed.length === 0) {
        return { ok: false, code: 'invalid_prompt', message: hostT().errToolPromptEmpty };
    }
    if (trimmed.length > limits.maxChars) {
        return {
            ok: false,
            code: 'invalid_prompt',
            message: hostTf('errToolPromptTooLong', { maxChars: limits.maxChars }),
        };
    }
    return { ok: true, value: trimmed };
}
export function validateCreateInput(input, limits = { allowLong: false, maxChars: DEFAULT_MAX_PROMPT_CHARS }) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { ok: false, code: 'invalid_rule', message: hostT().errToolCreateNotObject };
    }
    const args = input;
    const promptResult = validatePrompt(args['prompt'], limits);
    if (!promptResult.ok)
        return promptResult;
    const trimmed = promptResult.value;
    const selectorCount = Number(args['after_seconds'] !== undefined) +
        Number(args['at'] !== undefined) +
        Number(args['every_seconds'] !== undefined);
    if (selectorCount !== 1) {
        return {
            ok: false,
            code: 'invalid_selector',
            message: hostT().errToolSelectorExactlyOne,
        };
    }
    const time_zone = typeof args['time_zone'] === 'string' && args['time_zone'].length > 0
        ? args['time_zone']
        :
            detectTimeZone();
    if (!isValidIanaZone(time_zone)) {
        return { ok: false, code: 'invalid_time_zone', message: hostT().errToolTimeZoneInvalid };
    }
    let atNormalized;
    if (args['at'] !== undefined) {
        const at = args['at'];
        if (typeof at === 'string') {
            atNormalized = canonicalInstantString(at);
            if (atNormalized === undefined) {
                return {
                    ok: false,
                    code: 'invalid_rule',
                    message: hostT().errToolAtNeedsZone,
                };
            }
        }
        else if (typeof at === 'object' && at !== null && !Array.isArray(at)) {
            const obj = at;
            if (typeof obj['date'] !== 'string' || typeof obj['time'] !== 'string' || typeof obj['time_zone'] !== 'string') {
                return { ok: false, code: 'invalid_rule', message: hostT().errToolAtObjectMissing };
            }
            const date = canonicalLocalDate(obj['date']);
            if (date === undefined) {
                return { ok: false, code: 'invalid_rule', message: hostT().errToolAtBadDate };
            }
            const time = canonicalLocalClock(obj['time']);
            if (time === undefined) {
                return {
                    ok: false,
                    code: 'invalid_rule',
                    message: hostT().errToolAtBadTime,
                };
            }
            if (!isValidIanaZone(obj['time_zone'])) {
                return { ok: false, code: 'invalid_time_zone', message: hostT().errToolAtTimeZoneInvalid };
            }
            if (epochFromLocal(date, time, obj['time_zone']) === undefined) {
                return {
                    ok: false,
                    code: 'invalid_rule',
                    message: hostTf('errToolAtLocalGap', {
                        date,
                        time,
                        timeZone: String(obj['time_zone']),
                    }),
                };
            }
            atNormalized = { date, time, time_zone: obj['time_zone'] };
        }
        else {
            return { ok: false, code: 'invalid_rule', message: hostT().errToolAtShape };
        }
    }
    return { ok: true, value: { prompt: trimmed, time_zone, ...remainingSelectors(args, atNormalized) } };
}
function remainingSelectors(args, at) {
    const out = {};
    if (args['after_seconds'] !== undefined)
        out['after_seconds'] = args['after_seconds'];
    if (at !== undefined)
        out['at'] = at;
    if (args['every_seconds'] !== undefined)
        out['every_seconds'] = args['every_seconds'];
    return out;
}
export function isValidIanaZone(value) {
    if (typeof value !== 'string' || value.length === 0)
        return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
    }
    catch {
        return false;
    }
}
export function foldOwnedIds(events) {
    const owned = new Set();
    for (const event of events) {
        if (event.type !== OWNED_EVENT)
            continue;
        const data = event.data;
        if (typeof data !== 'object' || data === null || data.version !== 1)
            continue;
        if (data.operation === 'add')
            owned.add(data.id);
        else if (data.operation === 'remove')
            owned.delete(data.id);
    }
    return owned;
}
export function foldOwnedDelivery(events) {
    const map = new Map();
    for (const event of events) {
        if (event.type !== OWNED_EVENT)
            continue;
        const data = event.data;
        if (typeof data !== 'object' || data === null || data.version !== 1)
            continue;
        if (data.operation === 'remove') {
            map.delete(data.id);
            continue;
        }
        map.set(data.id, data.delivery ?? 'context');
    }
    return map;
}
const foldCache = new WeakMap();
export function foldUserState(session) {
    const cursor = readLogCursor(session);
    const generation = ownershipGeneration();
    const cached = foldCache.get(session);
    if (cached !== undefined &&
        cached.offset === cursor.offset &&
        cached.tail === cursor.tail &&
        cached.generation === generation) {
        return cached.state;
    }
    const { events, inheritedEventCount } = readFoldInput(session);
    const folded = asLegacySchedules(foldScheduleEventsCompat(events, inheritedEventCount));
    const sessionId = session.header?.id;
    const owned = foldOwnedIds(events);
    const delivery = new Map(foldOwnedDelivery(events));
    if (typeof sessionId === 'string' && sessionId.length > 0) {
        for (const [id, entry] of Object.entries(allOwnership(sessionId))) {
            owned.add(id);
            if (!delivery.has(id))
                delivery.set(id, entry.delivery);
        }
    }
    const state = {
        folded,
        owned,
        delivery,
    };
    foldCache.set(session, { offset: cursor.offset, tail: cursor.tail, generation, state });
    return state;
}
export function internalError() {
    return { ok: false, code: 'internal_error', message: hostT().errToolInternalFailed };
}
export function persistenceError() {
    return {
        ok: false,
        code: 'persistence_uncertain',
        message: hostT().errToolPersistenceUnconfirmed,
    };
}
export function toInputError(error) {
    if (error instanceof ScheduleInputError) {
        return { ok: false, code: error.code, message: error.message };
    }
    return internalError();
}
export function serializeScheduleView(view) {
    return {
        id: view.id,
        kind: view.kind,
        prompt: view.prompt,
        ...(view.kind === 'after' ? { after_seconds: view.afterSeconds } : {}),
        ...(view.kind === 'every' ? { every_seconds: view.everySeconds } : {}),
        scheduled_at: view.scheduledAt,
        state: view.state,
        delivery_mode: 'session-local',
        source: 'user-tool',
    };
}
const tails = new WeakMap();
export function runUserScheduleTransaction(agent, operation) {
    const run = (tails.get(agent) ?? Promise.resolve()).then(operation);
    const tail = run.then(() => undefined, () => undefined);
    tails.set(agent, tail);
    tail.then(() => {
        if (tails.get(agent) === tail)
            tails.delete(agent);
    });
    return run;
}
async function flushSession(ctx, session) {
    try {
        return (await ctx.sessions.flush(session)) === true;
    }
    catch {
        return false;
    }
}
function buildScheduleRecord(input, id, now) {
    if (input.at !== undefined) {
        return createAtScheduleRecord(id, input.prompt, input.at, now);
    }
    if (input.after_seconds !== undefined) {
        return createAfterScheduleRecord(id, input.prompt, input.after_seconds, now);
    }
    return createEveryScheduleRecord(id, input.prompt, input.every_seconds, now);
}
export async function userScheduleCreate(input, agent, ctx, maxSchedules = DEFAULT_MAX_SCHEDULES, options, limits) {
    const leaveLocale = enterHostLocale(options?.locale);
    try {
        const validated = validateCreateInput(input, limits);
        if (!validated.ok)
            return validated;
        const trustedDelivery = options?.trustedDelivery === 'user' ? 'user' : 'context';
        const trustedAttachments = sanitizeAttachments(options?.attachments);
        return runUserScheduleTransaction(agent, async () => {
            const now = Date.now();
            let folded;
            let owned;
            try {
                const state = foldUserState(agent.session);
                folded = state.folded;
                owned = state.owned;
            }
            catch {
                return { ok: false, code: 'internal_error', message: hostT().errToolLogUnreadable };
            }
            const activeCount = folded.active.filter((record) => owned.has(record.id)).length;
            if (activeCount >= maxSchedules) {
                return {
                    ok: false,
                    code: 'quota_exceeded',
                    message: hostTf('errToolQuotaFull', { maxSchedules }),
                };
            }
            const id = allocateScheduleId(folded);
            let record;
            try {
                record = buildScheduleRecord(validated.value, id, now);
            }
            catch (error) {
                return toInputError(error);
            }
            const sessionId = agent.session.header?.id;
            recordOwnership(sessionId, id, trustedDelivery, newTaskUid(), record.kind === 'after' ? record.afterSeconds : undefined, trustedAttachments, Date.parse(record.scheduledAt));
            try {
                agent.session.append('schedule/change', {
                    version: 1,
                    operation: 'create',
                    schedule: toChangePayload(record),
                });
            }
            catch {
                removeOwnership(sessionId, id);
                return internalError();
            }
            if (!(await flushSession(ctx, agent.session))) {
                removeOwnership(sessionId, id);
                return persistenceError();
            }
            const view = scheduleViewCompat(record, Date.now());
            return {
                ok: true,
                ...serializeScheduleView(view),
            };
        });
    }
    finally {
        leaveLocale();
    }
}
export async function userScheduleList(agent, locale) {
    const leaveLocale = enterHostLocale(locale);
    try {
        return runUserScheduleTransaction(agent, async () => {
            let folded;
            let owned;
            try {
                const state = foldUserState(agent.session);
                folded = state.folded;
                owned = state.owned;
            }
            catch {
                return { ok: false, code: 'internal_error', message: hostT().errToolLogUnreadable };
            }
            const now = Date.now();
            const schedules = folded.active
                .filter((record) => owned.has(record.id))
                .map((record) => serializeScheduleView(scheduleViewCompat(record, now)));
            return { ok: true, schedules };
        });
    }
    finally {
        leaveLocale();
    }
}
export async function userScheduleDelete(id, agent, ctx, locale) {
    const leaveLocale = enterHostLocale(locale);
    try {
        if (typeof id !== 'string' || id.length === 0 || id.trim() !== id) {
            return { ok: false, code: 'invalid_rule', message: hostT().errToolScheduleIdInvalid };
        }
        return runUserScheduleTransaction(agent, async () => {
            const sessionId = agent.session.header?.id;
            let folded;
            try {
                folded = foldUserState(agent.session).folded;
            }
            catch {
                return { ok: false, code: 'internal_error', message: hostT().errToolLogUnreadable };
            }
            const activeId = resolveActiveScheduleId(sessionId, id);
            if (folded.active.some((record) => record.id === activeId)) {
                try {
                    agent.session.append('schedule/change', {
                        version: 1,
                        operation: 'delete',
                        id: ScheduleId(activeId),
                    });
                }
                catch {
                    return internalError();
                }
                if (!(await flushSession(ctx, agent.session)))
                    return persistenceError();
                removeOwnership(sessionId, activeId);
                return { ok: true, id, deleted: true };
            }
            const paused = getPaused(sessionId, id);
            if (paused !== undefined) {
                removePaused(sessionId, id);
                return { ok: true, id, deleted: true };
            }
            return { ok: true, id, deleted: false, code: 'schedule_not_found' };
        });
    }
    finally {
        leaveLocale();
    }
}
export async function userScheduleEditPrompt(id, newPrompt, agent, ctx, limits = { allowLong: false, maxChars: DEFAULT_MAX_PROMPT_CHARS }, locale) {
    const leaveLocale = enterHostLocale(locale);
    try {
        if (typeof id !== 'string' || id.length === 0 || id.trim() !== id) {
            return { ok: false, code: 'invalid_rule', message: hostT().errToolScheduleIdInvalid };
        }
        const promptResult = validatePrompt(newPrompt, limits);
        if (!promptResult.ok)
            return promptResult;
        const trimmed = promptResult.value;
        return runUserScheduleTransaction(agent, async () => {
            const sessionId = agent.session.header?.id;
            const scheduleId = ScheduleId(resolveActiveScheduleId(sessionId, id));
            let folded;
            let deliveries;
            try {
                const state = foldUserState(agent.session);
                folded = state.folded;
                deliveries = state.delivery;
            }
            catch {
                return { ok: false, code: 'internal_error', message: hostT().errToolLogUnreadable };
            }
            const existing = folded.active.find((record) => record.id === scheduleId);
            if (existing === undefined) {
                const paused = getPaused(sessionId, id);
                if (paused !== undefined) {
                    recordPaused(sessionId, { ...paused, prompt: trimmed });
                    return {
                        ok: true,
                        ...serializeScheduleView(scheduleViewCompat({
                            id: paused.lastScheduleId,
                            kind: 'after',
                            prompt: trimmed,
                            afterSeconds: paused.originalAfterSeconds ?? paused.remainingSeconds,
                            scheduledAt: paused.originalScheduledAt,
                        }, Date.now())),
                    };
                }
                return {
                    ok: false,
                    code: 'schedule_not_found',
                    message: hostTf('errToolScheduleNotFoundById', { id }),
                };
            }
            if (existing.kind === 'at' &&
                Date.parse(existing.scheduledAt) <= Date.now()) {
                return {
                    ok: false,
                    code: 'already_overdue',
                    message: hostTf('errToolEditOverdue', { id: scheduleId }),
                };
            }
            const now = Date.now();
            let record;
            try {
                if (existing.kind === 'after') {
                    record = createAfterScheduleRecord(allocateScheduleId(folded), trimmed, existing.afterSeconds, now);
                }
                else if (existing.kind === 'at') {
                    record = createAtScheduleRecord(allocateScheduleId(folded), trimmed, existing.scheduledAt, now);
                }
                else {
                    const everySeconds = existing.kind === 'every' && typeof existing.everySeconds === 'number'
                        ? existing.everySeconds
                        : 300;
                    record = createEveryScheduleRecord(allocateScheduleId(folded), trimmed, everySeconds, now);
                }
            }
            catch (error) {
                return toInputError(error);
            }
            const delivery = deliveries.get(scheduleId) ?? 'context';
            const previousEntry = getOwnership(sessionId, scheduleId);
            recordOwnership(sessionId, record.id, delivery, previousEntry?.uid, record.kind === 'after' ? record.afterSeconds : undefined, previousEntry?.attachments, Date.parse(record.scheduledAt));
            try {
                agent.session.append('schedule/change', { version: 1, operation: 'delete', id: scheduleId });
                agent.session.append('schedule/change', { version: 1, operation: 'create', schedule: toChangePayload(record) });
            }
            catch {
                removeOwnership(sessionId, record.id);
                return internalError();
            }
            if (!(await flushSession(ctx, agent.session))) {
                removeOwnership(sessionId, record.id);
                if (previousEntry !== undefined) {
                    recordOwnership(sessionId, scheduleId, previousEntry.delivery, previousEntry.uid, previousEntry.windowSeconds, previousEntry.attachments, previousEntry.scheduledAt);
                }
                return persistenceError();
            }
            removeOwnership(sessionId, scheduleId);
            const view = scheduleViewCompat(record, Date.now());
            return { ok: true, ...serializeScheduleView(view) };
        });
    }
    finally {
        leaveLocale();
    }
}
function resolveActiveScheduleId(sessionId, id) {
    if (getOwnership(sessionId, id) !== undefined)
        return id;
    const byUid = findScheduleIdByUid(sessionId, id);
    return byUid ?? id;
}
export async function userSchedulePause(id, agent, ctx, locale) {
    const leaveLocale = enterHostLocale(locale);
    try {
        if (typeof id !== 'string' || id.length === 0 || id.trim() !== id) {
            return { ok: false, code: 'invalid_rule', message: hostT().errToolScheduleIdInvalid };
        }
        return runUserScheduleTransaction(agent, async () => {
            const sessionId = agent.session.header?.id;
            let folded;
            let owned;
            let deliveryMap;
            try {
                const state = foldUserState(agent.session);
                folded = state.folded;
                owned = state.owned;
                deliveryMap = state.delivery;
            }
            catch {
                return { ok: false, code: 'internal_error', message: hostT().errToolLogUnreadable };
            }
            const scheduleId = resolveActiveScheduleId(sessionId, id);
            const existing = folded.active.find((record) => record.id === scheduleId);
            if (existing === undefined || !owned.has(scheduleId)) {
                return {
                    ok: false,
                    code: 'schedule_not_found',
                    message: hostTf('errToolPauseNotFoundById', { id }),
                };
            }
            if (existing.kind !== 'after') {
                return { ok: false, code: 'unsupported_kind', message: hostT().errToolPauseUnsupportedKind };
            }
            const now = Date.now();
            const target = Date.parse(existing.scheduledAt);
            if (!Number.isFinite(target) || target <= now) {
                return {
                    ok: false,
                    code: 'already_overdue',
                    message: hostT().errToolPauseOverdue,
                };
            }
            const remainingSeconds = Math.max(1, Math.ceil((target - now) / 1000));
            const ownership = getOwnership(sessionId, scheduleId);
            const uid = ownership?.uid ?? newTaskUid();
            const delivery = deliveryMap.get(scheduleId) ?? ownership?.delivery ?? 'context';
            if (ownership?.uid === undefined) {
                recordOwnership(sessionId, scheduleId, delivery, uid, ownership?.windowSeconds, ownership?.attachments, ownership?.scheduledAt ?? target);
            }
            const windowSeconds = ownership?.windowSeconds ?? existing.afterSeconds;
            const pausedEntry = {
                uid,
                prompt: existing.prompt,
                delivery,
                kind: 'after',
                remainingSeconds,
                originalScheduledAt: existing.scheduledAt,
                ...(windowSeconds !== undefined ? { originalAfterSeconds: windowSeconds } : {}),
                lastScheduleId: scheduleId,
                pausedAt: now,
                ...(ownership?.attachments !== undefined ? { attachments: ownership.attachments } : {}),
            };
            recordPaused(sessionId, pausedEntry);
            try {
                agent.session.append('schedule/change', {
                    version: 1,
                    operation: 'delete',
                    id: ScheduleId(scheduleId),
                });
            }
            catch {
                removePaused(sessionId, uid);
                return internalError();
            }
            if (!(await flushSession(ctx, agent.session))) {
                removePaused(sessionId, uid);
                return persistenceError();
            }
            removeOwnership(sessionId, scheduleId);
            return {
                ok: true,
                uid,
                schedule_id: scheduleId,
                remaining_seconds: remainingSeconds,
                scheduled_at: existing.scheduledAt,
            };
        });
    }
    finally {
        leaveLocale();
    }
}
export async function userScheduleResume(uid, agent, ctx, maxSchedules = DEFAULT_MAX_SCHEDULES, locale) {
    const leaveLocale = enterHostLocale(locale);
    try {
        if (typeof uid !== 'string' || uid.length === 0 || uid.trim() !== uid) {
            return { ok: false, code: 'invalid_rule', message: hostT().errToolUidInvalid };
        }
        return runUserScheduleTransaction(agent, async () => {
            const sessionId = agent.session.header?.id;
            const paused = getPaused(sessionId, uid);
            if (paused === undefined) {
                return {
                    ok: false,
                    code: 'not_paused',
                    message: hostTf('errToolResumeNotFound', { uid }),
                };
            }
            let folded;
            let owned;
            try {
                const state = foldUserState(agent.session);
                folded = state.folded;
                owned = state.owned;
            }
            catch {
                return { ok: false, code: 'internal_error', message: hostT().errToolLogUnreadable };
            }
            const activeCount = folded.active.filter((record) => owned.has(record.id)).length;
            if (activeCount >= maxSchedules) {
                return {
                    ok: false,
                    code: 'quota_exceeded',
                    message: hostTf('errToolQuotaFull', { maxSchedules }),
                };
            }
            const now = Date.now();
            let record;
            try {
                record = createAfterScheduleRecord(ScheduleId(allocateScheduleId(folded)), paused.prompt, Math.max(1, paused.remainingSeconds), now);
            }
            catch (error) {
                return toInputError(error);
            }
            removePaused(sessionId, uid);
            recordOwnership(sessionId, record.id, paused.delivery, uid, paused.originalAfterSeconds ?? paused.remainingSeconds, paused.attachments, Date.parse(record.scheduledAt));
            try {
                agent.session.append('schedule/change', {
                    version: 1,
                    operation: 'create',
                    schedule: toChangePayload(record),
                });
            }
            catch {
                removeOwnership(sessionId, record.id);
                recordPaused(sessionId, paused);
                return internalError();
            }
            if (!(await flushSession(ctx, agent.session))) {
                removeOwnership(sessionId, record.id);
                recordPaused(sessionId, paused);
                return persistenceError();
            }
            return {
                ok: true,
                uid,
                schedule_id: record.id,
                remaining_seconds: Math.max(1, paused.remainingSeconds),
            };
        });
    }
    finally {
        leaveLocale();
    }
}
