#!/usr/bin/env node
/**
 * 把 src/upstream-compat.ts 的 KERNEL_GENERATIONS 同步进 package.json
 * 的 peerDependencies / devDependencies（kernel-scoped 包）。
 *
 * 用法（新 rc 落地时）：
 *   1. 编辑 src/upstream-compat.ts，在 KERNEL_GENERATIONS 追加一代
 *   2. npm run build   # 或至少 tsc 产出 lib/upstream-compat.js
 *   3. node scripts/sync-peer-matrix.mjs
 *   4. npm test
 *
 * 幂等：重复运行结果不变。不改动非 kernel-scoped 的 peer（cordis 等）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const { peerMatrixEntries, enginesDshRange, KERNEL_GENERATIONS } = await import(
  join(root, 'lib', 'upstream-compat.js')
);

const entries = peerMatrixEntries();
const changed = [];

/** 最新已验证代次（devDependencies 固定到它 —— 见下方说明）。 */
const latestGeneration = KERNEL_GENERATIONS[KERNEL_GENERATIONS.length - 1].id;

for (const { packageName, range } of entries) {
  // peerDependencies = 声明支持范围 → 与 KERNEL_GENERATIONS 拼出的完整范围一致。
  if ('peerDependencies' in pkg) {
    const prev = pkg.peerDependencies[packageName];
    if (prev !== range) {
      pkg.peerDependencies[packageName] = range;
      changed.push(`peerDependencies.${packageName}: ${prev ?? '(absent)'} → ${range}`);
    }
  }

  /**
   * devDependencies = 本地实际编译/测试所跑的代次 → **固定到最新已验证代次**，
   * 而不是完整范围串。
   *
   * 为什么不能沿用范围串：npm/pnpm 会解析到「满足范围的最老可用版本」（实测解析到
   * 0.1.2-rc.1），导致测试环境长期落后于真实运行环境（0.1.5-rc.3），API 漂移无法
   * 在本地暴露 —— 此前的 peer 缺口正是这样漏掉的。
   *
   * 只在该字段**已是范围串**（即历史遗留）或缺失时才改写，避免把有意固定的具体
   * 版本冲掉；若已是具体版本则保留，由人来决定何时升代次（并在测试里显式登记）。
   */
  if ('devDependencies' in pkg) {
    const prev = pkg.devDependencies[packageName];
    const isRangeString = typeof prev === 'string' && prev.includes('||');
    if (prev === undefined || isRangeString) {
      pkg.devDependencies[packageName] = latestGeneration;
      changed.push(
        `devDependencies.${packageName}: ${prev ?? '(absent)'} → ${latestGeneration}（固定到最新已验证代次）`,
      );
    }
  }
}

/**
 * `engines.dsh` = 声明支持范围（**由 KERNEL_GENERATIONS 按 tuple 上界推导**，不是 peer 那串）。
 *
 * 为什么单独处理：这一项此前是手写常量，于是「加了一代」只更新 peer 枚举、engines 悄悄不动，
 * 两者各说各话。而且 node-semver 不把预发布算进普通范围，手写的 `>=a <b` 会把别的 tuple 的
 * 预发布一起放行（实测 `0.2.2-alpha.2` 等都判支持）。形状与理由见 `enginesDshRange`。
 */
if ('engines' in pkg && typeof pkg.engines.dsh === 'string') {
  const prev = pkg.engines.dsh;
  const next = enginesDshRange();
  if (prev !== next) {
    pkg.engines.dsh = next;
    changed.push(`engines.dsh:\n    旧 ${prev}\n    新 ${next}`);
  }
}

if (changed.length === 0) {
  console.log('peer matrix already in sync.');
  console.log(
    `  generations: ${KERNEL_GENERATIONS.map((g) => g.id).join(', ')}`,
  );
  process.exit(0);
}

writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log('updated package.json peer matrix:');
for (const line of changed) console.log(`  ${line}`);
console.log(
  `  generations: ${KERNEL_GENERATIONS.map((g) => g.id).join(', ')}`,
);
