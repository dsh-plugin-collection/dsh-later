/**
 * 时间输入的**上界**、**错误文案跟随语言**、以及「提示里写的示例真的能用」。
 *
 * ## 三个缺陷，一个共同点
 *
 * 它们都是在补 6 门语言那次之后排查出来的，共同点是**只有真跑才暴露**：
 *
 * 1. **超大时长会让 `toISOString()` 抛 `RangeError`**
 *    `after_seconds` 原来只校验「正整数」，没有上限。`+999999999999m` 折出来的 epoch
 *    超出 `Date` 的合法区间，而 `projection.ts` / `runtime.ts` 那几处 `toISOString()`
 *    没有任何 try 住它。这是会让插件抛异常的洞，不是文案问题。
 *
 * 2. **解析错误文案恒为中文**
 *    函数体里几十处回执走 `tr()`，而 `tr()` 读作用域栈、不读 `options.locale`。
 *    命令 handler 那侧有 `withLocale` 包着，所以只有**从工具或测试直接调**时才暴露。
 *
 * 3. **错误提示里的示例是中文，且其中一条解析不了**
 *    `ja` 提示写着「明日9時」，而词表只认中文的「点」——提示承诺了一个不支持的写法。
 *
 * 第 3 条是这一轮最有价值的教训：**提示与实现会各自演进并悄悄脱节**，
 * 所以下面有一组测试不是断言「文案写成什么样」，而是**把文案里的示例抽出来真跑一遍**。
 * @module tests/time-input-bounds
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScheduleInput } from '../lib/commands.js';
import { validateCreateInput } from '../lib/user-tools.js';
import { hostDicts } from '../lib/locales/host.js';
import { LOCALE_IDS } from '../lib/locales/locale-id.js';
import { MAX_AFTER_SECONDS } from '../lib/due.js';

const NOW = new Date('2026-11-16T10:00:00+08:00').getTime();
const TZ = 'Asia/Shanghai';
const LIMITS = { allowLong: false, maxChars: 1000 };

const parse = (spec, locale) =>
  parseScheduleInput(spec, NOW, TZ, LIMITS, { advancedSyntax: true, locale });

// ── 1. 时长上界 ─────────────────────────────────────────────────────────────

test('时间上界：超大相对时长被拒，且给的是「太长」而不是崩掉', () => {
  // 未修前：`+999999999999m` 会被接受，折出的 epoch 让 `toISOString()` 抛 RangeError。
  for (const spec of ['+999999999999m 喝水', '+99999999999m 喝水', '+9999999999h 喝水']) {
    const result = parse(spec, 'zh');
    assert.equal(result.ok, false, `「${spec}」应被拒绝`);
    assert.match(String(result.error), /天/u, `「${spec}」的文案应说明天数上限`);
  }
});

test('时间上界：正常范围的写法不受影响', () => {
  // 100 年以内都该放行 —— 上界拦的是溢出与荒谬值，不是长延时本身。
  for (const spec of ['+1h 喝水', '+30d 喝水', '+365d 喝水', '+1825d 喝水']) {
    assert.equal(parse(spec, 'zh').ok, true, `「${spec}」应被接受`);
  }
});

test('时间上界：`repeats` 累加后超界也会被拦（不只单条路径）', () => {
  // `+50y*3` 这类会走 repeats 展开路径，与单条分支不同，必须同样拦得住。
  const result = parse('+9999999h*3 喝水', 'zh');
  assert.equal(result.ok, false, '累加后超界应被拒绝');
});

test('时间上界：工具侧的 after_seconds / every_seconds 同样受限', () => {
  const tooBig = MAX_AFTER_SECONDS + 1;
  for (const key of ['after_seconds', 'every_seconds']) {
    const result = validateCreateInput({ prompt: '喝水', [key]: tooBig }, LIMITS);
    assert.equal(result.ok, false, `${key} 超界应被拒绝`);
  }
  // 上界之内照常放行。
  assert.equal(
    validateCreateInput({ prompt: '喝水', after_seconds: MAX_AFTER_SECONDS }, LIMITS).ok,
    true,
    '恰好等于上界应放行',
  );
});

test('时间上界：非正整数（0 / 负数 / 小数）报「必须是正整数」而不是「太长」', () => {
  // 两类错误分开文案：填 `-5` 却被告知「延时太长」会让人摸不着头脑。
  for (const bad of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = validateCreateInput({ prompt: '喝水', after_seconds: bad }, LIMITS);
    assert.equal(result.ok, false, `${String(bad)} 应被拒绝`);
    assert.doesNotMatch(
      String(result.message),
      /天/u,
      `${String(bad)} 不该报成「太长」，应报形状错误：${result.message}`,
    );
  }
});

// ── 2. 错误文案跟随 locale ──────────────────────────────────────────────────

test('错误文案：直接调解析器时也跟随传入的 locale（不只命令 handler 那条路）', () => {
  // 未修前：函数体走 `tr()` 读作用域栈，直接从工具/测试调用时栈是空的 ⇒ 恒中文。
  const zh = String(parse('zzz 喝水', 'zh').error);
  const en = String(parse('zzz 喝水', 'en').error);
  const de = String(parse('zzz 喝水', 'de').error);
  assert.notEqual(en, zh, 'en 的错误文案不该与 zh 逐字相同');
  assert.notEqual(de, zh, 'de 的错误文案不该与 zh 逐字相同');
  // 非 zh 门不该再出现「无法识别的时间格式」这句中文。
  for (const [locale, text] of [['en', en], ['de', de]]) {
    assert.doesNotMatch(text, /无法识别|时间格式/u, `${locale} 的错误文案仍是中文：${text}`);
  }
});

test('错误文案：语言作用域用完即还，不污染后续调用', () => {
  // 进入作用域靠 try/finally 弹栈；漏弹会让后续调用带着上一个语言的残留。
  parse('zzz 喝水', 'de');
  const after = String(parse('zzz 喝水', 'zh').error);
  assert.match(after, /无法识别/u, '德语调用之后，中文调用仍应是中文');
});

// ── 3. 提示里写的示例，必须真的能用 ─────────────────────────────────────────

test('提示一致性：/schedule 错误提示里列的每个示例，解析器都要真的接受', () => {
  // 这条才是关键：不钉「文案长什么样」，而是**把文案里的写法抽出来真跑一遍**。
  // 提示承诺一个做不到的写法，比不写提示更糟 —— 用户照着抄会一直失败。
  //
  // 每门给的是「该门提示里实际出现的那几个示例」，与 `parseUnrecognized` 的措辞同步维护。
  //
  // ⚠️ 这里只列**能直接照抄**的示例。绝对日期不在其中：提示里给的是一个具体日期
  // （曾写 `2026-08-21`），那个日期一过去，用户照抄就被「目标时间已过去」拒掉 ——
  // 这正是本条测试最初抓到的第二个脱节。现在提示改成 `<年-月-日> <时:分>` 这种
  // **格式说明**而不是可抄的示例，下面另有一条测试钉住「提示里不再出现写死的日期」。
  const samplesByLocale = {
    zh: ['+30m', '1532', '15:32', '30分钟后', '明天9点', '+1h*3', '+1h+1h+0.5h'],
    en: ['+30m', '1532', '15:32', 'in 30 minutes', 'tomorrow 9am', '+1h*3', '+1h+1h+0.5h'],
    ja: ['+30m', '1532', '15:32', '明日9時', '+1h*3', '+1h+1h+0.5h'],
    es: ['+30m', '1532', '15:32', 'en 30 minutos', 'mañana 9:00'],
    fr: ['+30m', '1532', '15:32', 'dans 30 minutes', 'demain 9:00'],
    de: ['+30m', '1532', '15:32', 'in 30 Minuten', 'morgen 9 Uhr'],
    ru: ['+30m', '1532', '15:32', 'через 30 минут', 'завтра 9:00'],
    pt: ['+30m', '1532', '15:32', 'em 30 minutos', 'amanhã 9:00'],
  };
  for (const locale of LOCALE_IDS) {
    const text = hostDicts[locale].parseUnrecognized;
    for (const sample of samplesByLocale[locale]) {
      // ① 示例必须真的出现在该门的提示文案里（防止文案改了、这里没跟上）
      assert.ok(text.includes(sample), `${locale} 的提示文案里应包含示例「${sample}」：${text}`);
      // ② 而且解析器必须真的接受它（防止提示承诺了做不到的事）
      assert.equal(
        parse(`${sample} 喝水`, locale).ok,
        true,
        `${locale} 的提示里写着「${sample}」，但解析器不接受它`,
      );
    }
  }
});

test('提示一致性：ja 的「時」与 zh 的「点」都对，互不挤掉', () => {
  // ja 复用中文词表，两边都该认各自的字；只收中文那个会让 ja 的提示自己解析不了。
  assert.equal(parse('明日9時 喝水', 'ja').ok, true, 'ja 应认「時」');
  assert.equal(parse('明日9時半 喝水', 'ja').ok, true, 'ja 应认「時半」');
  assert.equal(parse('明天9点 喝水', 'zh').ok, true, 'zh 应认「点」');
  assert.equal(parse('9点半 喝水', 'zh').ok, true, 'zh 应认「点半」');
});

test('提示一致性：错误提示里不出现写死的绝对日期（那个日期会过期）', () => {
  // 提示里写 `2026-08-21` 这种具体日期，一旦过去，用户照抄就被「目标时间已过去」拒掉。
  // 绝对日期只能以**格式说明**（`<年-月-日>` / `<YYYY-MM-DD>`）出现，不能是能抄的实例。
  for (const locale of LOCALE_IDS) {
    const text = hostDicts[locale].parseUnrecognized;
    assert.doesNotMatch(
      text,
      /\d{4}-\d{2}-\d{2}/u,
      `${locale} 的提示里出现了写死的日期（会过期）：${text}`,
    );
  }
});
