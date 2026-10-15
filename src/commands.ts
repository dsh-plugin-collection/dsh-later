/**
 * 客户端 → host 变更通道：通过 DSH 的 slash-command 一等机制把 GUI 的
 * 创建/删除/列表请求送到宿主，由 handler 复用 `user-tools` 一次性写入会话日志。
 *
 * 为什么不用 Typert Remote：命令 handler 直接携带 `agent`，天然按会话路由，
 * 且 `command/run` / `command/done` 自动落日志（审计友好）。`recordInput: false`
 * 避免把 GUI 的 JSON 载荷重复写进日志（权威载荷在 domain 事件里）。
 *
 * 客户端经 `session.command('/user-schedule-create <json>')` 调用；
 * 返回的 `RemoteResult<{matched}>` 只表达“已受理”，状态以 `userSchedules`
 * 投影回流（commands 框架本身的 admission 语义）。
 * @module dsh-later/commands
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands';
import {
  userScheduleCreate,
  userScheduleDelete,
  userScheduleEditPrompt,
  userScheduleList,
  userSchedulePause,
  userScheduleResume,
  resolvePromptLimits,
} from './user-tools.js';
import type { PromptLimits } from './user-tools.js';
import { DEFAULT_MAX_SCHEDULES } from './user-tools.js';
import { epochFromLocal, localFieldsOf } from './smart-window.js';
import { detectTimeZone, formatAbsolute, formatHhmm, formatRelative } from './time-utils.js';
import { hostDictFor } from './strings.js';

/** 用户创建/删除成功后的通知回调（宿主用它重驱用户调度器）。 */
export type UserChangeNotifier = (agent: Agent) => void;

/**
 * 用户主动插话回调（GUI「插话发送」按钮触发）。handler 返回 steer 结果；
 * - `{ ok: true, steered: true }` 表示已成功把消息立即推给 in-flight agent；
 * - `{ ok: false, code }` 表示拒绝（未到点 / 不存在 / every 类型暂不支持）。
 * @module dsh-later/commands
 */
export type UserSteerHandler = (
  agent: Agent,
  id: string,
) => Promise<
  | { readonly ok: true; readonly id: string; readonly steered: true }
  | { readonly ok: false; readonly code: string; readonly message: string }
>;

/** 命令名前缀（避免与其他插件命令冲突）。 */
const PREFIX = 'user-schedule';

/** 把任意异常稳定渲染为命令错误文本。 */
function renderError(message: string): CommandResult {
  return { kind: 'error', text: message };
}

/** 解析 JSON 载荷；非法返回错误描述。 */
function parsePayload(rawInput: string): { ok: true; value: unknown } | { ok: false; text: string } {
  const text = rawInput.trim();
  if (text.length === 0) return { ok: false, text: '缺少 JSON 载荷。' };
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, text: 'JSON 载荷必须是一个对象。' };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, text: 'JSON 载荷解析失败。' };
  }
}

/** `parseScheduleSpec` 的结果。 */
export type ParsedScheduleSpec =
  | { ok: true; kind: 'after'; afterSeconds: number }
  | { ok: true; kind: 'at'; at: { date: string; time: string; time_zone: string }; epoch: number }
  | { ok: false; error: string };

/**
 * `parseScheduleInput` 的结果：时间目标 + 剩余内容。
 *
 * `targets` 恒为 1..MAX_OCCURRENCES 个未来时刻：单条写法就是 1 个；
 * `+1h*3` / `+1h+30m` 这类多次写法给出多个，由命令层展开成同等数量的任务。
 * `target` 恒等于 `targets[0]`，为既有调用方保留。
 */
export type ParsedScheduleInput =
  | {
      ok: true;
      target: ResolvedTarget;
      targets: readonly ResolvedTarget[];
      content: string;
    }
  | { ok: false; error: string };

/** 语法开关（来自 settings.advancedSyntax）。 */
export interface ScheduleSyntaxOptions {
  /**
   * 高级语法（Beta）是否可用。
   *
   * `undefined` 与 `true` 都按开启处理——只有显式 `false` 才关闭，
   * 与 schema 的 `default(true)` 及旧调用方（不传第三参）的行为一致。
   */
  readonly advancedSyntax?: boolean;
}

/** 关闭高级语法时的统一提示：说清去哪儿开，而不是只说"不支持"。 */
export const ADVANCED_SYNTAX_DISABLED =
  '多次写法（+1h*3、+1h+1h+0.5h、15:32+16:32）属于 Beta 高级语法，当前已在设置中关闭。' +
  '开启路径：设置 → 插件 → 定时提醒 → 高级语法。';

/** 该时间写法是否属于高级语法（等间隔重复 / 相对序列 / 绝对锚点序列）。 */
function isMultiForm(target: TargetMatch['target']): boolean {
  return target.kind === 'repeats' || target.kind === 'sequence' || target.kind === 'chain';
}

/** 中文数字 → 数值（支持 十/两/半 由调用方特判）。 */
const CN_DIGIT: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function cnToNumber(text: string): number | undefined {
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const tenIdx = text.indexOf('十');
  if (tenIdx >= 0) {
    const head = text.slice(0, tenIdx);
    const tail = text.slice(tenIdx + 1);
    const headVal = head === '' ? 1 : CN_DIGIT[head];
    if (headVal === undefined) return undefined;
    let total = headVal * 10;
    if (tail !== '') {
      const tailVal = CN_DIGIT[tail];
      if (tailVal === undefined) return undefined;
      total += tailVal;
    }
    return total;
  }
  let total = 0;
  for (const ch of text) {
    const d = CN_DIGIT[ch];
    if (d === undefined) return undefined;
    total = total * 10 + d;
  }
  return total;
}

/** 归一化：全角冒号/数字 → 半角，压缩空白。 */
function normalizeInput(raw: string): string {
  return raw
    .replace(/[：]/g, ':')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, ' ')
    .trim();
}

/** 相对时长的中文单位秒数。 */
const CN_UNIT_SECONDS: Record<string, number> = {
  秒: 1, 秒钟: 1, 分: 60, 分钟: 60, 小时: 3600, 个小时: 3600, 钟头: 3600, 天: 86400, 日: 86400, 周: 604800,
};

/** 一次命令最多展开出的任务条数（`+1h*11`、11 段序列一律拒绝）。 */
export const MAX_OCCURRENCES = 10;

/**
 * 多次写法下相邻两次之间的最小间隔（秒）。
 *
 * 只约束「多次」：单条 `/later +5s` 是既有合法用法（README 演示与测试都依赖它），
 * 不因这道地板失效。`every` 记录在宿主侧另有 ≥300s 口径；多次写法走的是
 * 「展开成 N 条 one-shot」，不经过 `every`，所以这里自带一道 60s 防护，
 * 免得 `+1s*10` 一行命令把 dock 刷成瀑布。
 */
export const MIN_OCCURRENCE_INTERVAL_SECONDS = 60;

/**
 * 单个「时长段」：段内可多单位连写（`1h30m` = 90 分钟），段内累加。
 * 尾部的 `s*` 会吃掉紧跟的空格，段与段之间靠 `+` 分隔。
 */
const LATIN_SEGMENT_RE = /^(?:\d+(?:\.\d+)?\s*[smhdw]\s*)+/i;

/**
 * 重复次数后缀：`*3` / `×3` / `x3`，可带中文量词（`*3次`）。
 *
 * `(?=\s|$)` 是刻意的：`+1h*3号楼见` 里次数没有以空格收尾，说明 `*3` 属于正文，
 * 宁可报「写法未生效」也不要猜成 3 次——猜错的代价是用户以为设了 3 条任务。
 */
const REPEAT_SUFFIX_RE = /^\s*[*×xX]\s*(\d+)\s*(?:次|回|遍)?(?=\s|$)/;

/**
 * 时间表达式之后的「疑似时间残片」。
 *
 * 旧版正则的 `(?![0-9a-z])` 放过了 `*` 与 `+`，于是 `/later +1h*3 x` 被静默解析成
 * 「1 小时后发一条、内容写成 `*3 x`」。这类形态现在一律收口成显式报错。
 *
 * `\.{2,3}\s*\d` / `…\s*\d` 是同一个洞的另一个入口（`+1h..3h` → 内容 `..3h`）。
 * 要求点后**必须跟数字**才判为残片：正文以省略号开头（`+1h … 记得带伞`）不受影响。
 */
const DANGLING_TIME_RE = /^\s*(?:[*×]\s*\d|[xX]\s*\d(?![0-9])|\+\s*\d|(?:\.{2,}|…)\s*\d)/;

/** 时长段 → 秒（`1h30m` → 5400）；无有效单位或总值 ≤0 返回 undefined。 */
function latinSegmentSeconds(segment: string): number | undefined {
  let total = 0;
  const unitRe = /(\d+(?:\.\d+)?)\s*([smhdw])/gi;
  for (const match of segment.matchAll(unitRe)) {
    const n = Number(match[1]);
    const u = (match[2] ?? 'm').toLowerCase();
    total += n * (u === 's' ? 1 : u === 'm' ? 60 : u === 'h' ? 3600 : u === 'd' ? 86400 : 604800);
  }
  return total > 0 ? Math.round(total) : undefined;
}

/**
 * 从 `from` 起扫描「`+` 分隔的时长段序列」：`1h`、`1h30m`、`1h+30m+15m`。
 * 至少匹配一段才返回；`consumed` 相对 `from`。段数不设上限，交由校验层拒绝过长序列。
 *
 * 段尾空白**不算进 consumed**（等价于旧版正则的回溯行为）：`+90s x` 里那个空格必须
 * 留给边界判定，否则紧跟正文的 `x`/数字会被误当成「时间写法被截断」而整体拒收。
 */
function scanLatinSegments(s: string, from: number): { consumed: number; segments: number[] } | undefined {
  let i = from;
  let lastEnd = from; // 最后一个**完整时长段**结束的位置
  const segments: number[] = [];
  for (;;) {
    const match = LATIN_SEGMENT_RE.exec(s.slice(i));
    if (match === null) break;
    const seconds = latinSegmentSeconds(match[0] ?? '');
    if (seconds === undefined) break;
    segments.push(seconds);
    i += match[0].length;
    lastEnd = trimTrailingSpace(s, i, from);
    const gap = /^\s*\+/.exec(s.slice(i));
    if (gap === null) return { consumed: lastEnd - from, segments };
    i += gap[0].length;
  }
  // 断在 `+` 之后时回退到上一个完整段：让残片守卫看见那个 `+`，
  // 于是 `+1h+15:32`（相对段后面接绝对时刻）报「时间写法没生效」，
  // 而不是含糊的「无法识别的时间格式」——前者告诉用户改哪里，后者不会。
  return segments.length > 0 ? { consumed: lastEnd - from, segments } : undefined;
}

/** 把已落定的目标折算成 epoch 毫秒（after 相对 `now`，at 直接取解析出的时刻）。 */
function epochOfTarget(target: ResolvedTarget, now: number): number {
  return target.kind === 'after' ? now + target.afterSeconds * 1000 : target.epoch;
}

/**
 * 多次写法的校验+展开结果。
 */
type OccurrenceExpansion = { ok: true; segments: readonly number[] } | { ok: false; error: string };

/**
 * 校验并展开「重复 / 序列」写法；不是多次写法时返回 undefined（走原单条路径）。
 *
 * 语义（产品决策）：
 * - 首次落在第一个间隔之后：`+1h*3` → t+1h、t+2h、t+3h；
 * - 序列**链式累加**：`+1h+1h+0.5h` → t+1h、t+2h、t+2.5h（表达「提前 2h→1h→30m」的梯度催办）；
 * - 展开成 N 条 one-shot（`after`），而不是 1 条 `every`：宿主 `EveryScheduleRecord`
 *   没有次数字段，而 one-shot 天然带 pause/resume、行内编辑、单条取消、到点自动清理，
 *   且时刻锚定可预测，不会因会话忙碌而漂移。
 */
function expandOccurrences(target: TargetMatch['target']): OccurrenceExpansion | undefined {
  if (target.kind !== 'repeats' && target.kind !== 'sequence') return undefined;

  const tooMany = `一次最多 ${MAX_OCCURRENCES} 条（多次写法会展开成同等数量的一次性任务，并受会话总额度约束）。`;
  const tooTight = `多次写法的间隔至少 ${MIN_OCCURRENCE_INTERVAL_SECONDS} 秒；只想发一条可以不带次数。`;

  if (target.kind === 'repeats') {
    const { baseSeconds, count } = target;
    if (!Number.isInteger(count) || count < 1) {
      return { ok: false, error: '重复次数必须是正整数，如 +1h*3、+30m×2。' };
    }
    if (count > MAX_OCCURRENCES) return { ok: false, error: `重复次数过多（${count} 次）。${tooMany}` };
    if (count > 1 && baseSeconds < MIN_OCCURRENCE_INTERVAL_SECONDS) return { ok: false, error: tooTight };
    return { ok: true, segments: Array.from({ length: count }, () => baseSeconds) };
  }

  const { segments } = target;
  if (segments.length > MAX_OCCURRENCES) return { ok: false, error: `时间序列过长（${segments.length} 段）。${tooMany}` };
  if (segments.some((seconds) => seconds < MIN_OCCURRENCE_INTERVAL_SECONDS)) return { ok: false, error: tooTight };
  return { ok: true, segments };
}

/** 绝对时刻目标的原始匹配形状（日期/时刻成分，尚未落定成 epoch）。 */
type AtTargetSpec = {
  kind: 'at';
  date?: string;
  month?: number;
  day?: number;
  year?: number;
  dayOffset?: number;
  hour: number;
  minute: number;
};

/**
 * 锚点序列里的一步。
 *
 * - `at`：又一个墙钟时刻（`16:32`、`明天9点`），落定规则复用 {@link resolveTarget}
 *   ——把上一次的落点当作 "now"，于是「今天已过则顺延到明天」这条既有规则自动生效；
 * - `duration`：`+1d` 这类拉丁时长。**日历日**（days）与**真实秒数**（seconds）分开存：
 *   日/周走墙钟推进（连续三天都是 9:00，跨夏令时不漂），时/分/秒走瞬时累加
 *   （"一小时后"就真的是 3600 秒）。`+1.5d` 拆成「墙钟 +1 天，再瞬时 +12 小时」。
 */
type ChainStep =
  | { kind: 'at'; target: AtTargetSpec }
  | { kind: 'duration'; days: number; seconds: number };

/** 内部匹配结果。 */
interface TargetMatch {
  consumed: number;
  target:
    | { kind: 'after'; afterSeconds: number }
    | { kind: 'repeats'; baseSeconds: number; count: number }
    | { kind: 'sequence'; segments: readonly number[] }
    | { kind: 'chain'; anchor: AtTargetSpec; steps: readonly ChainStep[] }
    | AtTargetSpec;
}

/** 去掉 `[0, i)` 尾部空白，返回新的长度（不小于 `from`）。 */
function trimTrailingSpace(s: string, i: number, from: number): number {
  let j = i;
  while (j > from && /\s/.test(s[j - 1] ?? '')) j -= 1;
  return j;
}

/**
 * 把一个拉丁时长段解析成锚点序列的一步：`1d` → 墙钟加一天；`2h30m` → 瞬时加 9000 秒。
 * 全零或不含单位返回 undefined（调用方会继续尝试把它当绝对时刻解析）。
 */
function latinDurationStep(segment: string): ChainStep | undefined {
  let days = 0;
  let seconds = 0;
  const unitRe = /(\d+(?:\.\d+)?)\s*([smhdw])/gi;
  for (const match of segment.matchAll(unitRe)) {
    const n = Number(match[1]);
    const u = (match[2] ?? 'm').toLowerCase();
    if (u === 'd') days += n;
    else if (u === 'w') days += n * 7;
    else seconds += n * (u === 's' ? 1 : u === 'm' ? 60 : 3600);
  }
  // 小数天拆成「整天 + 瞬时尾巴」，避免把 0.5d 四舍五入成 1 天
  const wholeDays = Math.floor(days);
  seconds += (days - wholeDays) * 86400;
  const roundedSeconds = Math.round(seconds);
  if (wholeDays === 0 && roundedSeconds === 0) return undefined;
  return { kind: 'duration', days: wholeDays, seconds: roundedSeconds };
}

/** 本地日期字符串 `YYYY-MM-DD`。 */
function localDateOf(epoch: number, timeZone: string): string {
  const f = localFieldsOf(epoch, timeZone);
  return `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
}

/** 纯日历日加减（用 UTC 字段做日期运算，与时区无关，不受夏令时切日影响）。 */
function addLocalDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC((year ?? 1970) as number, ((month ?? 1) as number) - 1, ((day ?? 1) as number) + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

/**
 * 把绝对时刻锚点向右扩展成 `+` 序列：`15:32+16:32+17:32`、`9:00+1d+1d`、`明天9点+1h`。
 *
 * 只允许「绝对锚点 → 往后累加」这一个方向。`+1h+15:32`（相对段后面接绝对时刻）
 * 故意不支持：那样会出现 `16:32+1h+15:00` 这种要猜意图的来回跳，宁可在残片守卫里报错。
 */
function extendAnchorChain(s: string, base: TargetMatch): TargetMatch | undefined {
  const anchor = base.target;
  if (anchor.kind !== 'at') return undefined;

  const steps: ChainStep[] = [];
  let i = base.consumed;
  for (;;) {
    const gap = /^\s*\+/.exec(s.slice(i));
    if (gap === null) break;
    const from = i + gap[0].length;

    // a) 拉丁时长步：+1d / +2h / +1d12h（段内混合单位合成一步：先墙钟日后瞬时）
    const dur = LATIN_SEGMENT_RE.exec(s.slice(from));
    const durationStep = dur === null ? undefined : latinDurationStep(dur[0] ?? '');
    if (dur !== null && durationStep !== undefined) {
      // 时长段末尾**未去空白**的位置：紧跟数字/字母（`+1h30`）说明这一步不是干净时长，
      // 停下来交给残片守卫报错，而不是猜半个时长。
      const rawEnd = from + dur[0].length;
      if (/[0-9a-z]/i.test(s[rawEnd] ?? '')) break;
      steps.push(durationStep);
      i = trimTrailingSpace(s, rawEnd, from);
      continue;
    }

    // b) 绝对时刻步：+16:32 / +1732 / +9点半 / +8月22日 10点
    const stepMatch = matchSingleTimeExpr(s.slice(from));
    if (stepMatch === undefined || stepMatch.target.kind !== 'at') break;
    steps.push({ kind: 'at', target: stepMatch.target });
    i = trimTrailingSpace(s, from + stepMatch.consumed, from);
  }

  if (steps.length === 0) return undefined;
  return { consumed: i, target: { kind: 'chain', anchor, steps } };
}

/** 在归一化文本开头尝试匹配一个时间表达式；失败返回 undefined。 */
function matchTimeExpr(s: string): TargetMatch | undefined {
  const single = matchSingleTimeExpr(s);
  if (single === undefined) return undefined;
  if (single.target.kind !== 'at') return single;
  // 绝对时刻可以单独用（历史行为），也可以作锚点向右串 `+` 序列
  return extendAnchorChain(s, single) ?? single;
}

/** 单个时间表达式的匹配（不含锚点序列扩展）。 */
function matchSingleTimeExpr(s: string): TargetMatch | undefined {
  // 1. 拉丁相对时长：+30m / +1h30m / +90s / +1w / +2.5h，
  //    可带重复次数 +1h*3（等间隔 ×N）或序列 +1h+1h+0.5h（链式累加）。
  if (s.startsWith('+')) {
    const scan = scanLatinSegments(s, 1);
    if (scan !== undefined && scan.segments.length > 0) {
      let consumed = 1 + scan.consumed;
      let target: TargetMatch['target'];
      if (scan.segments.length === 1) {
        // 单段：尝试吞掉紧跟的 *N / ×N / xN（`+1h*3`、`+1h30m×2`、`+1h x2次`）
        const suffix = REPEAT_SUFFIX_RE.exec(s.slice(consumed));
        const baseSeconds = scan.segments[0] as number;
        if (suffix !== null) {
          consumed += suffix[0].length;
          target = { kind: 'repeats', baseSeconds, count: Number(suffix[1]) };
        } else {
          target = { kind: 'after', afterSeconds: baseSeconds };
        }
      } else {
        target = { kind: 'sequence', segments: scan.segments };
      }
      // 边界：时间写法后面不能紧跟数字/字母（`+1h3`、`+1hxyz` 一律不认）——
      // 旧版用 `(?![0-9a-z])` 表达同一条规则，这里原样保留。次数后缀自带
      // `(?=\s|$)`，所以吞掉 `*3` 后必然落在空白/结尾上，不会被这条误杀。
      const boundary = s[consumed];
      if (boundary !== undefined && /[0-9a-z]/i.test(boundary)) return undefined;
      return { consumed, target };
    }
  }

  // 2. 中文相对时长：30分钟后 / 半小时后 / 两小时后 / 1天以后 / 2.5小时后，
  //    同样支持次数后缀（半小时后×3）
  const cnRel = /^(半|\d+(?:\.\d+)?|[零一二两三四五六七八九十]+)\s*(个\s*小时|秒钟?|分钟?|小时|钟头|天|日|周)\s*(?:之)?后?/.exec(s);
  if (cnRel !== null) {
    const value = cnRel[1] === '半' ? 0.5 : cnToNumber(cnRel[1] ?? '');
    const unitKey = (cnRel[2] ?? '').replace(/\s+/g, '');
    const unitSeconds = CN_UNIT_SECONDS[unitKey];
    if (value === undefined || value <= 0 || unitSeconds === undefined) return undefined;
    const baseSeconds = Math.round(value * unitSeconds);
    let consumed = cnRel[0].length;
    const suffix = REPEAT_SUFFIX_RE.exec(s.slice(consumed));
    if (suffix !== null) {
      consumed += suffix[0].length;
      return { consumed, target: { kind: 'repeats', baseSeconds, count: Number(suffix[1]) } };
    }
    return { consumed, target: { kind: 'after', afterSeconds: baseSeconds } };
  }

  // 3. 紧凑日期：YYYYMMDD-HHMM / MMDD-HHMM（显式日期，不自动顺延）
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

  // 4. 通用组合：[今天|明天|后天|大后天] [日期] 时刻
  let i = 0;
  let dayOffset: number | undefined;
  const dayWords: readonly (readonly [string, number])[] = [['大后天', 3], ['后天', 2], ['明天', 1], ['明日', 1], ['今天', 0], ['今日', 0]];
  for (const [word, offset] of dayWords) {
    if (s.startsWith(word)) {
      dayOffset = offset;
      i += word.length;
      break;
    }
  }
  while (s[i] === ' ') i += 1;

  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;
  const rest1 = s.slice(i);
  const fullDate = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})[日号]?/.exec(rest1);
  if (fullDate !== null) {
    year = Number(fullDate[1]);
    month = Number(fullDate[2]);
    day = Number(fullDate[3]);
    i += fullDate[0].length;
  } else {
    const shortDate = /^(\d{1,2})[月/-](\d{1,2})[日号]?/.exec(rest1);
    if (shortDate !== null && (shortDate[0].includes('月') || shortDate[0].includes('-') || shortDate[0].includes('/'))) {
      month = Number(shortDate[1]);
      day = Number(shortDate[2]);
      i += shortDate[0].length;
    }
  }
  while (s[i] === ' ') i += 1;

  // 时刻：15:32 / 15时32分 / 9点 / 9点半 / 9点整
  const rest2 = s.slice(i);
  let hour: number | undefined;
  let minute = 0;
  let timeLen = 0;
  const colonTime = /^(\d{1,2}):(\d{2})/.exec(rest2);
  const cnTime = /^(\d{1,2}|[零一二两三四五六七八九十]+)\s*[点时]\s*(?:(半|\d{1,2}|[一二三四五]+)\s*分?)?\s*整?/.exec(rest2);
  if (colonTime !== null) {
    hour = Number(colonTime[1]);
    minute = Number(colonTime[2]);
    timeLen = colonTime[0].length;
  } else if (cnTime !== null) {
    const h = cnToNumber(cnTime[1] ?? '');
    if (h === undefined) return undefined;
    hour = h;
    const minRaw = cnTime[2];
    if (minRaw !== undefined) {
      minute = minRaw === '半' ? 30 : (cnToNumber(minRaw) ?? -1);
      if (minute < 0) return undefined;
    }
    timeLen = cnTime[0].length;
  } else if (dayOffset === undefined && year === undefined && month === undefined) {
    // 裸 HHMM（仅当无任何日期成分；后面必须是空白、`+`（锚点序列的分隔符）或结尾）
    const bare = /^(\d{2})(\d{2})(?!\d)(?=\s|\+|$)/.exec(rest2);
    if (bare !== null) {
      hour = Number(bare[1]);
      minute = Number(bare[2]);
      timeLen = bare[0].length;
    }
  }
  if (hour === undefined) return undefined;
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

/** 目标解析结果（时间 → 具体时刻/时长的落定）。 */
type ResolvedTarget =
  | { kind: 'after'; afterSeconds: number }
  | { kind: 'at'; at: { date: string; time: string; time_zone: string }; epoch: number };
type TargetResolution =
  | { status: 'ok'; target: ResolvedTarget }
  | { status: 'error'; error: string };

/** 把 matchTimeExpr 的原始匹配落定为具体目标（含日期推算与越界校验）。 */
function resolveTarget(matched: TargetMatch, now: number, timeZone: string): TargetResolution {
  const t = matched.target;
  if (t.kind === 'after') {
    return { status: 'ok', target: { kind: 'after', afterSeconds: t.afterSeconds } };
  }
  // 多次写法在 parseScheduleInput 里已展开成 N 个目标，不该走到这里；
  // 这条分支只为收窄下面的 `at` 联合（真到了这里就是调用顺序写错了）。
  if (t.kind === 'repeats' || t.kind === 'sequence' || t.kind === 'chain') {
    return { status: 'error', error: '内部错误：多次写法未经展开处理。' };
  }

  // 范围校验
  if ((t.month !== undefined && (t.month < 1 || t.month > 12)) ||
      (t.day !== undefined && (t.day < 1 || t.day > 31)) ||
      t.hour > 23 || t.minute > 59) {
    return { status: 'error', error: '日期或时间数值无效。' };
  }

  const hhmm = `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
  const epochOf = (date: string): number | undefined => {
    const e = epochFromLocal(date, `${hhmm}:00`, timeZone);
    return e === undefined || Number.isNaN(e) ? undefined : e;
  };
  const atOk = (date: string): TargetResolution => ({
    status: 'ok',
    target: { kind: 'at', at: { date, time: `${hhmm}:00`, time_zone: timeZone }, epoch: epochOf(date) as number },
  });

  // 显式完整日期（含年）
  if (t.year !== undefined && t.month !== undefined && t.day !== undefined) {
    const date = `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
    if (epochOf(date) === undefined) return { status: 'error', error: '日期不存在。' };
    if ((epochOf(date) as number) <= now) return { status: 'error', error: '目标时间已过去。' };
    return atOk(date);
  }

  // 显式月日（今年，已过则明年）
  if (t.month !== undefined && t.day !== undefined) {
    const thisYear = localFieldsOf(now, timeZone).year;
    for (const y of [thisYear, thisYear + 1]) {
      const date = `${y}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
      const epoch = epochOf(date);
      if (epoch !== undefined && epoch > now) return atOk(date);
    }
    return { status: 'error', error: '目标时间已过去。' };
  }

  // 今天/明天/后天/大后天（显式指定，不自动顺延）
  if (t.dayOffset !== undefined) {
    const f = localFieldsOf(now + t.dayOffset * 24 * 3600 * 1000, timeZone);
    const date = `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
    const epoch = epochOf(date);
    if (epoch === undefined) return { status: 'error', error: '无法解析目标时间。' };
    if (epoch <= now) return { status: 'error', error: '该时刻今天已过去，可改用「明天」或具体日期。' };
    return atOk(date);
  }

  // 仅时刻：从今天起顺延，最多 7 天
  for (let add = 0; add < 8; add += 1) {
    const f = localFieldsOf(now + add * 24 * 3600 * 1000, timeZone);
    const date = `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
    const epoch = epochOf(date);
    if (epoch !== undefined && epoch > now) return atOk(date);
  }
  return { status: 'error', error: '无法解析目标时间。' };
}

/** 锚点序列的落定结果。 */
type ChainResolution = { ok: true; targets: ResolvedTarget[] } | { ok: false; error: string };

/**
 * 把锚点序列落定成 N 个**绝对墙钟时刻**（`at` 目标）。
 *
 * 落点用 `at` 而不是 `after` 秒数是刻意的：`9:00+1d+1d` 必须三天都落在 9:00，
 * 而按 86400 秒累加在 `America/Los_Angeles`、`Europe/London` 这类有夏令时的时区
 * 会漂成 8:00/10:00。代价是 `at` 任务不支持面板的「暂停」（暂停只认 after），
 * 单条取消、行内编辑、到点自动清理照常可用。
 */
function resolveChain(
  chain: { anchor: AtTargetSpec; steps: readonly ChainStep[] },
  now: number,
  timeZone: string,
): ChainResolution {
  const landed = resolveTarget({ consumed: 0, target: chain.anchor }, now, timeZone);
  if (landed.status === 'error') return { ok: false, error: landed.error };
  if (landed.target.kind !== 'at') return { ok: false, error: '锚点必须是绝对时刻。' };

  const targets: ResolvedTarget[] = [landed.target];
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
        // 瞬时累加：「一小时后」就是 3600 秒后，墙钟跟着走——跨夏令时时这正是预期
        epoch += step.seconds * 1000;
        date = localDateOf(epoch, timeZone);
        const f = localFieldsOf(epoch, timeZone);
        time = `${String(f.hour).padStart(2, '0')}:${String(f.minute).padStart(2, '0')}:00`;
      }
    } else {
      // 绝对时刻步：把上一次落点当 now 交给 resolveTarget，于是「该时刻今天已过就顺延到
      // 明天」这条既有规则自动作用在每一步上（23:00+01:00 → 次日 01:00）。
      const next = resolveTarget({ consumed: 0, target: step.target }, epoch, timeZone);
      if (next.status === 'error') return { ok: false, error: next.error };
      if (next.target.kind !== 'at') return { ok: false, error: '序列里的时刻写法无效。' };
      date = next.target.at.date;
      time = next.target.at.time;
      epoch = next.target.epoch;
    }
    targets.push({ kind: 'at', at: { date, time, time_zone: timeZone }, epoch });
  }
  return { ok: true, targets };
}

/**
 * 解析 `/schedule` 与 `/later` 的完整输入：开头的时间表达式 + 剩余内容。
 *
 * 支持格式（示例）：
 *  - `+30m` `+1h30m` `+90s` `+1w`
 *  - `30分钟后` `半小时后` `两小时后` `1天以后`
 *  - `1532` `15:32` `15：32` `15时32分` `9点` `9点半`
 *  - `明天 15:32` `后天9点` `大后天 10:00`
 *  - `8月21日 15:32` `08-21 15:32`
 *  - `2026-08-21 15:32` `0821-1532` `20260821-1532`
 *  - 等间隔重复：`+1h*3` `+30m×2` `两小时后x3次` → t+1h、t+2h、t+3h
 *  - 链式序列：`+1h+1h+0.5h` → t+1h、t+2h、t+2.5h（梯度催办）
 *
 * 多次写法一律展开成 N 条 `after` 一次性任务（不是 1 条 `every`），理由见
 * {@link expandOccurrences}。上限 `MAX_OCCURRENCES`，多次写法的最小间隔
 * `MIN_OCCURRENCE_INTERVAL_SECONDS`。
 *
 * `limits` 可选：未传时回落到 `DEFAULT_MAX_PROMPT_CHARS=1000`，错误文案里
 * 的字符数与 settings 实际生效值一致。
 */
export function parseScheduleInput(
  raw: string,
  now: number,
  timeZone: string,
  limits: PromptLimits = { allowLong: false, maxChars: 1000 },
  options: ScheduleSyntaxOptions = { advancedSyntax: true },
): ParsedScheduleInput {
  const s = normalizeInput(raw);
  if (s.length === 0) return { ok: false, error: '用法：/schedule <时间> <内容>，如 /schedule 1532 检查构建结果' };

  const matched = matchTimeExpr(s);
  if (matched === undefined) {
    return {
      ok: false,
      error:
        '无法识别的时间格式。支持：+30m、1532、15:32、30分钟后、明天9点、2026-08-21 15:32；' +
        '重复 +1h*3；序列 +1h+1h+0.5h。',
    };
  }

  // 残片守卫：时间写法「没被吞干净」的形态（`15:32*3`、`+1h+1h*2`、`+1h*3号楼`）。
  // 旧版正则的负向断言放过了 `*` 与 `+`，于是这类输入被静默解析成「单条 +1h，
  // 内容里带着 *3」——用户以为设了 3 次，实际只收到一条乱码提醒。宁可报错。
  const rest = s.slice(matched.consumed);
  if (DANGLING_TIME_RE.test(rest)) {
    return {
      ok: false,
      error:
        '时间写法后面还跟着一段时长/次数，没有生效。多时刻请写成 +1h*3（等间隔 3 次）或 15:32+16:32、9:00+1d（序列，用 + 分隔）；' +
        '次数后面要留一个空格。若那部分是正文，请换个说法。',
    };
  }

  // Beta 开关：多次写法可关。**关闭 ≠ 回到旧行为**——旧行为是静默建成一条乱码任务，
  // 那是 bug，不在可回退的功能面里；这里只把它从"展开成 N 条"降级为"明确拒绝"。
  if (options.advancedSyntax === false && isMultiForm(matched.target)) {
    return { ok: false, error: ADVANCED_SYNTAX_DISABLED };
  }

  const occurrences = expandOccurrences(matched.target);
  if (occurrences !== undefined && !occurrences.ok) return { ok: false, error: occurrences.error };

  let targets: readonly ResolvedTarget[];
  if (matched.target.kind === 'chain') {
    const { steps } = matched.target;
    if (steps.length + 1 > MAX_OCCURRENCES) {
      return { ok: false, error: `时间序列过长（${steps.length + 1} 个时刻）。${MAX_OCCURRENCES} 个为上限。` };
    }
    const chain = resolveChain(matched.target, now, timeZone);
    if (!chain.ok) return { ok: false, error: chain.error };
    // 相邻落点的最小间隔：`9:00+1s` 这类瞬时步会绕过时长段的地板，在这里兜住
    for (let index = 1; index < chain.targets.length; index += 1) {
      const prev = chain.targets[index - 1] as ResolvedTarget;
      const cur = chain.targets[index] as ResolvedTarget;
      const gapSeconds = (epochOfTarget(cur, now) - epochOfTarget(prev, now)) / 1000;
      if (gapSeconds < MIN_OCCURRENCE_INTERVAL_SECONDS) {
        return { ok: false, error: `相邻两个时刻相差 ${Math.round(gapSeconds)} 秒，多次写法至少要隔 ${MIN_OCCURRENCE_INTERVAL_SECONDS} 秒。` };
      }
    }
    targets = chain.targets;
  } else if (occurrences !== undefined) {
    const expanded: ResolvedTarget[] = [];
    let cumulative = 0;
    for (const seconds of occurrences.segments) {
      cumulative += seconds;
      expanded.push({ kind: 'after', afterSeconds: cumulative });
    }
    targets = expanded;
  } else {
    const resolved = resolveTarget(matched, now, timeZone);
    if (resolved.status === 'error') return { ok: false, error: resolved.error };
    targets = [resolved.target];
  }

  const content = rest.trim();
  if (content.length === 0) return { ok: false, error: '提醒内容不能为空。' };
  if (content.length > limits.maxChars) {
    return { ok: false, error: `提醒内容不能超过 ${limits.maxChars} 字符。` };
  }

  return { ok: true, target: targets[0] as ResolvedTarget, targets, content };
}

/**
 * 兼容旧签名：解析纯时间描述（不含内容），**只支持单条**。
 *
 * 多次/序列写法会被明确拒绝：本函数的消费方（GUI 单次通道）一次只能落一条记录，
 * 静默取第一条等于把用户的「3 次」吃掉。
 */
export function parseScheduleSpec(spec: string, now: number, timeZone: string): ParsedScheduleSpec {
  const s = normalizeInput(spec);
  const matched = matchTimeExpr(s);
  if (matched === undefined) {
    return { ok: false, error: '无法识别的时间格式。支持：+30m、1532、15:32、30分钟后、明天9点 等。' };
  }
  const occurrences = expandOccurrences(matched.target);
  if (occurrences !== undefined && !occurrences.ok) return { ok: false, error: occurrences.error };
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
  if (resolved.status === 'error') return { ok: false, error: resolved.error };
  if (s.slice(matched.consumed).trim().length > 0) {
    return { ok: false, error: '无法识别的时间格式。支持：+30m、1532、15:32、30分钟后、明天9点 等。' };
  }
  if (resolved.target.kind === 'after') {
    return { ok: true, kind: 'after', afterSeconds: resolved.target.afterSeconds };
  }
  return { ok: true, kind: 'at', at: resolved.target.at, epoch: resolved.target.epoch };
}

/**
 * 多次写法的时刻列表文案：首条给完整日期，同一天的后续条只给 `HH:mm`。
 *
 * 跨天的序列（`+1d+1d*3` 之类）会退回到完整日期形式——只看 `HH:mm` 会丢「哪一天」。
 */
function describeEpochs(epochs: readonly number[], timeZone: string): string {
  const first = epochs[0];
  if (first === undefined) return '';
  const base = localFieldsOf(first, timeZone);
  return epochs
    .map((epoch, index) => {
      if (index === 0) return formatAbsolute(epoch, timeZone);
      const f = localFieldsOf(epoch, timeZone);
      const sameDate = f.year === base.year && f.month === base.month && f.day === base.day;
      return sameDate ? formatHhmm(epoch, timeZone) : formatAbsolute(epoch, timeZone);
    })
    .join('、');
}

/** 命令工厂：返回三个命令定义。
 *
 * `getSettings` 支持传数字（静态，兼容旧签名）、返回 `{maxSchedules}` 的 getter，
 * `() => { maxSchedules, allowLongPrompts, maxPromptChars }` 的 getter——传 getter
 * 时每次调用读取设置页的**实时**上限（设置保存后即时生效，按需 scope.get()，
 * 与 dsh-smooth-stream 一致）。
 */
export function userScheduleCommands(
  ctx: Context,
  getSettings:
    | number
    | (() => number)
    | (() => { maxSchedules: number; allowLongPrompts?: boolean; maxPromptChars?: number; advancedSyntax?: boolean }) = DEFAULT_MAX_SCHEDULES,
  onUserChange?: UserChangeNotifier,
  onUserSteer?: UserSteerHandler,
  getLocale?: () => string | undefined,
): CommandDefinition[] {
  const t = hostDictFor(getLocale?.());
  const resolveSettings = (): { maxSchedules: number; limits: PromptLimits; advancedSyntax: boolean } => {
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
  const create: CommandDefinition = {
    name: `${PREFIX}-create`,
    description: t.cmdLaterDesc,
    recordInput: false,
    handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
      const parsed = parsePayload(invocation.rawInput);
      if (!parsed.ok) return renderError(parsed.text);
      const { maxSchedules, limits } = resolveSettings();
      const result = await userScheduleCreate(parsed.value, invocation.agent, ctx, maxSchedules, undefined, limits);
      if (!result.ok) {
        return { kind: 'error', text: `${result.code}: ${result.message}` };
      }
      try {
        onUserChange?.(invocation.agent);
      } catch {
        /* 通知失败不影响命令成功结果 */
      }
      return { kind: 'success', text: JSON.stringify({ ...result }) };
    },
  };

  const list: CommandDefinition = {
    name: `${PREFIX}-list`,
    description: t.cmdListDesc,
    recordInput: false,
    handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
      const result = await userScheduleList(invocation.agent, ctx);
      if (!result.ok) {
        return { kind: 'error', text: `${result.code}: ${result.message}` };
      }
      return { kind: 'success', text: JSON.stringify(result.schedules) };
    },
  };

  const del: CommandDefinition = {
    name: `${PREFIX}-delete`,
    description: t.cmdDeleteDesc,
    recordInput: false,
    handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
      const parsed = parsePayload(invocation.rawInput);
      if (!parsed.ok) return renderError(parsed.text);
      const id = (parsed.value as Record<string, unknown>)['id'];
      const result = await userScheduleDelete(id, invocation.agent, ctx);
      if (!result.ok) {
        return { kind: 'error', text: `${result.code}: ${result.message}` };
      }
      if (result.deleted) {
        try {
          onUserChange?.(invocation.agent);
        } catch {
          /* 通知失败不影响命令成功结果 */
        }
      }
      return { kind: 'success', text: JSON.stringify({ id: result.id, deleted: result.deleted }) };
    },
  };

  const edit: CommandDefinition = {
    name: `${PREFIX}-edit`,
    description: t.cmdEditDesc,
    recordInput: false,
    handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
      const parsed = parsePayload(invocation.rawInput);
      if (!parsed.ok) return renderError(parsed.text);
      const value = parsed.value as Record<string, unknown>;
      const { limits } = resolveSettings();
      const result = await userScheduleEditPrompt(value['id'], value['prompt'], invocation.agent, ctx, limits);
      if (!result.ok) {
        return { kind: 'error', text: `${result.code}: ${result.message}` };
      }
      try {
        onUserChange?.(invocation.agent);
      } catch {
        /* 通知失败不影响命令成功结果 */
      }
      return { kind: 'success', text: JSON.stringify(result) };
    },
  };

  /** 暂停 after 提醒：sidecar 留档 + 日志 delete（GUI ⏸）。 */
  const pause: CommandDefinition = {
    name: `${PREFIX}-pause`,
    description: t.cmdPauseDesc,
    recordInput: false,
    handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
      const parsed = parsePayload(invocation.rawInput);
      if (!parsed.ok) return renderError(parsed.text);
      const id = (parsed.value as Record<string, unknown>)['id'];
      const result = await userSchedulePause(id, invocation.agent, ctx);
      if (!result.ok) {
        return { kind: 'error', text: `${result.code}: ${result.message}` };
      }
      try {
        onUserChange?.(invocation.agent);
      } catch {
        /* 通知失败不影响命令成功结果 */
      }
      return { kind: 'success', text: JSON.stringify(result) };
    },
  };

  /** 恢复暂停项：after_seconds=remaining 重建；uid 不变、日志 id 会变。 */
  const resume: CommandDefinition = {
    name: `${PREFIX}-resume`,
    description: t.cmdResumeDesc,
    recordInput: false,
    handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
      const parsed = parsePayload(invocation.rawInput);
      if (!parsed.ok) return renderError(parsed.text);
      const uid = (parsed.value as Record<string, unknown>)['uid']
        ?? (parsed.value as Record<string, unknown>)['id'];
      const { maxSchedules } = resolveSettings();
      const result = await userScheduleResume(uid, invocation.agent, ctx, maxSchedules);
      if (!result.ok) {
        return { kind: 'error', text: `${result.code}: ${result.message}` };
      }
      try {
        onUserChange?.(invocation.agent);
      } catch {
        /* 通知失败不影响命令成功结果 */
      }
      return { kind: 'success', text: JSON.stringify(result) };
    },
  };

  // 用户主动插话（GUI「插话发送」按钮）：把已到点的 reminder 立即 steer 进 agent。
  // 仅 one-shot 支持；every 类提醒因 batch framing 需要更多 plumbing 暂未开放。
  const steer: CommandDefinition = {
    name: `${PREFIX}-steer-now`,
    description: t.cmdSteerDesc,
    recordInput: false,
    handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
      if (onUserSteer === undefined) {
        return { kind: 'error', text: '插话处理器未注入。' };
      }
      const parsed = parsePayload(invocation.rawInput);
      if (!parsed.ok) return renderError(parsed.text);
      const id = (parsed.value as Record<string, unknown>)['id'];
      if (typeof id !== 'string' || id.length === 0) {
        return { kind: 'error', text: 'invalid_rule: schedule id 必填。' };
      }
      try {
        const result = await onUserSteer(invocation.agent, id);
        if (!result.ok) {
          return { kind: 'error', text: `${result.code}: ${result.message}` };
        }
        return { kind: 'success', text: JSON.stringify(result) };
      } catch (error) {
        return {
          kind: 'error',
          text: `steer_failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };

  // 人类友好快捷命令：/schedule <时间> <内容>（到点以「上下文注入」提醒注入）与
  // /later <时间> <内容>（到点以「我」的身份发送 = 延迟发送语义，产品取舍见
  // 下方注释）。两者共享同一解析与创建逻辑，仅 delivery 不同。
  //
  // 附件（`invocation.attachments`）只在 user 路径透传：/later 声明了
  // `input.attachments`，命令框架已把 composer 附件做耐久化准入；/schedule
  // 未声明，宿主会在 handler 之前就拒绝带附件的调用，故 context 路径不接附件。
  const buildQuickHandler = (delivery: 'context' | 'user') => {
    return async (invocation: CommandInvocation): Promise<CommandResult> => {
      const timeZone = detectTimeZone();
      const { maxSchedules, limits, advancedSyntax } = resolveSettings();
      // 一次取 now：既喂给解析器，也作为成功文案的基准时刻，避免两次 Date.now()
      // 让「约 1 小时后」与实际 scheduledAt 差出一个毫秒级的心跳。
      const now = Date.now();
      const parsed = parseScheduleInput(invocation.rawInput, now, timeZone, limits, { advancedSyntax });
      if (!parsed.ok) return renderError(parsed.error);

      const content = parsed.content;
      const attachments = delivery === 'user' ? invocation.attachments : [];
      // P0-1：delivery/attachments 只能经可信通道参数显式声明（人类输入的 /later），
      // 不再注入原始载荷——通用载荷字段一律无效，防止任何通道夹带绕过注入防护。
      //
      // 多次写法（+1h*3 / +1h+1h+0.5h）逐条创建：内容与附件每条都相同（「每条都带
      // 同一份附件引用」的产品决策），dock 上是 N 行独立任务，可单条取消/编辑/暂停。
      // 中途名额耗尽保留已建成的部分并如实报出——回滚已完成的事务反而更难解释。
      const epochs: number[] = [];
      let failure: string | undefined;
      for (const target of parsed.targets) {
        const input =
          target.kind === 'after'
            ? { prompt: content, after_seconds: target.afterSeconds, time_zone: timeZone }
            : { prompt: content, at: target.at, time_zone: timeZone };
        const result = await userScheduleCreate(
          input,
          invocation.agent,
          ctx,
          maxSchedules,
          { trustedDelivery: delivery, attachments },
          limits,
        );
        if (!result.ok) {
          failure = `${result.code}: ${result.message}`;
          break;
        }
        epochs.push(target.kind === 'after' ? now + target.afterSeconds * 1000 : target.epoch);
      }
      if (epochs.length === 0) return renderError(failure ?? '创建失败。');

      try {
        onUserChange?.(invocation.agent);
      } catch {
        /* 通知失败不影响命令成功结果 */
      }
      const verb = delivery === 'user' ? '将于' : '已设定提醒：';
      const hint =
        epochs.length === 1
          ? delivery === 'user'
            ? '（到点会以你的身份发出）'
            : '（输入框上方蓝色待发条可随时取消）'
          : delivery === 'user'
            ? '（到点逐条以你的身份发出，待发条里可单独取消）'
            : '（每条可在输入框上方待发条单独取消）';
      const attachNote = attachments.length > 0 ? `（含 ${attachments.length} 个附件）` : '';
      const times =
        epochs.length === 1
          ? `${formatAbsolute(epochs[0] as number, timeZone)}（${formatRelative(epochs[0] as number, now)}）`
          : describeEpochs(epochs, timeZone);
      const head = epochs.length === 1 ? `${verb}${times}` : `已展开为 ${epochs.length} 条任务：${times}`;
      const partial =
        failure !== undefined && epochs.length < parsed.targets.length
          ? `｜注意：只建成 ${epochs.length}/${parsed.targets.length} 条，${failure}`
          : '';
      return { kind: 'success', text: `${head}「${content}」${attachNote}${hint}${partial}` };
    };
  };

  const quick: CommandDefinition = {
    name: 'schedule',
    description:
      '定时提醒快捷命令：/schedule <时间> <内容>。时间宽容识别：+30m、+1h30m、30分钟后、1532、15:32、9点半、明天9点、后天 10:00、8月21日 15:32、0821-1532、2026-08-21 15:32。' +
      '多次写法：+1h*3（等间隔 3 次）与 +1h+1h+0.5h（链式序列，累计时刻），各自展开成独立任务，最多 10 条、多次时间隔 ≥60 秒。',
    // 声明 input → DSH 命令系统在输入框「等待补全」：选中/回车 /schedule 后
    // 保留 `/schedule ` token + hint 提示，等你写完参数回车才执行；带参整行
    // 回车也走命令系统（不会当普通用户消息直接发给模型）。
    input: {
      hint: '<时间> <内容>，如 1532 检查构建结果；也支持 +30m、明天9点、+1h*3、+1h+30m',
    },
    recordInput: false,
    handler: buildQuickHandler('context'),
  };

  // /later：延迟发送语义 —— 到点以「我」的身份把内容当作真实输入发出。
  // 产品取舍（有意为之，与 dsh-sleep-send 对齐）：它会让无人真实键入的内容
  // 以用户气泡出现，绕过核心的「注入 vs 人键」信任边界；因此只保留在人类
  // 显式输入 `/later` 的路径，工具/面板一律走安全的 `context`（notice 注入）。
  //
  // `attachments: true`（0.2.0 命令契约）：声明本命令接受 composer 附件。
  // 缺它时带图提交会被内核三层拦截（输入框提交机 / 命令仲裁 / 宿主注册表
  // 都按 `input.attachments` 放行），表现为「有图片时 /later 无法发送」。
  // 声明后宿主先做耐久化准入，handler 从 `invocation.attachments` 拿到
  // 耐久引用（ImageBlock/FileBlock），存 sidecar，到点代发时拼进消息 content。
  const later: CommandDefinition = {
    name: 'later',
    description:
      '延迟发送：/later <时间> <内容>，到点以你的身份发出该内容（不是提醒，是代发）；可附带图片/文件，到点随内容一起发出。时间格式同 /schedule，' +
      '含多次写法：+1h*3（等间隔 N 次）、+1h+1h+0.5h（相对序列）、15:32+16:32 / 9:00+1d（锚点序列）会展开成多条代发任务（同一内容与附件逐条带上）。' +
      '多次写法为 Beta 语法，可在插件设置「高级语法」中关闭。',
    input: {
      hint: '<时间> <内容>，如 1532 检查构建结果；可附带图片/文件；多条用 +1h*3 或 +1h+30m；到点会以你的身份发出',
      attachments: true,
    },
    recordInput: false,
    handler: buildQuickHandler('user'),
  };

  return [create, list, del, edit, pause, resume, steer, quick, later];
}

/** 注册三个命令，返回统一 disposer。 */
export function registerUserScheduleCommands(
  ctx: Context,
  getSettings:
    | number
    | (() => number)
    | (() => { maxSchedules: number; allowLongPrompts?: boolean; maxPromptChars?: number; advancedSyntax?: boolean }) = DEFAULT_MAX_SCHEDULES,
  onUserChange?: UserChangeNotifier,
  onUserSteer?: UserSteerHandler,
  getLocale?: () => string | undefined,
): () => void {
  const disposers = userScheduleCommands(ctx, getSettings, onUserChange, onUserSteer, getLocale).map((definition) => {
    try {
      return ctx.commands.register(definition);
    } catch (error) {
      ctx.logger.warn(
        `later: 命令 ${definition.name} 注册失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return () => undefined;
    }
  });
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
