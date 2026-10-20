/**
 * host tsc 失败时「要不要降级 esbuild」的决策策略（纯函数，可测、不碰文件系统）。
 *
 * 为什么单独成文件：`build.mjs` 是一串带副作用的顶层脚本（tsc / esbuild /
 * writeFileSync / linkSync），任何测试导入它都会真的改写 lib/ 与
 * ~/.dsh/profiles。把「要不要允许兜底」抽成纯函数，才能在不执行构建的前提下
 * 把默认值钉死（与 scripts/relink-policy.mjs 同一套做法）。
 *
 * 背景（issue #56）：兜底原先**默认生效**，代价是产物形态从逐文件 tsc 产物
 * （lib/index.js ≈24.6KB，模块各自成文件）变成 esbuild 单文件 bundle
 * （≈128KB，兄弟模块被内联）。模块身份与状态单例随之内联复制，一次性带出
 * 34 条假测试失败，把真正的类型错误埋在噪音里。现在默认**不兜底**：
 * tsc 失败即非零退出、lib/ 不改写，兜底要显式说。
 * @module dsh-later/scripts/build-fallback-policy
 */

/** 显式允许 esbuild 兜底的开关。 */
const ALLOW_FALLBACK_FLAGS = ['--allow-fallback', '--allow-esbuild-fallback', '--fallback'];
/** 显式拒绝兜底（优先级最高，用来在 CI/脚本里强制关掉环境变量的影响）。 */
const NO_FALLBACK_FLAGS = ['--no-fallback', '--no-esbuild-fallback'];
/** 环境变量 `DSH_LATER_BUILD_FALLBACK` 认作真的取值。 */
const TRUTHY = ['1', 'true', 'yes', 'on'];

/**
 * 本次构建在 host tsc 失败时是否允许降级 esbuild。
 *
 * 优先级：`--no-fallback` > `--allow-fallback` > 环境变量 > **默认关**。
 * 默认关是这条策略的全部意义（issue #56），别改成开。顺序与
 * `shouldRelink`（`--no-deploy` > `--deploy` > `DSH_LATER_RELINK`）保持一致。
 * @param argv 命令行参数（不含 node 与脚本名）。
 * @param env  环境变量表（默认 `process.env`）。
 */
export function shouldAllowFallback(argv = [], env = process.env) {
  if (argv.some((a) => NO_FALLBACK_FLAGS.includes(a))) return false;
  if (argv.some((a) => ALLOW_FALLBACK_FLAGS.includes(a))) return true;
  return TRUTHY.includes(String(env['DSH_LATER_BUILD_FALLBACK'] ?? '').trim().toLowerCase());
}

/**
 * tsc 失败且未开闸时打印的说明：说清「为什么不再自动兜底」「怎么显式开闸」。
 * 退出码由 build.mjs 负责（这里只有文案）。
 */
export const FALLBACK_REFUSED_NOTICE = [
  '❌ host tsc 失败：本次构建中止，lib/ 未被改写（issue #56）。',
  '',
  '   为什么不再自动降级 esbuild：兜底会把兄弟模块内联进单文件 bundle，',
  '   产物形态从逐文件 tsc 产物（lib/index.js ≈24.6KB）变成 ≈128KB，',
  '   模块身份与状态单例被复制，会一次带出几十条假测试失败，并掩盖真正的',
  '   类型错误。所以默认失败，让类型错误自己说话。',
  '',
  '   先修类型错误；确实只要一份能加载的产物时才显式开闸：',
  '     • node build.mjs --allow-fallback',
  '     • DSH_LATER_BUILD_FALLBACK=1 npm run build',
].join('\n');

/**
 * 走兜底时打印的醒目告警。必须明确写出产物形态差异，且测试结论不可用
 * （否则读者会把 bundle 带出的假失败当成回归）。
 */
export const FALLBACK_ALLOWED_NOTICE = [
  '██████████████████████████████████████████████████████████████████████',
  '🟥 警告：host tsc 失败，正在走 esbuild 兜底（显式开闸，issue #56）',
  '██████████████████████████████████████████████████████████████████████',
  '   ⚠️ 产物形态与逐文件 tsc 不同，测试结果不可用于判定回归。',
  '',
  '   • lib/index.js 会变成单文件 bundle（模块被内联、状态单例被复制），',
  '     不再是逐文件 tsc 产物（tests/build-artifact-shape.test.mjs 会判红）；',
  '   • 由此产生的测试失败很可能是假的，真正的信号是上面那条 tsc 错误；',
  '   • 这份产物只适合临时排查，不要用它跑回归、也不要据此发版。',
  '██████████████████████████████████████████████████████████████████████',
].join('\n');
