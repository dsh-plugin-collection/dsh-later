import { z } from 'zod';
import * as schedNs from '@deepseek-ai/dsh-schedule';
import { resolveEveryOccurrence } from '@deepseek-ai/dsh-schedule';
function pickExport(name) {
    return schedNs[name];
}
const upstreamDecodeChange = pickExport('decodeScheduleChange');
const upstreamDecodeRecord = pickExport('decodeScheduleRecord');
function decodeScheduleChangeCompat(data) {
    const upstream = upstreamDecodeChange;
    if (upstream !== undefined)
        return upstream(data);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new TypeError('schedule change must be an object');
    }
    const payload = data;
    const operation = payload['operation'];
    if (operation === 'create') {
        const raw = payload['schedule'];
        const record = upstreamDecodeRecord !== undefined ? upstreamDecodeRecord(raw) : raw;
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
export const __decodeScheduleChangeCompatForTest = decodeScheduleChangeCompat;
import { OWNED_EVENT, PROJECTION_KEY } from './domain.js';
import { allOwnership, allPaused, findPausedByScheduleId, getOwnership, hasOwnership, } from './ownership-store.js';
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
let imageHostPathResolver;
export function setImageHostPathResolver(resolver) {
    imageHostPathResolver = resolver;
}
function imageHostPathOf(ref) {
    if (imageHostPathResolver === undefined)
        return undefined;
    try {
        const path = imageHostPathResolver(ref);
        return typeof path === 'string' && path.length > 0 ? path : undefined;
    }
    catch {
        return undefined;
    }
}
const MAX_WIRE_ATTACHMENTS = 8;
function attachmentWireOf(list) {
    if (list === undefined || list.length === 0)
        return {};
    const mapped = list.map((block) => {
        if (block.type === 'image') {
            const ref = block.attachment;
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
    attachments: z.array(wireAttachmentSchema).optional(),
    attachments_total: z.number().optional(),
})
    .strict();
export const userSchedulesSchema = z
    .object({
    schedules: z.array(wireItemSchema),
})
    .strict();
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
    sessionId: z.string(),
    owned: z.array(z.string()),
    active: z.array(scheduleRecordStateSchema),
    seedSeq: z.number(),
    paused: z.array(pausedStateSchema).default([]),
});
function pausedFromSidecar(sessionId) {
    if (sessionId.length === 0)
        return [];
    return Object.values(allPaused(sessionId));
}
function normalizeInheritedCount(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}
export function initUserScheduleProjection(header, inheritedEventCount) {
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
function wireItemOf(record, sessionId) {
    const ownership = sessionId.length > 0 ? getOwnership(sessionId, record.id) : undefined;
    const uid = ownership?.uid;
    const windowSeconds = ownership?.windowSeconds;
    const kind = record.kind === 'after' || record.kind === 'at' ? record.kind : 'every';
    const everySeconds = record.kind === 'every' && typeof record.everySeconds === 'number'
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
        ...attachmentWireOf(ownership?.attachments),
    };
}
function pausedWireItemOf(entry) {
    const windowSec = entry.originalAfterSeconds ?? entry.remainingSeconds;
    return {
        id: entry.uid,
        kind: 'after',
        prompt: entry.prompt,
        after_seconds: windowSec,
        window_seconds: windowSec,
        scheduled_at: entry.originalScheduledAt,
        delivery_mode: 'session-local',
        status: 'paused',
        remaining_seconds: entry.remainingSeconds,
        paused_at: new Date(entry.pausedAt).toISOString(),
        schedule_id: entry.lastScheduleId,
        ...attachmentWireOf(entry.attachments),
    };
}
function advanceEvery(record, acceptedAt) {
    if (record.kind !== 'every')
        return record;
    const occurrence = resolveEveryOccurrence(record, Date.parse(acceptedAt));
    if (occurrence.nextScheduledAt === undefined)
        return undefined;
    return { ...record, scheduledAt: occurrence.nextScheduledAt };
}
export function applyUserScheduleProjection(state, event) {
    if (seedIsBefore(state, event))
        return state;
    if (event.type === 'session/end-seed')
        return state;
    if (event.type === OWNED_EVENT) {
        const data = event.data;
        if (typeof data !== 'object' || data === null || data.version !== 1)
            return state;
        if (data.operation === 'add') {
            if (state.owned.includes(data.id))
                return state;
            return {
                sessionId: state.sessionId,
                owned: [...state.owned, data.id],
                active: state.active,
                seedSeq: state.seedSeq,
                paused: state.paused,
            };
        }
        if (data.operation === 'remove') {
            if (!state.owned.includes(data.id))
                return state;
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
        }
        catch {
            return state;
        }
        switch (change.operation) {
            case 'create': {
                const record = change.schedule;
                let owned = state.owned;
                if (!owned.includes(record.id) && state.sessionId.length > 0 && hasOwnership(state.sessionId, record.id)) {
                    owned = [...owned, record.id];
                }
                const paused = state.sessionId.length > 0
                    ? pausedFromSidecar(state.sessionId)
                    : state.paused;
                const withCreated = typeof event.time === 'number' ? { ...record, createdAt: event.time } : record;
                const existing = state.active.find((entry) => entry.id === record.id);
                if (existing === withCreated && owned === state.owned && paused === state.paused)
                    return state;
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
                    if (state.sessionId.length > 0) {
                        const paused = pausedFromSidecar(state.sessionId);
                        const linked = findPausedByScheduleId(state.sessionId, change.id) !== undefined;
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
                const owned = state.owned.filter((id) => id !== change.id);
                const active = state.active.filter((entry) => entry.id !== change.id);
                const paused = state.sessionId.length > 0 ? pausedFromSidecar(state.sessionId) : state.paused;
                if (owned === state.owned && active === state.active && paused === state.paused)
                    return state;
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
                if (current === undefined)
                    return state;
                let nextActive;
                if (change.acceptedAt !== undefined) {
                    const advanced = advanceEvery(current, change.acceptedAt);
                    const next = advanced === undefined ? undefined : { ...advanced, createdAt: current.createdAt };
                    if (next === undefined) {
                        nextActive = state.active.filter((entry) => entry.id !== change.id);
                    }
                    else {
                        nextActive = state.active.map((entry) => (entry.id === change.id ? next : entry));
                    }
                }
                else {
                    nextActive = state.active.filter((entry) => entry.id !== change.id);
                }
                if (nextActive === state.active)
                    return state;
                return {
                    sessionId: state.sessionId,
                    owned: state.owned,
                    active: nextActive,
                    seedSeq: state.seedSeq,
                    paused: state.paused,
                };
            }
            default:
                return state;
        }
    }
    return state;
}
function seedIsBefore(state, event) {
    return state.seedSeq >= 0 && typeof event.seq === 'number' && event.seq < state.seedSeq;
}
export function viewUserScheduleProjection(state) {
    const active = state.active
        .filter((record) => state.owned.includes(record.id))
        .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
        .map((record) => wireItemOf(record, state.sessionId));
    const live = state.sessionId.length > 0 ? pausedFromSidecar(state.sessionId) : state.paused;
    const paused = live.map(pausedWireItemOf);
    return { schedules: [...active, ...paused] };
}
export const userSchedulesProjectionUnit = {
    key: PROJECTION_KEY,
    stateSchema: userSchedulesStateSchema,
    init: initUserScheduleProjection,
    apply: applyUserScheduleProjection,
    wire: {
        viewSchema: userSchedulesSchema,
        view: viewUserScheduleProjection,
    },
    stateVersion: 5,
};
