/**
 * dock 折叠与编辑态的结构契约测试（Gitea issue #31）。
 *
 * 与仓库既有的 client 测试同风格：**源码级**断言，不引入 DOM/渲染库。锁的是几条
 * 一旦回退就没人会立刻看见的性质：
 *
 *  1. 折叠头与列表之间的 ARIA 关联（`aria-controls` ↔ `id`），以及列表常驻 DOM；
 *  2. 交互进行中（编辑 / 命令在途）强制展开并禁用折叠头——这正是 #31 那个
 *     「编辑中收起 → 编辑器卸载 → 草稿残留 → 再展开复活旧输入」缺陷的根因；
 *  3. `editingId` 的四条退出路径都有归宿，不留活口；
 *  4. 折叠态要播报「未确认」，且优先级高于「处理中」——收起恰恰发生在用户不想看
 *     细节的时候，最需要看见的东西不能只在展开时可见；
 *  5. 折叠复位不再用 `schedules.length <= 1` 那条旧 effect（与宿主归一条件不一致）。
 *
 * 断言范围纪律同 `dock-actions.test.mjs`：计数类只在对应切片内做，全域禁令只留给
 * 本次明确废除的写法。
 * @module tests/dock-collapse-a11y
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

const component = read('client/components/ScheduleDock.tsx');
const strings = read('client/strings.ts');

/** 数一下 `needle` 出现的次数。 */
const count = (haystack, needle) => haystack.split(needle).length - 1;

/** 取一个源码切片：从 `marker` 起，到下一个顶格声明止。 */
const sliceFrom = (source, marker, label) => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `缺少 ${label}（${marker}）`);
  const rest = source.slice(start);
  const nextTop = /\n(?:function |const |export |\/\* =)/.exec(rest.slice(1));
  return nextTop ? rest.slice(0, nextTop.index + 1) : rest;
};

/** 组件返回的 JSX 根（`ss-dock-root`）到文件里 DockActions 之前的那一段。 */
const root = sliceFrom(component, '    <div className="ss-dock-root"', 'dock 根节点');

test('折叠头与列表建立 ARIA 关联，列表常驻 DOM（#31）', () => {
  assert.match(component, /const listId = useId\(\);/, '需要一个稳定 id 关联 header 与列表');
  assert.match(root, /aria-controls=\{listId\}/, '折叠头必须指向它控制的那个列表');
  assert.match(root, /<ul\s+id=\{listId\}/, '列表要带可被指向的 id');
  // 用 hidden 保 DOM（宿主同款），不是条件卸载——否则折叠时 aria-controls 指向空引用。
  assert.match(root, /hidden=\{!expanded\}/, '列表应常驻 DOM，用 hidden 控制可见性');
  assert.doesNotMatch(root, /\{expanded && <ul/, '不得退回「折叠即卸载列表」的旧写法');
  // 相位补偿：进度条的相位在**挂载那一刻**冻结（组件头部 #13/#16 的结论），列表常驻 DOM 后
  // 展开不再触发重挂载，所以随展开态换 key 强制重挂载——与旧的「收起即卸载」等价。
  assert.match(root, /key=\{expanded \? 'open' : 'closed'\}/, '重展开需重挂载，否则相位停在第一次挂载时');
});

test('编辑或命令在途时强制展开，并禁用折叠头（#31 根因）', () => {
  assert.match(
    component,
    /const interactionActive = editingId !== null \|\| busy;/,
    '交互进行中 = 正在编辑 或 有命令在途（宿主同一条判据）',
  );
  assert.match(
    component,
    /const expanded = schedules\.length === 1 \|\| !collapsed \|\| interactionActive;/,
    '交互进行中必须强制展开，否则编辑器随收起被卸载',
  );
  assert.match(root, /disabled=\{interactionActive\}/, '折叠头在交互进行中要禁用');
  assert.match(root, /aria-expanded=\{expanded\}/, 'aria-expanded 要说真实可见态，不是 collapsed 取反');
});

test('editingId 的四条退出路径都收干净，不留旧草稿（#31）', () => {
  /*
   * 切在两条清理 effect 上：起点是它们的文档注释，终点是紧随其后的「折叠态复位口径」
   * 注释。不能用「下一个顶格声明」当边界——清理区之后还有一堆缩进的 const（含
   * `cancelEdit`），会把它们的 `setEditingId(null)` 也算进来，计数就假高了。
   */
  const start = component.indexOf('   * `editingId` 的清理');
  const end = component.indexOf('   * 折叠态复位口径');
  assert.notEqual(start, -1, '缺少 editingId 清理的文档注释');
  assert.notEqual(end, -1, '缺少折叠态复位口径的文档注释（清理区的边界）');
  assert.ok(end > start, '两个边界注释的顺序变了，清理区切片失效');
  const cleanup = component.slice(start, end);

  // 路径①：该行从投影消失。判据用渲染源 `schedules`，与宿主一致。
  assert.match(
    cleanup,
    /if \(schedules\.some\(\(item\) => item\.id === editingId\)\) return;/,
    '行不在渲染源里时必须立刻退出编辑态',
  );
  // 路径②：切换会话——投影换了一整套行，旧草稿不属于这个会话。
  assert.match(cleanup, /\}, \[sessionId\]\);/, '会话切换要有独立的清理 effect');
  // 两条路径都要清全四样：只清 editingId 会留下脏的草稿文本 / 行内错误 / 保存中。
  assert.equal(count(cleanup, 'setEditingId(null);'), 2, '消失与切换两条路径各清一次');
  assert.equal(count(cleanup, 'setEditingText('), 2, '草稿文本不得残留');
  assert.equal(count(cleanup, 'setEditErr('), 2, '行内错误不得残留');
  assert.equal(count(cleanup, 'setSaving('), 2, '保存中标记不得残留');
  // 路径③④：保存成功与取消都走 cancelEdit（函数归 dock-editor，这里只验它确实清了 id）。
  assert.match(
    component,
    /const cancelEdit = \(\): void => \{\s*\n\s*setEditingId\(null\);/,
    'cancelEdit 必须清 editingId',
  );
});

test('折叠态播报未确认，优先级高于处理中（#31）', () => {
  assert.match(
    root,
    /steerUnconfirmed\.size > 0 \&& \(\s*<span className="ss-dock-status" role="status">/,
    '折叠时也要把「未确认」喊出来',
  );
  // 未确认优先于在途：两者同时存在时只播未确认。
  assert.match(root, /steerUnconfirmed\.size === 0 && busy &&/, '未确认与处理中互斥，未确认优先');
  assert.equal(count(root, 'role="status"'), 2, '两条摘要共用播报位，各一条');
  // 词条双语齐全（注册源是 strings.ts，见 issue #28 的双出口）。
  assert.equal(count(strings, 'statusUnconfirmed:'), 2, 'zh/en 各一条新词条');
  assert.match(strings, /statusUnconfirmed: '\{n\} 条未确认'/);
  assert.match(strings, /statusUnconfirmed: '\{n\} unconfirmed'/);
});

test('折叠复位口径与宿主一致，旧的 length<=1 effect 不得复活（#31/#32）', () => {
  assert.doesNotMatch(
    component,
    /if \(schedules\.length <= 1\) setCollapsed\(true\);/,
    '那条 effect 与宿主的归一条件不同：单条本就强制展开，多条时反而会抹掉用户展开的状态',
  );
  // 列表为空时整块返回 null（卸载），复位由下次挂载的初始值完成——与宿主同形。
  assert.match(component, /if \(schedules\.length === 0 \|\| sessionId === undefined\) return null;/);
});
