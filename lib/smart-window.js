import { parseLocalClock, parseLocalDate } from './time-utils.js';
export const DEFAULT_SMART_WINDOW = Object.freeze({
    workStart: '09:00',
    workEnd: '18:00',
    lunchStart: '12:00',
    lunchEnd: '14:00',
    eveningEnd: '22:00',
});
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export function isValidHhmm(value) {
    return typeof value === 'string' && HHMM_RE.test(value);
}
export function pickSmartWindowFields(raw) {
    const pick = (key, fallback) => isValidHhmm(raw?.[key]) ? raw[key] : fallback;
    return {
        workStart: pick('workStart', DEFAULT_SMART_WINDOW.workStart),
        workEnd: pick('workEnd', DEFAULT_SMART_WINDOW.workEnd),
        lunchStart: pick('lunchStart', DEFAULT_SMART_WINDOW.lunchStart),
        lunchEnd: pick('lunchEnd', DEFAULT_SMART_WINDOW.lunchEnd),
        eveningEnd: pick('eveningEnd', DEFAULT_SMART_WINDOW.eveningEnd),
    };
}
export function sanitizeSmartWindowConfig(raw) {
    const picked = pickSmartWindowFields(raw);
    return isValidWindow(picked) ? picked : DEFAULT_SMART_WINDOW;
}
export const SMART_MIN_DELAY_MS = 2 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export function hhmmToMinutes(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
    if (match === null)
        return undefined;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59)
        return undefined;
    return hour * 60 + minute;
}
export function minutesToHhmm(minutes) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
export const SMART_WINDOW_ORDER = Object.freeze([
    Object.freeze(['workStart', 'lunchStart']),
    Object.freeze(['lunchStart', 'lunchEnd']),
    Object.freeze(['lunchEnd', 'workEnd']),
    Object.freeze(['workEnd', 'eveningEnd']),
]);
export function firstOrderViolation(window) {
    for (const [left, right] of SMART_WINDOW_ORDER) {
        const a = hhmmToMinutes(window[left]);
        const b = hhmmToMinutes(window[right]);
        if (a === undefined || b === undefined || a >= b)
            return [left, right];
    }
    return null;
}
export function isValidWindow(window) {
    return firstOrderViolation(window) === null;
}
export function floorToMinute(epoch) {
    return Math.floor(epoch / MINUTE_MS) * MINUTE_MS;
}
function formatterFor(timeZone) {
    return new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });
}
export function localFieldsOf(epoch, timeZone) {
    const formatter = formatterFor(timeZone);
    const parts = Object.fromEntries(formatter.formatToParts(epoch).map((part) => [part.type, part.value]));
    return {
        year: Number(parts['year']),
        month: Number(parts['month']),
        day: Number(parts['day']),
        hour: Number(parts['hour']),
        minute: Number(parts['minute']),
        second: Number(parts['second']),
    };
}
function offsetOf(epoch, timeZone) {
    const f = localFieldsOf(epoch, timeZone);
    return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second, 0) - epoch;
}
export function resolveWallClock(epochOnDay, timeZone, hour, minute, second = 0) {
    const base = localFieldsOf(epochOnDay, timeZone);
    const localEpoch = Date.UTC(base.year, base.month - 1, base.day, hour, minute, second, 0);
    const offsets = new Set();
    for (let delta = -2; delta <= 2; delta += 1) {
        offsets.add(offsetOf(localEpoch + delta * DAY_MS, timeZone));
    }
    const candidates = [];
    for (const offset of offsets) {
        const candidate = localEpoch - offset;
        const f = localFieldsOf(candidate, timeZone);
        if (f.year === base.year &&
            f.month === base.month &&
            f.day === base.day &&
            f.hour === hour &&
            f.minute === minute &&
            f.second === second) {
            candidates.push(candidate);
        }
    }
    candidates.sort((a, b) => a - b);
    return candidates[0];
}
function nextMinutesAfter(now, timeZone, minutes) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    let probe = resolveWallClock(now, timeZone, hour, minute);
    if (probe === undefined) {
        probe = resolveWallClock(now + DAY_MS, timeZone, hour, minute);
    }
    if (probe === undefined) {
        return Date.UTC(localFieldsOf(now, timeZone).year, localFieldsOf(now, timeZone).month - 1, localFieldsOf(now, timeZone).day, hour, minute, 0, 0);
    }
    if (probe > now)
        return probe;
    const nextDay = resolveWallClock(probe + DAY_MS, timeZone, hour, minute) ?? probe + DAY_MS;
    return nextDay > now ? nextDay : nextDay + DAY_MS;
}
export function nextSmartTarget(now, timeZone, window = DEFAULT_SMART_WINDOW) {
    if (!isValidWindow(window))
        throw new TypeError('smart window configuration is invalid');
    const fields = localFieldsOf(now, timeZone);
    const minutes = fields.hour * 60 + fields.minute;
    const lunchStart = hhmmToMinutes(window.lunchStart);
    const lunchEnd = hhmmToMinutes(window.lunchEnd);
    if (minutes >= lunchStart && minutes < lunchEnd) {
        return now + SMART_MIN_DELAY_MS;
    }
    const workStart = hhmmToMinutes(window.workStart);
    const eveningStart = hhmmToMinutes(window.workEnd);
    const candidates = [
        nextMinutesAfter(now, timeZone, workStart),
        nextMinutesAfter(now, timeZone, lunchEnd),
        nextMinutesAfter(now, timeZone, eveningStart),
    ].filter((target) => target > now + SMART_MIN_DELAY_MS);
    if (candidates.length === 0) {
        const earliest = Math.min(nextMinutesAfter(now, timeZone, workStart), nextMinutesAfter(now, timeZone, lunchEnd), nextMinutesAfter(now, timeZone, eveningStart));
        return Math.max(earliest, now + SMART_MIN_DELAY_MS);
    }
    return Math.min(...candidates);
}
export function epochFromLocal(date, time, timeZone) {
    const day = parseLocalDate(date);
    const clock = parseLocalClock(time);
    if (day === undefined || clock === undefined)
        return undefined;
    const { year, month } = day;
    const { hour, minute, second } = clock;
    const localEpochSecond = Date.UTC(year, month - 1, day.day, hour, minute, second, 0);
    const offsets = new Set();
    for (let delta = -2; delta <= 2; delta += 1) {
        offsets.add(offsetOf(localEpochSecond + delta * DAY_MS, timeZone));
    }
    const candidates = [];
    for (const offset of offsets) {
        const candidate = localEpochSecond - offset + clock.millisecond;
        const f = localFieldsOf(candidate, timeZone);
        if (f.year === year &&
            f.month === month &&
            f.day === day.day &&
            f.hour === hour &&
            f.minute === minute &&
            f.second === second) {
            candidates.push(candidate);
        }
    }
    candidates.sort((a, b) => a - b);
    return candidates[0];
}
export function nextSmartAt(now, timeZone, window = DEFAULT_SMART_WINDOW) {
    let target;
    try {
        target = nextSmartTarget(now, timeZone, window);
    }
    catch {
        return null;
    }
    let parts;
    try {
        parts = localFieldsOf(target, timeZone);
    }
    catch {
        return null;
    }
    const date = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    const time = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`;
    return {
        date,
        time,
        time_zone: timeZone,
        epoch: target,
    };
}
