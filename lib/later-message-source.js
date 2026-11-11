export const LATER_SOURCE_VERSION = 1;
const LATER_FIELD = 'later';
function normalizeCount(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}
export function laterUserSource(input) {
    return {
        kind: 'user',
        later: {
            v: LATER_SOURCE_VERSION,
            delivery: input.delivery === 'every' ? 'every' : 'one-shot',
            count: normalizeCount(input.count),
        },
    };
}
export function readLaterMarker(source) {
    if (source === null || typeof source !== 'object')
        return undefined;
    const raw = source[LATER_FIELD];
    if (raw === null || typeof raw !== 'object')
        return undefined;
    const record = raw;
    const version = record['v'];
    if (typeof version !== 'number' || !Number.isFinite(version) || version < 1)
        return undefined;
    return {
        v: version,
        delivery: record['delivery'] === 'every' ? 'every' : 'one-shot',
        count: normalizeCount(record['count']),
    };
}
