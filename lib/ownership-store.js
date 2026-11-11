import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync, unlinkSync, readdirSync, copyFileSync, } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export function sanitizeAttachments(value) {
    if (!Array.isArray(value) || value.length === 0)
        return undefined;
    const blocks = [];
    for (const item of value) {
        if (typeof item !== 'object' || item === null)
            continue;
        const block = item;
        if (block.type !== 'image' && block.type !== 'file')
            continue;
        const ref = block.attachment;
        if (typeof ref !== 'object' || ref === null)
            continue;
        if (typeof ref.attachmentId !== 'string')
            continue;
        blocks.push(item);
    }
    return blocks.length > 0 ? blocks : undefined;
}
const CURRENT_VERSION = 3;
function stateDirOverride() {
    for (const name of ['DSH_LATER_STATE_DIR', 'DSH_SESSION_SCHEDULER_STATE_DIR']) {
        const value = process.env[name];
        if (value !== undefined && value.trim().length > 0)
            return value;
    }
    return undefined;
}
function resolveStateDir() {
    const override = stateDirOverride();
    if (override !== undefined)
        return override;
    const dshHomeEnv = process.env['DSH_HOME'];
    const home = dshHomeEnv !== undefined && dshHomeEnv.trim().length > 0 ? dshHomeEnv : join(homedir(), '.dsh');
    return join(home, 'plugin-state', 'later');
}
function legacyStateDir() {
    if (stateDirOverride() !== undefined)
        return undefined;
    const dshHomeEnv = process.env['DSH_HOME'];
    const home = dshHomeEnv !== undefined && dshHomeEnv.trim().length > 0 ? dshHomeEnv : join(homedir(), '.dsh');
    return join(home, 'plugin-state', 'session-scheduler');
}
function migrateLegacyState(newDir) {
    const oldDir = legacyStateDir();
    if (oldDir === undefined || !existsSync(oldDir))
        return;
    try {
        renameSync(oldDir, newDir);
        return;
    }
    catch {
    }
    try {
        for (const entry of readdirSync(oldDir)) {
            if (!entry.endsWith('.json'))
                continue;
            const target = join(newDir, entry);
            if (!existsSync(target))
                copyFileSync(join(oldDir, entry), target);
        }
    }
    catch (error) {
        console.warn(`[dsh-later] 旧 sidecar 目录迁移失败（旧目录保留，可手动搬移）: ${error instanceof Error ? error.message : String(error)}`);
    }
}
let cachedDir;
function stateDir() {
    if (cachedDir === undefined) {
        cachedDir = resolveStateDir();
        try {
            mkdirSync(cachedDir, { recursive: true });
            migrateLegacyState(cachedDir);
        }
        catch {
        }
    }
    return cachedDir;
}
function fileOf(sessionId) {
    const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
    return join(stateDir(), `${safe}.json`);
}
function emptyFile() {
    return { version: CURRENT_VERSION, entries: {}, paused: {} };
}
const cache = new Map();
let sidecarGeneration = 0;
export function ownershipGeneration() {
    return sidecarGeneration;
}
function readFresh(sessionId) {
    const path = fileOf(sessionId);
    let stat;
    try {
        stat = statSync(path);
    }
    catch {
        cache.delete(sessionId);
        return emptyFile();
    }
    const cached = cache.get(sessionId);
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.file;
    }
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (typeof parsed !== 'object' ||
            parsed === null ||
            (parsed.version !== 1 &&
                parsed.version !== 2 &&
                parsed.version !== 3) ||
            typeof parsed.entries !== 'object' ||
            parsed.entries === null) {
            throw new Error('unexpected shape');
        }
        const entries = {};
        for (const [id, entry] of Object.entries(parsed.entries)) {
            const attachments = sanitizeAttachments(entry.attachments);
            entries[id] = attachments === undefined ? entry : { ...entry, attachments };
        }
        const paused = {};
        for (const [uid, entry] of Object.entries(parsed.paused ?? {})) {
            const attachments = sanitizeAttachments(entry.attachments);
            paused[uid] = attachments === undefined ? entry : { ...entry, attachments };
        }
        const file = {
            version: CURRENT_VERSION,
            entries,
            paused,
        };
        cache.set(sessionId, { mtimeMs: stat.mtimeMs, size: stat.size, file });
        return file;
    }
    catch (error) {
        try {
            renameSync(path, `${path}.corrupt-${Date.now()}`);
        }
        catch {
        }
        cache.delete(sessionId);
        try {
            console.warn(`[dsh-later] 所有权 sidecar 解析失败，已按空表继续: ${error instanceof Error ? error.message : String(error)}`);
        }
        catch {
        }
        return emptyFile();
    }
}
export function allOwnership(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0)
        return {};
    return readFresh(sessionId).entries;
}
export function hasOwnership(sessionId, id) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof id !== 'string')
        return false;
    return Object.prototype.hasOwnProperty.call(readFresh(sessionId).entries, id);
}
export function getOwnership(sessionId, id) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof id !== 'string')
        return undefined;
    return readFresh(sessionId).entries[id];
}
function writeThrough(sessionId, file) {
    const path = fileOf(sessionId);
    const dir = stateDir();
    const tmp = join(dir, `.${safeName(sessionId)}.${process.pid}.${Date.now()}.tmp`);
    const payload = `${JSON.stringify(file, null, 2)}\n`;
    writeFileSync(tmp, payload, 'utf8');
    try {
        renameSync(tmp, path);
    }
    catch {
        writeFileSync(path, payload, 'utf8');
        try {
            if (existsSync(tmp))
                unlinkSync(tmp);
        }
        catch {
        }
    }
    const stat = statSync(path);
    cache.set(sessionId, { mtimeMs: stat.mtimeMs, size: stat.size, file });
    sidecarGeneration += 1;
}
function safeName(sessionId) {
    return sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
}
export function newTaskUid() {
    return globalThis.crypto?.randomUUID?.() ?? `uid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
export function recordOwnership(sessionId, id, delivery, uid, windowSeconds, attachments, scheduledAt) {
    const safeAttachments = sanitizeAttachments(attachments);
    const safeScheduledAt = validTimestamp(scheduledAt);
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof id !== 'string' || id.length === 0) {
        const bare = {
            delivery,
            createdAt: Date.now(),
            ...(uid !== undefined ? { uid } : {}),
            ...(typeof windowSeconds === 'number' ? { windowSeconds } : {}),
            ...(safeAttachments !== undefined ? { attachments: safeAttachments } : {}),
            ...(safeScheduledAt !== undefined ? { scheduledAt: safeScheduledAt } : {}),
        };
        return bare;
    }
    const file = readFresh(sessionId);
    const entries = { ...file.entries };
    const nextUid = uid ?? entries[id]?.uid;
    const nextWindow = windowSeconds ?? entries[id]?.windowSeconds;
    const nextAttachments = attachments !== undefined ? safeAttachments : entries[id]?.attachments;
    const nextScheduledAt = safeScheduledAt ?? entries[id]?.scheduledAt;
    const nextDispatchedAt = safeScheduledAt === undefined ? entries[id]?.dispatchedAt : undefined;
    const entry = {
        delivery,
        createdAt: Date.now(),
        ...(nextUid !== undefined ? { uid: nextUid } : {}),
        ...(typeof nextWindow === 'number' ? { windowSeconds: nextWindow } : {}),
        ...(nextAttachments !== undefined ? { attachments: nextAttachments } : {}),
        ...(nextScheduledAt !== undefined ? { scheduledAt: nextScheduledAt } : {}),
        ...(nextDispatchedAt !== undefined ? { dispatchedAt: nextDispatchedAt } : {}),
    };
    entries[id] = entry;
    writeThrough(sessionId, { version: CURRENT_VERSION, entries, paused: file.paused ?? {} });
    return entry;
}
function validTimestamp(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
const MAX_SIDECAR_BYTES = 8 * 1024 * 1024;
export function listOwnershipSnapshots(warn) {
    const notify = warn ?? ((message) => console.warn(`[dsh-later] ${message}`));
    const dir = stateDir();
    let names;
    try {
        names = readdirSync(dir);
    }
    catch {
        return [];
    }
    const snapshots = [];
    for (const name of names) {
        if (!name.endsWith('.json') || name.startsWith('.'))
            continue;
        const sessionId = name.slice(0, -'.json'.length);
        try {
            const path = join(dir, name);
            const stat = statSync(path);
            if (stat.size > MAX_SIDECAR_BYTES) {
                notify(`sidecar "${name}" 体积异常（${stat.size} 字节），本轮扫描跳过该会话。`);
                continue;
            }
            const file = readFresh(sessionId);
            if (Object.keys(file.entries).length === 0)
                continue;
            snapshots.push({ sessionId, entries: file.entries });
        }
        catch (error) {
            notify(`sidecar "${name}" 读取失败，本轮扫描跳过该会话: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return snapshots;
}
export function removeOwnership(sessionId, id) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof id !== 'string' || id.length === 0)
        return;
    const file = readFresh(sessionId);
    if (!Object.prototype.hasOwnProperty.call(file.entries, id))
        return;
    const entries = { ...file.entries };
    delete entries[id];
    writeThrough(sessionId, { version: CURRENT_VERSION, entries, paused: file.paused ?? {} });
}
export function mirrorDueIndex(sessionId, targets) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || targets.size === 0)
        return 0;
    const file = readFresh(sessionId);
    const entries = { ...file.entries };
    let changed = 0;
    for (const [id, target] of targets) {
        const entry = entries[id];
        if (entry === undefined)
            continue;
        if (target === undefined) {
            if (validTimestamp(entry.dispatchedAt) !== undefined)
                continue;
            entries[id] = { ...entry, dispatchedAt: Date.now() };
            changed += 1;
            continue;
        }
        const safe = validTimestamp(target);
        if (safe === undefined)
            continue;
        if (safe === entry.scheduledAt && validTimestamp(entry.dispatchedAt) === undefined)
            continue;
        const { dispatchedAt: _stale, ...rest } = entry;
        entries[id] = { ...rest, scheduledAt: safe };
        changed += 1;
    }
    if (changed === 0)
        return 0;
    writeThrough(sessionId, { version: CURRENT_VERSION, entries, paused: file.paused ?? {} });
    return changed;
}
export function findScheduleIdByUid(sessionId, uid) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof uid !== 'string')
        return undefined;
    for (const [id, entry] of Object.entries(readFresh(sessionId).entries)) {
        if (entry.uid === uid)
            return id;
    }
    return undefined;
}
export function allPaused(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0)
        return {};
    return readFresh(sessionId).paused ?? {};
}
export function getPaused(sessionId, uid) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof uid !== 'string')
        return undefined;
    return (readFresh(sessionId).paused ?? {})[uid];
}
export function findPausedByScheduleId(sessionId, scheduleId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof scheduleId !== 'string')
        return undefined;
    for (const entry of Object.values(readFresh(sessionId).paused ?? {})) {
        if (entry.lastScheduleId === scheduleId)
            return entry;
    }
    return undefined;
}
export function recordPaused(sessionId, entry) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof entry.uid !== 'string')
        return;
    const file = readFresh(sessionId);
    writeThrough(sessionId, {
        version: CURRENT_VERSION,
        entries: file.entries,
        paused: { ...(file.paused ?? {}), [entry.uid]: entry },
    });
}
export function removePaused(sessionId, uid) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof uid !== 'string')
        return;
    const file = readFresh(sessionId);
    const paused = { ...(file.paused ?? {}) };
    if (!Object.prototype.hasOwnProperty.call(paused, uid))
        return;
    delete paused[uid];
    writeThrough(sessionId, { version: CURRENT_VERSION, entries: file.entries, paused });
}
export function resetCacheForTests() {
    cache.clear();
    cachedDir = undefined;
}
