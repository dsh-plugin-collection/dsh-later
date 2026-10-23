/**
 * 「在分组徽标中显示定时任务」的齐全性契约（issue #83）。
 *
 * ## 这个文件在防什么
 *
 * dsh-group-status 的 PR #37 删掉了它 `Config` 里的 `showScheduledInBadge`，并把协议成员
 * `settingKey` 标为**废弃**（v1 仍接受、不报错，但对端不再读取）。于是那条「关掉定时任务
 * 提示」的开关**悬空**了：用户界面上再也找不到它，而协议只认一条规则——登记即显示，
 * 不注册即不显示。本仓的处置是把开关搬到自己的设置卡里，关掉时不登记 facet。
 *
 * 这条链子上有五个独立的地方需要说同一个名字：host `Config`、设置卡（interface / 字段联合 /
 * SECTIONS 行）、双语言字典、client 的读取处，以及 README 的配置表。**写错任何一处都不会报错**
 * ——宿主设置页照常渲染、facet 照常登记，只是那个开关从此失灵。所以这里逐处钉住，
 * 并检查旧的对端字段名（`showScheduledInBadge`）与废弃的 `settingKey` 在代码体里彻底消失。
 *
 * 判代码体不判注释：本仓的注释需要解释「曾经有过 settingKey、为什么删」，那些句子提到旧名
 * 是**正确**的，用全文正则会被自己的说明打挂（同 `long-prompt-settings.test.mjs` 的处置）。
 * @module tests/group-badge-visibility
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GROUP_BADGE_SETTING_KEY, isGroupBadgeVisible } from '../lib/schedule-facet.js';

const host = () => readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const card = () => readFileSync(new URL('../src/client/components/SchedulerSettingsCard.tsx', import.meta.url), 'utf8');
const client = () => readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8');
const facetGlue = () => readFileSync(new URL('../src/client/group-status-facet.ts', import.meta.url), 'utf8');
const logic = () => readFileSync(new URL('../src/schedule-facet.ts', import.meta.url), 'utf8');
const readme = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

/** 剥掉块注释与行注释，只留代码体（同 `group-status-facet.test.mjs` 的 `codeOf`）。 */
function codeOf(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 取 `zh: {` / `en: {` 那**一个**字典对象的源码（收尾按 6 空格缩进的 `},`）。
 * 不能一直取到 locale 调用结尾：那样 zh 的窗口会把 en 整块包进来，同名 key 被英文盖掉。
 */
function dictSource(src, lang) {
  const start = src.indexOf(`\n      ${lang}: {`);
  assert.notEqual(start, -1, `client 源码里找不到 ${lang} 字典`);
  const close = src.slice(start + 1).search(/^      \},$/m);
  assert.notEqual(close, -1, `${lang} 字典找不到收尾`);
  return src.slice(start, start + 1 + close);
}

// ── 1. 名字必须同源 ────────────────────────────────────────────────────────────────

test('字段名三处一致：常量、host Config、设置卡', () => {
  assert.equal(GROUP_BADGE_SETTING_KEY, 'showInGroupBadge');
  // host：默认开，且必须是 s.boolean()（0.2.0 的表单只认 Config 上的声明）。
  assert.match(host(), /showInGroupBadge: s\.boolean\(\)\.default\(true\)/);
  // 设置卡：存储形状 + SECTIONS 行都得到，缺任一处就是「设置页里没有这一行」。
  assert.match(card(), /showInGroupBadge\?: boolean/);
  assert.match(card(), /key: 'showInGroupBadge'/);
  assert.match(codeOf(client()), /isGroupBadgeVisible\(scope\.getSnapshot\(\)\)/, '两条轨道都必须走同一个判定函数');
  assert.match(codeOf(logic()), /value\[GROUP_BADGE_SETTING_KEY\] !== false/, '读取处必须用同一个常量，且只有显式 false 才算关');
});

test('设置卡把这一行归入布尔联合，默认值与 host 一致（true）', () => {
  const c = card();
  assert.match(c, /'showButton' \| 'showInGroupBadge' \| 'confirmDelivery'/, '必须挂在 boolean 字段的 key 联合里');
  const block = c.slice(c.indexOf("key: 'showInGroupBadge'"));
  assert.match(block.slice(0, 400), /defaultValue: true/, '默认值与 Config 的 default(true) 同源');
  assert.match(block.slice(0, 400), /labelKey: 'showInGroupBadgeLabel'/);
  assert.match(block.slice(0, 400), /hintKey: 'showInGroupBadgeHint'/);
});

test('中英字典都有这一行的 label 与 hint，且取值非空', () => {
  const src = client();
  for (const lang of ['zh', 'en']) {
    const dict = dictSource(src, lang);
    for (const key of ['showInGroupBadgeLabel', 'showInGroupBadgeHint']) {
      const m = dict.match(new RegExp(`\\n\\s{8}${key}:\\s*\\n?\\s*'((?:[^'\\\\]|\\\\.)*)'`));
      assert.ok(m !== null, `${lang} 字典缺 ${key}`);
      assert.ok(m[1].trim().length > 0, `${lang} 的 ${key} 是空串`);
    }
  }
});

// ── 2. 废弃字段必须彻底退出代码体 ──────────────────────────────────────────────────

test('交给对端的 facet 里没有 settingKey，也没有对端已删除的字段名', () => {
  // 只看代码体：注释里必须解释「曾经有 settingKey、为什么删」，那些句子提到旧名是对的。
  for (const [label, src] of [['facet 胶面', facetGlue()], ['纯逻辑面', logic()]]) {
    const code = codeOf(src);
    assert.doesNotMatch(code, /settingKey/, `${label} 的代码体里仍出现 settingKey：要么还在交给对端，要么还在读它`);
    assert.doesNotMatch(code, /showScheduledInBadge/, `${label} 仍挂着对端 #37 删掉的那个字段名`);
  }
  const rest = [host(), card(), client()].map(codeOf).join('\n');
  assert.doesNotMatch(rest, /showScheduledInBadge/, '对端删掉的字段名不得再出现在本仓代码体里');
});

// ── 3. 显隐只能由本插件执行 ────────────────────────────────────────────────────────

test('gate 挂在两条设置轨道上，且跟着订阅刷新（保存即生效，不靠刷新页面）', () => {
  const code = codeOf(client());
  assert.equal(
    (code.match(/attachBadgeVisibility\(scope\);/g) ?? []).length,
    2,
    '旧 settingsScope 与新 configForms 两条轨道都必须接上：只接一条，另一代 harness 的开关就是摆设',
  );
  assert.match(code, /scope\.subscribe\(\(\) => facetMount\.refresh\(\)\)/, '必须订阅设置变更');
  assert.match(code, /enabled: \(\) => getShowInGroupBadge\(\)/, '登记面必须现读开关，而不是 apply 时读一次');
});

test('判定只有显式 false 才算关：缺省 / loading / 非布尔一律显示', () => {
  assert.equal(isGroupBadgeVisible({ status: 'ready', value: { showInGroupBadge: false } }), false);
  assert.equal(isGroupBadgeVisible({ status: 'ready', value: { showInGroupBadge: true } }), true);
  assert.equal(isGroupBadgeVisible({ status: 'ready', value: {} }), true, '字段缺失按 schema 默认（显示）');
  assert.equal(isGroupBadgeVisible({ status: 'ready', value: { showInGroupBadge: 'false' } }), true, '非布尔不得当成关闭');
  assert.equal(isGroupBadgeVisible({ status: 'ready' }), true, '整个 value 都没有也按显示');
  assert.equal(isGroupBadgeVisible({ status: 'loading', value: { showInGroupBadge: false } }), true, '还没读到设置就关掉徽标，是拿「我看不见」冒充「用户不要」');
  assert.equal(isGroupBadgeVisible({ status: 'unavailable', value: { showInGroupBadge: false } }), true);
});

test('登记/注销的幂等由 mount 控制器保证（refresh 反复调用不登记出两份）', () => {
  const code = codeOf(facetGlue());
  assert.match(code, /if \(unregister === undefined\) unregister = registerLaterScheduleFacet\(input\);/);
  assert.match(code, /const detach = \(\): void => \{/, '注销必须只有一条路径');
  // dispose 复用同一个 detach：卸载时「关着」与「开着」都只需要一次注销，且不会重入。
  assert.match(code, /dispose: detach,/);
});

// ── 4. 文档别漂 ────────────────────────────────────────────────────────────────────

test('README 两份语言各列了这一行（设置页里有、文档里没有 = 指引不可达）', () => {
  assert.match(readme('README.md'), /\| 在分组徽标中显示定时任务 \|/);
  assert.match(readme('README.en.md'), /\| Show scheduled in group badge \|/);
});
