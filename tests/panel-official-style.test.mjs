/**
 * 面板抬升面（issue #24）：逐项锁住 SchedPanel 用的是官方那套 elevation token。
 *
 * 背景：面板此前用 `--dsw-shadow-lv3` + `--dsw-alias-border-inverted` —— 那是**更早
 * 一个设计代次**的 token，混用让面板在浅色/深色下都偏离官方观感（截图里那个
 * 「灰底 + 重描边 + 旧阴影」的观感）。官方基线见
 * `@deepseek-ai/dsh-client-ui-schedule` 的 PickerPopover.module.css 与
 * primitives 的 MenuSurface.module.css。
 *
 * 这些是**纯文本断言**而非渲染断言：token 选错是肉眼可见但极难在测试里察觉的
 * 一类回归，写死字符串比搭 DOM 便宜且更直接。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/client/components/SchedPanel.tsx', import.meta.url), 'utf8');
const button = readFileSync(new URL('../src/client/components/SchedButton.tsx', import.meta.url), 'utf8');
const compat = readFileSync(new URL('../src/client/primitives-compat.ts', import.meta.url), 'utf8');

/** 取 `.ss-panel { … }` 的规则体（用于只断言该选择器，不牵连其他规则）。 */
function panelRule(css) {
  const match = /\.ss-panel \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(match !== null, '应能找到 .ss-panel 规则');
  return match[1];
}

test('面板抬升面用官方 elevation token，而非旧代次的 shadow-lv3 / border-inverted', () => {
  const rule = panelRule(styles);
  assert.match(rule, /--dsw-menu-surface-fill/, '背景应对齐官方菜单面');
  assert.match(rule, /--dsw-elevation-prominent/, '阴影应对齐官方 prominent elevation');
  assert.match(rule, /--dsw-menu-backdrop-filter/, '毛玻璃应对齐官方菜单模糊');
  assert.match(rule, /border-radius: var\(--dsw-radius-lg\)/, '圆角应对齐官方 16px 档');

  // 回归锁：这两个旧代次 token 不得再出现在面板抬升面上。
  assert.doesNotMatch(rule, /--dsw-shadow-lv3/, '面板不得回退到旧代次阴影');
  assert.doesNotMatch(rule, /--dsw-alias-border-inverted/, '面板不得回退到旧代次反色描边');
});

test('面板描边由 elevation-stroke 提供（0.5px 细线），不手写 1px border', () => {
  const rule = panelRule(styles);
  assert.match(rule, /--dsw-elevation-stroke-color/, '须给 elevation stroke 赋色');
  assert.match(rule, /border: 0/, '抬升描边应交给 elevation-stroke，border 归零');
});

test('面板 z-index / 层级为官方浮层档 1100', () => {
  const rule = panelRule(styles);
  assert.match(rule, /z-index: 1100/);
});

test('面板 portal 到 document.body，且不因无 document 而丢内容', () => {
  assert.match(panel, /createPortal\(panel, document\.body\)/, '面板应 portal 到 body');
  assert.match(panel, /typeof document === 'undefined'/, '需有非浏览器兜底分支');
});

test('定位与外部点击关闭走 primitives 探测层，不在组件里硬依赖具名导入', () => {
  // 具名 import 在目标导出缺失时是链接期硬失败，会让旧代次宿主直接加载不了。
  assert.match(compat, /namespace \+ 属性访问|不能用具名 import/, 'compat 层应写明具名 import 的风险');
  assert.match(compat, /pick<T>\(name: string\)/, '应经由 pick() 做特性探测');
  assert.doesNotMatch(
    panel,
    /import \{[^}]*useAnchoredPosition/,
    '组件不得直接具名导入官方锚定 hook',
  );
});

test('新旧代次都保留 Esc 关闭路径', () => {
  assert.match(compat, /useEscapeToClose/);
  assert.match(button, /useEscapeToClose\(open, setOpen\)/);
});

test('官方 outside-pointer 可用时不再渲染全屏 backdrop（旧代次仍保留）', () => {
  assert.match(button, /!hasOfficialOutsideDismiss && \(/, 'backdrop 应仅在兜底路径渲染');
  assert.match(button, /hasOfficialOutsideDismiss/, '需按探测结果分支');
});