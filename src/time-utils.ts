/**
 * 时间格式化与通用工具（纯函数，host 与 client 共享）。
 * 文案遵循 docs/ui/08-microcopy.md 的微文案规范。
 * @module dsh-later/time-utils
 */

/** 校验一个字符串是否为合法 IANA 时区（或 UTC）。 */

/** 浏览器默认时区（客户端）；host 侧无合理默认则退回 UTC。 */
export function detectTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz?.length ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** 常见时区候选（面板下拉用）。 */

/** 文案语言 id（zh 中文；en 英文；其余回退中文）。 */
export type TextLocale = 'zh' | 'en';

/**
 * 相对时间文案：zh "约 X 分钟后"；en "in ~X minutes" 等。
 * @param epoch - 目标 epoch 毫秒。
 * @param now - 当前 epoch 毫秒（默认 Date.now()）。
 * @param locale - 文案语言（默认 zh，host 侧无浏览器语境保持中文）。
 */
export function formatRelative(epoch: number, now: number = Date.now(), locale: TextLocale = 'zh'): string {
  const diff = epoch - now;
  if (locale === 'en') {
    if (diff < 0) return 'overdue';
    if (diff < MINUTE_MS) return 'sending soon';
    const minutes = Math.round(diff / MINUTE_MS);
    if (minutes < 60) return `in ~${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    if (hours < 24) {
      return restMinutes === 0 ? `in ~${hours} h` : `in ~${hours} h ${restMinutes} min`;
    }
    const days = Math.floor(hours / 24);
    return `in ~${days} days`;
  }
  if (diff < 0) return '已到期';
  if (diff < MINUTE_MS) return '即将发送';
  const minutes = Math.round(diff / MINUTE_MS);
  if (minutes < 60) return `约 ${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes === 0 ? `约 ${hours} 小时后` : `约 ${hours} 小时 ${restMinutes} 分后`;
  }
  const days = Math.floor(hours / 24);
  return `约 ${days} 天后`;
}

/** 毫秒常量（避免依赖 smart-window 再复制）。 */
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/**
 * 完整时间文案：zh "{M}月{d}日 {周X} HH:mm"、en "Wed, Aug 26, 14:45"（按指定时区）。
 */
export function formatAbsolute(epoch: number, timeZone: string, locale: TextLocale = 'zh'): string {
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

/** 仅时间部分 "HH:mm"（按指定时区）。 */
export function formatHhmm(epoch: number, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB-u-ca-iso8601-nu-latn', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return formatter.format(epoch);
}

/** 周期几第几天（与 formatAbsolute 里的 wkday 词对齐）。 */

/**
 * 倒计时 "HH:MM:SS"（或剩余不足 1 小时时 "MM:SS"）。
 */
export function formatCountdown(epoch: number, now: number = Date.now()): string {
  const remain = Math.max(0, epoch - now);
  const totalSeconds = Math.floor(remain / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${String(hours).padStart(2, '0')}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

/** 未来距离（毫秒）；用于紧急度判断。 */
export function remainingMs(epoch: number, now: number = Date.now()): number {
  return Math.max(0, epoch - now);
}


// ── `at` 的文法：预览、守门人、面板三处共用同一份 ──────────────────────────────────

/**
 * 上游 `dsh-schedule` 对 `at` 的准入比本插件的预览严：本地时间必须是**两位小时 + 必带秒**
 * （毫秒可 1–3 位），字符串形态必须是 `T` 分隔 + 显式 `Z`/`±HH:MM`。于是历史上形成三处
 * 交集为空的文法（Gitea issue #76）：面板 `<input type="time">` 的原生输出 `09:00`、
 * 模型爱写的 `9:00:00`，**预览判合法、提交必挂**，而且挂的是上游那句英文文法错。
 *
 * 下面这一组函数把三处收到一处：**解析只认这一个文法**，要交给上游的形式只由
 * `canonical*` 生成。这样「预览说 OK ⇔ 提交能成」是结构上成立的，不再靠两处正则各写一遍
 * 恰好一致——上游文法再变，需要改的也只有这里。
 */

/** 本地墙钟：`H`/`HH` : `mm`（秒可省，毫秒 1–3 位）。前后空白容忍一次。 */
const LOCAL_CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/;

/** 本地日历日期：`YYYY-M`/`YYYY-MM`-`D`/`DD`（真实与否另判）。 */
const LOCAL_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/**
 * 带显式偏移的绝对时刻。分隔符允许 `T`/`t`/空格，`Z` 允许小写，偏移允许 `+0800`，
 * 秒可省——这些都是**改写拼法**（不改变所指时刻）；唯独**没有偏移**不在此列，
 * 那需要一个时区猜测，见 {@link canonicalInstantString} 的注释。
 */
const INSTANT = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?(Z|z|[+-]\d{2}:?\d{2})$/;

/** 解析出来的一段本地墙钟。 */
export interface LocalClockParts {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

/**
 * 解析本地墙钟；形状或范围不对（`24:00`、`09:60`、`9:0`）时 `undefined`。
 *
 * 范围检查放这里而不是留给上游：上游那句 `The local at value must be a real ISO calendar
 * date and time...` 对用户是不可读的，守门人应当在边界就给中文结论。
 */
export function parseLocalClock(raw: unknown): LocalClockParts | undefined {
  if (typeof raw !== 'string') return undefined;
  const m = LOCAL_CLOCK.exec(raw.trim());
  if (m === null) return undefined;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] === undefined ? 0 : Number(m[3]);
  // 毫秒按 1–3 位补右零：`.5` = 500ms、`.05` = 50ms（上游同口径，不是四舍五入）。
  const millisecond = m[4] === undefined ? 0 : Number(m[4].padEnd(3, '0'));
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  return { hour, minute, second, millisecond };
}

/**
 * 把本地墙钟改写成上游必收的形式：`HH:mm:ss`，仅当原文真的写了毫秒才带 `.mmm`。
 *
 * 为什么只在有毫秒时输出 `.mmm`：`09:00:00` 与 `09:00:00.000` 是同一时刻，但把没写毫秒的
 * 输入补成 `.000` 会让「用户/模型到底写没写」这件事在日志里消失。省秒则必须补——上游不收。
 */
export function canonicalLocalClock(raw: unknown): string | undefined {
  const parts = parseLocalClock(raw);
  if (parts === undefined) return undefined;
  const base = `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
  return parts.millisecond === 0 && !hasMillisecond(raw) ? base : `${base}.${String(parts.millisecond).padStart(3, '0')}`;
}

/** 原文里是否真的写了毫秒段（决定 canonical 形式要不要带 `.mmm`）。 */
function hasMillisecond(raw: unknown): boolean {
  return typeof raw === 'string' && /\.\d/.test(raw);
}

/** 解析本地日历日期，并校验它是**真实存在**的一天（拒 `2026-02-30`）。 */
export function parseLocalDate(raw: unknown): { year: number; month: number; day: number } | undefined {
  if (typeof raw !== 'string') return undefined;
  const m = LOCAL_DATE.exec(raw.trim());
  if (m === null) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return undefined;
  // 用「构造再读回」判真实日：`Date.UTC(2026, 1, 30)` 会滚到 3 月 2 日，读回的月/日不一致即非法。
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return undefined;
  return { year, month, day };
}

/** 把本地日历日期补零成 `YYYY-MM-DD`（上游要求两位月/日）。 */
export function canonicalLocalDate(raw: unknown): string | undefined {
  const parts = parseLocalDate(raw);
  if (parts === undefined) return undefined;
  return `${String(parts.year).padStart(4, '0')}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/**
 * 把绝对时刻字符串改写成上游必收的形式（`T` 分隔 + 大写 `Z`/带冒号偏移 + 必带秒）。
 *
 * **只做不改变所指时刻的改写**：补秒（`:00`）、`T`/`t`/空格统一、`+0800` → `+08:00`、
 * 毫秒补零。反过来，**没有偏移也没有 `Z` 的串一律拒绝**——`2026-10-26 09:00` 该按哪个时区
 * 解释，插件猜不出来；替用户猜一个时区得到的是「静默错值」，比一次可读的拒绝坏得多
 * （issue #76 的评论里同一条判断）。缺的时区信息必须由调用方给，出路写在报错文案里。
 */
export function canonicalInstantString(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const m = INSTANT.exec(raw.trim());
  if (m === null) return undefined;
  const date = m[1]!;
  if (parseLocalDate(date) === undefined) return undefined;
  const clock = parseLocalClock(`${m[2]}:${m[3]}${m[4] === undefined ? '' : `:${m[4]}`}${m[5] === undefined ? '' : `.${m[5]}`}`);
  if (clock === undefined) return undefined;
  const offset = m[6]!.toUpperCase();
  const normalizedOffset = offset.length === 5 ? `${offset.slice(0, 3)}:${offset.slice(3)}` : offset;
  const base = `${date}T${pad2(clock.hour)}:${pad2(clock.minute)}:${pad2(clock.second)}`;
  const fraction = clock.millisecond === 0 && m[5] === undefined ? '' : `.${String(clock.millisecond).padStart(3, '0')}`;
  return `${base}${fraction}${normalizedOffset}`;
}

/** 两位补零。 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
