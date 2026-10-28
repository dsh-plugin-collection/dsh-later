/**
 * 智能时段计算（纯函数，host 与 client 共享）。
 *
 * 默认时段（v1 硬编码，可经 cordis config 覆盖）：
 *   工作时间 09:00–18:00
 *   午休时间 12:00–14:00
 *   晚间时间 18:00–22:00
 *   夜间静默 22:00–次日 09:00（不发送）
 *
 * 计算在**用户显式选定的 IANA 时区**内进行（不自动推断，确定性优先）。
 * 墙钟→epoch 的解析采用 dsh-schedule `resolveLocalInstant` 同款偏移校正法，
 * 避免依赖进程时区。
 * @module dsh-later/smart-window
 */
import { parseLocalClock, parseLocalDate } from './time-utils.js';

/** 智能时段配置（HH:mm 格式，可配置）。 */
export interface SmartWindowConfig {
  /** 工作时间开始。 */
  readonly workStart: string;
  /** 工作时间结束。 */
  readonly workEnd: string;
  /** 午休开始。 */
  readonly lunchStart: string;
  /** 午休结束。 */
  readonly lunchEnd: string;
  /** 晚间结束（夜间静默起点）。 */
  readonly eveningEnd: string;
}

/** 默认时段。 */
export const DEFAULT_SMART_WINDOW: SmartWindowConfig = Object.freeze({
  workStart: '09:00',
  workEnd: '18:00',
  lunchStart: '12:00',
  lunchEnd: '14:00',
  eveningEnd: '22:00',
});

/** HH:mm（24 小时制）格式。 */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 校验一个 HH:mm 字符串。 */
export function isValidHhmm(value: unknown): value is string {
  return typeof value === 'string' && HHMM_RE.test(value);
}

/**
 * 逐项清洗：非法或缺省的字段回落默认值，**不做跨字段的序关系判定**。
 *
 * 单独导出是给设置卡用的：卡片要在用户按下「保存」之前就说出**哪一对**相邻边界被
 * 写反了，而 {@link sanitizeSmartWindowConfig} 在序关系不成立时已经把五个字段整体
 * 换回默认，那份「用户真正填的组合」就看不到了。
 */
export function pickSmartWindowFields(
  raw: Partial<Record<keyof SmartWindowConfig, unknown>> | undefined | null,
): SmartWindowConfig {
  const pick = (key: keyof SmartWindowConfig, fallback: string): string =>
    isValidHhmm(raw?.[key]) ? (raw[key] as string) : fallback;
  return {
    workStart: pick('workStart', DEFAULT_SMART_WINDOW.workStart),
    workEnd: pick('workEnd', DEFAULT_SMART_WINDOW.workEnd),
    lunchStart: pick('lunchStart', DEFAULT_SMART_WINDOW.lunchStart),
    lunchEnd: pick('lunchEnd', DEFAULT_SMART_WINDOW.lunchEnd),
    eveningEnd: pick('eveningEnd', DEFAULT_SMART_WINDOW.eveningEnd),
  };
}

/**
 * 清洗**设置层**送来的时段字段（host schema 与 client 设置面共用这一个入口）：
 * 逐项回落 + 序关系不成立时整体回落默认。
 *
 * ## 为什么序关系的降级放在这一层（issue #19 的实测结论，改动前请先复现）
 *
 * 设置卡的五个 HH:mm 字段曾经只在卡片里可写、不在宿主 `Config` 里，于是用户的改动
 * 永远进不到快照——面板读不到，恒用默认。把字段补进 schema 只是**让值能落地**；
 * 落地之后这两类脏值会真的流进时段计算，实测行为分别是：
 *
 *  - **格式非法**（`25:00` / `9:00` / 非字符串）：逐项清洗本来就挡得住，`isValidWindow`
 *    随即为 true，时段照算（不会出 NaN）。
 *  - **格式合法但序关系不成立**（例如 `workStart=13:00`，而午休仍从 12:00 起）：
 *    逐项清洗**放行**（它只看单字段格式），于是 `isValidWindow` 为 false →
 *    `nextSmartTarget` 抛 `TypeError` → `nextSmartAt` 把异常吞成 `null` → 面板上
 *    「智能」那一枚芯片**静默消失**，而另两枚芯片照旧显示 `今天 18:00 / 明天 13:00`
 *    这种自相矛盾的时刻。用户看到的现象是「改了设置之后智能排期没了」，没有任何解释。
 *
 * 也就是说不加这道降级，把崩溃点从「改动不生效」挪到「算不出时段」就够了——仍然是静默。
 * 所以序关系的判定必须在**进入计算之前的最后一个共享环节**做一次，且只能做一次：
 * `pickSmartWindowFields` 与 `isValidWindow` 之间不再有别的消费者。
 *
 * ## 为什么是「整体回落」而不是「逐字段凑」
 *
 * 序关系是四条相邻约束，违反时「哪个字段错了」没有唯一答案（改任一侧都能修好）。
 * 逐字段凑会静默造出一份用户从没填过的混合配置，且每改一格都可能换一个组合；
 * 整体回落是一条可解释的规则，并且让下游 `isValidWindow` 的前置守卫**恒成立**——
 * `nextSmartTarget` 永不因脏输入抛错，NaN 也进不了 `nextMinutesAfter`
 * （`resolveWallClock` 收到 NaN 会让 `Intl.formatToParts` 抛 RangeError）。
 *
 * 卡片侧另有一道同规则的输入校验（保存前就报错，不静默），两处共用
 * {@link SMART_WINDOW_ORDER}，所以「被拒的组合」与「被降级的组合」必然是同一个集合。
 */
export function sanitizeSmartWindowConfig(
  raw: Partial<Record<keyof SmartWindowConfig, unknown>> | undefined | null,
): SmartWindowConfig {
  const picked = pickSmartWindowFields(raw);
  return isValidWindow(picked) ? picked : DEFAULT_SMART_WINDOW;
}

/** 两次提醒之间至少等待的毫秒数（智能模式下）。 */
export const SMART_MIN_DELAY_MS = 2 * 60 * 1000;

/** 一小时/一天的毫秒数。 */
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** 当日第几分钟（0–1439）。 */
export type DayMinutes = number;

/** 本地日历字段。 */
export interface LocalFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * 把 "HH:mm" 解析为当日第几分钟；非法返回 undefined。
 */
export function hhmmToMinutes(value: string): DayMinutes | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (match === null) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}

/** 把当日第几分钟格式化为 "HH:mm"。 */
export function minutesToHhmm(minutes: DayMinutes): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * 时段序关系：表里每一对相邻边界都必须**严格递增**。
 *
 * 这是这条规则在本仓的**唯一定义处**——`isValidWindow`（计算前置守卫）与设置卡的
 * 跨字段输入校验都读它，所以「卡片会拒绝的组合」与「消费端会整体降级的组合」
 * 必然是同一个集合。改这张表就等于同时改了行为与提示，不存在两处漂移。
 */
export const SMART_WINDOW_ORDER: ReadonlyArray<
  readonly [keyof SmartWindowConfig, keyof SmartWindowConfig]
> = Object.freeze([
  Object.freeze(['workStart', 'lunchStart'] as const),
  Object.freeze(['lunchStart', 'lunchEnd'] as const),
  Object.freeze(['lunchEnd', 'workEnd'] as const),
  Object.freeze(['workEnd', 'eveningEnd'] as const),
]);

/**
 * 第一对被破坏的相邻边界（全部满足则 `null`）。
 * 格式不合法（`hhmmToMinutes` 落空）也算破坏——序关系没有「未知」这一档。
 * 卡片用它把提示挂到**具体那两格**上，而不是整段糊一句「时间无效」。
 */
export function firstOrderViolation(
  window: SmartWindowConfig,
): readonly [keyof SmartWindowConfig, keyof SmartWindowConfig] | null {
  for (const [left, right] of SMART_WINDOW_ORDER) {
    const a = hhmmToMinutes(window[left]);
    const b = hhmmToMinutes(window[right]);
    if (a === undefined || b === undefined || a >= b) return [left, right];
  }
  return null;
}

/**
 * 可配置时段是否有效：所有边界均为合法 HH:mm 且满足
 * workStart < lunchStart < lunchEnd < workEnd < eveningEnd。
 */
export function isValidWindow(window: SmartWindowConfig): boolean {
  return firstOrderViolation(window) === null;
}

/** 取整到整分钟（秒、毫秒清零）。 */
export function floorToMinute(epoch: number): number {
  return Math.floor(epoch / MINUTE_MS) * MINUTE_MS;
}

/** 为该时区构建一个 ISO 投影 formatter（含长期偏移）。 */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
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

/** 把 epoch 投影到指定时区的本地日历字段。 */
export function localFieldsOf(epoch: number, timeZone: string): LocalFields {
  const formatter = formatterFor(timeZone);
  const parts = Object.fromEntries(
    formatter.formatToParts(epoch).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: Number(parts['hour']),
    minute: Number(parts['minute']),
    second: Number(parts['second']),
  };
}

/** 该 epoch 在指定时区的 UTC 偏移（毫秒）：local − UTC。 */
function offsetOf(epoch: number, timeZone: string): number {
  const f = localFieldsOf(epoch, timeZone);
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second, 0) - epoch;
}

/**
 * 解析一个本地墙钟时刻（hour/min 表示，sec=00）在指定时区内对应的 epoch。
 * 采用「偏移校正」法：把墙钟当 UTC 构造候选，再用采样偏移反推真实 epoch，
 * 并验证映射回原墙钟字段；DST 重叠取最早候选，缺口会导致无候选。
 */
export function resolveWallClock(
  epochOnDay: number,
  timeZone: string,
  hour: number,
  minute: number,
  second = 0,
): number | undefined {
  const base = localFieldsOf(epochOnDay, timeZone);
  const localEpoch = Date.UTC(base.year, base.month - 1, base.day, hour, minute, second, 0);
  const offsets = new Set<number>();
  for (let delta = -2; delta <= 2; delta += 1) {
    offsets.add(offsetOf(localEpoch + delta * DAY_MS, timeZone));
  }
  const candidates: number[] = [];
  for (const offset of offsets) {
    const candidate = localEpoch - offset;
    const f = localFieldsOf(candidate, timeZone);
    if (
      f.year === base.year &&
      f.month === base.month &&
      f.day === base.day &&
      f.hour === hour &&
      f.minute === minute &&
      f.second === second
    ) {
      candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => a - b);
  return candidates[0];
}

/** 求「下一个严格晚于 now 的本地 HH:mm 时刻」的 epoch。 */
function nextMinutesAfter(now: number, timeZone: string, minutes: DayMinutes): number {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  let probe = resolveWallClock(now, timeZone, hour, minute);
  if (probe === undefined) {
    // DST 缺口：该墙钟时刻当天不存在，跳到次日
    probe = resolveWallClock(now + DAY_MS, timeZone, hour, minute);
  }
  if (probe === undefined) {
    // 兜底：按纯 UTC 猜测
    return Date.UTC(
      localFieldsOf(now, timeZone).year,
      localFieldsOf(now, timeZone).month - 1,
      localFieldsOf(now, timeZone).day,
      hour,
      minute,
      0,
      0,
    );
  }
  if (probe > now) return probe;
  const nextDay = resolveWallClock(probe + DAY_MS, timeZone, hour, minute) ?? probe + DAY_MS;
  return nextDay > now ? nextDay : nextDay + DAY_MS;
}

/**
 * 计算下一个智能时段的本地墙钟目标。
 *
 * 规则：
 *  - 若当前在午休时段（lunchStart ≤ now < lunchEnd）→ 目标为 now + 2 分钟；
 *  - 否则候选为下一个 工作开始 / 午休结束 / 晚间开始（均 > now + 2 分钟），取最早者；
 *  - 夜间静默（≥ eveningEnd 或 < workStart）自然被「下一个工作开始」覆盖。
 *
 * @param now - 当前墙钟 epoch 毫秒。
 * @param timeZone - 用户显式选定的 IANA 时区。
 * @param window - 时段配置（默认 {@link DEFAULT_SMART_WINDOW}）。
 * @returns 目标 epoch 毫秒（严格位于未来，且至少 SMART_MIN_DELAY_MS 之后）。
 */
export function nextSmartTarget(
  now: number,
  timeZone: string,
  window: SmartWindowConfig = DEFAULT_SMART_WINDOW,
): number {
  if (!isValidWindow(window)) throw new TypeError('smart window configuration is invalid');
  const fields = localFieldsOf(now, timeZone);
  const minutes = fields.hour * 60 + fields.minute;
  const lunchStart = hhmmToMinutes(window.lunchStart) as number;
  const lunchEnd = hhmmToMinutes(window.lunchEnd) as number;
  // 午休优先：直接 now + 2 分钟
  if (minutes >= lunchStart && minutes < lunchEnd) {
    return now + SMART_MIN_DELAY_MS;
  }
  const workStart = hhmmToMinutes(window.workStart) as number;
  const eveningStart = hhmmToMinutes(window.workEnd) as number; // 工作结束 = 晚间开始
  const candidates = [
    nextMinutesAfter(now, timeZone, workStart),
    nextMinutesAfter(now, timeZone, lunchEnd),
    nextMinutesAfter(now, timeZone, eveningStart),
  ].filter((target) => target > now + SMART_MIN_DELAY_MS);
  if (candidates.length === 0) {
    const earliest = Math.min(
      nextMinutesAfter(now, timeZone, workStart),
      nextMinutesAfter(now, timeZone, lunchEnd),
      nextMinutesAfter(now, timeZone, eveningStart),
    );
    return Math.max(earliest, now + SMART_MIN_DELAY_MS);
  }
  return Math.min(...candidates);
}

/**
 * 把本地墙钟字符串（date YYYY-MM-DD、time HH:mm[:ss]）在指定时区解析为 epoch。
 * 用于自定义时间的预览与合法性校验。解析失败返回 undefined（如 DST 缺口）。
 */
export function epochFromLocal(
  date: string,
  time: string,
  timeZone: string,
): number | undefined {
  // 文法**只有 time-utils 那一份**：预览与提交（`validateCreateInput` → 上游）必须对同一个
  // 形状给出同一个结论。这里原来自己写着 `^(\d{2}):(\d{2})(?::(\d{2}))?$`——比上游宽容、
  // 又比面板输入严格，于是「预览判合法、提交被拒」和「`9:00` 明明能懂却判非法」两种错
  // 各自长在两个文件里（issue #76）。收到一处以后，改文法只需要改 `time-utils.ts`。
  const day = parseLocalDate(date);
  const clock = parseLocalClock(time);
  if (day === undefined || clock === undefined) return undefined;
  const { year, month } = day;
  const { hour, minute, second } = clock;
  // 「哪一天」必须由**请求的日历日期**决定，不能从某个探测瞬点反推：
  // 旧实现传 `Date.UTC(y,m-1,d)`（UTC 零点）给 resolveWallClock，它再用
  // localFieldsOf 读「当天」——在 UTC 负偏移时区（America/Los_Angeles 等）那个
  // 瞬间读出来的是**前一天**，于是 `2026-11-01 09:00 @LA` 解成 10-31 09:00，
  // 面板自定义日期与 `/later 明天9点` 整体错一天（正偏移 ≤ +11 的时区恰好看不出）。
  // 这里改为直接以请求日期为判据，在候选偏移里挑字段完全吻合的最小瞬点。
  // 采样偏移必须用**整秒**的 epoch 去要：`offsetOf` 的定义是「字段重构成的 UTC 减去入参」，
  // 它自己丢弃毫秒，所以带毫秒的 epoch 会把 `+500ms` 漏进偏移量里，反推出的候选秒数偏移一位
  // （实测 `09:00:00.5` 解成 `09:00:01` → 字段对不上 → 整条返回 undefined）。
  // 毫秒在偏移确定之后再加回候选，不参与采样。
  const localEpochSecond = Date.UTC(year, month - 1, day.day, hour, minute, second, 0);
  const offsets = new Set<number>();
  for (let delta = -2; delta <= 2; delta += 1) {
    offsets.add(offsetOf(localEpochSecond + delta * DAY_MS, timeZone));
  }
  const candidates: number[] = [];
  for (const offset of offsets) {
    const candidate = localEpochSecond - offset + clock.millisecond;
    const f = localFieldsOf(candidate, timeZone);
    if (
      f.year === year &&
      f.month === month &&
      f.day === day.day &&
      f.hour === hour &&
      f.minute === minute &&
      f.second === second
    ) {
      candidates.push(candidate);
    }
  }
  // 回拨日同一墙钟出现两次 → 取较早的一次（与 dsh-schedule 的 weekly/daily 口径一致）；
  // 前拨跳过的墙钟 → 无候选 → undefined，由调用方给出「该时刻不存在」的提示。
  candidates.sort((a, b) => a - b);
  return candidates[0];
}

/**
 * 智能模式的一站式目标构造：返回可直接作为 `at` 对象使用的本地日历字段。
 * @returns null 当配置非法或无法解析时。
 */
export function nextSmartAt(
  now: number,
  timeZone: string,
  window: SmartWindowConfig = DEFAULT_SMART_WINDOW,
): { date: string; time: string; time_zone: string; epoch: number } | null {
  let target: number;
  try {
    target = nextSmartTarget(now, timeZone, window);
  } catch {
    return null;
  }
  let parts: LocalFields;
  try {
    parts = localFieldsOf(target, timeZone);
  } catch {
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
