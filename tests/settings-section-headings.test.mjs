/**
 * 设置卡 section 标题的唯一性契约。
 *
 * 病灶：插件详情页（`surface === 'detail'`）先渲染「在设置中显示」开关段
 * （标题 key `sectionDisplayToggle`），紧接着渲染 `SECTIONS` 的第一段
 * （标题 key `sectionDisplay`）。两者曾同为「显示设置」，于是页面上连着出现
 * 两个一模一样的标题 —— 用户无法判断哪段管什么，`aria-labelledby` 指向的
 * 区域名也失去区分度。
 *
 * 这里断言的是**渲染结果**（解析源码里的 key 与字典取值），不是注释或字面量，
 * 所以改字典、改 key、给 SECTIONS 加一段同名的，都会被这条打挂。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const card = () => readFileSync(new URL('../src/client/components/SchedulerSettingsCard.tsx', import.meta.url), 'utf8');
// 设置卡词条的落点：从 `src/client/index.tsx`（内联）搬到 `src/client/locales/settings.ts`。
const dictFile = () => readFileSync(new URL('../src/client/locales/settings.ts', import.meta.url), 'utf8');

/**
 * 取 `zh: {` / `en: {` 那**一个**字典对象的源码。
 *
 * 读数位置随结构迁移改过一次，断言的判据没变：
 *  - 原先设置卡词条内联在 `src/client/index.tsx` 的 `locale.register(NS, {zh, en})` 里，
 *    缩进是 6 空格、字典体在 8 空格；
 *  - 现在内联的是 `src/client/locales/settings.ts` 的 `const zh = {…}` / `const en = {…}`，
 *    缩进 0 空格、字典体在 2 空格。`src/client/index.tsx` 现在只剩 `mergedFor()` 调用，
 *    那里没有任何文案可抓（在本文件读它只会得到"找不到字典"的假红）。
 *
 * 结尾仍然按**该字典自己的收尾**截断，而不是取到文件尾：那样 zh 的窗口会把 en 整块也包
 * 进来，后面同名 key 的英文值盖掉中文值，本测试就退化成「en 查两遍」——只在 zh 重复的
 * 标题会漏网。
 */
function dictSource(src, lang) {
  // zh 是键的定义来源（`export const zh = {`，`as const`）；en 与 6 门机器初翻都带映射类型
  // 标注（`const en: { [K in keyof typeof zh]: string } = {`），所以不能只认 ` = {` 这一种形状。
  const re = new RegExp(`\\n(?:export )?const ${lang}\\b[^=\\n]*=\\s*\\{`);
  const m = re.exec(src);
  assert.notEqual(m, null, `settings.ts 源码里找不到 ${lang} 字典`);
  const start = m.index;
  assert.notEqual(start, -1, `settings.ts 源码里找不到 ${lang} 字典`);
  const close = src.slice(start + 1).search(/^\};$/m);
  assert.notEqual(close, -1, `${lang} 字典找不到收尾`);
  return src.slice(start, start + 1 + close);
}

/** 字典里字面量取值（`key: 'value'`，含 `\'` 转义）的映射。 */
function dictValues(src, lang) {
  const out = new Map();
  const re = /^\s{2}(\w+):\s*'((?:[^'\\]|\\.)*)',$/gm;
  for (const m of dictSource(src, lang).matchAll(re)) {
    out.set(m[1], m[2].replace(/\\'/g, "'"));
  }
  return out;
}

/** 详情页实际会渲染出的 section 标题 key（按页面顺序）。 */
function renderedHeadingKeys() {
  const c = card();
  assert.match(c, /surface === 'detail' && \(/, '详情页开关段的渲染条件被改动，需同步本测试');
  const keys = ['sectionDisplayToggle'];
  for (const m of c.matchAll(/titleKey: '(\w+)'/g)) keys.push(m[1]);
  return keys;
}

test('详情页渲染的 section 标题在 zh / en 下都互不重复', () => {
  const src = dictFile();
  const keys = renderedHeadingKeys();
  assert.ok(keys.length >= 2, '应至少解析到开关段与一个字段段');

  for (const lang of ['zh', 'en']) {
    const dict = dictValues(src, lang);
    const byTitle = new Map();
    for (const key of keys) {
      const title = dict.get(key);
      assert.notEqual(title, undefined, `${lang} 字典缺少标题 key：${key}`);
      const prior = byTitle.get(title);
      assert.equal(
        prior,
        undefined,
        prior === undefined ? '' : `${lang} 下「${title}」被 ${prior} 与 ${key} 同时使用`,
      );
      byTitle.set(title, key);
    }
  }
});

test('开关段与显示字段段仍是两个不同的 key（改名而非删段）', () => {
  const dict = dictValues(dictFile(), 'zh');
  assert.notEqual(dict.get('sectionDisplayToggle'), undefined);
  assert.notEqual(dict.get('sectionDisplay'), undefined);
  assert.notEqual(dict.get('sectionDisplayToggle'), dict.get('sectionDisplay'));
});
