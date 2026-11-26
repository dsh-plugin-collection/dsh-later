/**
 * `.gitea/workflows/kernels.yml` 的判据（issue #208 的 (a) 面）。
 *
 * ## 这条工作流要防什么
 *
 * `scripts/verify-across-kernels.mjs` 用三个退出码区分**三种不同性质**的结论：
 * `0` 绿 / `1` 真回归红 / `2` 未判定（代次装不出来、组合漂移）。CI 只有「成功 / 失败」
 * 两格，把退出码原样交给 CI 就等于把 `1` 与 `2` 折成同一格「失败」—— 于是每次内核
 * 在 registry 上换一版、某代次装不出来，就出现一条常红门禁，而它红的原因**不是**本插件
 * 回归。那种红会训练人「红是常态」，最后连真回归一起被忽略。
 *
 * 所以这里钉三层：
 *  1. **纯逻辑**：`triage()` 把 0/1/2/缺失翻成「绿 / 红 / 未判定 / 没结论」，
 *     未判定**不判红**、缺失**必须判红**（那是空跑）；
 *  2. **接线**：`kernels.yml` 必须真的用这条 triage（而不是自己 `exit $?`），
 *     必须同时有 cron 与 workflow_dispatch、必须上传 `.verify/across-kernels-*.json`；
 *  3. **反例**：把 yml 里那一步换成裸 `exit $?`（或把 triage 换成恒绿），
 *     第 1、2 层都会红 —— 它们守的是行为，不是「文件里出现了某个词」。
 *
 * 真跑 15 代内核不在 CI 的本文件里（要装包、要磁盘，见 `kernels.yml` 的前置条件注释）；
 * 这里只钉「哪些结论该红」这件事本身。
 * @module tests/kernels-workflow
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERDICTS, triage, readExitCode } from '../scripts/triage-kernels.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const yml = read('.gitea/workflows/kernels.yml');

/* ---------------- 1. 纯逻辑：三种结论各有归处 ---------------- */

test('triage：0 → 绿，作业成功', () => {
  const result = triage(0);
  assert.equal(result.verdict, VERDICTS.GREEN);
  assert.equal(result.exitCode, 0);
  assert.match(result.message, /全绿/);
});

test('triage：1 → 真回归红，作业失败（这是唯一该红的结论）', () => {
  const result = triage(1);
  assert.equal(result.verdict, VERDICTS.RED);
  assert.equal(result.exitCode, 1, '真回归必须让作业失败');
  assert.match(result.message, /::error::/);
  assert.match(result.message, /插件回归/, '要明确说这是插件回归，不是环境问题');
});

test('triage：2 → 未判定，作业保持绿但必须喊出来（否则就是常红噪声门禁）', () => {
  const result = triage(2);
  assert.equal(result.verdict, VERDICTS.UNDETERMINED);
  assert.equal(result.exitCode, 0, '未判定绝不能判红：那一格要留给真回归');
  assert.match(result.message, /::warning::/);
  assert.match(result.message, /不是.*插件回归/, '要说清性质，否则读日志的人会去查插件代码');
});

test('triage：没拿到退出码 → 红（「这轮没产出结论」不是「未判定」）', () => {
  // 这是最容易写反的一格：脚本崩了 / 步骤没跑 / code 文件没落盘时，
  // 若把它当「未判定」放行，就等于又开一条「什么都没跑却宣布通过」的空跑门禁。
  for (const code of [undefined, null, 3, -1]) {
    const result = triage(code);
    assert.equal(result.verdict, VERDICTS.UNKNOWN, `${String(code)} 应归为没结论`);
    assert.equal(result.exitCode, 1, `${String(code)} 必须判红`);
    assert.match(result.message, /::error::/);
    assert.match(result.message, /空跑/);
  }
});

test('readExitCode：文件缺失 / 内容不是整数都返回 undefined（交给 triage 判红）', () => {
  assert.equal(readExitCode(join(root, '.verify', 'no-such-file')), undefined);
  assert.equal(typeof readExitCode(join(root, 'package.json')), 'undefined', '内容不是整数时也算没读到');
});

/* ---------------- 2. 接线：yml 必须真的走 triage ---------------- */

test('结构：kernels.yml 有 cron 与 workflow_dispatch（外加 steps/versions 两个入参）', () => {
  assert.match(yml, /schedule:/, '必须有定期：跨内核回归不靠人在 PR 里想起来');
  assert.match(yml, /cron:/, 'schedule 下要有 cron 表达式');
  assert.match(yml, /workflow_dispatch:/, '必须能手动触发（出事时要能立刻复跑某一代）');
  assert.match(yml, /inputs:/);
  assert.match(yml, /steps:/, '面要能从入参指定：默认只跑 mount,function，type/gate 要显式开');
  assert.match(yml, /default: 'mount,function'/, '默认面就是 mount,function（type/gate 要临时 worktree + pnpm install）');
});

test('结构：退出码先落盘、再由 triage 判红（不许在 verify 那一步直接判）', () => {
  // 反例的形状就是写成 `run: node scripts/verify-across-kernels.mjs …`：那一步的退出码
  // 会被 CI 直接当结论，1 与 2 当场被抹成一格。所以必须：verify 步骤 `exit 0` + 落盘，
  // 独立的下一步用 triage 读文件。
  const verifyStep = yml.indexOf('node scripts/verify-across-kernels.mjs');
  assert.ok(verifyStep > 0, '工作流里必须真跑 verify 脚本');
  const exitZero = yml.indexOf('exit 0', verifyStep);
  assert.ok(exitZero > verifyStep, 'verify 那一步必须显式 exit 0：三值语义不能交给 CI 折成两格');
  assert.match(yml, /echo "\$code" > \.verify\/kernels-exit-code/, '退出码要落盘，才能跨步骤保住三值');

  const triageStep = yml.indexOf('node scripts/triage-kernels.mjs');
  assert.ok(triageStep > exitZero, 'triage 必须是**独立的一步**、且在落盘之后');
  assert.match(yml, /--code-file \.verify\/kernels-exit-code/, 'triage 从文件读，不要靠 shell 变量');
});

test('结构：明细必须上传（绿/红/未判定都要有证据）', () => {
  assert.match(yml, /upload-artifact/, '没有产物的矩阵等于没有证据，事后无法复核');
  assert.match(yml, /\.verify\/across-kernels-\*\.json/, '要存脚本自己落的那份 JSON 明细');
  assert.match(yml, /if: always\(\)/, '未判定/红的时候更需要产物，别只在绿的时候上传');
  assert.match(yml, /include-hidden-files: true/, '.verify 以点开头，upload-artifact 默认会跳过它');
});

test('结构：前置条件写清（真起内核要装包/要磁盘/要网络）', () => {
  // 这些不是「注释文学」：缺了树会得到「未判定」，而读日志的人必须一眼能分辨
  // 「环境没配」与「插件坏了」。
  assert.match(yml, /前置条件/, '要有一段专门讲前置条件');
  assert.match(yml, /dsh-versions/, '要写出内核树的默认位置');
  assert.match(yml, /--no-install|no-install/, '要说明这一轮用的是现成树还是现场装');
  assert.match(yml, /磁盘/, 'type 面要临时 worktree + pnpm install，磁盘代价要写明');
});

/* ---------------- 3. 反例：把口径改回去，上面两层会红 ---------------- */

test('反例：triage 若被写成恒绿，未判定/没结论的判定就失效（自证这几条不是摆设）', () => {
  // 不测 `triage` 的「另一版实现」，而是钉住上面那些断言确实依赖它的返回值：
  // 只要 exitCode 与 verdict 同时为「绿」，下面的等式就不再成立。
  const und = triage(2);
  assert.notEqual(und.exitCode, triage(1).exitCode, '未判定与真回归的作业结论必须不同格');
  assert.notEqual(und.verdict, triage(1).verdict);
  const unknown = triage(undefined);
  assert.equal(unknown.exitCode, triage(1).exitCode, '没结论与真回归同样判红，但性质不同（verdict 不同）');
  assert.notEqual(unknown.verdict, triage(1).verdict);
});
