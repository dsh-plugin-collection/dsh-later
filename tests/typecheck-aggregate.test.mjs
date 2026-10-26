/**
 * 类型门禁必须**两个项目都跑完**，不能按失败顺序短路（issue #96）。
 *
 * ## 这个文件在防什么
 *
 * `package.json` 里原本是 `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit`。
 * `&&` 让**宿主项目一红，client 项目就完全不跑**；而跨代次回归里红的基本都在 client 侧
 * （`dsh-client-ui-primitives` 图标改名、props 形状），于是这条门禁在最能发现问题的场景里失明：
 * `0.1.2-rc.1` 上宿主先红 2 条，client 的错误数至今未知。同一份脚本报出来的数量取决于
 * 两个项目的**失败顺序** —— 这不是门禁该有的性质。
 *
 * 光把 `&&` 换成 `;` 也不够：退出码会被最后一条覆盖（前红后绿 ⇒ 整体绿）。所以改成脚本
 * `scripts/typecheck-all.mjs`：逐项目跑、逐项目记条数、任一红即整体红。
 *
 * 断言分两层：
 *  1. **结构**：`typecheck` script 与 CI 都必须走那一个入口（CI 的两条 `npx tsc` 在 `bash -e`
 *     下也是同一个短路）——防有人"顺手改回去"；
 *  2. **行为**：用假 tsc 造出"先红后绿"和"先绿后红"两种顺序，断言**两个项目都真的跑了**
 *     且条数各自正确。这一层才是本质：结构对了但实现又按顺序提前退出，只有它能抓到。
 * @module tests/typecheck-aggregate
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROJECTS, countErrors, runTypecheck } from '../scripts/typecheck-all.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const scriptPath = join(root, 'scripts', 'typecheck-all.mjs');

/**
 * 造一个临时"项目"：两个 tsconfig + 一个假 tsc。
 *
 * 假 tsc 按 `-p` 的项目名决定造多少条 `error TS` 与退出码，这样"谁先红"完全由用例指定，
 * 不依赖真 tsc 的行为（本仓当前是绿的，用真 tsc 根本造不出红）。
 * @param {{ hostErrors: number, clientErrors: number }} spec - 两个项目各自要造多少条错误。
 * @returns {{ cwd: string, tsc: string }} 临时目录与假 tsc 路径。
 */
function makeFakeProject(spec) {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-typecheck-'));
  writeFileSync(join(cwd, 'tsconfig.json'), '{}');
  writeFileSync(join(cwd, 'tsconfig.client.json'), '{}');
  const tsc = join(cwd, 'fake-tsc.mjs');
  writeFileSync(tsc, `#!/usr/bin/env node
const project = process.argv[process.argv.indexOf('-p') + 1];
const errors = ${JSON.stringify({ 'tsconfig.json': spec.hostErrors, 'tsconfig.client.json': spec.clientErrors })};
const n = errors[project] ?? 0;
for (let i = 0; i < n; i += 1) console.error(\`\${project}(\${i + 1},1): error TS9999: fake diagnostic\`);
process.exit(n > 0 ? 1 : 0);
`);
  return { cwd, tsc };
}

test('结构：typecheck 与 CI 都走同一个汇总入口（不许再出现两条 tsc）', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.typecheck, 'node scripts/typecheck-all.mjs', 'typecheck 必须是汇总脚本，不能是 && 串');
  assert.doesNotMatch(pkg.scripts.typecheck, /&&/, '不得退回 tsc a && tsc b');

  const ci = readFileSync(join(root, '.gitea', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /node scripts\/typecheck-all\.mjs/, 'CI 的类型检查也要走同一个入口（bash -e 下两条 npx tsc 同样会短路）');
  assert.doesNotMatch(ci, /npx tsc -p tsconfig/);
});

test('行为：宿主先红，client 项目**仍然跑完**并报出条数（0.1.2 那个失明现场）', () => {
  const { cwd, tsc } = makeFakeProject({ hostErrors: 2, clientErrors: 19 });
  const result = runTypecheck({ cwd, tsc, projects: DEFAULT_PROJECTS });

  assert.equal(result.ok, false);
  assert.equal(result.projects.length, 2, '两个项目都必须留下结果——这正是 && 做不到的');
  assert.deepEqual(result.projects.map((p) => p.project), [...DEFAULT_PROJECTS], '顺序稳定，便于人读');
  assert.deepEqual(result.projects.map((p) => p.errors), [2, 19], '各自条数要分开数，不能并成一个总数');
  assert.ok(result.projects[1].output.includes('error TS9999'), '红了要给出完整诊断，便于定位');
});

test('行为：宿主通过、client 红，同样两组结果（反向顺序也不许短路）', () => {
  const { cwd, tsc } = makeFakeProject({ hostErrors: 0, clientErrors: 19 });
  const result = runTypecheck({ cwd, tsc, projects: DEFAULT_PROJECTS });
  assert.equal(result.ok, false);
  assert.deepEqual(result.projects.map((p) => p.errors), [0, 19]);
});

test('行为：都绿时 ok=true（别把"跑了两个项目"误判成红）', () => {
  const { cwd, tsc } = makeFakeProject({ hostErrors: 0, clientErrors: 0 });
  const result = runTypecheck({ cwd, tsc, projects: DEFAULT_PROJECTS });
  assert.equal(result.ok, true);
  assert.deepEqual(result.projects.map((p) => p.errors), [0, 0]);
});

test('行为：缺席的 tsconfig 记进 missing，不阻断另一个项目', () => {
  const { cwd, tsc } = makeFakeProject({ hostErrors: 0, clientErrors: 3 });
  const result = runTypecheck({ cwd, tsc, projects: ['tsconfig.json', 'tsconfig.does-not-exist.json'] });
  assert.deepEqual(result.missing, ['tsconfig.does-not-exist.json']);
  assert.equal(result.projects.length, 1);
  assert.equal(result.ok, true);
});

test('计数口径：数 `error TS` 标记，不数行（多行诊断不该虚高）', () => {
  const sample = [
    "src/a.ts(1,1): error TS2322: Type 'x' is not assignable.",
    '  Type detail line one',
    '  Type detail line two',
    'src/b.ts(2,2): error TS7006: Parameter implicitly has any type.',
  ].join('\n');
  assert.equal(countErrors(sample), 2);
});

test('CLI 端到端：退出码 1，且两个项目的结论都在输出里', () => {
  const { cwd, tsc } = makeFakeProject({ hostErrors: 2, clientErrors: 5 });
  const run = spawnSync(process.execPath, [scriptPath, '--tsc', tsc], { cwd, encoding: 'utf8' });
  assert.equal(run.status, 1, '有项目红 → 退出码 1');
  const out = `${run.stdout}${run.stderr}`;
  assert.match(out, /tsconfig\.json\s+2 条错误/);
  assert.match(out, /tsconfig\.client\.json\s+5 条错误/, '第二个项目的结论必须出现在输出里');
  assert.match(out, /汇总：有项目未通过/);
});

test('CLI 端到端：全绿退出码 0', () => {
  const { cwd, tsc } = makeFakeProject({ hostErrors: 0, clientErrors: 0 });
  const run = spawnSync(process.execPath, [scriptPath, '--tsc', tsc], { cwd, encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(`${run.stdout}`, /汇总：两个项目都通过/);
});
