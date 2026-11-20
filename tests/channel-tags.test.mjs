/**
 * 通道 tag（`latest` / `next` / `alpha`）与 `verified-on` 台账。
 *
 * ## 这个文件在钉什么
 *
 * 通道 tag 回答的是「我用哪条内核轨，就装哪个插件版本」。它**必须**由验证事实推导，
 * 不能靠人记 —— 靠人记的结果是发版时忘了更新，用户拿着新内核装上旧插件，出问题才发现。
 *
 * 所以这里测的不是「tag 拼得对不对」，而是三条纪律：
 *
 * 1. **只挑验证过的版本**：`pickVersionForChannel` 找不到就返回 `undefined`，
 *    **绝不**回退到 latest —— 那会让用户以为装上了配套版本；
 * 2. **挑版本号最高的那个**：同一通道可能有多版都验过，要给最新的；
 * 3. **`VERIFIED_ON` 里登记的代次必须在 `KERNEL_GENERATIONS` 里**：防止有人手写一个
 *    根本没入表（=没跑完四面）的内核版本，声称「验过了」。
 *
 * 第 3 条是本轮事故（先打 tag 后补验证）教训的延续。
 * @module tests/channel-tags
 */
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  pickVersionForChannel,
  compareVersions,
  VERIFIED_ON,
  KERNEL_CHANNELS,
} from '../scripts/lib/verified-on.ts';
import { KERNEL_GENERATIONS } from '../lib/upstream-compat.js';
import { computeChannelTargets, computeDiff } from '../scripts/sync-generation-tags.mjs';

const LEDGER_IDS = new Set(KERNEL_GENERATIONS.map((g) => g.id));

/**
 * 当前发布版：**从 package.json 读，不写死**。
 *
 * 写死的后果是每发一版就有一条测试红，而红的原因不是代码错了、是测试过期 ——
 * 那种红会训练人「发版时顺手改测试」，于是护栏本身失效。
 */
const CURRENT = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

test('通道 tag：三条通道与内核 dist-tag 一一对应', () => {
  assert.deepEqual([...KERNEL_CHANNELS], ['latest', 'next', 'alpha']);
});

test('通道 tag：VERIFIED_ON 里的每个代次都必须在 KERNEL_GENERATIONS 台账里', () => {
  // 台账的入表标准是「mount / function / type / gate 四面都过」。
  // 一个不在台账里的代次出现在 VERIFIED_ON 中，等于声称「验过了但没跑完」——
  // 这正是本轮那次事故的形状（先打 tag、后补验证）。
  for (const [version, generations] of Object.entries(VERIFIED_ON)) {
    for (const generation of generations) {
      assert.ok(
        LEDGER_IDS.has(generation),
        `${version} 声称在 ${generation} 上验证过，但该代次不在 KERNEL_GENERATIONS 里`,
      );
    }
  }
});

test('通道 tag：当前版本覆盖全部台账代次（这是它同时服务三条通道的前提）', () => {
  const generations = VERIFIED_ON[CURRENT];
  assert.ok(
    Array.isArray(generations),
    `VERIFIED_ON 必须登记当前发布版 ${CURRENT} —— 否则 next/alpha 与代际 handle 会一直指向上一个版本`,
  );
  for (const id of LEDGER_IDS) {
    assert.ok(generations.includes(id), `${CURRENT} 应覆盖 ${id}`);
  }
});

test('通道 tag：未验证的内核版本返回 undefined，**不回退**到 latest', () => {
  // 这是最关键的一条：回退会让用户以为拿到了配套版本，实际没有。
  assert.equal(pickVersionForChannel('next', '9.9.9-never-verified'), undefined);
  assert.equal(pickVersionForChannel('alpha', undefined), undefined);
  assert.equal(pickVersionForChannel('latest', ''), undefined);
});

test('通道 tag：同一个内核上验过多版时，挑版本号最高的', () => {
  const ledger = {
    '1.13.0': ['0.2.2-rc.3'],
    '1.14.0': ['0.2.2-rc.3'],
    '1.10.0': ['0.2.2-rc.3'],
  };
  assert.equal(pickVersionForChannel('next', '0.2.2-rc.3', ledger), '1.14.0');
});

test('通道 tag：只在目标内核那代验过的版本才被挑中（别的代次不算）', () => {
  const ledger = {
    '1.13.0': ['0.2.2-rc.1'],
    '1.14.0': ['0.2.2-rc.3'],
  };
  assert.equal(pickVersionForChannel('latest', '0.2.2-rc.1', ledger), '1.13.0');
  assert.equal(pickVersionForChannel('next', '0.2.2-rc.3', ledger), '1.14.0');
  assert.equal(pickVersionForChannel('alpha', '0.2.2-alpha.3', ledger), undefined);
});

test('通道 tag：未知通道名直接抛错（避免拼错后静默挑出一个版本）', () => {
  assert.throws(() => pickVersionForChannel('nxt', '0.2.2-rc.3'), /未知通道/u);
});

test('通道 tag：版本比较按数值而不是字典序（1.9.0 < 1.10.0）', () => {
  // 字典序会把 '1.9.0' 排到 '1.10.0' 后面，挑出一个更旧的版本。
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0, '1.10.0 应大于 1.9.0');
  assert.ok(compareVersions('1.9.0', '1.10.0') < 0);
  assert.equal(compareVersions('1.14.0', '1.14.0'), 0);
});

test('通道 tag：三条通道都跟随内核实时 dist-tag 推导', () => {
  const { targets, unresolved } = computeChannelTargets({
    latest: '0.2.2-rc.1',
    next: '0.2.2-rc.3',
    alpha: '0.2.2-alpha.3',
  });
  assert.deepEqual(unresolved, [], '三条通道都应能判定');
  for (const { channel, kernel, version } of targets) {
    assert.equal(version, CURRENT, `${channel}（kernel=${kernel}）应挑到 ${CURRENT}`);
  }
});

test('通道 tag：内核某通道指向未验证版本时，该通道进 unresolved 并阻止执行', () => {
  const { unresolved } = computeChannelTargets({
    latest: '0.2.2-rc.1',
    next: '0.9.9-unverified',
    alpha: '0.2.2-alpha.3',
  });
  assert.deepEqual(unresolved, ['next'], '只有 next 应进 unresolved');
});

test('通道 tag：通道 tag 不会因为不在代际白名单里被误判成「应回收」', () => {
  // 回收规则是「线上多出来的 dsh-* tag」。latest/next/alpha 不是 dsh-* 前缀，
  // 但这条测试盯的是别把通道 tag 加进 remove（那会删掉正常通道）。
  const targets = computeChannelTargets({ latest: '0.2.2-rc.1', next: '0.2.2-rc.3', alpha: '0.2.2-alpha.3' }).targets;
  const diff = computeDiff({ latest: '1.14.0', next: '1.14.0', alpha: '1.14.0' }, '1.14.0', targets);
  assert.deepEqual(diff.remove, [], '通道 tag 齐备时不应有任何回收');
});

test('通道 tag：通道目标版本与线上不一致时进 add', () => {
  const targets = computeChannelTargets({ latest: '0.2.2-rc.1', next: '0.2.2-rc.3', alpha: '0.2.2-alpha.3' }).targets;
  const diff = computeDiff({ latest: '1.13.0' }, '1.14.0', targets);
  const added = diff.add.filter((e) => e.channel !== undefined).map((e) => e.tag);
  assert.ok(added.includes('next'), 'next 缺失时应进 add');
  assert.ok(added.includes('alpha'), 'alpha 缺失时应进 add');
});
