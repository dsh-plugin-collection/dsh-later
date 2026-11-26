#!/usr/bin/env node
/**
 * 跨内核回归的分诊（`.gitea/workflows/kernels.yml` 的判据端，issue #208 的 (a) 面）。
 *
 * ## 为什么不是把退出码直接交给 CI
 *
 * `scripts/verify-across-kernels.mjs` 按设计用三个退出码表达三种**不同性质**的结论：
 *
 * | 退出码 | 含义 | 该谁处理 |
 * |---|---|---|
 * | `0` | 全绿 | 没人 |
 * | `1` | 有**红**：这些代次上真跑挂了 | 插件回归，要修代码 |
 * | `2` | 有**未判定**：代次装不出来 / 组合漂移 | 环境或上游换版，要人看一眼 |
 *
 * CI 只认「成功 / 失败」两格。把这个脚本的退出码原样交给 CI，`1` 与 `2` 会被折成
 * 同一格「失败」—— 于是每逢内核在 registry 上换一版、某代次装不出来，就出现一条
 * 常红的门禁；而它红的原因恰恰**不是**本插件回归。这种红会训练人「红是常态、忽略它」，
 * 最后连真回归也一起被忽略。
 *
 * 所以分诊放在**这里**（一个能被单测直接调用的纯逻辑 + CLI），而不是埋在 yml 的 shell
 * 里：`tests/kernels-workflow.test.mjs` 用 0/1/2/缺失四种输入逐一断言它的结论，
 * yml 只负责把 code 文件喂进来。判据一旦写进 shell，就只有「读一眼 yml」这一种验证方式。
 *
 * ## 口径
 *
 * - `2` → 作业**成功**（退出 0），但打一条 `::warning::` 把「未判定」这个词写进日志，
 *   并说明这是环境/组合漂移、不是插件回归。
 * - `1` → 作业**失败**（退出 1），打 `::error::`，明确说这是真回归。
 * - `0` → 成功，打一行绿。
 * - 其余（code 文件缺失、被信号打断、脚本崩了）→ **失败**：这不是「未判定」，
 *   而是「这一轮根本没产出结论」，把它算绿等于又开一条空跑门禁。
 *
 * @module scripts/triage-kernels
 */
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/** 三种结论 + 一种「没结论」。 */
export const VERDICTS = /** @type {const} */ ({
  GREEN: 'GREEN',
  RED: 'RED',
  UNDETERMINED: 'UNDETERMINED',
  UNKNOWN: 'UNKNOWN',
});

/**
 * 把退出码翻成结论。纯函数，测试直接调。
 *
 * @param {number | null | undefined} code - `verify-across-kernels.mjs` 的退出码；`null`/`undefined` 表示没拿到。
 * @returns {{ verdict: string, exitCode: number, message: string }} 结论、本作业该用的退出码、给人看的一句话。
 */
export function triage(code) {
  if (code === 0) {
    return { verdict: VERDICTS.GREEN, exitCode: 0, message: '跨内核回归全绿（15 代 mount/function 都通过）。' };
  }
  if (code === 1) {
    return {
      verdict: VERDICTS.RED,
      exitCode: 1,
      message: '::error::跨内核回归有红（退出码 1）：这些代次上真跑挂了，是插件回归，要修代码。',
    };
  }
  if (code === 2) {
    return {
      verdict: VERDICTS.UNDETERMINED,
      exitCode: 0, // 未判定不等于红：作业保持绿，但把这件事喊出来
      message:
        '::warning::跨内核回归有「未判定」（退出码 2）：代次装不出来或组合漂移，需要人看一眼；' +
        '它**不是**插件回归 —— 这是本作业刻意不判红的唯一情形。',
    };
  }
  return {
    verdict: VERDICTS.UNKNOWN,
    exitCode: 1,
    message:
      `::error::没拿到可解释的退出码（${code === null || code === undefined ? '缺失' : code}）：` +
      '这一轮根本没产出结论（脚本崩了/被信号打断/步骤没跑），按失败处理 —— 当绿就是又开一条空跑门禁。',
  };
}

/**
 * 从文件读退出码。文件不存在 ⇒ `undefined`（走 {@link VERDICTS.UNKNOWN}）。
 *
 * 为什么用文件而不是 shell 变量：`outcome` 在 CI 里只有成功/失败两格，把 1 和 2 抹平
 * 正是这里要避免的事；写进文件才能把「三值语义」原样带过步骤边界。
 * @param {string} path - 退出码文件路径（相对 cwd）。
 * @returns {number | undefined} 读到的整数；读不到/内容不是整数时 `undefined`。
 */
export function readExitCode(path) {
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, 'utf8').trim();
  if (!/^-?\d+$/.test(raw)) return undefined;
  return Number(raw);
}

/**
 * CLI：`node scripts/triage-kernels.mjs --code-file <path>` 或 `--code <n>`。
 * @param {string[]} argv - 不含 node 与脚本名。
 * @returns {number} 本作业该用的退出码。
 */
function main(argv) {
  const fileIndex = argv.indexOf('--code-file');
  const codeIndex = argv.indexOf('--code');
  let code;
  if (codeIndex >= 0) {
    code = Number(argv[codeIndex + 1]);
    if (!Number.isInteger(code)) code = undefined;
  } else if (fileIndex >= 0) {
    code = readExitCode(argv[fileIndex + 1] ?? '.verify/kernels-exit-code');
  } else {
    code = readExitCode('.verify/kernels-exit-code');
  }
  const result = triage(code);
  // Gitea 支持 `::warning::` / `::error::` 注解：日志里高亮，且不会被当成普通输出吞掉。
  // 同时打一行纯文本，注解不被识别时也读得懂。
  console.log(result.message);
  console.log(`triage-kernels: verdict=${result.verdict} 作业退出码=${result.exitCode}`);
  return result.exitCode;
}

const invoked = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (invoked !== undefined && import.meta.url === invoked) {
  process.exit(main(process.argv.slice(2)));
}
