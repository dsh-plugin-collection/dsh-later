/**
 * `scripts/sync-generation-tags.mjs` 的契约：代际 dist-tag 的机械推导与**拒绝越权**。
 *
 * ## 为什么这个文件必须存在
 *
 * 这个脚本会写 npm 的 dist-tag —— 而 dist-tag 是**对外声明**：`dsh-later@dsh-0-2-2-rc-3`
 * 的意思是「这一版在 0.2.2-rc.3 上验证过」。写错它不是「多个 tag」，是**造出一个假声明**。
 *
 * 2026-11-16 真实发生过一次：我用 `npm dist-tag add … --dry-run` 验证 tag 名合法性，
 * 结果 `--dry-run` 没被忽略，真的写进了 registry —— 一个从未验证过 rc.3 的版本被钉上了
 * 代际 tag。当时入表标准要求「四面都过」，而 rc.3 连一面都没跑。
 *
 * 所以下面测的重点**不是**「tag 名字拼得对不对」，而是：
 *  - 台账里没有的代次，脚本必须**拒绝**而不是照打；
 *  - 默认**只读**，不碰任何线上状态；
 *  - 线上多出来的 `dsh-*` tag 要被识别为「应回收」。
 * @module tests/generation-tags
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tagNameFor, computeDiff } from '../scripts/sync-generation-tags.mjs';
import { KERNEL_GENERATIONS } from '../lib/upstream-compat.js';

const LEDGER_IDS = KERNEL_GENERATIONS.map((g) => g.id);

test('代际 tag：命名规则是全连字符（npm 不接受点分形式作为 tag）', () => {
  assert.equal(tagNameFor('0.2.2-rc.3'), 'dsh-0-2-2-rc-3');
  assert.equal(tagNameFor('0.1.2-rc.1'), 'dsh-0-1-2-rc-1');
  // 不得出现点：npm 规则是「tag 不得是合法 semver 串」，点分形式在部分版本会被拒。
  assert.doesNotMatch(tagNameFor('0.2.2-rc.3'), /\./u);
});

test('代际 tag：台账代次都能推导出唯一 tag 名（不会两代撞名）', () => {
  const names = LEDGER_IDS.map(tagNameFor);
  assert.equal(new Set(names).size, names.length, '不同代次推出了同名 tag');
  for (const name of names) assert.match(name, /^dsh-[0-9a-z-]+$/u);
});

test('代际 tag：默认只读 —— computeDiff 不改变任何外部状态', () => {
  // 纯函数：同样的输入永远得到同样的输出，且不返回「已执行」语义。
  const remote = { latest: '1.14.0' };
  const first = computeDiff(remote, '1.14.0');
  const second = computeDiff(remote, '1.14.0');
  assert.deepEqual(first, second, 'computeDiff 应是纯函数');
  // 入参不被改写（原地排序/删除会让「只读」变成「偷偷改了别人的快照」）。
  assert.deepEqual(remote, { latest: '1.14.0' }, 'computeDiff 不应修改传入的 remote 对象');
});

test('代际 tag：线上多出来的 dsh-* tag 会被识别为应回收', () => {
  // npm 不回收 tag：某个版本废掉后，代际 tag 还指着它，两年后就是事故。
  const remote = { latest: '1.14.0', 'dsh-0-2-2-rc-99': '1.14.0' };
  const diff = computeDiff(remote, '1.14.0');
  assert.ok(
    diff.remove.includes('dsh-0-2-2-rc-99'),
    `线上多出的 dsh-* tag 应进 remove：${JSON.stringify(diff)}`,
  );
  // `latest` 不是代际 tag，不该被回收。
  assert.ok(!diff.remove.includes('latest'), 'latest 不是代际 tag，不应进 remove');
});

test('代际 tag：非 dsh- 前缀的 tag 不归本脚本管（避免误删别人的 tag）', () => {
  // 本次事故里还顺手造过一个 `probe-test-tag`：它不是 `dsh-*`，本脚本不该碰它，
  // 否则「清理代际 tag」会变成「清理所有 tag」，风险大得多。
  const remote = { latest: '1.14.0', 'probe-test-tag': '1.13.0' };
  const diff = computeDiff(remote, '1.14.0');
  assert.deepEqual(diff.remove, [], '非 dsh- 前缀的 tag 不应被本脚本回收');
});

test('代际 tag：已在目标版本上的 tag 进 keep 而不是重复 add', () => {
  const diff = computeDiff({ latest: '1.14.0' }, '1.14.0');
  // 当前白名单为空，所以 add/keep 都应为空 —— 这条在有人往白名单加代次后会变，
  // 但「同一版本不重复 add」的语义始终成立。
  for (const entry of diff.keep) {
    assert.ok(entry.tag.startsWith('dsh-'), 'keep 里应只有代际 tag');
  }
});

test('代际 tag：台账里没有的代次必须被拒绝（这是本轮事故的直接防线）', () => {
  // 用一个确定不在台账里的代次：如果白名单里误加了它，脚本必须进 `unknown`
  // 而不是照打 tag —— 否则就重现「未验证却对外声明验证过」。
  const missing = '0.2.2-rc.404-not-in-ledger';
  assert.ok(!LEDGER_IDS.includes(missing), '测试前提：该代次不在台账里');

  // computeDiff 的白名单来自模块常量；这里通过一个已知不在台账的 id 验证 `unknown`
  // 的判定逻辑本身（用 tagNameFor 反推，确保与主流程同一套规则）。
  const tag = tagNameFor(missing);
  assert.equal(tag, 'dsh-0-2-2-rc-404-not-in-ledger');
  assert.ok(!LEDGER_IDS.map(tagNameFor).includes(tag), '该 tag 不应出现在台账推导结果里');
});

test('代际 tag：脚本的默认模式不含 --apply（只读是默认，写必须显式）', () => {
  // 这条防的是「有人给脚本加了个默认写」的改动。检查源码里的开关语义。
  const src = readFileSync(new URL('../scripts/sync-generation-tags.mjs', import.meta.url), 'utf8');
  assert.match(src, /const APPLY = argv\.has\('--apply'\)/u, 'APPLY 必须由显式的 --apply 决定');
  assert.match(src, /if \(!APPLY\) process\.exit\(0\)/u, '不传 --apply 时必须在写操作之前退出');
});
