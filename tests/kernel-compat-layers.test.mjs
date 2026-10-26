/**
 * 跨内核代次兼容层的**行为**契约（issue #95 方案 B）。
 *
 * 三处降级各自有一个"只在老代次才跑"的分支，而本机的 devDependencies 是新代次 ——
 * 也就是说这些分支在常规回归里**永远不会执行**。所以它们必须能被注入/单独调用来测：
 *
 *  1. `attachment-blocks`：0.1.2 的 `ContentBlock` 没有 `file` 变体 ⇒ 文件块降级成文本；
 *     ≥0.1.5 原样透传。硬塞的后果是"被宿主拒"或"装配期静默丢弃"，用户到点收到一条没有附件的消息。
 *  2. `workspace-path-compat`：0.1.5/0.1.2 的 `dsh-util-workspace-path` 没有 `fileMediaUrl`。
 *  3. `primitives-compat`：图标在 0.1.7 之前叫尺寸后缀名 —— 本机只能验证"新名优先"这一侧，
 *     老名兜底由 `resolvedIconNames()` + 跨代 tsc（`--steps type`）共同保证。
 * @module tests/kernel-compat-layers
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FILE_ATTACHMENT_PREFIX,
  FILE_BLOCK_SINCE,
  appendAttachmentBlocks,
  contentWithAttachmentBlocks,
  kernelSupportsFileBlocks,
  resetFileBlockSupport,
} from '../lib/attachment-blocks.js';
import { readFileSync } from 'node:fs';
import { fileMediaUrlFallback } from '../lib/media-url.js';

/** 造一个"宿主给我们的图片块"（两代都认，必须原样透传）。 */
const imageBlock = { type: 'image', attachment: { attachmentId: 'img-1', name: 'a.png' } };
/** 造一个 file 块（≥0.1.5 才认）。 */
const fileBlock = { type: 'file', attachment: { attachmentId: 'file-1', name: 'report.pdf', bytes: 99 } };
const lead = { type: 'text', text: '到点了' };

/** 注入一个固定内核版本（不依赖真实安装）。 */
const kernelAt = (version) => ({ readKernel: () => ({ version, specifier: '@deepseek-ai/dsh-schedule' }) });

test.beforeEach(() => resetFileBlockSupport());

test('能力阈值：0.1.5-rc.1 起才认 file 块（0.1.2 没有这个变体）', () => {
  assert.equal(FILE_BLOCK_SINCE, '0.1.5-rc.1');
  assert.equal(kernelSupportsFileBlocks(kernelAt('0.1.2-rc.1')), false);
  resetFileBlockSupport();
  assert.equal(kernelSupportsFileBlocks(kernelAt('0.1.5-rc.1')), true);
});

test('0.1.2：文件块降级成 `[附件] 名字` 文本，图片块仍原样透传（内容不丢）', () => {
  const content = contentWithAttachmentBlocks(lead, [imageBlock, fileBlock], kernelAt('0.1.2-rc.1'));
  assert.deepEqual(content, [
    lead,
    imageBlock, // 同一引用：图片块不做任何转换
    { type: 'text', text: `${FILE_ATTACHMENT_PREFIX} report.pdf` },
  ]);
});

test('≥0.1.5：文件块原样透传（行为与改动前逐字一致）', () => {
  const content = contentWithAttachmentBlocks(lead, [imageBlock, fileBlock], kernelAt('0.1.5-rc.1'));
  assert.equal(content.length, 3);
  assert.equal(content[2], fileBlock, '必须是同一个块对象，不能被改写');
  assert.equal(content[2].type, 'file');
});

test('读不到内核版本：保守降级（宁可文件变文本，也不静默丢附件）且警告只打一次', () => {
  const warnings = [];
  const options = { readKernel: () => undefined, warn: (message) => warnings.push(message) };
  assert.equal(kernelSupportsFileBlocks(options), false);
  assert.equal(kernelSupportsFileBlocks(options), false);
  assert.equal(warnings.length, 1, '反复调用只该警告一次（否则淹掉真问题）');
  assert.match(warnings[0], /保守降级/);
  const content = contentWithAttachmentBlocks(lead, [fileBlock], options);
  assert.deepEqual(content[1], { type: 'text', text: `${FILE_ATTACHMENT_PREFIX} report.pdf` });
});

test('sidecar 被改坏（文件名缺失/空串）：占位词，不让 undefined 进用户气泡', () => {
  const broken = { type: 'file', attachment: { attachmentId: 'file-2', bytes: 3 } };
  const blank = { type: 'file', attachment: { attachmentId: 'file-3', name: '', bytes: 3 } };
  const content = [];
  appendAttachmentBlocks(content, [broken, blank], kernelAt('0.1.2-rc.1'));
  assert.deepEqual(content.map((block) => block.text), [
    `${FILE_ATTACHMENT_PREFIX} 未命名附件`,
    `${FILE_ATTACHMENT_PREFIX} 未命名附件`,
  ]);
});

test('判定结果按进程缓存（代发路径每次都要问，别每次都去读 package.json）', () => {
  let calls = 0;
  const options = { readKernel: () => { calls += 1; return { version: '0.2.1-rc.2', specifier: '@deepseek-ai/dsh' }; } };
  assert.equal(kernelSupportsFileBlocks(options), true);
  assert.equal(kernelSupportsFileBlocks(options), true);
  assert.equal(calls, 1, '同进程内内核版本不会变，判一次就够');
});

test('fileMediaUrl 本地兜底：scheme 白名单 / 绝对路径 / UNC / 控制字符（0.1.5 起缺此导出时走它）', () => {
  const base = 'http://127.0.0.1:3080/';
  assert.equal(fileMediaUrlFallback(base, '/tmp/a.png'), 'http://127.0.0.1:3080/api/file?path=%2Ftmp%2Fa.png');
  // 桌面载体基址
  assert.equal(
    fileMediaUrlFallback('dsh-app://app/', '/tmp/a b.png'),
    'dsh-app://app/api/file?path=%2Ftmp%2Fa%20b.png',
  );
  // 非 http(s) / 非 dsh-app 基址 → 拒绝（避免拼出奇怪的 scheme）
  assert.equal(fileMediaUrlFallback('file:///etc/', '/tmp/a.png'), undefined);
  // 相对路径 → 拒绝（它不是"本地绝对路径"）
  assert.equal(fileMediaUrlFallback(base, 'tmp/a.png'), undefined);
  // UNC 起点 → 拒绝（会被当成网络路径）
  assert.equal(fileMediaUrlFallback(base, '//server/share/a.png'), undefined);
  assert.equal(fileMediaUrlFallback(base, '\\\\server\\share\\a.png'), undefined);
  // 控制字符 → 拒绝（防注入/截断）
  assert.equal(fileMediaUrlFallback(base, '/tmp/a\u0000b.png'), undefined);
  assert.equal(fileMediaUrlFallback(base, '/tmp/a\nb.png'), undefined);
});

// ── 客户端兼容层：只能做源码级契约断言（模块被 bundle 进 lib/client.js，运行时拿不到）──

const compatSource = readFileSync(new URL('../src/client/primitives-compat.ts', import.meta.url), 'utf8');
/** 从源码里取出图标名清单（单一事实来源，不在测试里另抄一份）。 */
const iconExportNames = (() => {
  const block = /export const ICON_EXPORT_NAMES: readonly string\[\] = \[([\s\S]*?)\] as const;/.exec(compatSource);
  assert.ok(block !== null, 'primitives-compat.ts 必须有 ICON_EXPORT_NAMES 清单');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
})();

test('图标兼容层：每个别名都有"新名优先、老名兜底"两条候选，且候选都在导出清单里', () => {
  const aliases = [...compatSource.matchAll(/export const (Icon[A-Za-z]+) = firstIcon\(([\s\S]*?)\);/g)];
  assert.equal(aliases.length, 9, '应导出 9 个别名图标（时钟/叉/下箭头/编辑/暂停/播放/发送/删除/信息）');
  for (const [, alias, body] of aliases) {
    const picked = [...body.matchAll(/pick<IconComponent>\('([A-Za-z0-9]+)'\)/g)].map((m) => m[1]);
    assert.equal(picked.length, 2, `${alias} 必须有两个候选（新名 + 老代次兜底名）`);
    assert.match(picked[0], /Regular$/, `${alias} 的第一个候选必须是 0.1.7+ 的新名`);
    for (const name of picked) {
      assert.ok(iconExportNames.includes(name), `${alias} 的候选 ${name} 不在 ICON_EXPORT_NAMES 里`);
    }
  }
});

test('图标清单：老代次的尺寸后缀名必须在（删了就退化成 EmptyIcon，老内核上图标消失）', () => {
  for (const legacy of ['IconClockOutline16', 'IconChevronDownOutline14', 'IconQuestionOutline14', 'IconPaperclipOutline16']) {
    assert.ok(iconExportNames.includes(legacy), `${legacy} 是老代次的兜底名，不得删除`);
  }
  // 0.1.2 缺 FileTypeIcon/fileSizeText：这两个也要在清单里（测试桩按清单声明可枚举属性）
  assert.ok(iconExportNames.includes('FileTypeIcon'));
  assert.ok(iconExportNames.includes('fileSizeText'));
});

test('Tooltip 的 portal 经 spread 传（老代次没有这个 prop，直接写会编译失败）', () => {
  const dock = readFileSync(new URL('../src/client/components/ScheduleDock.tsx', import.meta.url), 'utf8');
  assert.match(compatSource, /export const tooltipPortalProps: \{ portal\?: true \} = \{ portal: true \};/);
  assert.equal((dock.match(/\{\.\.\.tooltipPortalProps\}/g) ?? []).length, 5, '5 处 Tooltip 都要经兼容层打开 portal');
  assert.doesNotMatch(dock, /delayMs=\{500\} portal/, '不得再直接写 portal（0.1.5 上编译不过）');
});
