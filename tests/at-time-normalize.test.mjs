/**
 * `at` 的文法与规范化（Gitea issue #76 / GitHub 镜像 #6）。
 *
 * ## 这个文件在防什么
 *
 * 面板 `<input type="time">` 的原生输出是 `HH:mm`，模型也常写 `9:00:00`；而上游
 * `createAtScheduleRecord` 对本地时间要的是**两位小时 + 必带秒**。过去守门人
 * `validateCreateInput` 只检查「是不是字符串」就原样透传，于是这些形状 100% 被上游拒，
 * 回执是一句英文文法错（用户看到「自定义时间有问题」但不知道为什么），而**插件自己的预览层
 * 却判它们合法**——同一个时刻两套标准。跨代次实测（0.1.7-rc.2 / 0.2.0-rc.2 / 0.2.1-rc.2）
 * 回执逐字相同，所以这是插件边界的问题，等不到上游放宽文法。
 *
 * 于是断言分三层，缺一层都会留下「我以为修好了」的缝：
 *  1. **文法单测**：`parseLocalClock` / `canonical*` 的接受集与补零规则（含 `.5` = 500ms 这种
 *     容易写成 5ms 的地方）；
 *  2. **守门人**：合法形状被**规范化后**放行（断言的是 `value.at`，不是「没报错」）、
 *     畸形形状在这里就拒，且回执是中文、不含上游那句英文；
 *  3. **对真上游对账**：凡守门人放行的 `value.at`，喂进实际安装的 `@deepseek-ai/dsh-schedule`
 *     必须建成，且它算出的 `scheduledAt` 与预览层 `epochFromLocal` 是**同一个瞬点**。
 *     这一层不是装饰：前两层都只在本仓口径内自证，只有第 3 层能发现「我们补的形式上游其实
 *     不收」。上游文法哪天再变，这条会红——正是我们要的信号（issue #76 的根因就是没人钉这条）。
 * @module tests/at-time-normalize
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  canonicalInstantString,
  canonicalLocalClock,
  canonicalLocalDate,
  parseLocalClock,
  parseLocalDate,
} from '../lib/time-utils.js';
import { epochFromLocal } from '../lib/smart-window.js';
import { validateCreateInput } from '../lib/user-tools.js';

const TZ = 'Asia/Shanghai';

/**
 * 未来第 N 天的 `YYYY-MM-DD`（本地日历）。
 *
 * 为什么不用写死的日期：本文件里「真上游对账」那两条会**真的调** `createAtScheduleRecord`，
 * 而它拒过去时刻（`not_future`）。第一版把日期写死在 2026-10-26，到了那天用例自己就红了
 * —— 一个和被测代码毫无关系的红。凡是把日期交给上游的用例，日期必须现算。
 */
function inDays(days) {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 同 {@link inDays}，但月/日**不补零**（用来验守门人的补零，如 `2026-12-5`）。 */
function inDaysUnpadded(days) {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 下一个「美东回拨日」：11 月第一个周日，当天 01:30 会出现两次（歧义墙钟）。
 * 必须现算 —— 写死 2026-11-01 的话，11-01 之后这条又变成"过去时刻"被上游拒。
 */
function nextNyFallBack() {
  const startYear = new Date().getUTCFullYear();
  for (const year of [startYear, startYear + 1]) {
    for (let day = 1; day <= 7; day += 1) {
      const probe = new Date(Date.UTC(year, 10, day));
      if (probe.getUTCDay() !== 0) continue; // 11 月第一个周日
      const iso = `${year}-11-${String(day).padStart(2, '0')}`;
      // 回拨后 EST=−05:00；取较晚的那一次候选作为"是否已过去"的判据。
      if (new Date(`${iso}T01:30:00-05:00`).getTime() > Date.now()) return iso;
    }
  }
  throw new Error('找不到下一个美东回拨日');
}

/** 剥注释（结构断言只看代码体，见 `long-prompt-settings.test.mjs` 同一条理由）。 */
function codeOf(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 守门人放行时的 `value.at`（不放行就直接 fail，带上原报错）。 */
function acceptedAt(input, label) {
  const result = validateCreateInput(input);
  assert.equal(result.ok, true, `${label} 应被放行，实际：${JSON.stringify(result)}`);
  return result.value.at;
}

/** 用**实际安装的上游**建一次记录，返回 scheduledAt 的 epoch（失败则抛出错误文本）。 */
async function upstreamEpoch(at) {
  const sched = await import('@deepseek-ai/dsh-schedule');
  const record = sched.createAtScheduleRecord(
    sched.ScheduleId(`schedule-at-${Math.random().toString(36).slice(2)}`),
    'p',
    at,
    Date.now(),
    'probe',
  );
  return new Date(record.scheduledAt).getTime();
}

// ── 1. 文法 ────────────────────────────────────────────────────────────────────────

test('本地墙钟：宽容的形状都能解析，越界与残片一律非法', () => {
  assert.deepEqual(parseLocalClock('09:00'), { hour: 9, minute: 0, second: 0, millisecond: 0 });
  assert.deepEqual(parseLocalClock('9:00'), { hour: 9, minute: 0, second: 0, millisecond: 0 });
  assert.deepEqual(parseLocalClock('9:00:15'), { hour: 9, minute: 0, second: 15, millisecond: 0 });
  // `.5` 是 500ms，不是 5ms——上游口径如此，补零方向写反就会静默早 0.495 秒。
  assert.deepEqual(parseLocalClock('09:00:00.5'), { hour: 9, minute: 0, second: 0, millisecond: 500 });
  assert.deepEqual(parseLocalClock('09:00:00.05'), { hour: 9, minute: 0, second: 0, millisecond: 50 });
  assert.deepEqual(parseLocalClock(' 09:00 '), { hour: 9, minute: 0, second: 0, millisecond: 0 });

  for (const bad of ['24:00', '09:60', '09:00:60', '9:0', '0900', '09:00:00:00', '09:00:00.5000', '', '  ', '9:00am']) {
    assert.equal(parseLocalClock(bad), undefined, `${JSON.stringify(bad)} 不该被接受`);
  }
  assert.equal(parseLocalClock(undefined), undefined);
  assert.equal(parseLocalClock(900), undefined, '非字符串不进文法');
});

test('本地日历：补零、真实日与闰年', () => {
  assert.equal(canonicalLocalDate('2026-1-6'), '2026-01-06');
  assert.equal(canonicalLocalDate('2026-10-26'), '2026-10-26');
  assert.equal(canonicalLocalDate('2026-02-30'), undefined, '不存在的日不能靠补零蒙过去');
  assert.equal(canonicalLocalDate('2026-02-29'), undefined, '2026 不是闰年');
  assert.equal(canonicalLocalDate('2028-02-29'), '2028-02-29');
  assert.equal(canonicalLocalDate('26-10-26'), undefined);
  assert.deepEqual(parseLocalDate('2026-10-26'), { year: 2026, month: 10, day: 26 });
});

test('本地时间补成上游必收的形式：只在该补的地方补', () => {
  assert.equal(canonicalLocalClock('09:00'), '09:00:00');
  assert.equal(canonicalLocalClock('9:00'), '09:00:00');
  assert.equal(canonicalLocalClock('9:00:15'), '09:00:15');
  // 没写毫秒就不补 `.000`：写了什么就交什么，日志里才看得出用户到底给的是什么。
  assert.equal(canonicalLocalClock('09:00:00'), '09:00:00');
  assert.equal(canonicalLocalClock('09:00:00.5'), '09:00:00.500');
  assert.equal(canonicalLocalClock('09:00:00.050'), '09:00:00.050');
  assert.equal(canonicalLocalClock('25:00'), undefined);
});

test('绝对串只做不改时刻的改写；没有时区信息一律拒', () => {
  // 秒缺省 = 整分，补 `:00` 不改变所指时刻；分隔符大小写/空格、偏移冒号同理。
  assert.equal(canonicalInstantString('2026-10-26T09:00+08:00'), '2026-10-26T09:00:00+08:00');
  assert.equal(canonicalInstantString('2026-10-26 09:00:00+0800'), '2026-10-26T09:00:00+08:00');
  assert.equal(canonicalInstantString('2026-10-26t09:00z'), '2026-10-26T09:00:00Z');
  assert.equal(canonicalInstantString('2026-10-26T09:00:00.25+08:00'), '2026-10-26T09:00:00.250+08:00');
  assert.equal(canonicalInstantString('2026-10-26T09:00:00Z'), '2026-10-26T09:00:00Z');
  // 这几条要的是**时区**，不是格式——插件猜不出用户在哪，猜出来的是静默错值。
  for (const noZone of ['2026-10-26 09:00', '2026-10-26T09:00', '2026-10-26T09:00:00', '2026-10-26']) {
    assert.equal(canonicalInstantString(noZone), undefined, `${noZone} 无偏移，必须拒而不是猜`);
  }
  assert.equal(canonicalInstantString('2026-02-30T09:00:00Z'), undefined);
  assert.equal(canonicalInstantString('2026-10-26T25:00:00Z'), undefined);
});

// ── 2. 守门人 ──────────────────────────────────────────────────────────────────────

test('面板原生 HH:mm 与个位小时都被放行，且交出的是规范化后的值', () => {
  const shapes = ['09:00', '9:00', '9:00:00', '09:00:00'];
  for (const time of shapes) {
    const at = acceptedAt(
      { prompt: `P ${time}`, at: { date: '2026-10-26', time, time_zone: TZ } },
      time,
    );
    assert.equal(at.time, '09:00:00', `${time} 应补成 HH:mm:ss 再交上游，实际交出 ${at.time}`);
    assert.equal(at.date, '2026-10-26');
    assert.equal(at.time_zone, TZ);
  }
  // 毫秒保留，不被吞掉（原报告实测 `.5` 落进上游是 500ms）。
  const withMs = acceptedAt({ prompt: 'P ms', at: { date: '2026-10-26', time: '9:00:30.5', time_zone: TZ } }, '9:00:30.5');
  assert.equal(withMs.time, '09:00:30.500');
});

test('守门人交出的本地对象恰好三个键：多余键不透传给上游', () => {
  // 上游那句 `Local at must contain exactly date, time, and time_zone.` 同样是英文文法错。
  const at = acceptedAt(
    { prompt: 'P extra', at: { date: '2026-10-26', time: '09:00', time_zone: TZ, note: '忽略我' } },
    '多余键',
  );
  assert.deepEqual(Object.keys(at).sort(), ['date', 'time', 'time_zone']);
});

test('畸形形状在守门人这里就拒，回执是中文而不是上游英文', () => {
  const cases = [
    [{ prompt: 'P', at: { date: '2026-10-26', time: '9:0', time_zone: TZ } }, /HH:mm/],
    [{ prompt: 'P', at: { date: '2026-10-26', time: '24:00', time_zone: TZ } }, /HH:mm/],
    [{ prompt: 'P', at: { date: '2026-02-30', time: '09:00', time_zone: TZ } }, /YYYY-MM-DD/],
    [{ prompt: 'P', at: '2026-10-26 09:00' }, /Z|偏移/],
    [{ prompt: 'P', at: '2026-10-26T09:00' }, /Z|偏移/],
  ];
  for (const [input, expectPattern] of cases) {
    const result = validateCreateInput(input);
    assert.equal(result.ok, false, `${JSON.stringify(input.at)} 应当被拒`);
    assert.equal(result.code, 'invalid_rule');
    assert.match(result.message, expectPattern);
    assert.doesNotMatch(
      result.message,
      /requires|must use|must contain|invalid_rule:/,
      `回执里不该出现上游的英文文法错：${result.message}`,
    );
  }
});

test('拒绝文案给出出路：无偏移的串要点名两条可走的路', () => {
  const result = validateCreateInput({ prompt: 'P', at: '2026-10-26 09:00' });
  assert.equal(result.ok, false);
  assert.match(result.message, /date.*time.*time_zone/, '要告诉用户可以改传三元组');
  assert.match(result.message, /2026-10-26T09:00:00\+08:00|示例|如 /, '要给一个能照抄的例子');
});

test('夏令时跳过的钟面：与预览同一口径拒，且是中文', () => {
  // America/New_York 2026-03-08 02:30 这一刻不存在（前拨跳过）。上游收不进，
  // 预览也算不出——两边必须说同一句话，而不是面板能选、提交报错。
  const gap = validateCreateInput({
    prompt: 'P dst',
    at: { date: '2026-03-08', time: '02:30', time_zone: 'America/New_York' },
  });
  assert.equal(gap.ok, false, '不存在的钟面必须在守门人处就拒');
  assert.match(gap.message, /不存在|夏令时/);
  assert.doesNotMatch(gap.message, /does not exist in the selected/, '不要让用户读到上游英文');
  assert.equal(epochFromLocal('2026-03-08', '02:30:00', 'America/New_York'), undefined, '预览同口径判非法');
  // 回拨日（同一钟面出现两次）两边都必须放行，且取同一个瞬点。
  const fold = validateCreateInput({
    prompt: 'P fold',
    at: { date: '2026-11-01', time: '01:30', time_zone: 'America/New_York' },
  });
  assert.equal(fold.ok, true, '回拨日的重复钟面是存在的，不该拒');
});

// ── 3. 对真上游对账（这一层才叫「能建」）─────────────────────────────────────────

test('凡守门人放行的形状，真上游必收，且与预览算出同一个瞬点', async () => {
  const soon = inDays(20);
  const soonUtc = inDays(25);
  const unpadded = inDaysUnpadded(40); // 用来验守门人补零：月/日不补零的形态
  const fold = nextNyFallBack();       // 美东回拨日：01:30 当天出现两次
  const shapes = [
    ['09:00', soon, TZ],
    ['9:00', soon, TZ],
    ['9:00:00', soon, TZ],
    ['09:00:00', soon, TZ],
    ['09:00:00.5', soon, TZ],
    ['18:00', unpadded, TZ],
    ['01:30', fold, 'America/New_York'],
    ['09:00', soonUtc, 'UTC'],
  ];
  // 日期一律取未来：上游还会拒「过去时刻」（`not_future`），那是**正确**行为，
  // 但不是这条用例要验的文法——混进来只会让红绿说不出是谁的锅。
  for (const [time, date, timeZone] of shapes) {
    const at = acceptedAt({ prompt: `P ${time}@${timeZone}`, at: { date, time, time_zone: timeZone } }, `${time}@${timeZone}`);
    const epoch = await upstreamEpoch(at);
    const preview = epochFromLocal(at.date, at.time, at.time_zone);
    assert.equal(preview, epoch, `${time}@${timeZone}：预览 ${preview} 与上游 ${epoch} 不是同一刻`);
  }
});

test('字符串形态：补秒后真上游接受，且指向改写前那个时刻', async () => {
  const date = inDays(20); // 现算：上游拒过去时刻
  const input = `${date}T09:00+08:00`;       // 缺秒，但偏移显式
  const expected = `${date}T09:00:00+08:00`;
  const before = new Date(input).getTime();
  const at = acceptedAt({ prompt: 'P str', at: input }, '缺秒带偏移串');
  assert.equal(at, expected);
  const epoch = await upstreamEpoch(at);
  assert.equal(epoch, before, '补秒必须不改时刻——改了就是静默错值');
});

// ── 4. 结构护栏：文法只能有一份 ────────────────────────────────────────────────────

test('守门人与面板不再各写一份时间正则', () => {
  const root = resolvePath(import.meta.dirname, '..');
  const gate = codeOf(readFileSync(resolvePath(root, 'src/user-tools.ts'), 'utf8'));
  assert.doesNotMatch(gate, /\\d\{1,2\}:\)\\d/, 'user-tools 不该再有时间文法');
  assert.doesNotMatch(gate, /\$\{[^\n]*\}:00/, 'user-tools 不该手工拼秒');

  const panel = codeOf(readFileSync(resolvePath(root, 'src/client/components/SchedPanel.tsx'), 'utf8'));
  assert.doesNotMatch(panel, /\$\{customTime\}:00/, '面板不该再自己补秒');
  assert.doesNotMatch(panel, /\$\{hhmm\}:00/, '快捷项同上');
  assert.match(panel, /canonicalLocalClock\(/, '面板必须走共享文法');

  // epochFromLocal 是预览层：它只能问 time-utils，不能留自己的正则。
  const smart = readFileSync(resolvePath(root, 'src/smart-window.ts'), 'utf8');
  const from = smart.indexOf('export function epochFromLocal');
  const to = smart.indexOf('candidates.sort', from);
  assert.ok(from >= 0 && to > from, '没定位到 epochFromLocal 的函数体，结构断言会退化成永真');
  const body = smart.slice(from, to);
  const code = codeOf(body);
  assert.doesNotMatch(code, /\^\(\\d/, 'epochFromLocal 里不该再有本地时间正则（文法归 time-utils）');
  assert.match(code, /parseLocalClock\(time\)/);
  assert.match(code, /parseLocalDate\(date\)/);
});

test('工具描述与守门人口径一致（模型看得见的文法不能比实现严或松）', () => {
  const src = readFileSync(resolvePath(import.meta.dirname, '..', 'src/strings.ts'), 'utf8');
  const zh = src.slice(src.indexOf('paramAtDesc:'), src.indexOf('paramTimeZoneDesc:'));
  assert.match(zh, /HH:mm/, '中文描述要写清接受的形状');
  assert.match(zh, /时区/, '要说明无偏移串会被拒这件事');
  const enStart = src.lastIndexOf('paramAtDesc:');
  const en = src.slice(enStart, src.indexOf('paramTimeZoneDesc:', enStart));
  assert.match(en, /HH:mm/);
  assert.match(en, /rejected|zone/i);
});
