/**
 * 发布包瘦身的反向锚点（包大小优化，「不影响功能」前提下的唯一无副作用杠杆）。
 *
 * 背景：tarball 曾 211.8KB。两条候选杠杆里：
 *  - **minify client.js** 被否决——本仓有 4 个「读 lib/client.js 文本」的守护测试
 *    （CSS 一致性 / 状态行形状 / 合并标记 / #141 占位符），minify 会使其变红；
 *    可读产物是守护契约的一部分，故不 minify（见 build.mjs 注释）。
 *  - **排除 lib/types**（仅开发用 .d.ts，运行时与宿主都不读）被采纳：73→41 文件、
 *    tarball 211.8→196.4KB、解包 -60KB，且 1004 测试 / 自检 / 跨代矩阵全绿。
 *
 * 本文件把「排除 types」钉成配置锚点：谁把它回退（重新发布 .d.ts / 恢复 types 字段），
 * 这里直接红，逼着回到「为什么不改」的讨论，而不是悄悄把体积加回去。
 * @module tests/package-slim
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('包瘦身：files 用负向模式排除 lib/types（.d.ts 不随发布包走）', () => {
  assert.ok(Array.isArray(pkg.files), 'package.json 要有 files 白名单');
  assert.ok(pkg.files.includes('lib'), 'lib 运行时产物必须在白名单');
  assert.ok(pkg.files.includes('!lib/types'), '必须显式排除 lib/types（仅开发用声明）');
});

test('包瘦身：不保留指向被排除文件的 types 契约（顶层与 exports 均无）', () => {
  assert.equal(pkg.types, undefined, '顶层 types 字段应移除（指向的 .d.ts 已不发布）');
  const dot = pkg.exports?.['.'];
  assert.ok(dot && typeof dot === 'object', 'exports["."] 应存在');
  assert.equal(dot.types, undefined, 'exports["."].types 应移除');
  assert.ok(dot.import, 'exports["."].import 必须保留（宿主运行时入口）');
});

test('包瘦身：运行时入口与 client 出口不受影响', () => {
  assert.equal(pkg.main, 'lib/index.js', 'main 入口不变');
  assert.equal(pkg.exports?.['./client'], './lib/client.js', 'client 出口不变');
});
