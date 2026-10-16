/**
 * dock 行内附件带的源码级断言（Gitea issue #38）。
 *
 * 与仓库既有 dock 测试同风格：不引入 DOM/渲染库，锁的是「回退后没人会立刻看见」的
 * 性质。本文件尤其要锁两类东西：
 *
 *  1. **宿主取值不被自己发明掉**——缩略图/文件 chip 的每个数值都对照
 *     dsh-client-ui-conversation 的 QueueDock.module.css（.thumb / .file /
 *     .fileIcon / .fileName / .fileSize）；
 *  2. **两条事故换来的硬约束**——`uiConversation` 不得进模块级 inject（#34：顶层
 *     inject 是激活门控，服务缺失会让整个插件永久 pending、`/later` 集体消失）；
 *     传给宿主 `imageUrl` 的必须是 camelCase 的引用形状（wire 是 snake_case，
 *     直接透传会让宿主按 attachmentId 取缓存键拿到 undefined，表现为串图或永远加载不出来）。
 *
 * 计数类断言一律在**切片**内做（见 sliceFrom），不做全域禁令——上一轮已有队员因为
 * 整文件计数把别人的正常改动判成假失败。
 * @module tests/dock-attachments
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

const component = read('client/components/ScheduleDock.tsx');
const styles = read('client/styles.ts');
const entry = read('client/index.tsx');
const strings = read('client/strings.ts');
const types = read('client/types.ts');

/** 数一下 needle 出现的次数。 */
const count = (haystack, needle) => haystack.split(needle).length - 1;

/**
 * 从 marker 起切到下一个**顶格**声明（`function ` 或文档块 `/**`）为止。
 *
 * ⚠️ 不要用「切到第一个顶格 `}`」的写法：这两个组件的签名是解构形
 * （`function X({ a, b }: {...}): T {`），`}: {` 那行的 `}` 就在列 0，
 * 会把切片截成几乎为空——本文件第一版就是这么静默切空的，四条断言全红才发现。
 */
function sliceFrom(source, marker, label) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `找不到 ${label}`);
  const rest = source.slice(start + marker.length);
  const end = rest.search(/^function |^\/\*\*/m);
  return end === -1 ? rest : rest.slice(0, end);
}

const band = sliceFrom(component, 'function DockAttachments(', 'DockAttachments');
const thumb = sliceFrom(component, 'function DockThumb(', 'DockThumb');

test('附件带是正文的兄弟节点，且排在进度条之前（三带结构）', () => {
  const rowLine = component.indexOf('<div className="ss-dock-row-line">');
  const bandAt = component.indexOf('<DockAttachments ');
  const barAt = component.indexOf('<MultiBar item={item}');
  assert.ok(rowLine > 0 && bandAt > 0 && barAt > 0, '三个锚点都必须存在');
  // 顺序即结构：正文带 → 附件带 → 进度条。附件排在 MultiBar 之前，进度条才不会被挤出可视区。
  assert.ok(rowLine < bandAt && bandAt < barAt, '必须是 正文 / 附件 / 进度条 的顺序');
  // 兄弟而非嵌套：附件带不能出现在 .ss-dock-row-line 内部（否则它会跟正文抢横向）。
  const lineClose = component.indexOf('</div>', rowLine);
  assert.ok(lineClose > 0 && lineClose < bandAt, '附件带必须在正文带闭合之后（兄弟节点）');
});

test('无附件与只剩图片但没解析能力时，整带不渲染（不得留空容器）', () => {
  assert.match(band, /blocks === undefined \|\| blocks\.length === 0\) return null;/, '无附件键不出现时不渲染');
  assert.match(band, /const canResolve = loadImage !== undefined && sessionId !== undefined;/, '能力判定只看两个可选注入');
  assert.match(band, /blocks\.filter\(\(block\) => block\.kind === .file.\)/, '没能力时只留文件 chip');
  assert.match(band, /shown\.length === 0\) return null;/, '只剩图片且没能力 → 整带不渲染');
});

test('缩略图与文件 chip 的取值逐条照抄宿主，不许自己发明', () => {
  const thumbRule = /\.ss-dock-thumb \{([^}]*)\}/.exec(styles);
  assert.ok(thumbRule !== null, 'styles.ts 要有 .ss-dock-thumb');
  for (const [needle, why] of [
    ['width: 24px; height: 24px', '宿主 .thumb 尺寸'],
    ['object-fit: cover', '宿主 .thumb'],
    ['.5px solid var(--dsw-alias-border-l1)', '宿主 .thumb 的亚像素描边（不是 1px）'],
    ['border-radius: var(--dsw-radius-xs)', '宿主 .thumb 圆角档'],
  ]) {
    assert.ok(thumbRule[1].includes(needle), `${why} 应为 ${needle}`);
  }

  const fileRule = /\.ss-dock-file \{([^}]*)\}/.exec(styles);
  assert.ok(fileRule !== null, 'styles.ts 要有 .ss-dock-file');
  for (const [needle, why] of [
    ['flex: 0 180px', '宿主 .file 原值——初稿曾自作主张收紧到 120px，已撤回'],
    ['min-width: 74px', '宿主 .file'],
    ['height: 24px', '宿主 .file'],
    ['border-radius: var(--dsw-radius-sm)', '宿主 .file'],
    ['gap: 4px', '宿主 .file'],
  ]) {
    assert.ok(fileRule[1].includes(needle), `${why} 应为 ${needle}`);
  }

  // 带容器：横向铺开 + 可滚动。宿主是 max-width:55% + overflow:hidden（静默裁切），
  // 我们附件独占一带、横向不紧张，所以既不照抄 55% 也不照抄 hidden。
  const bandRule = /\.ss-dock-attachments \{([^}]*)\}/.exec(styles);
  assert.ok(bandRule !== null, 'styles.ts 要有 .ss-dock-attachments');
  assert.ok(bandRule[1].includes('flex-wrap: nowrap'), '一行铺开，不折行');
  assert.ok(bandRule[1].includes('overflow-x: auto'), '超出可滚动，不像宿主那样静默裁切');
  assert.ok(!bandRule[1].includes('max-width'), '不得引入宿主的 55% 折中');
});

test('传给宿主 imageUrl 的必须是 camelCase 引用形状（wire 是 snake_case）', () => {
  const loader = sliceFrom(entry, 'const loadAttachmentUrl = (', 'loadAttachmentUrl');
  assert.match(loader, /attachmentId: ref\.attachment_id/, '必须显式把 attachment_id 映射成 attachmentId');
  // 反向锁：不许把 wire 对象整个透传——宿主按 camelCase 取键，透传会拿到 undefined。
  assert.doesNotMatch(loader, /imageUrl\(sessionId, ref\)/, '禁止直接透传 snake_case 的 wire 对象');
  assert.match(loader, /mediaType: ref\.media_type/, 'media_type 同样要转换');
});

test('uiConversation 绝不进模块级 inject（#34 事故的复发防线）', () => {
  const decl = /(?:export )?const inject = \[([^\]]*)\]/.exec(entry);
  assert.ok(decl !== null, 'index.tsx 必须有模块级 inject');
  const names = [...decl[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
  assert.ok(!names.includes('uiConversation'), '顶层 inject 是激活门控，列进去会让整个插件永久 pending');
  // 只能走可选 get（或嵌套 inject）。
  assert.match(entry, /ctx\.get\('uiConversation'\)/, '必须用可选 get 取该服务');
});

test('拿不到服务时降级但不消失：能力缺失与读失败是两种形态', () => {
  // 能力缺失（这台宿主本来没这能力）→ 图片位不渲染，不刷「图片不可用」。
  assert.match(thumb, /if \(loadImage === undefined \|\| sessionId === undefined\) return null;/);
  // 读失败（本该有却拿不到）→ 退化成可读 chip，比宿主的无声占位多做一层。
  assert.match(thumb, /if \(failed\) \{/);
  assert.match(thumb, /data-ss-attach="image-unavailable"/);
  assert.match(thumb, /fileSizeText\(block\.bytes\)/, '失败时仍显示大小');
});

test('每块独立异步加载 + alive 标志，且依赖不能用块对象（dock 每秒 tick）', () => {
  assert.match(thumb, /let alive = true;/);
  assert.match(thumb, /alive = false;/, '卸载后不得 setState');
  assert.match(thumb, /\[attachmentId, sessionId, loadImage\]\);/, '依赖必须是 attachment_id 而非 block 对象');
  assert.match(thumb, /const blockRef = useRef\(block\);/, '用 ref 拿最新块内容而不进依赖');
});

test('超出上限给 +N，且 a11y 有独立标签', () => {
  assert.match(band, /data-ss-attach="more"/);
  assert.match(band, /t\('attachmentMore', \{ n: extra \}\)/);
  assert.match(band, /\+\$\{extra\}/);
});

test('四个新词条 zh/en 双语齐全（注册源是 strings.ts，见 #28 双出口）', () => {
  for (const key of ['attachmentImage', 'attachmentFile', 'attachmentUnavailable', 'attachmentMore']) {
    assert.equal(count(strings, `${key}:`), 2, `${key} 必须 zh/en 各一条`);
  }
});

test('数据契约字段名与 #37 逐字一致', () => {
  assert.match(types, /export interface ClientAttachment \{/);
  for (const field of ['attachment_id', 'media_type', 'kind', 'name', 'bytes', 'width', 'height']) {
    assert.match(types, new RegExp(`readonly ${field}\\??:`), `ClientAttachment 缺字段 ${field}`);
  }
  assert.match(types, /readonly attachments\?: readonly ClientAttachment\[\]/, '无附件时键不出现（可选）');
  assert.match(types, /readonly attachments_total\?: number/);
});

test('高度守护：列表 max-height 与纵向滚动不得被改小', () => {
  const listRule = /\.ss-dock-list \{([^}]*)\}/.exec(styles);
  assert.ok(listRule !== null, 'styles.ts 要有 .ss-dock-list');
  assert.match(listRule[1], /max-height: 180px/, '附件带让行变高，列表必须仍可滚');
  assert.match(listRule[1], /overflow-y: auto/);
  // 正文仍必须可截断：附件带不得反向挤占 line 1。
  const promptRule = /\.ss-dock-row-prompt \{([^}]*)\}/.exec(styles);
  assert.ok(promptRule !== null, 'styles.ts 要有 .ss-dock-row-prompt');
  assert.match(promptRule[1], /min-width: 0/);
  assert.match(promptRule[1], /text-overflow: ellipsis/);
});
