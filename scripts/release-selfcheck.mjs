#!/usr/bin/env node
/**
 * 发布面自检：`npm publish` 之前，确认包内**实际**带着运行时需要的文件。
 *
 * 判据分两层，缺一层就留下面的事故：
 *   1. 静态层：`package.json` 的 `files` 白名单与 `dsh.bundle.patch` 字段自洽。
 *   2. 实测层：真跑一次 `npm pack --dry-run --json`，读 npm 给出的文件清单。
 *
 * 为什么只看 `files` 不够：`files` 只是输入，最终入包清单还受 `.npmignore`、
 * `.gitignore`、`exports` 与 npm 的默认排除规则影响。仓库里一次 `files` 写对、
 * `.npmignore` 写错，静态判据仍然全绿，装出来的包却缺文件。
 *
 * 挡的事故有三类，都是**装上去才炸**：
 *   - `SKILL.md` / `SKILL.en.md` 缺席：`src/skill.ts` 的 `skillFilePaths()` 按包根
 *     拼这两个文件名，运行时 `readFileSync`；缺席时 provider 收敛成「本 skill 缺席」，
 *     模型侧的常驻目录少一行，且不报错。
 *   - `lib` / `icon.svg` / `cordis.patch.yml` 缺席：入口、图标、装配补丁缺失。
 *   - `CHANGELOG.md` 重新入包：它是一百多 KB 的历史记录，不参与运行。npm 页面只渲染
 *     默认 `README.md`，把历史一并塞进 tarball 只是让每次安装多下载。
 *
 * @module dsh-later/scripts/release-selfcheck
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 包根。`scripts/` 的上一级。 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 运行时按路径读取的 skill 文件。
 *
 * 路径来源：`src/skill.ts` 的 `skillFilePaths()` 以包根为 base，分别拼 `SKILL.md`
 * 与 `SKILL.en.md`，`parseSkill` 的调用点是 `readFileSync`。两个文件都要，因为
 * `resolveSkillLocale` 在 locale 为 `en` 时选英文那份。
 */
export const SKILL_FILES = Object.freeze(['SKILL.md', 'SKILL.en.md']);

/** `package.json` 的 `dsh.bundle.patch` 指向的装配补丁。 */
export const BUNDLE_PATCH_FILE = 'cordis.patch.yml';

/** 入口与图标：`main` / `types` / `icon` 三个字段都指向它们。 */
export const ENTRY_PATHS = Object.freeze(['lib', 'icon.svg']);

/**
 * 刻意不随 npm 包发布的纯文档。
 *
 * `CHANGELOG.md` 是历史记录，在仓库与 GitHub 上照常可读，npm 页面也不渲染它。
 *
 * 这里**只有一个**是有原因的：`README.en.md` 看着也像「纯传输量」，但它裁不掉，见
 * {@link ALWAYS_PACKED_README}。
 */
export const EXCLUDED_DOCS = Object.freeze(['CHANGELOG.md']);

/**
 * npm **无条件**收进 tarball 的根目录 README。
 *
 * npm 把「包必须带一份 README」表达成硬规则：项目根目录下所有名字匹配 `/^readme/i`
 * 的文件都会入包，`files` 白名单不写它、`.npmignore` 里点名排除它，都没有用
 * （npm 11.19.1 实测：`files` 删掉这一项后 `README.en.md` 仍在包内，35,022B 一个字节没省）。
 *
 * 既然是规则而不是疏漏，这里就把它断言成**必须在包内**：有人以为 `files` 能裁掉它、
 * 删掉这一项再跑自检，会得到一条判红，而不是一次「看起来省了 35KB」的静默变化。
 */
export const ALWAYS_PACKED_README = 'README.en.md';

/**
 * 尺寸上限。来源：issue #145 落地后的实测值加余量。
 *
 * 裁掉 `CHANGELOG.md` 后实测 tarball 与 unpacked 都只有原来的四成左右；上面这两个常量
 * 取实测值的一倍上下。留这么宽是有意的：`lib/` 的产物体积随源码增长，阈值贴着实测值
 * 定会让每次正常改代码都可能红一次，门禁一红就没人看了。这里要拦的是**量级变化**
 * （历史文档重新入包、`lib/` 被整份内联成单文件），不是几个百分点的漂移。
 */
export const TARBALL_BYTE_BUDGET = 300 * 1024;
/**
 * unpacked 上限，理由同上。
 *
 * `lib/` 占入包体积的九成以上，其中 `lib/client.js` 单文件最大、随 UI 代码线性涨；
 * 上限给到 1100KB 时，`CHANGELOG.md` 那样的文档一回来就会撞上。
 */
export const UNPACKED_BYTE_BUDGET = 1100 * 1024;

/**
 * 白名单条目是否覆盖某个包内路径。
 *
 * npm 的 `files` 语义：条目可以是文件，也可以是目录（递归收录其下所有文件）。
 * 所以 `lib` 覆盖 `lib/index.js`，`lib/index.js` 只覆盖自己。
 *
 * @param {readonly string[]} files `package.json` 的 `files` 数组。
 * @param {string} path 需要覆盖的包内相对路径。
 */
export function filesCovers(files, path) {
  const target = normalize(path);
  return (Array.isArray(files) ? files : []).some((entry) => {
    const dir = normalize(entry);
    return dir === target || target.startsWith(`${dir}/`);
  });
}

/** 包内路径归一化：去掉开头的 `./` 与结尾的 `/`，统一正斜杠。 */
function normalize(path) {
  return String(path ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

/**
 * 静态层判据：只用 `package.json`，不碰文件系统。
 *
 * @param {object} pkg 解析后的 `package.json`。
 * @returns {{problems: string[]}} `problems` 为空表示通过。
 */
export function checkPackageManifest(pkg) {
  const problems = [];
  const files = pkg?.files;

  if (!Array.isArray(files) || files.length === 0) {
    // 没有 `files` 时 npm 会收录整个包目录（减去默认排除项），白名单等于失效。
    return { problems: ['package.json 没有 files 白名单：npm 会按目录递归收录，发布面不可控'] };
  }

  for (const path of [...SKILL_FILES, ...ENTRY_PATHS]) {
    if (!filesCovers(files, path)) {
      problems.push(`files 未覆盖 ${path}`);
    }
  }

  const patch = pkg?.dsh?.bundle?.patch;
  if (typeof patch !== 'string' || patch.length === 0) {
    problems.push('package.json 缺少 dsh.bundle.patch：装配补丁没有声明路径');
  } else {
    const patchPath = normalize(patch);
    if (patchPath !== BUNDLE_PATCH_FILE) {
      problems.push(`dsh.bundle.patch 指向 ${patchPath}，自检只认 ${BUNDLE_PATCH_FILE}（改路径要同步改这里）`);
    }
    if (!filesCovers(files, patchPath)) {
      problems.push(`files 未覆盖 ${patchPath}（dsh.bundle.patch 指向它）`);
    }
  }

  return { problems };
}

/**
 * 实测层判据：读 `npm pack --dry-run --json` 的输出。
 *
 * @param {string} stdout `npm pack --dry-run --json` 的原始 stdout。
 * @returns {{
 *   problems: string[],
 *   report: { entryCount: number, tarballBytes: number, unpackedBytes: number, paths: string[] } | null,
 * }}
 *   `report` 为解析出的实测数字；解析失败时为 `null`（此时 `problems` 非空）。
 */
export function checkPackReport(stdout) {
  const problems = [];
  let parsed;
  try {
    parsed = JSON.parse(String(stdout ?? ''));
  } catch (error) {
    return {
      problems: [`npm pack --dry-run --json 的输出不是 JSON：${error instanceof Error ? error.message : String(error)}`],
      report: null,
    };
  }

  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry || !Array.isArray(entry.files)) {
    return { problems: ['npm pack 输出里没有 files 数组'], report: null };
  }

  const paths = entry.files.map((file) => normalize(file?.path));
  const present = new Set(paths);
  const report = {
    entryCount: typeof entry.entryCount === 'number' ? entry.entryCount : paths.length,
    tarballBytes: typeof entry.size === 'number' ? entry.size : NaN,
    unpackedBytes: typeof entry.unpackedSize === 'number' ? entry.unpackedSize : NaN,
    paths,
  };

  for (const path of [...SKILL_FILES, BUNDLE_PATCH_FILE]) {
    if (!present.has(path)) problems.push(`包内缺 ${path}`);
  }
  if (!paths.some((path) => path.startsWith('lib/'))) {
    problems.push('包内没有任何 lib/ 下的文件（入口与类型声明都在那里）');
  }
  if (!present.has('icon.svg')) problems.push('包内缺 icon.svg');

  for (const path of EXCLUDED_DOCS) {
    if (present.has(path)) {
      problems.push(`包内出现了 ${path}：它属于纯文档，不该随 npm 包发布`);
    }
  }

  // 反向断言：npm 的 readme 自动收纳规则决定了它必然在包里（见 ALWAYS_PACKED_README）。
  if (!present.has(ALWAYS_PACKED_README)) {
    problems.push(
      `包内没有 ${ALWAYS_PACKED_README}：npm 会自动收纳根目录的 README，它缺席说明打包规则变了，` +
        '本文件里的发布面描述（以及据此写下的文档）都要重核',
    );
  }

  if (!Number.isFinite(report.tarballBytes)) {
    problems.push('npm pack 输出里没有 size：无法核对 tarball 预算');
  } else if (report.tarballBytes > TARBALL_BYTE_BUDGET) {
    problems.push(
      `tarball ${report.tarballBytes}B 超过预算 ${TARBALL_BYTE_BUDGET}B（issue #145）`,
    );
  }
  if (!Number.isFinite(report.unpackedBytes)) {
    problems.push('npm pack 输出里没有 unpackedSize：无法核对解包体积预算');
  } else if (report.unpackedBytes > UNPACKED_BYTE_BUDGET) {
    problems.push(
      `unpacked ${report.unpackedBytes}B 超过预算 ${UNPACKED_BYTE_BUDGET}B（issue #145）`,
    );
  }

  return { problems, report };
}

/** 默认的打包命令。`--dry-run` 不写 tarball，`--json` 给可解析的输出。 */
export const DEFAULT_PACK_COMMAND = 'npm';

/**
 * 跑一次 `npm pack --dry-run --json` 并取 stdout。
 *
 * 命令可注入，测试因此不需要真跑 npm；CLI 路径用默认值。
 * @param {string} command 可执行文件（默认 `npm`）。
 * @param {string} cwd 执行目录（默认包根）。
 */
export function runPackCommand(command = DEFAULT_PACK_COMMAND, cwd = ROOT) {
  return execFileSync(command, ['pack', '--dry-run', '--json'], {
    cwd,
    encoding: 'utf8',
    // npm 的进度与警告走 stderr；stdout 只留 JSON。
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

/**
 * 跑完整自检：静态层 + 实测层。
 *
 * @param {object} options
 * @param {object} [options.pkg] 已解析的 `package.json`（默认读包根那份）。
 * @param {() => string} [options.pack] 取打包输出的函数（默认跑 {@link runPackCommand}）。
 * @returns {{ok: boolean, problems: string[], manifest: {problems: string[]}, pack: ReturnType<typeof checkPackReport>}}
 */
export function runReleaseSelfcheck(options = {}) {
  const pkg = options.pkg ?? JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const pack = options.pack ?? (() => runPackCommand());

  const manifest = checkPackageManifest(pkg);
  let packResult;
  try {
    packResult = checkPackReport(pack());
  } catch (error) {
    packResult = {
      problems: [`npm pack 执行失败：${error instanceof Error ? error.message : String(error)}`],
      report: null,
    };
  }

  const problems = [...manifest.problems, ...packResult.problems];
  return { ok: problems.length === 0, problems, manifest, pack: packResult };
}

/** 实测数字的一行摘要，成功与失败都打。 */
function summaryLine(report) {
  if (!report) return '实测：npm pack 未产出可解析的报告';
  return (
    `实测：${report.entryCount} 个文件，` +
    `tarball ${report.tarballBytes}B（预算 ${TARBALL_BYTE_BUDGET}B），` +
    `unpacked ${report.unpackedBytes}B（预算 ${UNPACKED_BYTE_BUDGET}B）`
  );
}

/** 直接执行时的入口。 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runReleaseSelfcheck();
  console.log(summaryLine(result.pack.report));
  if (result.ok) {
    console.log('✅ 发布面自检通过');
  } else {
    console.error(`❌ 发布面自检失败（${result.problems.length} 项）：`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  }
}
