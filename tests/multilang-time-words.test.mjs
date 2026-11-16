/**
 * 多语言时间词表：解析器认不认各语言的**自然语言时间写法**。
 *
 * ## 这个文件在测什么（不是翻译质量）
 *
 * 界面补齐 8 门之后出现过一次荒谬的不对称：非中文用户的界面上写着「中文形式也接受」，
 * 而**他们自己语言的写法反而不认** —— 德语用户写 `morgen 9 Uhr` 拿到的是解析失败。
 * 本文件钉住「各语言的高频写法都能解析」，以及「不会因为多语言支持而打乱既有行为」。
 *
 * ## 判据的三层
 *
 * 1. **各语言正向**：`in 30 minutes` / `morgen 9 Uhr` / `завтра 9:00` … 必须解析成正确时刻；
 * 2. **语言隔离**：同样的串在别的 locale 下**不该**被认（否则「8 门全认」会让德语用户的
 *    `morgen` 被别的语言抢走，错误提示也没法说清你这门支持什么）；
 * 3. **既有行为零回归**：中文口语、`+30m`、`1532`、`15:32`、`9:30pm` 的 12 小时制等
 *    原有用法逐条不变 —— 这是最容易在「加功能」时被顺手改坏的。
 * @module tests/multilang-time-words
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScheduleInput } from '../lib/commands.js';
import { wordsFor } from '../lib/time-words.js';

/** 固定「现在」：2026-11-16（周一）10:00 上海，避免测试随真实时间漂。 */
const NOW = new Date('2026-11-16T10:00:00+08:00').getTime();
const TZ = 'Asia/Shanghai';
const LIMITS = { allowLong: false, maxChars: 1000 };

/** 按 locale 解析一句「时间 + 内容」。 */
function parse(spec, locale) {
  return parseScheduleInput(spec, NOW, TZ, LIMITS, { advancedSyntax: true, locale });
}

/** 取解析出的第一个绝对时刻（`YYYY-MM-DD HH:MM`），拿不到返回 undefined。 */
function at(spec, locale) {
  const result = parse(spec, locale);
  if (!result.ok) return undefined;
  const target = result.targets?.[0]?.at ?? result.target?.at;
  if (target === undefined) return undefined;
  return `${target.date} ${target.time.slice(0, 5)}`;
}

/** 取相对时长（秒）。 */
function afterSeconds(spec, locale) {
  const result = parse(spec, locale);
  if (!result.ok) return undefined;
  const target = result.targets?.[0] ?? result.target;
  return target?.kind === 'after' ? target.afterSeconds : undefined;
}

// ── 1. 各语言正向 ───────────────────────────────────────────────────────────

test('多语言时间：6 门的「once + 单位」相对写法都能解析', () => {
  const cases = [
    ['en', 'in 30 minutes 喝水', 30 * 60],
    ['en', 'in 2 hours 喝水', 2 * 3600],
    ['de', 'in 30 Minuten 喝水', 30 * 60],
    ['de', 'in 2 Stunden 喝水', 2 * 3600],
    ['es', 'en 30 minutos 喝水', 30 * 60],
    ['es', 'en 2 horas 喝水', 2 * 3600],
    ['fr', 'dans 30 minutes 喝水', 30 * 60],
    ['fr', 'dans 2 heures 喝水', 2 * 3600],
    ['ru', 'через 30 минут 喝水', 30 * 60],
    ['ru', 'через 2 часа 喝水', 2 * 3600],
    ['pt', 'em 30 minutos 喝水', 30 * 60],
    ['pt', 'em 2 horas 喝水', 2 * 3600],
  ];
  for (const [locale, spec, expected] of cases) {
    assert.equal(afterSeconds(spec, locale), expected, `${locale} 应能解析「${spec}」为 ${expected} 秒`);
  }
});

test('多语言时间：6 门的日词 + 时刻写法都能解析，且日期落在对的偏移上', () => {
  // NOW = 2026-11-16，明天 = 17、后天 = 18。
  const cases = [
    ['en', 'tomorrow 9am 喝水', '2026-11-17 09:00'],
    ['de', 'morgen 9 Uhr 喝水', '2026-11-17 09:00'],
    ['es', 'mañana 9:00 喝水', '2026-11-17 09:00'],
    ['fr', 'demain 9:00 喝水', '2026-11-17 09:00'],
    ['ru', 'завтра 9:00 喝水', '2026-11-17 09:00'],
    ['pt', 'amanhã 9:00 喝水', '2026-11-17 09:00'],
    ['en', 'day after tomorrow 9am 喝水', '2026-11-18 09:00'],
    ['de', 'übermorgen 9:30 Uhr 喝水', '2026-11-18 09:30'],
    ['es', 'pasado mañana 9:00 喝水', '2026-11-18 09:00'],
    ['fr', 'après-demain 9:00 喝水', '2026-11-18 09:00'],
    ['ru', 'послезавтра 9:00 喝水', '2026-11-18 09:00'],
    ['pt', 'depois de amanhã 9:00 喝水', '2026-11-18 09:00'],
  ];
  for (const [locale, spec, expected] of cases) {
    assert.equal(at(spec, locale), expected, `${locale} 应能解析「${spec}」`);
  }
});

test('多语言时间：12 小时制的 am/pm 与「12 点」两种边界都对', () => {
  // 12am 是 0 点、12pm 是 12 点 —— 这是 12 小时制最容易写错的地方。
  const cases = [
    ['tomorrow 9am 喝水', '2026-11-17 09:00'],
    ['tomorrow 9pm 喝水', '2026-11-17 21:00'],
    ['tomorrow 9:30pm 喝水', '2026-11-17 21:30'],
    ['tomorrow 12am 喝水', '2026-11-17 00:00'],
    ['tomorrow 12pm 喝水', '2026-11-17 12:00'],
  ];
  for (const [spec, expected] of cases) {
    assert.equal(at(spec, 'en'), expected, `en 应把「${spec}」解析为 ${expected}`);
  }
});

test('多语言时间：德语 `9 Uhr 30`（分钟在后）也对', () => {
  assert.equal(at('morgen 9 Uhr 30 喝水', 'de'), '2026-11-17 09:30');
  assert.equal(at('morgen 9:30 Uhr 喝水', 'de'), '2026-11-17 09:30');
});

// ── 2. 语言隔离 ─────────────────────────────────────────────────────────────

test('多语言时间：某门的写法不会在别门被认（避免互相抢词）', () => {
  // 德语 `morgen` 在英文下不该被当成 `tomorrow`——英文词表里根本没有 morgen。
  assert.equal(at('morgen 9 Uhr 喝水', 'en'), undefined, 'en 不应认德语的 morgen');
  assert.equal(at('tomorrow 9am 喝水', 'de'), undefined, 'de 不应认英文的 tomorrow');
  // 中文口语在非中文门下不该被认（`明天9点` 是中文词表的日词）。
  assert.equal(at('明天9点 喝水', 'en'), undefined, 'en 不应认中文的 明天');
});

test('多语言时间：未收录的 locale 回退中文（与 hostDictFor 同规则）', () => {
  // 拿不到 locale 服务时（undefined），以及没收录的串，都按中文处理。
  for (const locale of [undefined, 'xx', 'zh-Hant']) {
    assert.equal(at('明天9点 喝水', locale), '2026-11-17 09:00', `${String(locale)} 应回退中文`);
  }
});

test('多语言时间：ja 复用中文词表（两者都用汉字）', () => {
  assert.equal(wordsFor('ja'), wordsFor('zh'), 'ja 应映射到中文词表');
  assert.equal(at('明天9点 喝水', 'ja'), '2026-11-17 09:00');
});

// ── 3. 既有行为零回归 ───────────────────────────────────────────────────────

test('多语言时间：中文口语与语法糖在 zh 下逐条不变', () => {
  const cases = [
    ['30分钟后 喝水', 30 * 60],
    ['半小时后 喝水', 30 * 60],
    ['两小时后 喝水', 2 * 3600],
    ['1天以后 喝水', 86400],
  ];
  for (const [spec, expected] of cases) {
    assert.equal(afterSeconds(spec, 'zh'), expected, `zh 的「${spec}」应保持 ${expected} 秒`);
  }
  assert.equal(at('明天9点 喝水', 'zh'), '2026-11-17 09:00');
  assert.equal(at('后天 10:00 喝水', 'zh'), '2026-11-18 10:00');
  // `9点半` 在 NOW=10:00 时已经过去 ⇒ 按既有规则顺延到明天（不是回归，是原本的语义）。
  assert.equal(at('9点半 喝水', 'zh'), '2026-11-17 09:30');
});

test('多语言时间：语言无关的写法在任何 locale 下都一样', () => {
  // 这些是「语法糖」，不该随界面语言变化 —— 变了就是回归。
  for (const locale of ['zh', 'en', 'de', 'es', 'fr', 'ru', 'pt', 'ja', undefined]) {
    assert.equal(afterSeconds('+30m 喝水', locale), 30 * 60, `${String(locale)} 的 +30m`);
    assert.equal(at('1532 喝水', locale), '2026-11-16 15:32', `${String(locale)} 的 1532`);
    assert.equal(at('15:32 喝水', locale), '2026-11-16 15:32', `${String(locale)} 的 15:32`);
  }
});

test('多语言时间：裸 HH:MM 不被词表时钟吃掉（en 下 15:32 仍是 15:32）', () => {
  // 词表时钟排在 colonTime 之前，若正则写宽松了会把裸 HH:MM 也吞掉。
  assert.equal(at('tomorrow 15:32 喝水', 'en'), '2026-11-17 15:32');
  assert.equal(at('15:32 喝水', 'de'), '2026-11-16 15:32');
});

// ── 4. 词表自身的结构约束 ───────────────────────────────────────────────────

test('多语言时间：日词里「长词不能以短词开头」，否则匹配顺序会吃掉长词', () => {
  // 匹配按表内顺序 `startsWith`。若某语言同时收了 `morgen` 与 `morgenfrüh`，
  // 且短的排在前面，长词永远匹配不到（`morgenfrüh` 会先被 `morgen` 吃成「明天」）。
  //
  // 当前 7 张表都没有这种前缀关系，这条护栏是为了**以后加词时**不踩坑：
  // 加了一个与前缀冲突的词，这里立刻红，提示把它排到长的后面。
  for (const locale of ['zh', 'en', 'de', 'es', 'fr', 'ru', 'pt']) {
    const words = wordsFor(locale).day;
    for (const [short] of words) {
      for (const [long] of words) {
        if (short === long) continue;
        if (!long.startsWith(short)) continue;
        const shortIndex = words.findIndex(([w]) => w === short);
        const longIndex = words.findIndex(([w]) => w === long);
        assert.ok(
          longIndex < shortIndex,
          `${locale}: 「${short}」是「${long}」的前缀，长的必须排在前面（当前 short@${shortIndex}、long@${longIndex}）`,
        );
      }
    }
  }
});
