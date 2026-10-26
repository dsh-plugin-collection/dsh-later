#!/usr/bin/env node
/**
 * 两个 tsconfig **都跑完再汇总**（issue #96）。
 *
 * ## 为什么不用 `tsc -p a && tsc -p b`
 *
 * `&&` 让**前一个项目一红，后一个项目就完全不跑**。而跨代次回归里红的基本都在 client 侧
 * （`dsh-client-ui-primitives` 的图标改名、props 形状），于是这条门禁在最能发现问题的场景里
 * 恰好失明：`0.1.2-rc.1` 上宿主项目先红 2 条，client 项目一条都没跑，它的错误数至今未知。
 * 同一份脚本报出来的数量取决于两个项目的**失败顺序** —— 这不是门禁该有的性质。
 *
 * ## 为什么是脚本而不是 `a ; b`
 *
 * `a && b` 换成 `a ; b` 只解决"都跑"，退出码仍被最后一条覆盖（`a` 红、`b` 绿 ⇒ 整体绿）。
 * 汇总退出码必须自己算，所以这里逐项目记 `status` 与错误计数，任一红即整体红。
 *
 * ## 为什么导出 `runTypecheck`
 *
 * 跨代次回归（issue #97 的 `--steps type`）要的就是同一套汇总逻辑。**一处实现、两处消费**，
 * 而不是在 `matrix.mjs` / `verify-across-kernels.mjs` 里再各写一遍"遍历项目、数 error TS、
 * 汇总退出码"——那种复制迟早会让两边对"什么算红"产生分歧。
 *
 * 用法：
 *   node scripts/typecheck-all.mjs                # = `npm run typecheck`
 *   node scripts/typecheck-all.mjs --tsc <tsc>    # 指定 tsc 可执行（测试/特殊环境）
 *
 * 退出码：`0` 全过；`1` 至少一个项目红；`2` 找不到 tsc（环境问题，不是代码问题——
 * 与"有错误"区分开，避免 CI 里把装依赖失败误读成类型回归）。
 * @module scripts/typecheck-all
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 默认项目：宿主 + client。顺序稳定，便于人读与断言。 */
export const DEFAULT_PROJECTS = ['tsconfig.json', 'tsconfig.client.json'];

/**
 * 统计 `error TSxxxx` 条数。
 *
 * 不用"数行数"：tsc 的多行诊断（`  error TS2353: ...` 后面跟类型详情）会让行数虚高；
 * 而每条诊断恰好有一个 `error TS` 标记，按它数才是"错误条数"的稳定口径。
 * @param {string} text - tsc 的 stdout + stderr。
 * @returns {number} 错误条数。
 */
export function countErrors(text) {
  return (String(text ?? '').match(/error TS\d+/g) ?? []).length;
}

/**
 * 找 tsc：**仓库自带的 typescript 优先**（可复现），PATH 兜底。
 *
 * 不直接 spawn `npx tsc`：CI 里 `npx` 会去解析/下载，慢且有网络行为；而 `typescript` 是本仓
 * devDependency，路径是确定的。
 * @param {string} [cwd] - 仓库根。
 * @returns {string | undefined} tsc 入口脚本路径；两者都没有时 undefined。
 */
export function resolveTsc(cwd = process.cwd()) {
  try {
    const require = createRequire(pathToFileURL(join(cwd, 'package.json')).href);
    return require.resolve('typescript/bin/tsc');
  } catch {
    // 没装 typescript（或布局不同）→ 退回 PATH 上的全局 tsc
  }
  const which = spawnSync('sh', ['-c', 'command -v tsc || true'], { encoding: 'utf8' }).stdout.trim();
  return which.length > 0 ? which : undefined;
}

/**
 * 逐项目跑 tsc 并汇总（**全部跑完**，不短路）。
 *
 * @param {object} [options]
 * @param {string} [options.cwd] - 仓库根，默认 `process.cwd()`。
 * @param {readonly string[]} [options.projects] - tsconfig 文件名列表。
 * @param {string} [options.tsc] - tsc 入口（默认 {@link resolveTsc}）。
 * @param {typeof spawnSync} [options.spawn] - 注入点，测试用。
 * @returns {{
 *   ok: boolean,
 *   tsc: string | undefined,
 *   projects: Array<{ project: string, status: number, errors: number, output: string }>,
 *   missing: string[],
 * }} 汇总结果；`missing` 是不存在的 tsconfig（跨代次 scratch 里 client 项目可能缺席）。
 */
export function runTypecheck(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const projects = options.projects ?? DEFAULT_PROJECTS;
  const tsc = options.tsc ?? resolveTsc(cwd);
  const spawn = options.spawn ?? spawnSync;
  const results = [];
  const missing = [];

  // 没有 tsc 时不要带着 undefined 去 spawn（会抛一个与"类型错误"无关的栈）——
  // 直接交回"环境问题"，由 CLI 用退出码 2 与真回归区分开。
  if (tsc === undefined) return { ok: false, tsc, projects: results, missing };

  for (const project of projects) {
    if (!existsSync(join(cwd, project))) {
      missing.push(project);
      continue;
    }
    // `--pretty false`：让输出可 grep（CI 日志与跨代回归的计数都靠它）。
    const run = spawn(
      process.execPath,
      [tsc, '-p', project, '--noEmit', '--pretty', 'false'],
      { cwd, encoding: 'utf8' },
    );
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    results.push({ project, status: run.status ?? 1, errors: countErrors(output), output });
  }

  return { ok: results.every((r) => r.status === 0), tsc, projects: results, missing };
}

/**
 * CLI 入口。
 * @param {readonly string[]} argv - 不含 `node` 与脚本名。
 * @returns {number} 退出码。
 */
function main(argv) {
  const tscIndex = argv.indexOf('--tsc');
  const tsc = tscIndex >= 0 ? argv[tscIndex + 1] : undefined;
  const result = runTypecheck(tsc === undefined ? {} : { tsc });

  if (result.tsc === undefined) {
    console.error('typecheck-all: 找不到 tsc —— 既没有仓库自带的 typescript，PATH 上也没有 tsc。');
    console.error('               这不是类型错误，是依赖/环境问题（先 `pnpm install`）。');
    return 2;
  }

  for (const item of result.projects) {
    const verdict = item.status === 0 ? '通过' : `${item.errors} 条错误`;
    console.log(`${item.project.padEnd(22)} ${verdict}`);
    if (item.status !== 0) {
      // 红了的项目把完整诊断打出来；绿的不打（否则几百行源码片段淹掉结论）。
      process.stdout.write(item.output);
    }
  }
  for (const project of result.missing) {
    console.log(`${project.padEnd(22)} 跳过（文件不存在）`);
  }
  console.log(result.ok ? '汇总：两个项目都通过' : '汇总：有项目未通过');
  return result.ok ? 0 : 1;
}

// 只在被当作脚本直接运行时执行，import 时保持纯函数（跨代回归要 import 它）。
const invoked = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(resolve(process.argv[1])).href;
if (invoked !== undefined && import.meta.url === invoked) {
  process.exit(main(process.argv.slice(2)));
}
