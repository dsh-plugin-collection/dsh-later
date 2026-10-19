/**
 * issue #46：`npm run build` 不得静默部署到 ~/.dsh/profiles。
 *
 * 原先重链是 build 的**默认副作用**，后果有两层：
 *  1. 未合并分支只要 build 一次，代码就进到运行中的 host；
 *  2. 多个 worktree 经 profile 共享 inode，彼此静默覆盖 —— 实测发生过：
 *     主 worktree 的 build 把未合并的修复写进了另一个会话的工作树。
 *  3. 更糟的是 `watch.mjs` 每次改动都跑 `npm run build`，等于**持续自动部署**。
 *
 * 本文件两层都要钉住：纯策略（快、穷举）+ 端到端（真的用假 HOME 跑一次构建，
 * 证明默认路径碰不到 profile）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldRelink, RELINK_SKIP_NOTICE } from '../scripts/relink-policy.mjs';

const repoRoot = realpathSync(new URL('..', import.meta.url).pathname);
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

/* ---------------- 1. 策略：默认关，开要显式 ---------------- */

test('默认不重链（这是本 issue 的全部意义，别改成开）', () => {
  assert.equal(shouldRelink([], {}), false);
  assert.equal(shouldRelink([], { DSH_LATER_RELINK: '' }), false);
  assert.equal(shouldRelink(['--silent'], {}), false);
});

test('--deploy / --relink-profiles 显式开启', () => {
  assert.equal(shouldRelink(['--deploy'], {}), true);
  assert.equal(shouldRelink(['--relink-profiles'], {}), true);
  // 同时给出时 --no-deploy 胜出（见下一条：显式拒绝优先级最高）
  assert.equal(shouldRelink(['--no-deploy', '--deploy'], {}), false);
});

test('DSH_LATER_RELINK 环境变量可开启，取值宽松', () => {
  for (const v of ['1', 'true', 'TRUE', ' yes ', 'on']) {
    assert.equal(shouldRelink([], { DSH_LATER_RELINK: v }), true, `${v} 应视为开`);
  }
  for (const v of ['0', 'false', 'no', '', 'banana']) {
    assert.equal(shouldRelink([], { DSH_LATER_RELINK: v }), false, `${v} 应视为关`);
  }
});

test('--no-deploy 优先级最高（可在脚本里强制关掉环境的影响）', () => {
  assert.equal(shouldRelink(['--no-deploy'], { DSH_LATER_RELINK: '1' }), false);
  assert.equal(shouldRelink(['--no-relink-profiles'], { DSH_LATER_RELINK: 'true' }), false);
});

test('跳过部署时必须打印提示，并给出显式路径（否则会被当成「构建没生效」）', () => {
  assert.match(RELINK_SKIP_NOTICE, /npm run deploy/);
  assert.match(RELINK_SKIP_NOTICE, /--deploy/);
  assert.match(RELINK_SKIP_NOTICE, /DSH_LATER_RELINK/);
});

/* ---------------- 2. 接线：build/watch 都必须走同一策略 ---------------- */

test('build.mjs 的重链块由 shouldRelink 把关', () => {
  const src = read('build.mjs');
  assert.match(src, /import \{ shouldRelink, RELINK_SKIP_NOTICE \} from '\.\/scripts\/relink-policy\.mjs'/);
  assert.match(src, /if \(!shouldRelink\(process\.argv\.slice\(2\)\)\)/, '重链必须挂在策略后面');
  // linkSync 只能出现在被把关的那个分支里
  const gate = src.indexOf('if (!shouldRelink(');
  const link = src.indexOf('linkSync(src, dst)');
  assert.ok(gate > 0 && link > gate, 'linkSync 必须位于策略判断之后');
});

test('watch.mjs 不自建重链，而是复用 npm run build 的策略', () => {
  const src = read('watch.mjs');
  assert.doesNotMatch(src, /linkSync|profiles/, 'watch 不得自己重链 profile');
  assert.match(src, /execSync\('npm run build'/, 'watch 必须经由 build 走同一策略');
});

test('package.json 提供显式 deploy 入口', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.build, 'node build.mjs', 'build 保持纯构建');
  assert.equal(pkg.scripts.deploy, 'node build.mjs --deploy');
});

/* ---------------- 3. 端到端：默认构建真的碰不到 profile ---------------- */

/** 造一个假 HOME，里面放一个装了本插件的 profile。 */
function fakeProfile() {
  const home = mkdtempSync(join(tmpdir(), 'fake-dsh-home-'));
  const lib = join(home, '.dsh/profiles/web/node_modules/dsh-later/lib');
  mkdirSync(lib, { recursive: true });
  writeFileSync(join(lib, 'index.js'), '// SENTINEL 旧产物，不该被覆盖\n');
  return { home, lib };
}

const canBuild = existsSync(join(repoRoot, 'node_modules/esbuild'));

test('端到端：默认 npm run build 不改写 profile；--deploy 才改', { skip: !canBuild }, () => {
  // 默认：哨兵文件必须原样留着
  const a = fakeProfile();
  execFileSync('node', ['build.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, HOME: a.home, DSH_LATER_RELINK: '' },
    stdio: 'pipe',
    timeout: 300_000,
  });
  assert.equal(
    readFileSync(join(a.lib, 'index.js'), 'utf8').includes('SENTINEL'),
    true,
    '默认构建不得改写 profile 产物',
  );

  // 显式 --deploy：哨兵应被替换
  const b = fakeProfile();
  execFileSync('node', ['build.mjs', '--deploy'], {
    cwd: repoRoot,
    env: { ...process.env, HOME: b.home },
    stdio: 'pipe',
    timeout: 300_000,
  });
  assert.equal(
    readFileSync(join(b.lib, 'index.js'), 'utf8').includes('SENTINEL'),
    false,
    '--deploy 应把产物同步进 profile',
  );
});
