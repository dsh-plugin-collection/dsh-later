/**
 * 支持面护栏：`engines.dsh` 必须由 KERNEL_GENERATIONS 推导，且 tuple 上界的判定符合预期。
 *
 * ## 这条守卫挡的是哪一种事故
 *
 * `engines.dsh` 此前是手写常量，而加新一代只重写了 peer 枚举 —— 两处各说各话，实测后果是
 * 一批**从没跑过的预发布**被判「支持」（`0.1.3-alpha.2`、`0.1.6-alpha.1`、`0.1.7-alpha.1`、
 * `0.2.2-alpha.2`、`0.1.5-rc.1/rc.2`）：node-semver 不把预发布算进普通范围，`>=0.1.2-rc.1 <0.2.0-0`
 * 这种写法兜不住。现在这一行由 `enginesDshRange()` 生成、`sync-peer-matrix` 落地，本文件钉住
 * 「package.json 与本表不再可能漂移」＋「收口形状确实是逐 tuple」。
 *
 * ## 判定用的是谁
 *
 * 本仓自带的 `compareVersions`（semver §11 实现，含预发布比较）。**不是** node-semver：
 * 它在本插件的依赖树里不可解析（实测 ERR_MODULE_NOT_FOUND），装它进 devDependencies 只为
 * 跑一条断言不值。与被测内核（`semver.satisfies(..., {includePrerelease:true})`）的一致性
 * 不是本文件证明的，是靠真内核逐代实测得出的（见 docs/verification.md 与本目录 git log）。
 * 所以这里断言的是**内部自洽 + 形状正确**；跨实现等价性请复跑 `verify-across-kernels`。
 *
 * ## 一条不许被误读成「白名单」的边界
 *
 * range 语法表达不出「只认已验证的那几个版本」：同 tuple 的更晚 rc 与正式版都会一起放行。
 * 下面 `同 tuple 向后放行` 那组断言是**刻意把这个行为钉成契约**，不是把它当漏洞——
 * 谁哪天改成精确版本列表，这组会红，那时要一并决定「每个新 rc 都要重发插件」的代价。
 * @module tests/support-surface
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareVersions, enginesDshRange, KERNEL_GENERATIONS, versionAtLeast } from '../lib/upstream-compat.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** 把 `>=a <b || >=c <d` 解析成条款数组。 */
const clauses = (range) =>
  range.split('||').map((part) => {
    const m = /^\s*>=([\w.\-+]+)\s+<([\w.\-+]+)\s*$/.exec(part);
    assert.ok(m, `范围条款形状不认识：${JSON.stringify(part)}`);
    return { floor: m[1], ceiling: m[2] };
  });

/** 版本是否落在范围串里（逐条款比对上下界，含下界、不含上界）。 */
const admitted = (version, range) =>
  clauses(range).some(
    ({ floor, ceiling }) =>
      (versionAtLeast(version, floor) ?? false) && (compareVersions(version, ceiling) ?? 1) < 0,
  );

test('engines.dsh 必须由 KERNEL_GENERATIONS 推导，不许再手抄（防两处漂移）', () => {
  assert.equal(
    pkg.engines.dsh,
    enginesDshRange(),
    'package.json 的 engines.dsh 与本表推导结果不一致——跑 node scripts/sync-peer-matrix.mjs',
  );
});

test('形状：每个 tuple 一条款，上界是下一 patch 的 `-0`', () => {
  const list = clauses(pkg.engines.dsh);
  const tuples = [...new Set(KERNEL_GENERATIONS.map((g) => g.id.split('-')[0]))];
  assert.equal(list.length, tuples.length, '条款数应等于 tuple 数（同 tuple 的多个 rc 合成一条）');

  for (const { floor, ceiling } of list) {
    const [base, pre] = floor.split('-');
    assert.ok(pre !== undefined, `下界应带预发布标记（逐代留痕），却是 ${floor}`);
    const [major, minor, patch] = base.split('.').map(Number);
    assert.equal(
      ceiling,
      `${major}.${minor}.${patch + 1}-0`,
      `上界必须是下一 patch 的 -0（它低于该版任何预发布），实际 ${ceiling}`,
    );
    // 下界必须是**该 tuple 里最早已验证的那一代**，不是借来的更早范围。
    const inTuple = KERNEL_GENERATIONS.filter((g) => g.id.split('-')[0] === base).map((g) => g.id);
    assert.ok(inTuple.includes(floor), `${floor} 不是已验证代次：${inTuple.join(', ')}`);
    for (const id of inTuple) {
      assert.ok((compareVersions(floor, id) ?? 1) <= 0, `${floor} 高于同 tuple 已验证的 ${id}`);
    }
  }
});

test('六个已验证代次必须全部放行（收紧不能把自己收出门）', () => {
  for (const gen of KERNEL_GENERATIONS) {
    assert.ok(admitted(gen.id, pkg.engines.dsh), `已验证代次 ${gen.id} 被 engines.dsh 拒绝`);
  }
});

test('别的 tuple 上的预发布必须被拦住（这次收紧的实际内容）', () => {
  const rejected = [
    '0.1.1-rc.2',      // 已出表的下界之外
    '0.1.2-alpha.5',
    '0.1.3-alpha.2',   // 全新 tuple
    '0.1.4-rc.1',
    '0.1.5-rc.1',      // 同 tuple 但早于已验证的 rc.3
    '0.1.5-rc.2',
    '0.1.6-alpha.1',
    '0.1.7-alpha.1',   // alpha 低于 rc：同 tuple 的更早预发布也拦
    '0.2.0-rc.1',
    '0.2.2-alpha.2',
    '0.3.0-rc.1',
  ];
  for (const version of rejected) {
    assert.equal(admitted(version, pkg.engines.dsh), false, `${version} 不该被判「支持」`);
  }
});

test('同 tuple 向后放行是**契约**而非漏洞（range 写不出白名单）', () => {
  // 0.2.1-rc.3 / rc.4 已实测 mount GREEN（但未进 KERNEL_GENERATIONS，见模块头说明）：
  // 它们能被放行靠的就是这条语义，不是靠把它们塞进 engines 字符串。
  for (const version of ['0.2.1-rc.3', '0.2.1-rc.4', '0.1.7-rc.3', '0.2.0-rc.3']) {
    assert.equal(admitted(version, pkg.engines.dsh), true, `${version} 应随同 tuple 向后放行`);
  }
  // 各 tuple 的正式版同样放行——这是 range 语法的固有结果。
  assert.equal(admitted('0.2.1', pkg.engines.dsh), true);
  assert.equal(admitted('0.1.7', pkg.engines.dsh), true);
});

test('peer 侧仍是逐代枚举（两种形状各有各的职责，不许互相抄）', () => {
  const peer = pkg.peerDependencies['@deepseek-ai/dsh-session'];
  for (const gen of KERNEL_GENERATIONS) {
    assert.ok(peer.includes(`^${gen.id}`), `peer 少了逐代枚举项 ^${gen.id}`);
  }
  // peer 是「证据台账」，engines 是「收口范围」：把后者的形状抄进前者会丢掉留痕。
  assert.ok(!peer.includes('<'), 'peer 里出现 tuple 上界写法说明两处被混用了');
});
