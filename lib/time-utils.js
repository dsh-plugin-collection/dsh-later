export function detectTimeZone() {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return tz?.length ? tz : 'UTC';
    }
    catch {
        return 'UTC';
    }
}
export function formatRelative(epoch, now = Date.now(), locale = 'zh') {
    const diff = epoch - now;
    if (locale === 'en') {
        if (diff < 0)
            return 'overdue';
        if (diff < MINUTE_MS)
            return 'sending soon';
        const minutes = Math.round(diff / MINUTE_MS);
        if (minutes < 60)
            return `in ~${minutes} min`;
        const hours = Math.floor(minutes / 60);
        const restMinutes = minutes % 60;
        if (hours < 24) {
            return restMinutes === 0 ? `in ~${hours} h` : `in ~${hours} h ${restMinutes} min`;
        }
        const days = Math.floor(hours / 24);
        return `in ~${days} days`;
    }
    if (diff < 0)
        return '已到期';
    if (diff < MINUTE_MS)
        return '即将发送';
    const minutes = Math.round(diff / MINUTE_MS);
    if (minutes < 60)
        return `约 ${minutes} 分钟后`;
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    if (hours < 24) {
        return restMinutes === 0 ? `约 ${hours} 小时后` : `约 ${hours} 小时 ${restMinutes} 分后`;
    }
    const days = Math.floor(hours / 24);
    return `约 ${days} 天后`;
}
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export function formatAbsolute(epoch, timeZone, locale = 'zh') {
    const formatter = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
        timeZone,
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });
    return formatter.format(epoch).replace(/\s+/g, ' ');
}
export function formatHhmm(epoch, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-GB-u-ca-iso8601-nu-latn', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });
    return formatter.format(epoch);
}
export function formatCountdown(epoch, now = Date.now()) {
    const remain = Math.max(0, epoch - now);
    const totalSeconds = Math.floor(remain / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    if (hours > 0)
        return `${String(hours).padStart(2, '0')}:${mm}:${ss}`;
    return `${mm}:${ss}`;
}
export function remainingMs(epoch, now = Date.now()) {
    return Math.max(0, epoch - now);
}
const LOCAL_CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/;
const LOCAL_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const INSTANT = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?(Z|z|[+-]\d{2}:?\d{2})$/;
export function parseLocalClock(raw) {
    if (typeof raw !== 'string')
        return undefined;
    const m = LOCAL_CLOCK.exec(raw.trim());
    if (m === null)
        return undefined;
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    const second = m[3] === undefined ? 0 : Number(m[3]);
    const millisecond = m[4] === undefined ? 0 : Number(m[4].padEnd(3, '0'));
    if (hour > 23 || minute > 59 || second > 59)
        return undefined;
    return { hour, minute, second, millisecond };
}
export function canonicalLocalClock(raw) {
    const parts = parseLocalClock(raw);
    if (parts === undefined)
        return undefined;
    const base = `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
    return parts.millisecond === 0 && !hasMillisecond(raw) ? base : `${base}.${String(parts.millisecond).padStart(3, '0')}`;
}
function hasMillisecond(raw) {
    return typeof raw === 'string' && /\.\d/.test(raw);
}
export function parseLocalDate(raw) {
    if (typeof raw !== 'string')
        return undefined;
    const m = LOCAL_DATE.exec(raw.trim());
    if (m === null)
        return undefined;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1)
        return undefined;
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day)
        return undefined;
    return { year, month, day };
}
export function canonicalLocalDate(raw) {
    const parts = parseLocalDate(raw);
    if (parts === undefined)
        return undefined;
    return `${String(parts.year).padStart(4, '0')}-${pad2(parts.month)}-${pad2(parts.day)}`;
}
export function canonicalInstantString(raw) {
    if (typeof raw !== 'string')
        return undefined;
    const m = INSTANT.exec(raw.trim());
    if (m === null)
        return undefined;
    const date = m[1];
    if (parseLocalDate(date) === undefined)
        return undefined;
    const clock = parseLocalClock(`${m[2]}:${m[3]}${m[4] === undefined ? '' : `:${m[4]}`}${m[5] === undefined ? '' : `.${m[5]}`}`);
    if (clock === undefined)
        return undefined;
    const offset = m[6].toUpperCase();
    const normalizedOffset = offset.length === 5 ? `${offset.slice(0, 3)}:${offset.slice(3)}` : offset;
    const base = `${date}T${pad2(clock.hour)}:${pad2(clock.minute)}:${pad2(clock.second)}`;
    const fraction = clock.millisecond === 0 && m[5] === undefined ? '' : `.${String(clock.millisecond).padStart(3, '0')}`;
    return `${base}${fraction}${normalizedOffset}`;
}
function pad2(value) {
    return value < 10 ? `0${value}` : String(value);
}
