/**
 * 插话投递设置的静态契约测试。
 *
 * 这组断言刻意做成「源码级」而非渲染级：设置卡片是 React 组件，测试环境不引入
 * DOM/渲染库（仓库既有的 client 测试也都是源码级，见 client-command-outcome）。
 * 目的不是覆盖渲染细节，而是锁住几个**容易在后续改动中悄悄丢失**的约定：
 *
 *  1. 三个新字段在 host schema、host 类型、client 类型三处都齐全（漏一处就静默失效）；
 *  2. 默认值是安全侧（followup / 确认开 / 未确认保留）；
 *  3. steer 的风险提示是**常驻**且在确认关闭时改口径（不能退化成 tooltip 或固定文案）；
 *  4. dock 的未确认提示走**投影对账**，而不是依赖命令返回值（框架只回 matched）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

test('host settings schema 含三字段且默认为安全侧', () => {
  const src = read('index.ts');
  assert.match(src, /steerDelivery: s\.union\(\[s\.const\('followup'\), s\.const\('steer'\)\]\)\.default\('followup'\)/);
  assert.match(src, /confirmDelivery: s\.boolean\(\)\.default\(true\)/);
  assert.match(src, /onUnconfirmed: s\.union\(\[s\.const\('keep'\), s\.const\('discard'\)\]\)\.default\('keep'\)/);
});

test('host 非法值回落安全侧（不得把未知值当 steer / discard）', () => {
  const src = read('index.ts');
  // 只认精确的 'steer' / 'discard'，其余一律走默认
  assert.match(src, /steerDelivery: value\?\.steerDelivery === 'steer' \? 'steer' : 'followup'/);
  assert.match(src, /onUnconfirmed: value\?\.onUnconfirmed === 'discard' \? 'discard' : 'keep'/);
  assert.match(src, /confirmDelivery: value\?\.confirmDelivery !== false/);
});

test('client 设置类型含三字段，字段表覆盖三处', () => {
  const src = read('client/components/SchedulerSettingsCard.tsx');
  assert.match(src, /steerDelivery\?: 'followup' \| 'steer'/);
  assert.match(src, /confirmDelivery\?: boolean/);
  assert.match(src, /onUnconfirmed\?: 'keep' \| 'discard'/);
  // 字段表里三个 key 都要出现（key 拼错会导致该设置项在 UI 上根本不显示）
  assert.match(src, /key: 'steerDelivery'/);
  assert.match(src, /key: 'confirmDelivery'/);
  assert.match(src, /key: 'onUnconfirmed'/);
});

test('steer 风险提示常驻，且随「投递确认」开关切换口径', () => {
  const src = read('client/components/SchedulerSettingsCard.tsx');
  // 常驻渲染（role=status 的段落），不是 title/tooltip
  assert.match(src, /ss-card-risk/);
  assert.match(src, /steerRiskGuarded/);
  assert.match(src, /steerRiskUnguarded/);
  // 口径由 confirmEnabled 决定
  assert.match(src, /confirmEnabled \? t\('steerRiskGuarded'\) : t\('steerRiskUnguarded'\)/);
});

test('中英文案齐备（漏英文会回落中文，难以察觉）', () => {
  const src = read('client/index.tsx');
  for (const key of [
    'steerDeliveryLabel',
    'steerDeliveryOption_followup',
    'steerDeliveryOption_steer',
    'confirmDeliveryLabel',
    'onUnconfirmedLabel',
    'onUnconfirmedOption_keep',
    'onUnconfirmedOption_discard',
    'steerRiskGuarded',
    'steerRiskUnguarded',
    'discardRisk',
  ]) {
    const hits = src.split(`${key}:`).length - 1;
    assert.equal(hits, 2, `${key} 应中英各一份，实际 ${hits} 份`);
  }
});

test('dock 的未确认提示走投影对账（不依赖命令返回值）', () => {
  const src = read('client/components/ScheduleDock.tsx');
  // 观察窗常量必须大于宿主侧确认预算，否则会在宿主判定前就下结论
  assert.match(src, /STEER_CONFIRM_WINDOW_MS = 2600/);
  assert.match(src, /steerUnconfirmed/);
  assert.match(src, /ss-dock-steer-warn/);
  assert.match(src, /handleSteerRetry/);
  // 不得从命令结果里读业务码（框架只回 matched）
  assert.doesNotMatch(src, /outcome\.code/, '不得依赖命令返回值里的业务码');
});

test('dock 文案齐备', () => {
  const src = read('client/strings.ts');
  for (const key of ['steerUnconfirmed', 'steerRetry']) {
    const hits = src.split(`${key}:`).length - 1;
    assert.equal(hits, 2, `${key} 应中英各一份，实际 ${hits} 份`);
  }
});

test('每个布尔字段有自己的开/关文案（不得共用「显示/隐藏」）', () => {
  const src = read('client/components/SchedulerSettingsCard.tsx');
  // showButton 是显隐开关 → 显示/隐藏；confirmDelivery 是功能开关 → 开启/关闭。
  // 曾共用 optionOn/optionOff，导致「投递确认」显示成「显示/隐藏」（实机发现）。
  assert.match(src, /onKey: 'optionOn',\s*\n\s*offKey: 'optionOff'/);
  assert.match(src, /onKey: 'optionEnabled',\s*\n\s*offKey: 'optionDisabled'/);
  // 渲染必须读字段自己的 key，而不是硬编码共用文案
  assert.match(src, /t\(field\.onKey\)/);
  assert.match(src, /t\(field\.offKey\)/);
  assert.doesNotMatch(src, /<option value="true">\{t\('optionOn'\)\}/, '不得硬编码共用开文案');
});

test('optionEnabled / optionDisabled 中英齐备', () => {
  const src = read('client/index.tsx');
  for (const key of ['optionEnabled', 'optionDisabled']) {
    const hits = src.split(`${key}:`).length - 1;
    assert.equal(hits, 2, `${key} 应中英各一份，实际 ${hits} 份`);
  }
});

test('delivery.ts 不监听核心运行时事件（避免与核心时序隐性耦合）', () => {
  const src = read('delivery.ts');
  // 只看**代码**，不看注释：注释里正当地解释了 inbox/claimed 的机制。
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  assert.doesNotMatch(code, /inbox\/claimed/);
  assert.doesNotMatch(code, /request\/header/);
  assert.doesNotMatch(code, /\.on\(/, '不得订阅核心事件');
  // 判据是读日志
  assert.match(code, /readOwnEvents/);
});
