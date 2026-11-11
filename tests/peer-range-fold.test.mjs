/**
 * peer 范围合并的等价性护栏。
 *
 * ## 这条守卫挡的是哪一种事故
 *
 * 8 个 `dsh-*` peer 原来每代写一条区间（11 到 12 条），现在按版本段合并（6 到 7 条）。
 * 合并的安全条件是**并集逐点相同**：同段内更晚的 rc 本来就被该段最早下界的区间覆盖，
 * 去掉冗余下界不改变任何版本的可安装性。
 *
 * 事故长什么样：合并时把 `0.1.5-rc.3` 抬到 `0.1.2-rc.1`（空洞被吃掉，声明支持一堆没
 * 跑过的预发布），或把 `0.2.0-rc.2` 段整段丢掉（已验证代次装不上）。两种都不会报错，
 * 只会在某个老内核上原地变成「插件静默不加载」。所以这里不比对字符串，而是拿版本
 * 逐点比对**新旧两条 range 的命中结果**。
 *
 * ## 判定口径
 *
 * - 探针覆盖每个版本段的 rc / alpha 边界、段间空洞与段上界，另外补一份全 0.x 网格。
 * - 两种 semver 模式都跑：默认模式（node-semver `satisfies` 的默认语义）与
 *   `includePrerelease`（本插件判定内核版本时用的口径）。
 * - 新旧两串分别喂给 node-semver；node-semver 本身不在本包依赖里（实测解析不到），
 *   缺席时该组断言跳过，其余纯函数断言照跑。
 * @module tests/peer-range-fold
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KERNEL_GENERATIONS,
  genPeerRange,
  peerMatrixEntries,
} from '../lib/upstream-compat.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** node-semver 只在 pnpm 的隐藏目录里有；找不到就跳过需要它的那组断言。 */
function loadSemver() {
  const resolver = createRequire(import.meta.url);
  try {
    return resolver('semver');
  } catch {
    // 落回 pnpm 布局：node_modules/.pnpm/semver@<ver>/node_modules/semver
  }
  try {
    const store = fileURLToPath(new URL('../node_modules/.pnpm/', import.meta.url));
    const dir = readdirSync(store)
      .filter((name) => name.startsWith('semver@'))
      .sort()
      .at(-1);
    if (dir === undefined) return null;
    return resolver(join(store, dir, 'node_modules', 'semver'));
  } catch {
    return null;
  }
}

/**
 * 拆解一条 peer 串：`>=a <b || >=c <d` → `[{ floor, ceiling }]`。
 * 形状不认识直接判红（形状漂了，等价性也就无从谈起）。
 */
function clauses(range) {
  return range.split('||').map((part) => {
    const m = /^\s*>=([\w.\-+]+)\s+<([\w.\-+]+)\s*$/.exec(part);
    assert.ok(m, `范围条款形状不认识：${JSON.stringify(part)}`);
    return { floor: m[1], ceiling: m[2] };
  });
}

/**
 * 按段折叠：同一 `ceiling` 只保留最早的下界。
 *
 * 故意在测试里独立实现一遍，不复用 `src/upstream-compat.ts` 的 `foldSegmentClauses`：
 * 实现写错时不能用实现算出的期望值自证。
 *
 * @param {readonly string[]} ids 代次 id（已按表顺序）。
 */
function foldExpected(ids) {
  const segments = new Map();
  for (const id of ids) {
    const ceiling = `${id.split('-')[0].split('.').map(Number).slice(0, 2).join('.')}.${
      Number(id.split('-')[0].split('.')[2]) + 1
    }-0`;
    const held = segments.get(ceiling);
    if (held === undefined || compare(id, held) < 0) segments.set(ceiling, id);
  }
  return [...segments.entries()]
    .sort((a, b) => compare(`${a[0]}-0`, `${b[0]}-0`))
    .map(([ceiling, floor]) => `>=${floor} <${ceiling}`)
    .join(' || ');
}

/** semver §11 的最小比较器，只用于排序段上界（不参与任何等价性判定）。 */
function compare(a, b) {
  const parse = (v) => {
    const [base, pre] = v.split('-');
    const [major, minor, patch] = base.split('.').map(Number);
    return { major, minor, patch, pre: pre === undefined ? null : pre.split('.') };
  };
  const x = parse(a);
  const y = parse(b);
  for (const key of ['major', 'minor', 'patch']) {
    if (x[key] !== y[key]) return x[key] - y[key];
  }
  if (x.pre === null || y.pre === null) return x.pre === null ? (y.pre === null ? 0 : 1) : -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    if (x.pre[i] === undefined) return -1;
    if (y.pre[i] === undefined) return 1;
    if (x.pre[i] === y.pre[i]) continue;
    const nx = Number(x.pre[i]);
    const ny = Number(y.pre[i]);
    if (Number.isNaN(nx) || Number.isNaN(ny)) return x.pre[i] < y.pre[i] ? -1 : 1;
    return nx - ny;
  }
  return 0;
}

/**
 * 探针版本集。
 *
 * 固定探针覆盖：每段的 rc / alpha 边界（`0.1.4-0`、`0.1.6-0`、`0.2.0-rc.1`、`0.2.2-rc.0` 等）、
 * 三个空洞（`0.1.3`*、`0.1.4`*、`0.1.6`*、`0.2.2-beta.*`）、下界之前（`0.1.1-rc.2`）、
 * 上界之后（`0.2.3-0`、`0.3.0`）。
 *
 * 动态探针：每个段下界到上界之间的每个 patch × 全部预发布标签，以及上界本身。
 */
const FIXED_PROBES = Object.freeze([
  '0.0.0',
  '0.0.1-0', '0.0.1-rc.1', '0.0.1', '0.0.2-0',
  '0.1.0',
  '0.1.1-rc.2', '0.1.1',
  '0.1.2-0', '0.1.2-alpha.1', '0.1.2-rc.1', '0.1.2',
  '0.1.3-0', '0.1.3-alpha.2', '0.1.3',
  '0.1.4-0', '0.1.4',
  '0.1.5-0', '0.1.5-rc.1', '0.1.5-rc.2', '0.1.5-rc.3', '0.1.5',
  '0.1.6-0', '0.1.6-alpha.1', '0.1.6',
  '0.1.7-0', '0.1.7-alpha.1', '0.1.7-rc.1', '0.1.7-rc.2', '0.1.7-rc.3', '0.1.7', '0.1.8-0',
  '0.2.0-0', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.0-rc.3', '0.2.0', '0.2.1-0',
  '0.2.1-rc.1', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1-rc.5', '0.2.1', '0.2.2-0',
  '0.2.2-alpha.0', '0.2.2-alpha.1', '0.2.2-alpha.2', '0.2.2-alpha.3', '0.2.2-alpha.4',
  '0.2.2-beta.1', '0.2.2-rc.0', '0.2.2-rc.1', '0.2.2-rc.2', '0.2.2', '0.2.3-0', '0.2.3-alpha.1', '0.2.3',
  '0.3.0-rc.1', '1.0.0',
]);

const PRE_LABELS = Object.freeze(['0', 'alpha.1', 'alpha.2', 'alpha.3', 'beta.1', 'rc.0', 'rc.1', 'rc.2', 'rc.3', 'rc.4']);

/** 一串 range 覆盖的版本段（上界）集合。 */
function ceilingSet(range) {
  return clauses(range).map((clause) => clause.ceiling);
}

/** 每个段 [下界 patch, 上界 patch] 之间逐 patch × 逐标签的探针，外加段上界本身。 */
function dynamicProbes(ranges) {
  const probes = new Set();
  for (const range of ranges) {
    for (const { floor, ceiling } of clauses(range)) {
      const [major, minor, patch] = floor.split('-')[0].split('.').map(Number);
      const ceilingPatch = Number(ceiling.split('-')[0].split('.').pop());
      for (let p = patch; p <= ceilingPatch; p += 1) {
        for (const label of PRE_LABELS) probes.add(`${major}.${minor}.${p}-${label}`);
      }
      probes.add(ceiling);
    }
  }
  return [...probes];
}

/** 旧串（每代一条）。由代次表推导，不从 git 历史抄。 */
function legacyPeerRange(packageName) {
  const ids = packageName === '@deepseek-ai/dsh-commands'
    ? ['0.0.1-rc.1', ...KERNEL_GENERATIONS.map((g) => g.id)]
    : KERNEL_GENERATIONS.map((g) => g.id);
  return ids.map((id) => genPeerRange(id)).join(' || ');
}

test('merged peer range 的形状：每段一条，下界是该段最早的已验证代次', () => {
  for (const { packageName, range } of peerMatrixEntries()) {
    const list = clauses(range);
    const ceilings = list.map((clause) => clause.ceiling);
    assert.equal(new Set(ceilings).size, ceilings.length, `${packageName} 同段出现多条条款`);

    const ids = KERNEL_GENERATIONS.map((g) => g.id);
    if (packageName === '@deepseek-ai/dsh-commands') {
      assert.equal(list[0].floor, '0.0.1-rc.1', 'dsh-commands 应保留 0.0.1 线');
      assert.equal(list[0].ceiling, '0.0.2-0');
    }
    // 每个段的下界必须是落在该段的已入表代次里最早的一个（commands 的 0.0.1 段除外）。
    for (const { floor, ceiling } of list) {
      const inSegment = ids.filter((id) => genPeerRange(id).endsWith(` <${ceiling}`));
      if (inSegment.length === 0) continue;
      assert.equal(
        floor,
        inSegment[0],
        `${packageName} 的 ${ceiling} 段下界应是 ${inSegment[0]}，实际 ${floor}`,
      );
    }
    // 生成器给了"每代一条"，折叠器必须真的合掉同段冗余，否则条款数守恒。
    const legacy = legacyPeerRange(packageName);
    assert.equal(
      list.length,
      new Set(ceilingSet(legacy)).size,
      `${packageName} 的条款数应等于旧串覆盖的版本段数（折叠语义）`,
    );
    assert.ok(list.length <= clauses(legacy).length, `${packageName} 折叠后条款数反而变多`);
  }
});

test('折叠结果与独立重算一致（不从实现抄期望值）', () => {
  for (const { packageName, range } of peerMatrixEntries()) {
    const ids = packageName === '@deepseek-ai/dsh-commands'
      ? ['0.0.1-rc.1', ...KERNEL_GENERATIONS.map((g) => g.id)]
      : KERNEL_GENERATIONS.map((g) => g.id);
    assert.equal(range, foldExpected(ids), `${packageName} 的合并结果与按段重算不一致`);
  }
});

const semver = loadSemver();

test('并集逐点等价：新旧 range 对全部探针的判定相同', { skip: semver === null && 'node-semver 不在依赖树里' }, () => {
  assert.ok(semver, 'node-semver 应可解析');
  const probes = [...new Set([...FIXED_PROBES, ...dynamicProbes(peerMatrixEntries().map((e) => e.range))])];
  assert.ok(probes.length > 100, `探针太少（${probes.length}）：等价性没被真正覆盖`);

  for (const { packageName, range } of peerMatrixEntries()) {
    const legacy = legacyPeerRange(packageName);
    for (const options of [{}, { includePrerelease: true }]) {
      const differences = probes
        .filter(
          (version) =>
            semver.satisfies(version, legacy, options) !== semver.satisfies(version, range, options),
        )
        .map((version) => `${version}（旧 ${semver.satisfies(version, legacy, options)} / 新 ${semver.satisfies(version, range, options)}）`);
      assert.deepEqual(
        differences,
        [],
        `${packageName} 折叠改变了可安装面（options=${JSON.stringify(options)}）：\n${differences.join('\n')}`,
      );
    }
  }
  // 关键边界单独点名：防探针生成器哪天把这几条改没了，等价性变成空过。
  const session = pkg.peerDependencies['@deepseek-ai/dsh-session'];
  for (const version of ['0.1.4-0', '0.1.6-0', '0.2.0-rc.1', '0.2.2-rc.0', '0.2.2-alpha.2', '0.2.2-alpha.3', '0.2.2-rc.1']) {
    assert.equal(
      semver.satisfies(version, session),
      semver.satisfies(version, legacyPeerRange('@deepseek-ai/dsh-session')),
      `${version} 的判定被折叠改变了`,
    );
  }
});

test('变异验证：把一段并掉、或把下界抬高，等价性判据必须判红', { skip: semver === null && 'node-semver 不在依赖树里' }, () => {
  assert.ok(semver, 'node-semver 应可解析');
  const probes = [...FIXED_PROBES];
  const legacy = legacyPeerRange('@deepseek-ai/dsh-session');
  const differs = (mutant) =>
    probes.some(
      (version) => semver.satisfies(version, legacy) !== semver.satisfies(version, mutant),
    );

  // 变异 1：两段并成一段，段间空洞（0.1.3 / 0.1.4 / 0.1.6）被吃进可安装面。
  assert.ok(
    differs('>=0.1.2-rc.1 <0.2.0-0 || >=0.2.0-rc.2 <0.2.3-0'),
    '并段的变异没被判红：等价性判据在空过',
  );
  // 变异 2：把 0.1.5-rc.3 的下界抬到 0.1.2-rc.1，等于空放行没验证过的预发布。
  assert.ok(
    differs('>=0.1.2-rc.1 <0.1.3-0 || >=0.1.2-rc.1 <0.1.6-0 || >=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.2 <0.2.1-0 || >=0.2.1-rc.2 <0.2.2-0 || >=0.2.2-alpha.2 <0.2.3-0'),
    '抬高下界的变异没被判红',
  );
  // 变异 3：丢掉 0.2.0-rc.2 整段，已验证代次装不上。
  assert.ok(
    differs('>=0.1.2-rc.1 <0.1.3-0 || >=0.1.5-rc.3 <0.1.6-0 || >=0.1.7-rc.1 <0.1.8-0 || >=0.2.1-rc.2 <0.2.2-0 || >=0.2.2-alpha.2 <0.2.3-0'),
    '丢段的变异没被判红',
  );
  // 对照：真值本身必须判绿，否则上面三条"判红"没有意义。
  assert.equal(
    differs(pkg.peerDependencies['@deepseek-ai/dsh-session']),
    false,
    '真实的合并结果本身就与旧串不等价',
  );
});
