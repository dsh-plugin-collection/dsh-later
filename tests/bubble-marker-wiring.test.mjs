/**
 * 气泡标记的「同一个名字出现在几处」契约（issue #112）。
 *
 * ## 这个文件在防什么
 *
 * 这条链上有七处必须说同一件事，任何一处漏写都**不会报错**：
 *  1. host `Config` 的 `bubbleMarker` 字段（0.2.x 设置页由它生成表单）；
 *  2. 设置卡的 enum 字段（旧轨道的手写卡片）；
 *  3. zh / en 两本字典的四档选项文案；
 *  4. 控制器里的影子 priority（负值才盖得住官方 0）；
 *  5. 被接管的两个 key（`user`、`steering`）；
 *  6. 客户端入口在两条设置轨道上各挂一次；
 *  7. 渲染器真的走官方内容工厂（不自己画气泡）。
 *
 * 漏了 1/2：设置页没有这一项，用户改不了；漏了 3：下拉框里显示 key 名；
 * 漏了 4：注册直接抛错（同 priority 冲突）；漏了 5：steer 投递的定时消息没有钟；
 * 漏了 6：新老 harness 只有一边生效；漏了 7：气泡变成兜底样式。
 * @module tests/bubble-marker-wiring
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('host Config：bubbleMarker 四档 + 默认 left', () => {
  const src = read('src/index.ts');
  assert.match(src, /bubbleMarker:\s*s\s*\.union\(\[/);
  for (const value of ['off', 'left', 'meta', 'hover']) {
    assert.match(src, new RegExp(`s\\.const\\('${value}'\\)`), `缺少档位 ${value}`);
  }
  assert.match(src, /\.default\('left'\)/);
});

test('设置卡：bubbleMarker 是 enum，四档齐全', () => {
  const src = read('src/client/components/SchedulerSettingsCard.tsx');
  assert.match(src, /key: 'bubbleMarker'/);
  const field = src.slice(src.indexOf("key: 'bubbleMarker'"), src.indexOf("key: 'bubbleMarker'") + 320);
  for (const value of ['left', 'meta', 'hover', 'off']) {
    assert.ok(field.includes(`'${value}'`), `卡片缺档位 ${value}`);
  }
});

test('字典：四档选项与 tooltip 在 zh/en 都存在', () => {
  const src = read('src/client/strings.ts');
  for (const key of [
    'bubbleMarkerLabel',
    'bubbleMarkerHint',
    'bubbleMarkerOption_off',
    'bubbleMarkerOption_left',
    'bubbleMarkerOption_meta',
    'bubbleMarkerOption_hover',
    'laterMarkerAria',
    'laterMarkerTooltip',
    'laterMarkerTooltipBatch',
    'laterMarkerMeta',
    'actionCopy',
    'actionCopied',
    'clockMd',
    'clockYmd',
  ]) {
    const hits = src.split(`${key}:`).length - 1;
    assert.equal(hits, 2, `${key} 应同时出现在 zh/en（实际 ${hits} 处）`);
  }
});

test('控制器：影子 priority 是 -10，接管 user 与 steering', () => {
  const src = read('src/client/marker-controller.ts');
  assert.match(src, /const SHADOW_PRIORITY = -10;/);
  assert.match(src, /const NODE_KEYS = \['user', 'steering'\] as const;/);
  assert.match(src, /planBubbleMarker\(/);
  // 能力探针：用户内容工厂的子槽
  assert.match(src, /CONTENT_PROBE_SLOT = 'conversation\.chat\.user\.images'/);
});

test('入口：两条设置轨道各挂一次 mountMarker', () => {
  const src = read('src/client/index.tsx');
  const calls = src.split('mountMarker(scope);').length - 1;
  assert.equal(calls, 2, `mountMarker 应调用两次（实际 ${calls}）`);
  assert.match(src, /mountBubbleMarker\(/);
});

test('渲染器：走官方内容工厂，且带兜底', () => {
  const src = read('src/client/components/LaterUserMessageView.tsx');
  assert.match(src, /'conversation\.chat\.user\.content'/);
  assert.match(src, /fallback:/);
  assert.match(src, /ss-later-actions/);
  // 没有标记时也要有一条等价行（普通消息全走这里）
  assert.match(src, /data-ss-later-row/);
});

test('样式：标记类都在 styles.ts 里定义（配合 client-class-guard）', () => {
  const src = read('src/client/styles.ts');
  for (const cls of ['ss-later-row', 'ss-later-mark', 'ss-later-meta', 'ss-later-actions', 'ss-later-copy', 'ss-later-time', 'ss-later-fallback']) {
    assert.ok(src.includes(`.${cls}`), `缺少 .${cls}`);
  }
});
