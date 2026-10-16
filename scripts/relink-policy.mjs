/**
 * profile 重链的决策策略（纯函数，可测、不碰文件系统）。
 *
 * 为什么单独成文件：`build.mjs` 是一串带副作用的顶层脚本（tsc / esbuild /
 * linkSync），任何测试导入它都会**真的改写 ~/.dsh/profiles**（issue #46 的成因
 * 正是这条路径）。把「要不要重链」抽成纯函数，才能在不执行构建的前提下把默认值
 * 钉死。
 *
 * 背景（issue #46）：重链原本是 build 的**默认副作用**，于是
 *  - 未合并、未评审的分支代码只要 build 一次就进到运行中的 host；
 *  - 多个 worktree 经 profile 共享 inode，彼此静默覆盖（实测发生过一次：
 *    主 worktree 的 build 把未合并的修复写进了另一个会话的工作树）。
 * 现在默认**不重链**，部署要显式说。
 * @module dsh-later/scripts/relink-policy
 */

/** 显式要求部署的开关。 */
const DEPLOY_FLAGS = ['--deploy', '--relink-profiles'];
/** 显式拒绝部署（优先级最高，用来在 CI/脚本里强制关掉环境变量的影响）。 */
const NO_DEPLOY_FLAGS = ['--no-deploy', '--no-relink-profiles'];
/** 环境变量 `DSH_LATER_RELINK` 认作真的取值。 */
const TRUTHY = ['1', 'true', 'yes', 'on'];

/**
 * 本次构建是否应该把产物重链进 `~/.dsh/profiles`。
 *
 * 优先级：`--no-deploy` > `--deploy` > 环境变量 > **默认关**。
 * 默认关是这条策略的全部意义，别改成开。
 * @param argv 命令行参数（不含 node 与脚本名）。
 * @param env  环境变量表（默认 `process.env`）。
 */
export function shouldRelink(argv = [], env = process.env) {
  if (argv.some((a) => NO_DEPLOY_FLAGS.includes(a))) return false;
  if (argv.some((a) => DEPLOY_FLAGS.includes(a))) return true;
  return TRUTHY.includes(String(env['DSH_LATER_RELINK'] ?? '').trim().toLowerCase());
}

/** 跳过重链时打印的提示：说清「没生效」是预期，并给出显式部署路径。 */
export const RELINK_SKIP_NOTICE = [
  'ℹ️  未同步到 ~/.dsh/profiles（默认行为，issue #46）：本次构建只写了本地 lib/，',
    '    运行中的 DSH 仍加载它启动时那份代码。要让改动在 GUI 里生效，任选其一：',
    '      • npm run deploy              （= node build.mjs --deploy）',
    '      • node build.mjs --deploy',
    '      • DSH_LATER_RELINK=1 npm run build',
    '    注意：--deploy 会改写所有 profile 的安装副本，多 worktree 并发开发时',
    '    请先确认这是你要的（谁最后 deploy 谁生效）。',
].join('\n');
