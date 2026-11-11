export function dueTargetOf(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? value : undefined;
    }
    if (typeof value !== 'string')
        return undefined;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
export function isDue(record, now) {
    const target = dueTargetOf(record?.scheduledAt);
    return target !== undefined && target <= now;
}
export function readDueIndex(entry) {
    if (entry === undefined)
        return { kind: 'unknown' };
    if (dueTargetOf(entry.dispatchedAt) !== undefined)
        return { kind: 'consumed' };
    const target = dueTargetOf(entry.scheduledAt);
    if (target === undefined)
        return { kind: 'unknown' };
    return { kind: 'due', target };
}
export function isDueIndex(entry, now) {
    const reading = readDueIndex(entry);
    return reading.kind === 'due' && reading.target <= now;
}
