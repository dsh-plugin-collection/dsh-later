/**
 * dock 动作区的静态契约测试（Gitea issue #29 + #32 的两条动作区项）。
 *
 * 与仓库既有的 client 测试同风格：**源码级**断言，不引入 DOM/渲染库。
 * 锁的是几个在后续改动里很容易悄悄丢掉的约定：
 *
 *  1. tooltip 用 primitives 的官方 `Tooltip`，自研 `DockTip` 不得复活（#29）；
 *  2. 任一动作在途时整块 dock 的动作按钮都禁用——宿主 `disabled: busy !== null` 的语义（#32-①）；
 *  3. 不留「JSX 挂了但 CSS 没有定义」的空类名（#32-②，`.ss-pending` 就是前车之鉴）；
 *  4. 不可用的原因走宿主那套分工（Tooltip `disabled` + 原生 `title`），不在 `aria-label` 里双写。
 *
 * 断言范围的纪律：凡是**计数类**（几处 tooltip、几个按钮引用 busy）都切到 `DockActions`
 * 函数体里数，不在整文件数。否则 dock-editor 给保存按钮加一层 Tooltip、或 task-5 把
 * 编辑行也接进单一 busy，都会变成**别人任务里的假失败**。全域禁令只留给
 * `ss-dock-tip` / `ss-pending` 这类「本次明确废除、不该再出现」的名字。
 *
 * 层级与气泡表现**已可静态核实**（primitives 的 `files` 收录了 `lib` 目录下的 `.css`，
 * `lib/Tooltip.module.css` 就在本机）：
 *   - `.bubble{position:fixed; z-index:100}`，`.bubble[data-portal]{z-index:1100}`
 *     → 我们传了 `portal`，档位与被删掉的自研气泡（1100）**一致**，不是丢失；
 *   - `max-width:50vw` + `white-space:pre-line` + `overflow-wrap:break-word`
 *     + `@keyframes tooltip-in` 150ms 与 `prefers-reduced-motion` 关闭——逐条同值；
 *   - 水平 clamp 与 bottom/top 翻转走 `edgeMargin = 12`，与自研实现的 12px 同算法。
 * 所以真机项只剩「遮挡表现」，不再需要核对数值。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

const component = read('client/components/ScheduleDock.tsx');
const styles = read('client/styles.ts');

/** 数一下 `needle` 出现的次数（用 split，避免正则转义噪音）。 */
const count = (haystack, needle) => haystack.split(needle).length - 1;

/**
 * `DockActions` 函数体的源码切片。
 *
 * 切到下一个**顶格**的顶层声明为止（顶格很关键：函数体内的 const/function 都带缩进，
 * 不会被误判为边界），所以将来在别人后面追加顶层符号也不会串味。
 */
const sliceFrom = (source, marker, label) => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `缺少 ${label}（${marker}）`);
  const rest = source.slice(start);
  const nextTop = /\n(?:function |const |export |\/\* =)/.exec(rest.slice(1));
  return nextTop ? rest.slice(0, nextTop.index + 1) : rest;
};

const actions = sliceFrom(component, 'function DockActions(', 'DockActions 函数');

test('tooltip 走 primitives 的 Tooltip，自研 DockTip 已彻底移除（#29）', () => {
  // 从 primitives 具名导入，且不再从 react-dom 走 portal
  assert.match(component, /Tooltip,\n\} from '@deepseek-ai\/dsh-client-ui-primitives'/);
  assert.doesNotMatch(component, /from 'react-dom'/, 'dock 内不应再直接用 createPortal（#29 改用 Tooltip 的 portal）');
  assert.doesNotMatch(component, /function DockTip\b/, '自研 DockTip 不得复活（#29）');
  assert.doesNotMatch(component, /<DockTip\b/, '自研 DockTip 不得复活（#29）');
  // 这两条**故意做成全域禁令**：ss-dock-tip 是 #29 明确废除的自研气泡类名，出现在任何
  // 位置都说明有人把 tooltip 又写回了自己实现，而不是说有人新加了一个正常样式。
  assert.doesNotMatch(component, /ss-dock-tip/, '自研气泡类名不得再出现（#29 的决定，非本次改动的 bug）');
  assert.doesNotMatch(styles, /\.ss-dock-tip\b|ss-dock-tip-in|ss-dock-tip-anchor/, '自研气泡 CSS 不得再出现（#29）');
});

test('Tooltip 参数与宿主 dock 一致：side bottom / delayMs 500 / portal', () => {
  // 计数只在动作区切片内做。源码里 5 个包裹：编辑 / 恢复 / 暂停 / 删除 / 插话；
  // 暂停与恢复互斥，所以任一行渲染 4 个。
  assert.equal(count(actions, '<Tooltip label='), 5, '动作区应有 5 处 Tooltip 包裹（暂停/恢复互斥）');
  assert.equal(count(actions, 'side="bottom" delayMs={500} portal'), 5);
  // 动作区这 5 处不自作焦点延迟与宽度上限（宿主 dock 两处都没传；50vw 上限由
  // Tooltip.module.css 自带）。别处要用 maxWidth 不受这条约束——所以禁令也只落在切片上。
  assert.doesNotMatch(actions, /focusDelayMs=\{/, '动作区 focusDelayMs 留默认 0，与宿主 dock 一致');
  assert.doesNotMatch(actions, /maxWidth=\{/, '动作区 maxWidth 留默认（Tooltip.module.css 已给 max-width:50vw）');
  // 层级由 Tooltip.module.css 承担：portal 档 1100，与被删的自研气泡同值（见文件头核实记录），
  // 所以这里禁的是「插件侧再自己声明一层」，而不是「层级无法得知」。
  assert.doesNotMatch(actions, /zIndex|z-index/, '层级归 Tooltip 自带，动作区不该再声明');
});

test('任一动作在途时整块 dock 的动作按钮都不可点（#32-① 全局 busy 锁）', () => {
  // busy 由现成的在途集合派生，不新增状态；且不纳入 cancelling（其清尾有 2.5s 延时）。
  // ⚠ task-5（单一 busy 收敛）**故意**会把这几条改写掉：那正是本测试想守住的取舍被
  //   推翻的时刻，请在改代码的同一次提交里显式更新这里，不要当假失败删掉断言。
  assert.match(
    component,
    /busy=\{steering\.size > 0 \|\| pausing\.size > 0 \|\| resuming\.size > 0 \|\| saving\}/,
    'busy 需覆盖插话/暂停/恢复/编辑保存四类在途',
  );
  assert.doesNotMatch(component, /busy=\{[^}]*cancelling/, 'cancelling 有 2.5s 清尾，不得进全局锁');
  // 四个动作全部引用 busy——只在动作区切片内数：dock-editor 若把保存按钮也接进 busy，
  // 该引用出现在编辑行（他的区），不该让这里的计数假失败。
  assert.equal(count(actions, 'disabled={busy'), 4, '编辑/恢复/删除/插话都要引用全局 busy');
  // 删除按钮此前「只写不读」：现在必须真正参与禁用
  assert.match(component, /disabled=\{busy \|\| cancellingNow\}/);
  assert.match(component, /cancellingNow=\{cancelling\.has\(item\.id\)\}/, 'cancelling 必须被读取，否则又是死状态');
  // 各自的行内在途标记仍叠加在 busy 之上（语义冗余但保留可读性）
  assert.match(component, /disabled=\{busy \|\| resumingNow\}/);
  assert.match(component, /disabled=\{!canPauseNow \|\| busy \|\| pausingNow\}/);
  assert.match(component, /disabled=\{busy \|\| steeringNow \|\| steerDone\}/);
});

test('不留空类名：ss-pending 在 JSX 与 CSS 里都已消失（#32-②）', () => {
  assert.doesNotMatch(component, /ss-pending/);
  assert.doesNotMatch(styles, /ss-pending/);
  // 在途反馈由 disabled 态承担，且与宿主的透明度口径一致
  assert.match(styles, /\.ss-dock-action:disabled \{ cursor: default; opacity: 0\.45; \}/);
});

test('不可用原因走 Tooltip disabled + 原生 title，不在 aria-label 双写', () => {
  // 宿主模式：Tooltip 抑制气泡，title 承载原因，aria-label 只留动作名
  assert.match(component, /<Tooltip label=\{t\.pauseTask\}[^>]*disabled=\{!canPauseNow\}/);
  assert.match(component, /title=\{canPauseNow \? undefined : t\.pauseUnsupportedKind\}/);
  assert.doesNotMatch(
    component,
    /aria-label=\{canPause\(item, now\) \? t\.pauseTask : t\.pauseUnsupportedKind\}/,
    'aria-label 不得再塞不可用原因',
  );
  assert.match(component, /aria-label=\{t\.pauseTask\}/);
});

test('动作区仍是同一层 DOM：四个按钮直接是 .ss-dock-actions 的子元素', () => {
  // Tooltip 用 cloneElement 注入 handler/ref，不插包装节点，所以 gap/flex 不受影响
  assert.match(component, /<div className="ss-dock-actions">/);
  assert.match(styles, /\.ss-dock-actions \{ display: flex; align-items: center; gap: 10px; flex: none; \}/);
  // 完成态的着色仍挂在动作按钮类上（自研气泡删除时容易顺手带歪这条规则）
  assert.match(styles, /\.ss-dock-action-steer\.ss-done \{ color: var\(--dsw-alias-state-success-primary\); \}/);
});

/** 取 styles.ts 里某条规则的源码片段（数组元素拼接，故按标记行切）。 */
const ruleSlice = (from, to) => {
  const start = styles.indexOf(from);
  const end = to === null ? styles.length : styles.indexOf(to);
  assert.notEqual(start, -1, `缺少规则 ${from}`);
  assert.ok(end > start, `规则 ${from} 之后找不到 ${to}`);
  return styles.slice(start, end);
};

test('#32 两条 CSS 像素漂移已对齐宿主：corner-shape 与两层描边（task-7）', () => {
  // ① .ss-dock-action 显式声明 corner-shape: round（宿主 ._action 有这条）。round 本就是
  //    该属性的初始值，所以这条是**逐字对齐**、不是视觉修复；断言只保证它存在且确实落在这条
  //    规则里，别被挪到别的规则上。
  assert.match(styles, /\.ss-dock-action \{',\n' {2}corner-shape: round;/);

  // ② 描边从 ::before 挪到 ::after，粗细改宿主 hairline；::before 只剩背景层。
  const beforeBlock = ruleSlice("'.ss-dock-body::before {", "'.ss-dock-body::after {");
  assert.doesNotMatch(beforeBlock, /border:/, '::before 只该画背景，不得再带描边');
  assert.match(beforeBlock, /background: var\(--dsw-specific-menu\)/);
  assert.match(beforeBlock, /backdrop-filter: var\(--dsw-menu-backdrop-filter\)/);
  assert.match(beforeBlock, /z-index: -1/);

  const afterBlock = ruleSlice("'.ss-dock-body::after {", "'.ss-dock-header");
  assert.match(afterBlock, /border: \.5px solid var\(--dsw-alias-border-l1\); border-bottom: none;/);
  assert.match(afterBlock, /border-radius: inherit/);
  assert.match(afterBlock, /position: absolute; inset: 0;/);
  assert.match(afterBlock, /pointer-events: none/);

  // dock 面板这两层里都不该再留 1px 的 alias-border-l1 描边（其它组件的 1px 不在此范围）
  assert.doesNotMatch(
    ruleSlice("'.ss-dock-body::before {", "'.ss-dock-header"),
    /border: 1px solid var\(--dsw-alias-border-l1\)/,
    'dock 面板描边必须是 .5px，与宿主一致',
  );
});
