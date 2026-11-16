#!/usr/bin/env node
/**
 * 把 `KERNEL_GENERATIONS` 台账同步成 npm 的代际 dist-tag（issue #168）。
 *
 * ## 它解决的问题
 *
 * 「这个版本在哪几代内核上验证过」目前只活在 README 与台账里，而**安装句柄**（用户
 * 真正会敲的那串 `npm i dsh-later@…`）表达不了这件事。代际 tag 把验证状态编码进分发
 * 元数据：`dsh-later@dsh-0-2-2-rc-3` 就是「这一版在 0.2.2-rc.3 上验证过」。
 *
 * 与 `sync-peer-matrix.mjs` 同一原则：**从台账机械推导，不手抄**。台账是唯一真相，
 * 这个脚本只负责把它投影成 tag 差量。
 *
 * ## 默认只读，`--apply` 才写
 *
 * 默认只打印「目标 tag → 版本」与「线上现有 tag」的差量，不做任何修改。原因见下方
 * 「一次真实事故」——写操作必须由人显式触发。
 *
 * ## 一次真实事故（本脚本设计上的直接来由）
 *
 * 2026-11-16 我用 `npm dist-tag add dsh-later@1.14.0 dsh-0-2-2-rc-3 --dry-run` 验证
 * 「tag 名合法吗」，**`--dry-run` 并没有被忽略，它真的写进了 registry** —— 于是一个
 * 从未验证过 rc.3 的版本被钉上了 `dsh-0-2-2-rc-3`，等于对外声称「验证过了」。
 * 更糟的是当前 token 是「绕过 2FA 的 Granular Token」，**能加不能删**，那个假声明
 * 只能由有 2FA 权限的人清掉。
 *
 * 三点教训直接写进了本脚本：
 *  1. **把「查」和「写」拆成两个明确的开关**，不要依赖第三方 CLI 的 `--dry-run` 语义；
 *  2. **拒绝给不在台账里的代次打 tag** —— 台账的入表标准是「四面都过」，
 *     而当时 rc.3 连一面都没跑过，脚本本该拦住；
 *  3. 打印差量时把「这一代会造出什么语义」写出来，让人看清楚再按回车。
 *
 * ## 用法
 *
 *   node scripts/sync-generation-tags.mjs              # 只读对账（默认）
 *   node scripts/sync-generation-tags.mjs --apply      # 真的执行 dist-tag add/rm
 *   node scripts/sync-generation-tags.mjs --json       # 机器可读输出（配合 CI）
 *
 * ## 打 tag 的判据（不是每一代都打）
 *
 * issue #168 说得对：cordis 至今只有两枚代际 tag，不必每 rc 必打。所以这里的策略是
 * **只为「外部有寻址需求」的代次打**，由 `TAGGED_GENERATIONS` 显式列出；其余代次
 * 在台账里但不出 tag。这样 tag 数量可控，也不会因为某个 rc 一闪而过就留下一串死 tag。
 *
 * @module scripts/sync-generation-tags
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { KERNEL_GENERATIONS } = await import(join(root, 'lib', 'upstream-compat.js'));

const argv = new Set(process.argv.slice(2));
const APPLY = argv.has('--apply');
const JSON_OUT = argv.has('--json');

/**
 * 需要出代际 tag 的代次（白名单）。
 *
 * 加一代进来之前必须确认两件事：
 *  - 该代次在 `KERNEL_GENERATIONS` 里（即四面已过）；
 *  - 外部**确实需要**用它寻址（`latest` 线已切走、而用户还停在那一代）。
 *
 * ⚠️ 这份清单**只增不减地人工维护**是有意的：自动给「表里最新一代」打 tag 会让每次
 * rc 都留一枚 tag，而绝大多数 rc 不会有人去寻址。
 */
export const TAGGED_GENERATIONS = [
  /**
   * 内核三轨分发后的第一枚 `next` 轨代次。
   *
   * 为什么是它：`latest` 压在 0.2.2-rc.1，而 rc.3 只在 `next` 上 —— 用户若想「用 next 轨
   * 内核跑这个插件」，除了 `dsh-later@latest`（未必在新内核上验过）就没有第二个句柄。
   * 代际 tag 正好补上这个缺口。
   *
   * 之所以敢进白名单，是因为它**先**跑完了 mount / function / type / gate / UI 五面
   * （见 docs/verification.md 与 KERNEL_GENERATIONS 里那一代的注释）。
   */
  '0.2.2-rc.3',
];

/** 台账里出现过的代次 id。用于拒绝「未验证就打 tag」。 */
const LEDGER_IDS = new Set(KERNEL_GENERATIONS.map((g) => g.id));

/**
 * 代次 id → npm dist-tag 名。
 *
 * 全连字符（`0.2.2-rc.3` → `dsh-0-2-2-rc-3`）：npm 的 tag **不得是合法 semver 串**，
 * 点分形式在部分 npm 版本会被拒；连字符形式与 cordis 的 `dsh-0-2-1-alpha-1` 惯例一致。
 *
 * @param {string} id - 台账里的代次 id。
 */
export function tagNameFor(id) {
  return `dsh-${id.replace(/\./g, '-')}`;
}

/** 跑一条命令并返回 stdout（失败抛错，调用方决定怎么呈现）。 */
function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** 线上现有的 dist-tags（`{tag: version}`）。 */
function readRemoteTags() {
  try {
    return JSON.parse(run('npm', ['view', pkg.name, 'dist-tags', '--json']));
  } catch {
    // 拿不到就当空：只读模式下会显示「全部待添加」，是安全的方向。
    return {};
  }
}

/**
 * 计算差量。
 *
 * @param {Record<string, string>} remote - 线上现有 tag。
 * @param {string} currentVersion - 本仓 package.json 的版本（新 tag 指向它）。
 * @returns {{add: Array<{tag: string, generation: string}>, remove: string[], keep: Array<{tag: string, generation: string}>, unknown: string[]}}
 */
export function computeDiff(remote, currentVersion) {
  const add = [];
  const keep = [];
  const unknown = [];
  const wanted = new Set(TAGGED_GENERATIONS.map(tagNameFor));

  for (const generation of TAGGED_GENERATIONS) {
    // 硬约束：只给台账里的代次打 tag。这条挡的正是「先打 tag 后补验证」——
    // 那种顺序会造出「声明验证过、其实没验」的假元数据。
    if (!LEDGER_IDS.has(generation)) {
      unknown.push(generation);
      continue;
    }
    const tag = tagNameFor(generation);
    if (remote[tag] === currentVersion) keep.push({ tag, generation });
    else add.push({ tag, generation });
  }

  // 线上多出来的 `dsh-*` tag（白名单里没有的）应当回收：
  // npm 不回收 tag，留着会让某个废版被永久寻址到。
  const remove = Object.keys(remote).filter((tag) => tag.startsWith('dsh-') && !wanted.has(tag));

  return { add, remove, keep, unknown };
}

/** 渲染人看的报告。 */
function render(diff, remote) {
  const lines = [];
  lines.push(`${pkg.name}@${pkg.version} · 代际 dist-tag 对账`);
  lines.push('');
  lines.push(`台账代次 ${LEDGER_IDS.size} 个；需出 tag 的代次 ${TAGGED_GENERATIONS.length} 个`);
  lines.push(`线上现有 tag：${Object.keys(remote).length ? Object.entries(remote).map(([t, v]) => `${t}→${v}`).join(', ') : '(无)'}`);
  lines.push('');

  if (diff.unknown.length > 0) {
    lines.push('❌ 拒绝执行：以下代次不在 KERNEL_GENERATIONS 台账里');
    for (const id of diff.unknown) {
      lines.push(`   ${id}  →  ${tagNameFor(id)}`);
    }
    lines.push('   台账的入表标准是「mount / function / type / gate 四面都过」。');
    lines.push('   先跑 node scripts/verify-across-kernels.mjs --versions <代次> --steps mount,function,type,gate');
    lines.push('   再把该代次写进 src/upstream-compat.ts 的 KERNEL_GENERATIONS。');
    lines.push('');
  }

  if (diff.add.length === 0 && diff.remove.length === 0 && diff.unknown.length === 0) {
    lines.push('✅ 已是目标状态，无需改动。');
    return lines.join('\n');
  }

  for (const { tag, generation } of diff.add) {
    lines.push(`+ ${tag}  →  ${pkg.version}`);
    lines.push(`   语义：${pkg.version} 在 ${generation} 上验证通过`);
  }
  for (const tag of diff.remove) {
    lines.push(`- ${tag}  (线上 ${remote[tag]}，白名单里没有，应回收)`);
  }
  lines.push('');
  lines.push(APPLY ? '正在执行…' : '只读模式：以上为差量。加 --apply 才会真的执行。');
  return lines.join('\n');
}

/**
 * 主流程。
 *
 * 抽成函数并加 `import.meta` 守卫，是为了让**测试能 import 本模块的纯函数**
 * （`tagNameFor` / `computeDiff`）而不触发真的网络查询与写操作 ——
 * 一个会在被 import 时就去碰 registry 的模块是不可测的。
 */
function main() {
  const remote = readRemoteTags();
  const diff = computeDiff(remote, pkg.version);

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({ name: pkg.name, version: pkg.version, apply: APPLY, ...diff }, null, 2) + '\n');
  } else {
    process.stdout.write(render(diff, remote) + '\n');
  }

  if (diff.unknown.length > 0) process.exit(1);
  if (!APPLY) process.exit(0);

  // ---- 写操作（只有显式 --apply 才到这里）----
  // ⚠️ 删 tag 需要「未绕过 2FA」的凭据。失败时如实报错，不吞异常：
  // npm 没有事务，一口气回滚成功的条目是不可能的，所以逐条报、让人看清哪条没成。
  let failed = 0;
  for (const { tag } of diff.add) {
    try {
      run('npm', ['dist-tag', 'add', `${pkg.name}@${pkg.version}`, tag]);
      process.stdout.write(`✓ ${tag}\n`);
    } catch (error) {
      failed += 1;
      process.stderr.write(`✗ ${tag}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  for (const tag of diff.remove) {
    try {
      run('npm', ['dist-tag', 'rm', pkg.name, tag]);
      process.stdout.write(`✓ 删除 ${tag}\n`);
    } catch (error) {
      failed += 1;
      process.stderr.write(`✗ 删除 ${tag}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

// 只有被当脚本直接执行时才跑；被测试 import 时只暴露纯函数。
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) main();
