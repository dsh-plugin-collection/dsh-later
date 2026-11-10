/**
 * issue #141：面板超长校验文案的上限数字。
 *
 * 缺陷：`SchedPanel.handleConfirm` 用**实时** `promptLimits?.maxChars ?? 1000` 校验，
 * 但文案 `errPromptTooLong` 写死「1000」——把上限设成 10000 后输入 12000 字符，
 * 面板弹「不能超过 1000 字符」，文案与实际执行的限制自相矛盾。
 *
 * 本轮取舍（详见 `src/client/strings.ts` 的 errPromptTooLong 注释）：面板是运行时
 * 文案，`{maxChars}` 由校验当场的同一个变量插值，与 #125（`5d147c6`）给工具描述
 * 选的「说明式不插值」不冲突——描述会冻在注册时刻，面板不会。规则是
 * 「静态说明不写死上限；运行时错误给出实际值」。
 *
 * 断言分四层：
 *  1. 行为：zh/en 模板插值非默认 maxChars 后，文案里的数字就是实际限制，
 *     且不再冒出旧的 1000（issue 验收标准的直接落点）；
 *  2. 模板：两份模板去掉占位符后不含任何硬编码数字；
 *  3. 接线：面板源码把**校验用的同一个** maxChars 喂给 setError(format(...))，
 *     并钉住「别把数字插回宿主工具描述」的说明注释还在；
 *  4. 产物：`lib/client.js` 已带占位符——改了 src 不重建 lib 会被这条抓住。
 *
 * 与 `panel-official-style.test.mjs` 同风格：源码级纯文本断言，不引 DOM/渲染库；
 * 字典用 eval 抽出真实对象，保证测的是文案本身而不是又抄一遍的副本。
 * @module tests/panel-prompt-limit-copy
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stringsSrc = readFileSync(new URL('../src/client/strings.ts', import.meta.url), 'utf8');
const panelSrc = readFileSync(new URL('../src/client/components/SchedPanel.tsx', import.meta.url), 'utf8');
const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

/**
 * 从 strings.ts 源码抽出对象字面量并 eval 成纯字典。
 * `[^=]*=` 跨过 en 的 TS 类型标注（`const en: { [K in keyof typeof zh]: string } = {`），
 * 非贪婪到第一个顶格 `}`（可带 `as const`）收尾——字典体内没有顶格 `}`，
 * 抽取错位会当场 SyntaxError，响亮失败。
 */
function extractDict(name) {
  const m = new RegExp(`const ${name}\\b[^=]*=\\s*(\\{[\\s\\S]*?\\n\\})(?: as const)?;`).exec(stringsSrc);
  assert.ok(m, `应能在 strings.ts 里找到 const ${name} = { … };`);
  return new Function(`return (${m[1]})`)();
}

const dicts = { zh: extractDict('zh'), en: extractDict('en') };

/**
 * `src/client/strings.ts` 里 format() 的同型实现（同一个 replace 正则）。
 * 不复用真函数的原因：format 编译进 lib/client.js 的 IIFE，测试环境拿不到导出；
 * 而本测试锁的对象是**模板文案**——插值语义由下一条断言钉住在面板源码里的真实调用。
 */
const format = (template, params) =>
  template.replace(/\{(\w+)\}/g, (_, key) => (key in params ? String(params[key]) : `{${key}}`));

for (const [locale, dict] of Object.entries(dicts)) {
  test(`#141 ${locale}：模板带 {maxChars} 占位符，去掉占位符后不含任何硬编码数字`, () => {
    const tmpl = dict.errPromptTooLong;
    assert.ok(typeof tmpl === 'string' && tmpl.includes('{maxChars}'),
      `${locale} 文案必须以 {maxChars} 占位符承载上限（实得 ${JSON.stringify(tmpl)}）`);
    assert.doesNotMatch(tmpl.replace(/\{maxChars\}/g, ''), /\d/,
      `${locale} 模板里不该再有写死的数字（旧「1000」正是这么藏进来的）`);
  });

  test(`#141 ${locale}：maxChars 取非默认值时，插值后的文案说的就是实际限制`, () => {
    // 复现 issue 场景：上限设成 10000、用户输入 12000 字符。
    const msg = format(dicts[locale].errPromptTooLong, { maxChars: 10000 });
    assert.match(msg, /10000/, `${locale} 文案应报出实际生效的 10000（实得 ${msg}）`);
    assert.doesNotMatch(msg, /\b1000\b/, `${locale} 文案不得再报旧默认值 1000（实得 ${msg}）`);
    // 兜底值同样如实上报：promptLimits 缺席时校验用 1000，文案也就说 1000，两边一致。
    assert.match(format(dicts[locale].errPromptTooLong, { maxChars: 1000 }), /\b1000\b/);
    // 再来一个第三方值，排除「只对了 1000/10000」的巧合。
    assert.match(format(dicts[locale].errPromptTooLong, { maxChars: 250 }), /250/);
  });
}

test('#141 面板把「校验当场」的 maxChars 同时用于比较与文案，接线不可拆', () => {
  // 校验行与文案行读同一个变量——这条正则同时锁住两点：maxChars 的取值式
  // （实时 prop ?? 兜底 1000）没有漂移、format 传的就是这个变量而不是别的常数。
  assert.match(
    panelSrc,
    /const maxChars = promptLimits\?\.maxChars \?\? 1000;[\s\S]{0,160}?if \(text\.length > maxChars\)[\s\S]{0,160}?setError\(format\(t\.errPromptTooLong, \{ maxChars \}\)\)/,
    '超长分支必须是 setError(format(t.errPromptTooLong, { maxChars }))，且 maxChars 与比较用的是同一个',
  );
  // 回归锁：不允许退回「直接取模板」（会把 {maxChars} 原样渲染给用户）或写死数字。
  assert.doesNotMatch(panelSrc, /setError\(t\.errPromptTooLong\)/, '不得把未插值的模板直接 setError');
});

test('#141 与 #125 的取舍说明必须留在 strings.ts（防止下一个人把数字插回工具描述）', () => {
  const comment = /\/\*\*[\s\S]*?\*\/\s*errPromptTooLong/.exec(stringsSrc);
  assert.ok(comment, 'zh 的 errPromptTooLong 上方应保留取舍注释块');
  assert.match(comment[0], /5d147c6/, '注释要引用 #125 的落点 commit，说明两处取舍为何不同');
  assert.match(comment[0], /paramPromptDesc/, '注释必须点名：不许据此把数字插回宿主工具描述');
});

test('#141 构建产物同步：lib/client.js 的两份文案都已换成占位符', () => {
  // src 改了没重建 lib 时，面板线上行为仍是旧文案——这条把产物钉进测试。
  const hits = bundle.match(/errPromptTooLong: "[^"]*\{maxChars\}[^"]*"/g) ?? [];
  assert.equal(hits.length, 2, `编译产物里 zh/en 两条都应带 {maxChars}（实得 ${hits.length} 条）`);
  assert.doesNotMatch(bundle, /errPromptTooLong: "[^"]*1000/, '产物里不应再残留写死的 1000');
});
