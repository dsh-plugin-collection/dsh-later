/**
 * 发布自检的判据测试。
 *
 * 为什么要这一份：`scripts/release-selfcheck.mjs` 一旦写成「永远返回 ok」，CI 照样绿，
 * 而它本该拦的三类事故（skill 文件从包里消失、装配补丁消失、纯文档重新入包）全都
 * 静默通过。所以每一类都用**真实形态**的输入跑一遍阴性用例，再各做一次变异看它判红。
 *
 * 输入分两层：
 *  - 静态层喂手写的 `package.json` 对象；
 *  - 实测层喂一份形态与 `npm pack --dry-run --json` 相同的 JSON（不真跑 npm，测试才会
 *    与包内容解耦；真跑一次由 `npm run check:release` 负责）。
 * @module tests/release-selfcheck
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALWAYS_PACKED_README,
  EXCLUDED_DOCS,
  TARBALL_BYTE_BUDGET,
  UNPACKED_BYTE_BUDGET,
  checkPackageManifest,
  checkPackReport,
  filesCovers,
  runReleaseSelfcheck,
} from '../scripts/release-selfcheck.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** 当前 `files` 白名单的副本，供变异用例改。 */
const files = () => [...pkg.files];

/** `packReport()` 去掉 README.en.md：模拟「有人把它从 files 删掉」之后的打包结果。 */
const packReportWithoutReadmeEn = () =>
  packReport().map((entry) => ({
    ...entry,
    files: [...entry.files, { path: 'README.en.md', size: 35_022, mode: 0o644 }].filter(
      (file) => file.path !== ALWAYS_PACKED_README,
    ),
  }));

/** 真实形态的 pack 报告：文件清单取当前 `files` 白名单的展开结果。 */
const packReport = (overrides = {}) => [
  {
    id: 'dsh-later@0.0.0',
    name: 'dsh-later',
    version: '0.0.0',
    size: 200_000,
    unpackedSize: 900_000,
    shasum: '0'.repeat(40),
    integrity: 'sha512-' + 'A'.repeat(86) + '==',
    entryCount: 6,
    files: [
      { path: 'package.json', size: 5_000 },
      { path: 'README.md', size: 30_000 },
      { path: 'README.en.md', size: 35_022 },
      { path: 'SKILL.md', size: 4_600 },
      { path: 'SKILL.en.md', size: 5_200 },
      { path: 'cordis.patch.yml', size: 775 },
      { path: 'icon.svg', size: 546 },
      { path: 'lib/index.js', size: 30_000 },
      { path: 'lib/types/index.d.ts', size: 6_900 },
    ].map((file) => ({ ...file, mode: 0o644 })),
    ...overrides,
  },
];

test('filesCovers：目录条目递归覆盖，文件条目只覆盖自己', () => {
  assert.equal(filesCovers(['lib'], 'lib/index.js'), true);
  assert.equal(filesCovers(['lib/index.js'], 'lib/index.js'), true);
  assert.equal(filesCovers(['lib/index.js'], 'lib/other.js'), false);
  // 前缀相同但不是同一目录：`libx/a.js` 不该被 `lib` 覆盖。
  assert.equal(filesCovers(['lib'], 'libx/a.js'), false);
  assert.equal(filesCovers(['./lib/'], 'lib/a.js'), true);
  assert.equal(filesCovers(undefined, 'lib/a.js'), false);
});

test('静态层：当前 package.json 通过', () => {
  assert.deepEqual(checkPackageManifest(pkg).problems, []);
});

test('静态层：manifest 里没有 files 白名单就判红', () => {
  const { problems } = checkPackageManifest({ ...pkg, files: undefined });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /没有 files 白名单/);
});

test('静态层变异：删掉任一必需路径都判红（SKILL.md / SKILL.en.md / lib / icon.svg / cordis.patch.yml）', () => {
  for (const target of ['SKILL.md', 'SKILL.en.md', 'lib', 'icon.svg', 'cordis.patch.yml']) {
    const mutated = { ...pkg, files: files().filter((entry) => entry !== target) };
    const { problems } = checkPackageManifest(mutated);
    assert.ok(problems.length > 0, `从 files 删掉 ${target} 后自检没有判红`);
    assert.ok(
      problems.some((problem) => problem.includes(target)),
      `判红信息里没有点名 ${target}：${problems.join(' / ')}`,
    );
  }
});

test('静态层变异：dsh.bundle.patch 指向的文件不在 files 里就判红', () => {
  const mutated = {
    ...pkg,
    files: files().filter((entry) => entry !== 'cordis.patch.yml'),
    dsh: { ...pkg.dsh },
  };
  const { problems } = checkPackageManifest(mutated);
  assert.ok(
    problems.some((problem) => problem.includes('dsh.bundle.patch 指向它')),
    problems.join(' / '),
  );
});

test('静态层变异：dsh.bundle.patch 路径改了而自检没跟上，也判红', () => {
  const mutated = { ...pkg, dsh: { ...pkg.dsh, bundle: { patch: './cordis.yml' } } };
  const { problems } = checkPackageManifest(mutated);
  assert.ok(problems.some((problem) => problem.includes('自检只认 cordis.patch.yml')), problems.join(' / '));
});

test('实测层：真实形态的报告通过，实测数字被取到', () => {
  const { problems, report } = checkPackReport(JSON.stringify(packReport()));
  assert.deepEqual(problems, []);
  assert.equal(report.tarballBytes, 200_000);
  assert.equal(report.unpackedBytes, 900_000);
  assert.ok(report.paths.includes('SKILL.md'));
});

test('实测层变异：包内缺 SKILL.md 判红（只看 files 拦不住 .npmignore 一类的排除）', () => {
  const report = packReport().map((entry) => ({
    ...entry,
    files: entry.files.filter((file) => file.path !== 'SKILL.md'),
  }));
  const { problems } = checkPackReport(JSON.stringify(report));
  assert.ok(problems.some((problem) => problem === '包内缺 SKILL.md'), problems.join(' / '));
});

test('实测层变异：包内缺 SKILL.en.md 判红', () => {
  const report = packReport().map((entry) => ({
    ...entry,
    files: entry.files.filter((file) => file.path !== 'SKILL.en.md'),
  }));
  const { problems } = checkPackReport(JSON.stringify(report));
  assert.ok(problems.some((problem) => problem === '包内缺 SKILL.en.md'), problems.join(' / '));
});

test('实测层变异：lib/ 一个文件都没有判红', () => {
  const report = packReport().map((entry) => ({
    ...entry,
    files: entry.files.filter((file) => !file.path.startsWith('lib/')),
  }));
  const { problems } = checkPackReport(JSON.stringify(report));
  assert.ok(problems.some((problem) => problem.includes('没有任何 lib/')), problems.join(' / '));
});

test('实测层变异：CHANGELOG.md 重新入包判红', () => {
  for (const doc of EXCLUDED_DOCS) {
    const report = packReport().map((entry) => ({
      ...entry,
      files: [...entry.files, { path: doc, size: 144_528, mode: 0o644 }],
    }));
    const { problems } = checkPackReport(JSON.stringify(report));
    assert.ok(
      problems.some((problem) => problem.includes(doc)),
      `${doc} 重新入包没有被判红：${problems.join(' / ')}`,
    );
  }
  // 只剩一条也要留住这层判据：加一条不在白名单的历史文档回包，必须判红。
  const planted = packReport().map((entry) => ({
    ...entry,
    files: [...entry.files, { path: 'CHANGELOG.md', size: 144_528, mode: 0o644 }],
  }));
  assert.ok(checkPackReport(JSON.stringify(planted)).problems.some((p) => p.includes('CHANGELOG.md')));
});

test('实测层：README.en.md 必须在包内（npm 无条件收纳根目录 readme，裁不掉）', () => {
  // 正向断言：它是研发中的坑，删掉 files 里那一项也裁不掉它，删掉这条断言只会让下一个人再试一次。
  // 报告里没有 README.en.md：判红必须点名它，而不是沉默通过。
  const { problems } = checkPackReport(JSON.stringify(packReportWithoutReadmeEn()));
  assert.ok(
    problems.some((problem) => problem.includes(ALWAYS_PACKED_README)),
    problems.join(' / '),
  );
  // 并且它现在确实写着 files 里：自检描述的是发布面，不是「我以为能裁掉的发布面」。
  assert.ok(filesCovers(files(), ALWAYS_PACKED_README), `${ALWAYS_PACKED_README} 不在 files 白名单里`);
});

test('实测层：当前 files 白名单的展开结果里不含 CHANGELOG.md', () => {
  for (const doc of EXCLUDED_DOCS) {
    assert.equal(filesCovers(files(), doc), false, `${doc} 仍被 files 覆盖`);
  }
  // 被裁掉的文档仍在仓库里，只是不随包发布。
  assert.ok(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').length > 0);
  assert.ok(readFileSync(new URL('../README.en.md', import.meta.url), 'utf8').length > 0);
});

test('实测层：尺寸超预算判红，预算常量与注释里的来源一致', () => {
  const over = packReport({ size: TARBALL_BYTE_BUDGET + 1, unpackedSize: UNPACKED_BYTE_BUDGET + 1 });
  const { problems } = checkPackReport(JSON.stringify(over));
  assert.ok(problems.some((problem) => problem.includes('超过预算') && problem.includes('tarball')));
  assert.ok(problems.some((problem) => problem.includes('超过预算') && problem.includes('unpacked')));
});

test('实测层：输出不是 JSON、或缺 files 数组时判红而不是抛', () => {
  assert.ok(checkPackReport('npm ERR! 一路噪音').problems.length > 0);
  const { problems } = checkPackReport(JSON.stringify([{ size: 1 }]));
  assert.ok(problems.some((problem) => problem.includes('没有 files 数组')));
});

test('组合：静态层通过但实测层缺 SKILL.md，整体仍判红（两层都要过）', () => {
  const report = packReport().map((entry) => ({
    ...entry,
    files: entry.files.filter((file) => file.path !== 'SKILL.md'),
  }));
  const result = runReleaseSelfcheck({ pkg, pack: () => JSON.stringify(report) });
  assert.equal(result.ok, false);
  assert.deepEqual(result.manifest.problems, []);
  assert.ok(result.problems.includes('包内缺 SKILL.md'));
});

test('组合：npm pack 执行失败也算失败，并把原因带出来', () => {
  const result = runReleaseSelfcheck({
    pkg,
    pack: () => {
      throw new Error('spawn npm ENOENT');
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('npm pack 执行失败')));
});
