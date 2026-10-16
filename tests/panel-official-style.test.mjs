/**
 * 「对齐官方」的纯文本断言集：面板抬升面（issue #24）+ dock 行内编辑（issue #30）。
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
const dock = readFileSync(new URL('../src/client/components/ScheduleDock.tsx', import.meta.url), 'utf8');

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

/** 取 `.ss-dock-edit-input { … }` 的规则体（只断言该选择器，不牵连别的规则）。 */
function editInputRule(css) {
  // 规则体在 styles.ts 里是数组元素，闭合行是 `'}',` —— 收尾必须含那个前引号。
  const match = /\.ss-dock-edit-input \{([\s\S]*?)\n'\}',/.exec(css);
  assert.ok(match !== null, '应能找到 .ss-dock-edit-input 规则');
  return match[1];
}

/**
 * 取 `DockEditor` 组件体（只断言编辑器本身，不牵连动作按钮区）。
 *
 * 贪婪到文件里最后一个行首 `}`：DockEditor 是本模块最后一个声明。用非贪婪会在
 * props 解构那行的 `}: {` 处提前截断，断言就全落在半截函数体上。
 */
function dockEditorBody(src) {
  const match = /function DockEditor\([\s\S]*\n\}/.exec(src);
  assert.ok(match !== null, '应能找到 DockEditor 组件');
  return match[0];
}

test('行内编辑是 textarea、自适应高度照宿主算法，且没有客户端长度上限', () => {
  const body = dockEditorBody(dock);
  assert.match(body, /<textarea/, '必须是 textarea：单行 input 会吃掉多行正文的换行');
  assert.match(body, /rows=\{1\}/, '起始一行，随内容增高');
  assert.match(body, /useLayoutEffect/, '高度回填要在布局阶段，避免可见跳动');
  assert.match(body, /node\.style\.height = 'auto'/, '宿主算法第一步：先归零再量');
  assert.match(body, /node\.scrollHeight \+ node\.offsetHeight - node\.clientHeight/,
    '高度 = 内容高 + 边框/内边距差额（与宿主 QueueEditor 逐字一致）');
  assert.doesNotMatch(body, /maxLength=/, '客户端不得截断：长度上限只有 host 一处（commands.ts resolveSettings）');
});

test('Enter 保存挡住输入法组合态与 Shift 换行，Esc 取消，且不再掐冒泡', () => {
  const body = dockEditorBody(dock);
  assert.match(body, /event\.nativeEvent\.isComposing/,
    '必须挡 IME 组合态：否则中文按 Enter 上屏就把半截正文提交掉（#30 核心缺陷）');
  assert.match(body, /event\.shiftKey/, 'Shift+Enter 换行、不提交');
  assert.match(body, /event\.preventDefault\(\)/, 'Enter 保存要阻止 textarea 往正文里插换行');
  assert.match(body, /'Escape'/, 'Esc 取消');
  assert.doesNotMatch(body, /stopPropagation/,
    '不得 stopPropagation：对 composer（绑在草稿编辑器元素）与捕获阶段的全局快捷键都无效，' +
    '却会掐掉宿主 document 冒泡阶段的 Esc/dismiss 监听');
});

test('编辑框描边圆角走官方 token，高度交给 min/max clamp', () => {
  const rule = editInputRule(styles);
  assert.match(rule, /border: \.5px solid var\(--dsw-alias-border-l4\)/, '官方 .5px 细描边 + l4');
  assert.match(rule, /border-radius: var\(--dsw-radius-sm\)/, '圆角走 token，不写字面 6px');
  assert.match(rule, /min-height: 28px/);
  assert.match(rule, /max-height: 127px/, '上限交 CSS clamp，到顶后 textarea 自己滚动');
  assert.match(rule, /resize: none/);
  assert.doesNotMatch(rule, /(?<!min-)height: 28px/, '固定 height 会顶死 JS 回填的自适应高度');
  assert.doesNotMatch(rule, /border-radius: 6px/, '不得回退到字面圆角');
  assert.doesNotMatch(rule, /border: 1px solid var\(--dsw-alias-border-l2\)/, '不得回退到 1px/l2');
});

test('本地文案覆盖只给暂停项，未暂停项以投影为准', () => {
  const match = /const submitEdit = \(item: ClientSchedule\)([\s\S]*?)\n  \};/.exec(dock);
  assert.ok(match !== null, 'submitEdit 应接收整条任务（需要 status 才能分支）');
  assert.match(match[1], /if \(item\.status === 'paused'\) \{[\s\S]*?setPromptOverrides/,
    '只有暂停项写本地覆盖：它的编辑不写会话事件，没有新投影帧');
  // 全函数里只允许这一处 setPromptOverrides，且必须在 paused 分支内：
  // 未暂停项若也无条件盖本地文案，被 host 拒绝时界面就谎称「已改好」。
  const writes = (match[1].match(/setPromptOverrides/g) ?? []).length;
  assert.equal(writes, 1, 'submitEdit 里只应有一处 setPromptOverrides，且在暂停分支内');
});

