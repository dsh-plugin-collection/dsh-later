/**
 * README 的**事实性断言**与代码同源。
 *
 * README 是全仓唯一一份"用户会照着做"的文本，它写错一处不会报错，只会让人按不存在的按钮、
 * 装不上不支持的内核。本仓已有先例把 README 钉进测试（`group-badge-visibility.test.mjs`
 * 钉设置项那一行），这里补上另外三类最容易漂的事实：
 *
 * 1. **支持矩阵**：代次集合与 `KERNEL_GENERATIONS` 逐项相等，`engines.dsh` 串逐字相同。
 *    两个真相源（代次表、package.json）改了而 README 没跟上，是这次要拦的头号问题。
 * 2. **已被代码否掉的功能名**：面板没有预览块（见 `src/client/components/SchedPanel.tsx` 文件头）、
 *    「取消全部」没有任何组件消费（`handleCancelAll` 在 `src/client/hooks/useSchedules.ts`）、
 *    模型侧只有三个工具（`src/index.ts` 的 `tools.register` 恰好三处，没有 `user_schedule_edit`）。
 * 3. **dock 按钮数与暂停措辞**：`ScheduleDock.tsx` 的 `DockActions` 渲染编辑 / 暂停或恢复 /
 *    删除 / 插话发送四个按钮，README 不能再写「三个按钮」，也不能不提暂停。
 *
 * 判两份语言：同一句话在中文里删掉、英文里留着，等于只修了一半。
 * @module tests/readme-facts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KERNEL_GENERATIONS } from '../lib/upstream-compat.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** @param {'README.md' | 'README.en.md'} file */
const readme = (file) => readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');

const FILES = ['README.md', 'README.en.md'];

/** 兼容小节里那张代次表：从「支持」标题起，到下一个标题止，取**第一张**表的第一列。 */
function matrixSection(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `README 缺少标题「${heading}」：支持矩阵整节就等于用户在猜`);
  const next = text.indexOf('\n### ', start + heading.length);
  const end = text.indexOf('\n## ', start + heading.length);
  const stop = [next, end].filter((i) => i > -1).reduce((a, b) => Math.min(a, b), text.length);
  const section = text.slice(start, stop);
  const lines = section.split('\n');
  /**
   * 只取第一张表：本小节后面还有「老内核降级」表，它的第一列是 `0.1.2` 这类**代次段**，
   * 把两张表一起收进来会让这条断言按构造永假。
   */
  const first = lines.findIndex((line) => line.startsWith('|'));
  assert.ok(first > -1, `${heading} 一节里没有代次表`);
  const rows = [];
  for (const line of lines.slice(first)) {
    if (!line.startsWith('|')) break;
    rows.push(line);
  }
  return { section, cells: rows.slice(2).map((row) => row.split('|')[1] ?? '') };
}

/** 第一列里出现的全部 semver 串（`` `0.1.7-rc.1` / `0.1.7-rc.2` `` 这种并排写法会取到两个）。 */
function idsFromCells(cells) {
  const found = [];
  for (const cell of cells) {
    for (const match of cell.matchAll(/`(\d+\.\d+\.\d+(?:-rc\.\d+)?)`/g)) found.push(match[1]);
  }
  return found;
}

for (const file of FILES) {
  const heading = file === 'README.md' ? '### 支持的 DSH 内核' : '### Supported DSH kernels';

  test(`${file}：代次表与 KERNEL_GENERATIONS 逐项相等`, () => {
    const ids = idsFromCells(matrixSection(readme(file), heading).cells);
    assert.deepEqual(
      ids,
      KERNEL_GENERATIONS.map((generation) => generation.id),
      '支持矩阵与 src/upstream-compat.ts 的代次表不一致：README 必须在增删一代时同步',
    );
  });

  test(`${file}：engines.dsh 串逐字写在兼容小节里`, () => {
    const { section } = matrixSection(readme(file), heading);
    assert.ok(
      section.includes(pkg.engines.dsh),
      `README 没有逐字写出 package.json 的 engines.dsh（${pkg.engines.dsh}）：两份范围打架时用户不知道信谁`,
    );
  });

  test(`${file}：不复述已被代码否掉的功能名`, () => {
    const text = readme(file);
    const banned =
      file === 'README.md'
        ? [/发送预览/, /取消全部/, /user_schedule_edit/, /行尾三个按钮/]
        : [/Send preview/i, /Cancel all/i, /user_schedule_edit/, /three buttons/i];
    for (const pattern of banned) {
      assert.doesNotMatch(
        text,
        pattern,
        `README 仍在描述不存在的入口「${pattern.source}」：面板无预览块、handleCancelAll 无人消费、` +
          '模型侧只注册 create/list/delete 三个工具、dock 每行是四个按钮',
      );
    }
  });

  test(`${file}：dock 一节写了暂停与恢复`, () => {
    const dock =
      file === 'README.md'
        ? /### 待发送 dock\n([\s\S]*?)\n### /
        : /### Pending dock\n([\s\S]*?)\n### /;
    const match = readme(file).match(dock);
    assert.ok(match, '找不到 dock 小节');
    const wanted = file === 'README.md' ? [/暂停/, /恢复/] : [/[Pp]ause/, /[Rr]esume/];
    for (const pattern of wanted) {
      assert.match(match[1], pattern, `dock 小节没提到 ${pattern.source}：ScheduleDock 的按钮就摆在那儿`);
    }
  });
}
