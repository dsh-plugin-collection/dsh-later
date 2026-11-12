/**
 * 面板锚定三档后端的守护（issue #158）。
 *
 * ## 钉住什么
 *
 * 1. **分派规则**：`hook` / `css-anchor` / `static` 三档的判定，以及**两个 API 同时存在时
 *    选 `hook`** —— 这不是假想情形：`0.2.2-rc.1` 的发布包两个都导出。
 * 2. **真实发布包上的结论**：用 registry 上两个代次的原包导出面，断言「rc.1 有
 *    `useAnchoredPosition`」「rc.2 没有、替代面是 `useAnchoredMaxHeight` + `usePointerGrace`」。
 * 摘录存放在 `tests/fixtures/anchor-backends/`，来源与复核命令见那里的 README。
 * 3. **CSS 契约**：`.ss-panel` 必须留 `bottom: auto`；`anchor-name` 不加引号；面板侧的内联
 *    几何对齐官方 `Menu.module.css` 的写法。
 *
 * ## 为什么这么测（而不是读源码 + 正则）
 *
 * 分派结论是**模块加载期**算出来的常量（`PANEL_ANCHOR_BACKEND`），所以想对不同的宿主断言，
 * 只能在加载时换掉 `require('@deepseek-ai/dsh-client-ui-primitives')` 的返回值。做法与
 * `tests/hover-card.test.mjs` 的 `loadClientBundle` 同款：执行 bundle 拿到 factory，
 * 用桩 require 调它；每次需要不同宿主就重新执行一遍。
 *
 * 读的是 `lib/client.js` 而不是 `src/`：这条路径要的是「esbuild 之后真正跑的那份代码」。
 * `npm test` 的前置步骤会先构建（见 `scripts/run-tests.mjs`）；没构建时这里 skip 而不是假绿。
 * @module tests/panel-anchor-backends
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const distIndex = join(repoRoot, 'lib', 'client.js');
const HAVE_DIST = existsSync(distIndex);
const skip = HAVE_DIST ? false : 'lib/client.js 不在（先跑 npm run build）';

/**
 * 用给定宿主导出面加载一份 compat 层。
 *
 * @param {Record<string, unknown>} hostExports - 假装宿主导出（命名空间成员）。
 * @returns {Record<string, any>} bundle 的模块导出。
 */
function loadBundle(hostExports) {
  const src = readFileSync(distIndex, 'utf8');
  let captured;
  globalThis.window = globalThis.window ?? {};
  const previousLoader = globalThis.window.__ModuleLoader__;
  globalThis.window.__ModuleLoader__ = { load: (def) => { captured = def; } };
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', src)(globalThis.window);
  } finally {
    globalThis.window.__ModuleLoader__ = previousLoader;
  }
  if (captured === undefined) throw new Error('bundle did not register a module');

  const require = (id) => {
    if (id === 'react') {
      return {
        createElement: () => null,
        Fragment: () => null,
        useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
        useEffect: () => {},
        useLayoutEffect: () => {},
        useMemo: (f) => f(),
        useCallback: (f) => f,
        useRef: (v) => ({ current: v }),
        useSyncExternalStore: (_sub, get) => get(),
      };
    }
    if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') {
      return { jsx: () => null, jsxs: () => null, Fragment: () => null };
    }
    if (id === 'react-dom' || id === 'react-dom/client') {
      return { createPortal: () => null, createRoot: () => ({ render() {}, unmount() {} }) };
    }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      // 真实宿主导出面是含静态导出的普通对象；esbuild 的 `import * as ns` 会把它摊平。
      return new Proxy({ ...hostExports }, {
        get: (target, name) => (typeof name === 'string' && name.startsWith('Icon') ? () => null : target[name]),
      });
    }
    throw new Error(`unexpected host require: ${id}`);
  };
  return captured.factory(require);
}

/**
 * 探针。`PANEL_ANCHOR_BACKEND` 在模块加载期就算好了，所以**每个用例都要重新加载**
 * 一份 bundle，再通过 `__panelAnchorProbeForTest` 对同一份宿主面判一遍。
 */
const probeOf = (hostExports) => loadBundle(hostExports).__panelAnchorProbeForTest(hostExports);
const backendOf = (hostExports) => probeOf(hostExports).backend;

const fixture = (name) => readFileSync(join(repoRoot, 'tests', 'fixtures', 'anchor-backends', name), 'utf8');

/** 把 d.ts 的导出行摘录还原成「名字 → 可调用桩」的导出面。 */
const surfaceOf = (text) => Object.fromEntries(
  [...text.matchAll(/^export \{ (\w+) \}/gm)].map(([, name]) => [name, () => undefined]),
);

test('分派：老代次导出 → hook', { skip }, () => {
  assert.equal(backendOf({ useAnchoredPosition: () => null }), 'hook');
});

test('分派：只有 rc.2 的替代导出 → css-anchor', { skip }, () => {
  assert.equal(backendOf({ useAnchoredMaxHeight: () => 1 }), 'css-anchor');
});

test('分派：两个 API 都在时 useAnchoredPosition 优先（两套坐标系不能混用）', { skip }, () => {
  assert.equal(
    backendOf({ useAnchoredPosition: () => null, useAnchoredMaxHeight: () => 1 }),
    'hook',
  );
});

test('分派：两样都没有 → static（不崩在缺失导出上）', { skip }, () => {
  assert.equal(backendOf({}), 'static');
  assert.equal(backendOf({ useAnchoredPosition: 'not-a-function' }), 'static');
});

test('真实发布包导出面：rc.1 有 useAnchoredPosition，rc.2 没有但有替代面', { skip }, () => {
  const rc1 = fixture('primitives-0.2.2-rc.1-exports.txt');
  const rc2 = fixture('primitives-0.2.2-rc.2-exports.txt');

  assert.match(rc1, /export \{ useAnchoredPosition \}/, 'rc.1 的发布包应导出 useAnchoredPosition');
  assert.doesNotMatch(rc2, /useAnchoredPosition/, 'rc.2 的发布包已删除 useAnchoredPosition');
  assert.match(rc2, /export \{ useAnchoredMaxHeight \}/, 'rc.2 应导出替代面 useAnchoredMaxHeight');
  assert.match(rc2, /export \{ usePointerGrace \}/, 'rc.2 另一枚替代面是 usePointerGrace');

  const rc1Surface = surfaceOf(rc1);
  const rc2Surface = surfaceOf(rc2);
  // rc.1 **两个都导出** —— 所以「同时探到优先谁」是 rc.1 的真实形态，不是假想。
  assert.deepEqual(Object.keys(rc1Surface).sort(),
    ['useAnchoredMaxHeight', 'useAnchoredPosition', 'useDismissOnOutsidePointer']);
  assert.deepEqual(Object.keys(rc2Surface).sort(),
    ['useAnchoredMaxHeight', 'useDismissOnOutsidePointer', 'usePointerGrace']);

  assert.equal(backendOf(rc1Surface), 'hook');
  assert.equal(backendOf(rc2Surface), 'css-anchor');
});

test('锚点名不加引号（引号会被 React 原样写进 DOM，浏览器就认不出 dashed-ident）', { skip }, () => {
  const { anchorName, trigger } = probeOf({ useAnchoredMaxHeight: () => 1 });
  assert.match(anchorName, /^--/);
  assert.doesNotMatch(anchorName, /['"]/);
  assert.deepEqual(trigger, { anchorName });
});

test('css-anchor 行内几何：贴锚点上沿、视口夹取，写法对齐官方 Menu.module.css', { skip }, () => {
  const { anchorName, panel } = probeOf({ useAnchoredMaxHeight: () => 1 });
  assert.equal(panel.positionAnchor, anchorName);
  assert.equal(panel.bottom, 'max(12px, calc(anchor(top) + 4px))');
  assert.equal(panel.left, 'max(12px, anchor(left))');
  // `top: auto` 不是装饰：上沿锚定时它必须让位给 bottom，否则 top+bottom 一起把高度拉成 auto。
  assert.equal(panel.top, 'auto');
  assert.equal(panel.right, 'auto');
});

test('.ss-panel 必须留 bottom:auto：否则 css-anchor 档的 top+height 定不住下沿', () => {
  const styles = readFileSync(join(repoRoot, 'src', 'client', 'styles.ts'), 'utf8');
  const match = /'\.ss-panel \{',\n([\s\S]*?)\n'\}'/.exec(styles);
  assert.ok(match !== null, '应能找到 .ss-panel 规则');
  assert.match(match[1], /position: fixed/, '面板须脱离文档流');
  assert.match(match[1], /bottom: auto/, '下沿默认必须 auto');
  assert.match(match[1], /top: auto/, '上沿默认必须 auto');
});

test('面板与触发元素都走 compat 层分派，不在组件里按具名导出写死分支', () => {
  const panel = readFileSync(join(repoRoot, 'src', 'client', 'components', 'SchedPanel.tsx'), 'utf8');
  const button = readFileSync(join(repoRoot, 'src', 'client', 'components', 'SchedButton.tsx'), 'utf8');
  assert.match(panel, /PANEL_ANCHOR_BACKEND/, '面板要按后端分派样式');
  assert.doesNotMatch(panel, /hasOfficialAnchoredPosition/, '旧的二档标志不应再决定面板样式');
  assert.match(button, /usePanelAnchorTriggerStyle/, '触发元素要让出 anchor-name');
});
