import { userScheduleCreate, userScheduleDelete, userScheduleEditPrompt, userScheduleList, userSchedulePause, userScheduleResume, resolvePromptLimits, } from './user-tools.js';
import { DEFAULT_MAX_SCHEDULES } from './user-tools.js';
import { epochFromLocal, localFieldsOf } from './smart-window.js';
import { detectTimeZone, formatAbsolute, formatHhmm, formatRelative } from './time-utils.js';
import { hostDictFor } from './strings.js';
const PREFIX = 'user-schedule';
function renderError(message) {
    return { kind: 'error', text: message };
}
function parsePayload(rawInput) {
    const text = rawInput.trim();
    if (text.length === 0)
        return { ok: false, text: '缺少 JSON 载荷。' };
    try {
        const value = JSON.parse(text);
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            return { ok: false, text: 'JSON 载荷必须是一个对象。' };
        }
        return { ok: true, value };
    }
    catch {
        return { ok: false, text: 'JSON 载荷解析失败。' };
    }
}
const BARE_ID_RE = /^schedule-[\w-]+$/;
export function coercePayload(rawInput) {
    const text = rawInput.trim();
    if (text.length === 0)
        return { ok: false, text: '缺少 JSON 载荷。' };
    if (BARE_ID_RE.test(text))
        return { ok: true, value: { id: text } };
    return parsePayload(text);
}
export const ADVANCED_SYNTAX_DISABLED = '多次写法（+1h*3、+1h+1h+0.5h、15:32+16:32）属于实验性功能「高级语法」，当前已在设置中关闭。' +
    '开启路径：设置 → 插件 → 定时提醒 → 高级语法。';
function isMultiForm(target) {
    return target.kind === 'repeats' || target.kind === 'sequence' || target.kind === 'chain';
}
const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnToNumber(text) {
    if (/^\d+(?:\.\d+)?$/.test(text))
        return Number(text);
    const tenIdx = text.indexOf('十');
    if (tenIdx >= 0) {
        const head = text.slice(0, tenIdx);
        const tail = text.slice(tenIdx + 1);
        const headVal = head === '' ? 1 : CN_DIGIT[head];
        if (headVal === undefined)
            return undefined;
        let total = headVal * 10;
        if (tail !== '') {
            const tailVal = CN_DIGIT[tail];
            if (tailVal === undefined)
                return undefined;
            total += tailVal;
        }
        return total;
    }
    let total = 0;
    for (const ch of text) {
        const d = CN_DIGIT[ch];
        if (d === undefined)
            return undefined;
        total = total * 10 + d;
    }
    return total;
}
function normalizeInput(raw) {
    return raw
        .replace(/[：]/g, ':')
        .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
        .replace(/\s+/g, ' ')
        .trim();
}
const CN_UNIT_SECONDS = {
    秒: 1, 秒钟: 1, 分: 60, 分钟: 60, 小时: 3600, 个小时: 3600, 钟头: 3600, 天: 86400, 日: 86400, 周: 604800,
};
export const MAX_OCCURRENCES = 10;
export const MIN_OCCURRENCE_INTERVAL_SECONDS = 60;
const LATIN_SEGMENT_RE = /^(?:\d+(?:\.\d+)?\s*[smhdw]\s*)+/i;
const REPEAT_SUFFIX_RE = /^\s*[*×xX]\s*(\d+)\s*(?:次|回|遍)?(?=\s|$)/;
const DANGLING_TIME_RE = /^\s*(?:[*×]\s*\d|[xX]\s*\d(?![0-9])|\+\s*\d|(?:\.{2,}|…)\s*\d)/;
function latinSegmentSeconds(segment) {
    let total = 0;
    const unitRe = /(\d+(?:\.\d+)?)\s*([smhdw])/gi;
    for (const match of segment.matchAll(unitRe)) {
        const n = Number(match[1]);
        const u = (match[2] ?? 'm').toLowerCase();
        total += n * (u === 's' ? 1 : u === 'm' ? 60 : u === 'h' ? 3600 : u === 'd' ? 86400 : 604800);
    }
    return total > 0 ? Math.round(total) : undefined;
}
function scanLatinSegments(s, from) {
    let i = from;
    let lastEnd = from;
    const segments = [];
    for (;;) {
        const match = LATIN_SEGMENT_RE.exec(s.slice(i));
        if (match === null)
            break;
        const seconds = latinSegmentSeconds(match[0] ?? '');
        if (seconds === undefined)
            break;
        segments.push(seconds);
        i += match[0].length;
        lastEnd = trimTrailingSpace(s, i, from);
        const gap = /^\s*\+/.exec(s.slice(i));
        if (gap === null)
            return { consumed: lastEnd - from, segments };
        i += gap[0].length;
    }
    return segments.length > 0 ? { consumed: lastEnd - from, segments } : undefined;
}
function epochOfTarget(target, now) {
    return target.kind === 'after' ? now + target.afterSeconds * 1000 : target.epoch;
}
function expandOccurrences(target) {
    if (target.kind !== 'repeats' && target.kind !== 'sequence')
        return undefined;
    const tooMany = `一次最多 ${MAX_OCCURRENCES} 条（多次写法会展开成同等数量的一次性任务，并受会话总额度约束）。`;
    const tooTight = `多次写法的间隔至少 ${MIN_OCCURRENCE_INTERVAL_SECONDS} 秒；只想发一条可以不带次数。`;
    if (target.kind === 'repeats') {
        const { baseSeconds, count } = target;
        if (!Number.isInteger(count) || count < 1) {
            return { ok: false, error: '重复次数必须是正整数，如 +1h*3、+30m×2。' };
        }
        if (count > MAX_OCCURRENCES)
            return { ok: false, error: `重复次数过多（${count} 次）。${tooMany}` };
        if (count > 1 && baseSeconds < MIN_OCCURRENCE_INTERVAL_SECONDS)
            return { ok: false, error: tooTight };
        return { ok: true, segments: Array.from({ length: count }, () => baseSeconds) };
    }
    const { segments } = target;
    if (segments.length > MAX_OCCURRENCES)
        return { ok: false, error: `时间序列过长（${segments.length} 段）。${tooMany}` };
    if (segments.some((seconds) => seconds < MIN_OCCURRENCE_INTERVAL_SECONDS))
        return { ok: false, error: tooTight };
    return { ok: true, segments };
}
function trimTrailingSpace(s, i, from) {
    let j = i;
    while (j > from && /\s/.test(s[j - 1] ?? ''))
        j -= 1;
    return j;
}
function latinDurationStep(segment) {
    let days = 0;
    let seconds = 0;
    const unitRe = /(\d+(?:\.\d+)?)\s*([smhdw])/gi;
    for (const match of segment.matchAll(unitRe)) {
        const n = Number(match[1]);
        const u = (match[2] ?? 'm').toLowerCase();
        if (u === 'd')
            days += n;
        else if (u === 'w')
            days += n * 7;
        else
            seconds += n * (u === 's' ? 1 : u === 'm' ? 60 : 3600);
    }
    const wholeDays = Math.floor(days);
    seconds += (days - wholeDays) * 86400;
    const roundedSeconds = Math.round(seconds);
    if (wholeDays === 0 && roundedSeconds === 0)
        return undefined;
    return { kind: 'duration', days: wholeDays, seconds: roundedSeconds };
}
function localDateOf(epoch, timeZone) {
    const f = localFieldsOf(epoch, timeZone);
    return `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
}
function addLocalDays(date, days) {
    const [year, month, day] = date.split('-').map(Number);
    const shifted = new Date(Date.UTC((year ?? 1970), (month ?? 1) - 1, (day ?? 1) + days));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}
function extendAnchorChain(s, base) {
    const anchor = base.target;
    if (anchor.kind !== 'at')
        return undefined;
    const steps = [];
    let i = base.consumed;
    for (;;) {
        const gap = /^\s*\+/.exec(s.slice(i));
        if (gap === null)
            break;
        const from = i + gap[0].length;
        const dur = LATIN_SEGMENT_RE.exec(s.slice(from));
        const durationStep = dur === null ? undefined : latinDurationStep(dur[0] ?? '');
        if (dur !== null && durationStep !== undefined) {
            const rawEnd = from + dur[0].length;
            if (/[0-9a-z]/i.test(s[rawEnd] ?? ''))
                break;
            steps.push(durationStep);
            i = trimTrailingSpace(s, rawEnd, from);
            continue;
        }
        const stepMatch = matchSingleTimeExpr(s.slice(from));
        if (stepMatch === undefined || stepMatch.target.kind !== 'at')
            break;
        steps.push({ kind: 'at', target: stepMatch.target });
        i = trimTrailingSpace(s, from + stepMatch.consumed, from);
    }
    if (steps.length === 0)
        return undefined;
    return { consumed: i, target: { kind: 'chain', anchor, steps } };
}
function matchTimeExpr(s) {
    const single = matchSingleTimeExpr(s);
    if (single === undefined)
        return undefined;
    if (single.target.kind !== 'at')
        return single;
    return extendAnchorChain(s, single) ?? single;
}
function matchSingleTimeExpr(s) {
    if (s.startsWith('+')) {
        const scan = scanLatinSegments(s, 1);
        if (scan !== undefined && scan.segments.length > 0) {
            let consumed = 1 + scan.consumed;
            let target;
            if (scan.segments.length === 1) {
                const suffix = REPEAT_SUFFIX_RE.exec(s.slice(consumed));
                const baseSeconds = scan.segments[0];
                if (suffix !== null) {
                    consumed += suffix[0].length;
                    target = { kind: 'repeats', baseSeconds, count: Number(suffix[1]) };
                }
                else {
                    target = { kind: 'after', afterSeconds: baseSeconds };
                }
            }
            else {
                target = { kind: 'sequence', segments: scan.segments };
            }
            const boundary = s[consumed];
            if (boundary !== undefined && /[0-9a-z]/i.test(boundary))
                return undefined;
            return { consumed, target };
        }
    }
    const cnRel = /^(半|\d+(?:\.\d+)?|[零一二两三四五六七八九十]+)\s*(个\s*小时|秒钟?|分钟?|小时|钟头|天|日|周)\s*(?:之)?后?/.exec(s);
    if (cnRel !== null) {
        const value = cnRel[1] === '半' ? 0.5 : cnToNumber(cnRel[1] ?? '');
        const unitKey = (cnRel[2] ?? '').replace(/\s+/g, '');
        const unitSeconds = CN_UNIT_SECONDS[unitKey];
        if (value === undefined || value <= 0 || unitSeconds === undefined)
            return undefined;
        const baseSeconds = Math.round(value * unitSeconds);
        let consumed = cnRel[0].length;
        const suffix = REPEAT_SUFFIX_RE.exec(s.slice(consumed));
        if (suffix !== null) {
            consumed += suffix[0].length;
            return { consumed, target: { kind: 'repeats', baseSeconds, count: Number(suffix[1]) } };
        }
        return { consumed, target: { kind: 'after', afterSeconds: baseSeconds } };
    }
    const compactFull = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(?!\d)/.exec(s);
    if (compactFull !== null) {
        return {
            consumed: compactFull[0].length,
            target: {
                kind: 'at',
                year: Number(compactFull[1]), month: Number(compactFull[2]), day: Number(compactFull[3]),
                hour: Number(compactFull[4]), minute: Number(compactFull[5]),
            },
        };
    }
    const compactShort = /^(\d{2})(\d{2})-(\d{2})(\d{2})(?!\d)/.exec(s);
    if (compactShort !== null) {
        return {
            consumed: compactShort[0].length,
            target: {
                kind: 'at',
                month: Number(compactShort[1]), day: Number(compactShort[2]),
                hour: Number(compactShort[3]), minute: Number(compactShort[4]),
            },
        };
    }
    let i = 0;
    let dayOffset;
    const dayWords = [['大后天', 3], ['后天', 2], ['明天', 1], ['明日', 1], ['今天', 0], ['今日', 0]];
    for (const [word, offset] of dayWords) {
        if (s.startsWith(word)) {
            dayOffset = offset;
            i += word.length;
            break;
        }
    }
    while (s[i] === ' ')
        i += 1;
    let year;
    let month;
    let day;
    const rest1 = s.slice(i);
    const fullDate = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})[日号]?/.exec(rest1);
    if (fullDate !== null) {
        year = Number(fullDate[1]);
        month = Number(fullDate[2]);
        day = Number(fullDate[3]);
        i += fullDate[0].length;
    }
    else {
        const shortDate = /^(\d{1,2})[月/-](\d{1,2})[日号]?/.exec(rest1);
        if (shortDate !== null && (shortDate[0].includes('月') || shortDate[0].includes('-') || shortDate[0].includes('/'))) {
            month = Number(shortDate[1]);
            day = Number(shortDate[2]);
            i += shortDate[0].length;
        }
    }
    while (s[i] === ' ')
        i += 1;
    const rest2 = s.slice(i);
    let hour;
    let minute = 0;
    let timeLen = 0;
    const colonTime = /^(\d{1,2}):(\d{2})/.exec(rest2);
    const cnTime = /^(\d{1,2}|[零一二两三四五六七八九十]+)\s*[点时]\s*(?:(半|\d{1,2}|[一二三四五]+)\s*分?)?\s*整?/.exec(rest2);
    if (colonTime !== null) {
        hour = Number(colonTime[1]);
        minute = Number(colonTime[2]);
        timeLen = colonTime[0].length;
    }
    else if (cnTime !== null) {
        const h = cnToNumber(cnTime[1] ?? '');
        if (h === undefined)
            return undefined;
        hour = h;
        const minRaw = cnTime[2];
        if (minRaw !== undefined) {
            minute = minRaw === '半' ? 30 : (cnToNumber(minRaw) ?? -1);
            if (minute < 0)
                return undefined;
        }
        timeLen = cnTime[0].length;
    }
    else if (dayOffset === undefined && year === undefined && month === undefined) {
        const bare = /^(\d{2})(\d{2})(?!\d)(?=\s|\+|$)/.exec(rest2);
        if (bare !== null) {
            hour = Number(bare[1]);
            minute = Number(bare[2]);
            timeLen = bare[0].length;
        }
    }
    if (hour === undefined)
        return undefined;
    i += timeLen;
    return {
        consumed: i,
        target: {
            kind: 'at', hour, minute,
            ...(year !== undefined ? { year } : {}),
            ...(month !== undefined ? { month } : {}),
            ...(day !== undefined ? { day } : {}),
            ...(dayOffset !== undefined ? { dayOffset } : {}),
        },
    };
}
function resolveTarget(matched, now, timeZone) {
    const t = matched.target;
    if (t.kind === 'after') {
        return { status: 'ok', target: { kind: 'after', afterSeconds: t.afterSeconds } };
    }
    if (t.kind === 'repeats' || t.kind === 'sequence' || t.kind === 'chain') {
        return { status: 'error', error: '内部错误：多次写法未经展开处理。' };
    }
    if ((t.month !== undefined && (t.month < 1 || t.month > 12)) ||
        (t.day !== undefined && (t.day < 1 || t.day > 31)) ||
        t.hour > 23 || t.minute > 59) {
        return { status: 'error', error: '日期或时间数值无效。' };
    }
    const hhmm = `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
    const epochOf = (date) => {
        const e = epochFromLocal(date, `${hhmm}:00`, timeZone);
        return e === undefined || Number.isNaN(e) ? undefined : e;
    };
    const atOk = (date) => ({
        status: 'ok',
        target: { kind: 'at', at: { date, time: `${hhmm}:00`, time_zone: timeZone }, epoch: epochOf(date) },
    });
    if (t.year !== undefined && t.month !== undefined && t.day !== undefined) {
        const date = `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
        if (epochOf(date) === undefined)
            return { status: 'error', error: '日期不存在。' };
        if (epochOf(date) <= now)
            return { status: 'error', error: '目标时间已过去。' };
        return atOk(date);
    }
    if (t.month !== undefined && t.day !== undefined) {
        const thisYear = localFieldsOf(now, timeZone).year;
        for (const y of [thisYear, thisYear + 1]) {
            const date = `${y}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
            const epoch = epochOf(date);
            if (epoch !== undefined && epoch > now)
                return atOk(date);
        }
        return { status: 'error', error: '目标时间已过去。' };
    }
    if (t.dayOffset !== undefined) {
        const f = localFieldsOf(now + t.dayOffset * 24 * 3600 * 1000, timeZone);
        const date = `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
        const epoch = epochOf(date);
        if (epoch === undefined)
            return { status: 'error', error: '无法解析目标时间。' };
        if (epoch <= now)
            return { status: 'error', error: '该时刻今天已过去，可改用「明天」或具体日期。' };
        return atOk(date);
    }
    for (let add = 0; add < 8; add += 1) {
        const f = localFieldsOf(now + add * 24 * 3600 * 1000, timeZone);
        const date = `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
        const epoch = epochOf(date);
        if (epoch !== undefined && epoch > now)
            return atOk(date);
    }
    return { status: 'error', error: '无法解析目标时间。' };
}
function resolveChain(chain, now, timeZone) {
    const landed = resolveTarget({ consumed: 0, target: chain.anchor }, now, timeZone);
    if (landed.status === 'error')
        return { ok: false, error: landed.error };
    if (landed.target.kind !== 'at')
        return { ok: false, error: '锚点必须是绝对时刻。' };
    const targets = [landed.target];
    let date = landed.target.at.date;
    let time = landed.target.at.time;
    let epoch = landed.target.epoch;
    for (const step of chain.steps) {
        if (step.kind === 'duration') {
            if (step.days > 0) {
                date = addLocalDays(date, step.days);
                const shifted = epochFromLocal(date, time, timeZone);
                if (shifted === undefined) {
                    return {
                        ok: false,
                        error: `${date} 的 ${time.slice(0, 5)} 在 ${timeZone} 不存在（夏令时切换跳过了这个时刻），请换一个时刻或时区。`,
                    };
                }
                epoch = shifted;
            }
            if (step.seconds > 0) {
                epoch += step.seconds * 1000;
                date = localDateOf(epoch, timeZone);
                const f = localFieldsOf(epoch, timeZone);
                time = `${String(f.hour).padStart(2, '0')}:${String(f.minute).padStart(2, '0')}:00`;
            }
        }
        else {
            const next = resolveTarget({ consumed: 0, target: step.target }, epoch, timeZone);
            if (next.status === 'error')
                return { ok: false, error: next.error };
            if (next.target.kind !== 'at')
                return { ok: false, error: '序列里的时刻写法无效。' };
            date = next.target.at.date;
            time = next.target.at.time;
            epoch = next.target.epoch;
        }
        targets.push({ kind: 'at', at: { date, time, time_zone: timeZone }, epoch });
    }
    return { ok: true, targets };
}
export function parseScheduleInput(raw, now, timeZone, limits = { allowLong: false, maxChars: 1000 }, options = { advancedSyntax: true }) {
    const s = normalizeInput(raw);
    if (s.length === 0)
        return { ok: false, error: '用法：/schedule <时间> <内容>，如 /schedule 1532 检查构建结果' };
    const matched = matchTimeExpr(s);
    if (matched === undefined) {
        return {
            ok: false,
            error: '无法识别的时间格式。支持：+30m、1532、15:32、30分钟后、明天9点、2026-08-21 15:32；' +
                '重复 +1h*3；序列 +1h+1h+0.5h。',
        };
    }
    const rest = s.slice(matched.consumed);
    if (DANGLING_TIME_RE.test(rest)) {
        return {
            ok: false,
            error: '时间写法后面还跟着一段时长/次数，没有生效。多时刻请写成 +1h*3（等间隔 3 次）或 15:32+16:32、9:00+1d（序列，用 + 分隔）；' +
                '次数后面要留一个空格。若那部分是正文，请换个说法。',
        };
    }
    if (options.advancedSyntax === false && isMultiForm(matched.target)) {
        return { ok: false, error: ADVANCED_SYNTAX_DISABLED };
    }
    const occurrences = expandOccurrences(matched.target);
    if (occurrences !== undefined && !occurrences.ok)
        return { ok: false, error: occurrences.error };
    let targets;
    if (matched.target.kind === 'chain') {
        const { steps } = matched.target;
        if (steps.length + 1 > MAX_OCCURRENCES) {
            return { ok: false, error: `时间序列过长（${steps.length + 1} 个时刻）。${MAX_OCCURRENCES} 个为上限。` };
        }
        const chain = resolveChain(matched.target, now, timeZone);
        if (!chain.ok)
            return { ok: false, error: chain.error };
        for (let index = 1; index < chain.targets.length; index += 1) {
            const prev = chain.targets[index - 1];
            const cur = chain.targets[index];
            const gapSeconds = (epochOfTarget(cur, now) - epochOfTarget(prev, now)) / 1000;
            if (gapSeconds < MIN_OCCURRENCE_INTERVAL_SECONDS) {
                return { ok: false, error: `相邻两个时刻相差 ${Math.round(gapSeconds)} 秒，多次写法至少要隔 ${MIN_OCCURRENCE_INTERVAL_SECONDS} 秒。` };
            }
        }
        targets = chain.targets;
    }
    else if (occurrences !== undefined) {
        const expanded = [];
        let cumulative = 0;
        for (const seconds of occurrences.segments) {
            cumulative += seconds;
            expanded.push({ kind: 'after', afterSeconds: cumulative });
        }
        targets = expanded;
    }
    else {
        const resolved = resolveTarget(matched, now, timeZone);
        if (resolved.status === 'error')
            return { ok: false, error: resolved.error };
        targets = [resolved.target];
    }
    const content = rest.trim();
    if (content.length === 0)
        return { ok: false, error: '提醒内容不能为空。' };
    if (content.length > limits.maxChars) {
        return { ok: false, error: `提醒内容不能超过 ${limits.maxChars} 字符。` };
    }
    return { ok: true, target: targets[0], targets, content };
}
export function parseScheduleSpec(spec, now, timeZone) {
    const s = normalizeInput(spec);
    const matched = matchTimeExpr(s);
    if (matched === undefined) {
        return { ok: false, error: '无法识别的时间格式。支持：+30m、1532、15:32、30分钟后、明天9点 等。' };
    }
    const occurrences = expandOccurrences(matched.target);
    if (occurrences !== undefined && !occurrences.ok)
        return { ok: false, error: occurrences.error };
    if (matched.target.kind === 'chain') {
        return {
            ok: false,
            error: '锚点序列会展开成多条任务，仅 /schedule 与 /later 支持；单条写法请只写一个时刻。',
        };
    }
    if (occurrences !== undefined && occurrences.segments.length > 1) {
        return {
            ok: false,
            error: '多次/序列写法会展开成多条任务，仅 /schedule 与 /later 支持；单条写法请用 +1h 这类单一时间。',
        };
    }
    const resolved = resolveTarget(matched, now, timeZone);
    if (resolved.status === 'error')
        return { ok: false, error: resolved.error };
    if (s.slice(matched.consumed).trim().length > 0) {
        return { ok: false, error: '无法识别的时间格式。支持：+30m、1532、15:32、30分钟后、明天9点 等。' };
    }
    if (resolved.target.kind === 'after') {
        return { ok: true, kind: 'after', afterSeconds: resolved.target.afterSeconds };
    }
    return { ok: true, kind: 'at', at: resolved.target.at, epoch: resolved.target.epoch };
}
function describeEpochs(epochs, timeZone) {
    const first = epochs[0];
    if (first === undefined)
        return '';
    const base = localFieldsOf(first, timeZone);
    return epochs
        .map((epoch, index) => {
        if (index === 0)
            return formatAbsolute(epoch, timeZone);
        const f = localFieldsOf(epoch, timeZone);
        const sameDate = f.year === base.year && f.month === base.month && f.day === base.day;
        return sameDate ? formatHhmm(epoch, timeZone) : formatAbsolute(epoch, timeZone);
    })
        .join('、');
}
export function userScheduleCommands(ctx, getSettings = DEFAULT_MAX_SCHEDULES, onUserChange, onUserSteer, getLocale) {
    const t = hostDictFor(getLocale?.());
    const resolveSettings = () => {
        if (typeof getSettings === 'function') {
            const value = getSettings();
            if (typeof value === 'number') {
                return { maxSchedules: value, limits: { allowLong: false, maxChars: 1000 }, advancedSyntax: true };
            }
            const maxSchedules = value?.maxSchedules ?? DEFAULT_MAX_SCHEDULES;
            const limits = resolvePromptLimits({
                allowLongPrompts: value?.allowLongPrompts,
                maxPromptChars: value?.maxPromptChars,
            });
            return { maxSchedules, limits, advancedSyntax: value?.advancedSyntax !== false };
        }
        return { maxSchedules: getSettings, limits: { allowLong: false, maxChars: 1000 }, advancedSyntax: true };
    };
    const armScheduler = (agent) => {
        try {
            return onUserChange?.(agent) ?? true;
        }
        catch {
            return false;
        }
    };
    const create = {
        name: `${PREFIX}-create`,
        description: t.cmdLaterDesc,
        input: {
            hint: 'JSON 载荷，例如 {"prompt":"检查构建结果","after_seconds":300}；也可用 {"prompt":"…","at":{"date":"2026-08-21","time":"15:32","time_zone":"Asia/Shanghai"}}',
        },
        recordInput: false,
        handler: async (invocation) => {
            const parsed = coercePayload(invocation.rawInput);
            if (!parsed.ok)
                return renderError(parsed.text);
            const { maxSchedules, limits } = resolveSettings();
            const result = await userScheduleCreate(parsed.value, invocation.agent, ctx, maxSchedules, undefined, limits);
            if (!result.ok) {
                return { kind: 'error', text: `${result.code}: ${result.message}` };
            }
            const armed = armScheduler(invocation.agent);
            return {
                kind: 'success',
                text: JSON.stringify(armed ? { ...result } : { ...result, warning: t.warnSchedulerNotArmed }),
            };
        },
    };
    const list = {
        name: `${PREFIX}-list`,
        description: t.cmdListDesc,
        input: {
            hint: '无需载荷。回车一次认领命令、再回车一次执行（内核的 input 命令都这样）',
        },
        recordInput: false,
        handler: async (invocation) => {
            const result = await userScheduleList(invocation.agent);
            if (!result.ok) {
                return { kind: 'error', text: `${result.code}: ${result.message}` };
            }
            return { kind: 'success', text: JSON.stringify(result.schedules) };
        },
    };
    const del = {
        name: `${PREFIX}-delete`,
        description: t.cmdDeleteDesc,
        input: {
            hint: 'JSON 载荷，例如 {"id":"schedule-…"}；也可直接给裸 id：schedule-…',
        },
        recordInput: false,
        handler: async (invocation) => {
            const parsed = coercePayload(invocation.rawInput);
            if (!parsed.ok)
                return renderError(parsed.text);
            const id = parsed.value['id'];
            const result = await userScheduleDelete(id, invocation.agent, ctx);
            if (!result.ok) {
                return { kind: 'error', text: `${result.code}: ${result.message}` };
            }
            if (result.deleted) {
                try {
                    onUserChange?.(invocation.agent);
                }
                catch {
                }
            }
            return { kind: 'success', text: JSON.stringify({ id: result.id, deleted: result.deleted }) };
        },
    };
    const edit = {
        name: `${PREFIX}-edit`,
        description: t.cmdEditDesc,
        input: {
            hint: 'JSON 载荷，例如 {"id":"schedule-…","prompt":"新的提醒内容"}',
        },
        recordInput: false,
        handler: async (invocation) => {
            const parsed = coercePayload(invocation.rawInput);
            if (!parsed.ok)
                return renderError(parsed.text);
            const value = parsed.value;
            if (value['prompt'] === undefined) {
                const id = value['id'];
                if (typeof id === 'string' && id.length > 0 && id.trim() === id) {
                    return renderError('缺少要改成的新内容：/user-schedule-edit 的载荷必须同时给出 id 与 prompt，例如 {"id":"schedule-…","prompt":"新的提醒内容"}。');
                }
            }
            const { limits } = resolveSettings();
            const result = await userScheduleEditPrompt(value['id'], value['prompt'], invocation.agent, ctx, limits);
            if (!result.ok) {
                return { kind: 'error', text: `${result.code}: ${result.message}` };
            }
            try {
                onUserChange?.(invocation.agent);
            }
            catch {
            }
            return { kind: 'success', text: JSON.stringify(result) };
        },
    };
    const pause = {
        name: `${PREFIX}-pause`,
        description: t.cmdPauseDesc,
        input: {
            hint: 'JSON 载荷，例如 {"id":"schedule-…"}；也可直接给裸 id：schedule-…',
        },
        recordInput: false,
        handler: async (invocation) => {
            const parsed = coercePayload(invocation.rawInput);
            if (!parsed.ok)
                return renderError(parsed.text);
            const id = parsed.value['id'];
            const result = await userSchedulePause(id, invocation.agent, ctx);
            if (!result.ok) {
                return { kind: 'error', text: `${result.code}: ${result.message}` };
            }
            try {
                onUserChange?.(invocation.agent);
            }
            catch {
            }
            return { kind: 'success', text: JSON.stringify(result) };
        },
    };
    const resume = {
        name: `${PREFIX}-resume`,
        description: t.cmdResumeDesc,
        input: {
            hint: 'JSON 载荷，例如 {"id":"schedule-…"}（也可用 {"uid":"…"}）；或直接给裸 id：schedule-…',
        },
        recordInput: false,
        handler: async (invocation) => {
            const parsed = coercePayload(invocation.rawInput);
            if (!parsed.ok)
                return renderError(parsed.text);
            const uid = parsed.value['uid']
                ?? parsed.value['id'];
            const { maxSchedules } = resolveSettings();
            const result = await userScheduleResume(uid, invocation.agent, ctx, maxSchedules);
            if (!result.ok) {
                return { kind: 'error', text: `${result.code}: ${result.message}` };
            }
            try {
                onUserChange?.(invocation.agent);
            }
            catch {
            }
            return { kind: 'success', text: JSON.stringify(result) };
        },
    };
    const steer = {
        name: `${PREFIX}-steer-now`,
        description: t.cmdSteerDesc,
        input: {
            hint: 'JSON 载荷，例如 {"id":"schedule-…"}；也可直接给裸 id：schedule-…',
        },
        recordInput: false,
        handler: async (invocation) => {
            if (onUserSteer === undefined) {
                return { kind: 'error', text: '插话处理器未注入。' };
            }
            const parsed = coercePayload(invocation.rawInput);
            if (!parsed.ok)
                return renderError(parsed.text);
            const id = parsed.value['id'];
            if (typeof id !== 'string' || id.length === 0) {
                return { kind: 'error', text: 'invalid_rule: schedule id 必填。' };
            }
            try {
                const result = await onUserSteer(invocation.agent, id);
                if (!result.ok) {
                    return { kind: 'error', text: `${result.code}: ${result.message}` };
                }
                return { kind: 'success', text: JSON.stringify(result) };
            }
            catch (error) {
                return {
                    kind: 'error',
                    text: `steer_failed: ${error instanceof Error ? error.message : String(error)}`,
                };
            }
        },
    };
    const buildQuickHandler = (delivery) => {
        return async (invocation) => {
            const timeZone = detectTimeZone();
            const { maxSchedules, limits, advancedSyntax } = resolveSettings();
            const now = Date.now();
            const parsed = parseScheduleInput(invocation.rawInput, now, timeZone, limits, { advancedSyntax });
            if (!parsed.ok)
                return renderError(parsed.error);
            const content = parsed.content;
            const attachments = delivery === 'user' ? invocation.attachments : [];
            const epochs = [];
            let failure;
            for (const target of parsed.targets) {
                const input = target.kind === 'after'
                    ? { prompt: content, after_seconds: target.afterSeconds, time_zone: timeZone }
                    : { prompt: content, at: target.at, time_zone: timeZone };
                const result = await userScheduleCreate(input, invocation.agent, ctx, maxSchedules, { trustedDelivery: delivery, attachments }, limits);
                if (!result.ok) {
                    failure = `${result.code}: ${result.message}`;
                    break;
                }
                epochs.push(target.kind === 'after' ? now + target.afterSeconds * 1000 : target.epoch);
            }
            if (epochs.length === 0)
                return renderError(failure ?? '创建失败。');
            const armed = armScheduler(invocation.agent);
            const verb = delivery === 'user' ? '将于' : '已设定提醒：';
            const hint = epochs.length === 1
                ? delivery === 'user'
                    ? '（到点会以你的身份发出）'
                    : '（输入框上方蓝色待发条可随时取消）'
                : delivery === 'user'
                    ? '（到点逐条以你的身份发出，待发条里可单独取消）'
                    : '（每条可在输入框上方待发条单独取消）';
            const attachNote = attachments.length > 0 ? `（含 ${attachments.length} 个附件）` : '';
            const times = epochs.length === 1
                ? `${formatAbsolute(epochs[0], timeZone)}（${formatRelative(epochs[0], now)}）`
                : describeEpochs(epochs, timeZone);
            const head = epochs.length === 1 ? `${verb}${times}` : `已展开为 ${epochs.length} 条任务：${times}`;
            const partial = failure !== undefined && epochs.length < parsed.targets.length
                ? `｜注意：只建成 ${epochs.length}/${parsed.targets.length} 条，${failure}`
                : '';
            const notArmed = armed ? '' : `｜${t.warnSchedulerNotArmed}`;
            return { kind: 'success', text: `${head}「${content}」${attachNote}${hint}${partial}${notArmed}` };
        };
    };
    const quick = {
        name: 'schedule',
        description: '定时提醒快捷命令：/schedule <时间> <内容>。时间宽容识别：+30m、+1h30m、30分钟后、1532、15:32、9点半、明天9点、后天 10:00、8月21日 15:32、0821-1532、2026-08-21 15:32。' +
            '多次写法：+1h*3（等间隔 3 次）与 +1h+1h+0.5h（链式序列，累计时刻），各自展开成独立任务，最多 10 条、多次时间隔 ≥60 秒。',
        input: {
            hint: '<时间> <内容>，如 1532 检查构建结果；也支持 +30m、明天9点、+1h*3、+1h+30m',
        },
        recordInput: false,
        handler: buildQuickHandler('context'),
    };
    const laterInput = {
        hint: '<时间> <内容>，如 1532 检查构建结果；可附带图片/文件；多条用 +1h*3 或 +1h+30m；到点会以你的身份发出',
        attachments: true,
    };
    const later = {
        name: 'later',
        description: '延迟发送：/later <时间> <内容>，到点以你的身份发出该内容（不是提醒，是代发）；可附带图片/文件，到点随内容一起发出。时间格式同 /schedule，' +
            '含多次写法：+1h*3（等间隔 N 次）、+1h+1h+0.5h（相对序列）、15:32+16:32 / 9:00+1d（锚点序列）会展开成多条代发任务（同一内容与附件逐条带上）。' +
            '多次写法为实验性功能，可在插件设置「高级语法」中关闭。',
        input: laterInput,
        recordInput: false,
        handler: buildQuickHandler('user'),
    };
    return [create, list, del, edit, pause, resume, steer, quick, later];
}
export function registerUserScheduleCommands(ctx, getSettings = DEFAULT_MAX_SCHEDULES, onUserChange, onUserSteer, getLocale) {
    const disposers = userScheduleCommands(ctx, getSettings, onUserChange, onUserSteer, getLocale).map((definition) => {
        try {
            return ctx.commands.register(definition);
        }
        catch (error) {
            ctx.logger.warn(`later: 命令 ${definition.name} 注册失败: ${error instanceof Error ? error.message : String(error)}`);
            return () => undefined;
        }
    });
    return () => {
        for (const dispose of disposers.reverse())
            dispose();
    };
}
