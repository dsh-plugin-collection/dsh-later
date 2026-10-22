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

test('附件带在行首、正文左侧（与宿主 QueueDock 同位置）', () => {
  const rowAt = component.indexOf('data-ss-dock-row={item.id}');
  const bandAt = component.indexOf('<DockAttachments ');
  const previewAt = component.indexOf('<div className="ss-dock-preview">');
  const lineAt = component.indexOf('<div className="ss-dock-row-line">');
  const barAt = component.indexOf('<MultiBar item={item}');
  assert.ok(rowAt > 0 && bandAt > 0 && previewAt > 0 && lineAt > 0 && barAt > 0, '五个锚点都必须存在');
  // 顺序即结构：行 → 附件带 → 正文 → 进度条。附件必须在正文**之前**（同一行的左侧）。
  assert.ok(rowAt < bandAt && bandAt < previewAt, '附件带必须是 .ss-dock-row 的第一个子元素');
  assert.ok(previewAt < lineAt && lineAt < barAt, '正文与进度条仍在 preview 内，且正文先于条');
  /*
   * 单条时行首必须有 glyph —— 宿主 QueueDock.tsx:197 的 `rowCount === 1` 同款分支：
   * 多条时图标在计数 header 里，单条时 header 不渲染，行首空出来、左边缘与原生对不齐。
   * 三处一起锁：位置（行内第一个）、条件（只单条）、总数（别处不许再加第三个）。
   */
  const leadAt = component.indexOf('className="ss-dock-lead"');
  assert.ok(leadAt > 0 && leadAt < bandAt, '单条行的第一个子元素必须是 .ss-dock-lead');
  assert.match(component.slice(leadAt - 120, leadAt), /schedules\.length === 1 &&/,
    '行首 glyph 只能单条时出现（多条由 header 承担）');
  assert.equal(count(component, 'className="ss-dock-lead"'), 2,
    'lead 只该有两处：单条行内 + 计数 header');
  /*
   * 移到行首**新引入**的风险：附件带开始与正文抢横向了（旧的下方独占带不会）。
   * 所以必须锁收缩能力——挤不下时它自己缩并横向滚动，而不是把正文顶出可视区。
   * 这正是我们不照抄宿主 max-width:55% 的地方：宿主缩完是静默裁切，我们是可滚。
   */
  assert.match(styles, /\.ss-dock-attachments \{[^}]*flex: 0 1 auto/, '附件带必须可收缩（flex-shrink:1）');
  assert.match(styles, /\.ss-dock-attachments \{[^}]*min-width: 0/, '收缩需要 min-width:0，否则撑破容器');
  assert.match(styles, /\.ss-dock-attachments \{[^}]*overflow-x: auto/, '挤不下要可滚，不静默裁切');
});

test('无附件与只剩图片但没任何出图能力时，整带不渲染（不得留空容器）', () => {
  assert.match(band, /blocks === undefined \|\| blocks\.length === 0\) return null;/, '无附件键不出现时不渲染');
  assert.match(band, /const canResolve = loadImage !== undefined && sessionId !== undefined;/, '异步通道的能力判定只看两个可选注入');
  // 图片能不能出图 = 异步通道可用 **或** host_path 能换算成 URL（后者不依赖任何服务）。
  assert.match(band, /block\.host_path !== undefined && localMediaUrl\?\.\(block\.host_path\) !== undefined/,
    'host_path 通道必须同时要求「内核带出了路径」与「换算结果非 undefined」');
  assert.match(band, /blocks\.filter\(\(block\) => block\.kind === .file. \|\| imageRenderable\(block\)\)/,
    '两条通道都没有时只留文件 chip');
  assert.match(band, /shown\.length === 0\) return null;/, '只剩图片且两条通道都不通 → 整带不渲染');
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

test('拿不到服务时降级但不消失：能力缺失 / 待发送 / 真失败是三种形态', () => {
  // 能力缺失（这台宿主本来没这能力）→ 图片位不渲染，不刷「图片不可用」。
  assert.match(thumb, /if \(loadImage === undefined \|\| sessionId === undefined\) return null;/);
  // 读不到 → 退化成可读 chip，比宿主的无声占位多做一层，且按性质分两种：
  assert.match(thumb, /if \(failure !== null\) \{/);
  assert.match(thumb, /data-ss-attach=\{pending \? 'image-pending-send' : 'image-unavailable'\}/,
    '待发送（未被会话引用）与真失败必须分开渲染');
  assert.match(thumb, /classifyAttachmentFailure\(error\)/, '失败性质必须经分类器判定，不能在组件里猜字符串');
  assert.match(thumb, /fileSizeText\(block\.bytes\)/, '失败时仍显示大小');
});

test('缩略图先查宿主缓存（peekImageUrl），命中就不发请求', () => {
  assert.match(thumb, /const cached = peekImage\?\.\(sessionId, blockRef\.current\);/, '先同步 peek');
  assert.match(thumb, /if \(cached !== undefined\) \{/, '命中即用，不发请求');
  assert.match(entry, /peekImageUrl\?\(id: string/, 'index 侧通过可选 peekImageUrl 取缓存');
  assert.match(entry, /peekImage: peekAttachmentUrl/, 'peek 能力必须注入 dock');
});

test('localMediaUrl 走宿主自己的解析器，且基址在调用时读（#待发缩略图）', () => {
  // 不自己拼 `/api/file?path=`：用宿主 `fileMediaUrl`，宿主收紧规则时自动跟上。
  assert.match(entry, /import \{ fileMediaUrl \} from .@deepseek-ai\/dsh-util-workspace-path./,
    '必须复用宿主的解析器');
  assert.match(entry, /const localMediaUrl = \(path: string\): string \| undefined => fileMediaUrl\(document\.baseURI, path\);/,
    '基址取 document.baseURI（web 与桌面 dsh-app:// 两种形态由宿主判别）');
  assert.doesNotMatch(entry, /['"`]\/api\/file/, '禁止在插件里硬编码路由');
  assert.match(entry, /localMediaUrl,\s*\} as ScheduleDockInjected\)/, '必须注入 dock');
});

test('每块独立异步加载 + alive 标志，且依赖不能用块对象（dock 每秒 tick）', () => {
  assert.match(thumb, /let alive = true;/);
  assert.match(thumb, /alive = false;/, '卸载后不得 setState');
  assert.match(thumb, /\[attachmentId, sessionId, loadImage, localUrl\]\);/,
    '依赖必须是 attachment_id 而非 block 对象（localUrl 是稳定的派生字符串，可以进依赖）');
  assert.match(thumb, /const blockRef = useRef\(block\);/, '用 ref 拿最新块内容而不进依赖');
});

test('host_path 通道优先于异步通道，且不发无谓请求（待发附件唯一出图路）', () => {
  // 派生必须是「取 host_path 再换算」，不能整块参与渲染判断（dock 每秒 tick 造新对象）。
  assert.match(thumb, /const hostPath = block\.host_path;/, '只读 host_path，不读 block 对象');
  assert.match(thumb, /const localUrl = hostPath === undefined \? undefined : localMediaUrl\?\.\(hostPath\);/);
  // 顺序即正确性：host_path 命中就**不进** effect，否则待发附件会先跑一趟注定被拒的
  // readAttachment，把 failure 态写进去（表现为缩略图闪一下再变 chip）。
  assert.match(thumb, /if \(localUrl !== undefined\) return undefined;/, 'effect 里必须最先短路');
  const effectAt = thumb.indexOf('useEffect(() => {');
  const localReturnAt = thumb.indexOf('if (localUrl !== undefined) {\n    // `data-ss-attach`');
  assert.ok(effectAt > 0 && localReturnAt > effectAt, '渲染分支在 effect 之后（顺序无语义，仅锚定两段都在）');
  // 探针取值集合是锁住的验证接口（docs/notes/dock-alignment.md 第 8 条）：
  // host_path 产出的就是正常缩略图，**不得**为它新增 data-ss-attach 取值。
  assert.match(thumb, /data-ss-attach="image" src=\{localUrl\}/, '复用既有 image 探针取值');
  const values = new Set(
    [...thumb.matchAll(/data-ss-attach=(?:"([^"]+)"|\{[^}]*\})/g)].map((m) => m[1] ?? 'dynamic'),
  );
  assert.deepEqual([...values].sort(), ['dynamic', 'image', 'pending'],
    '取值集合仍是 image / pending / 那条二选一的 dynamic，没被扩写');
});

test('超出上限给 +N，且 a11y 有独立标签', () => {
  assert.match(band, /data-ss-attach="more"/);
  assert.match(band, /t\('attachmentMore', \{ n: extra \}\)/);
  assert.match(band, /\+\$\{extra\}/);
});

test('四个新词条 zh/en 双语齐全（注册源是 strings.ts，见 #28 双出口）', () => {
  for (const key of ['attachmentImage', 'attachmentFile', 'attachmentPendingSend', 'attachmentUnavailable', 'attachmentMore']) {
    assert.equal(count(strings, `${key}:`), 2, `${key} 必须 zh/en 各一条`);
  }
});

test('数据契约字段名与 #37 逐字一致', () => {
  assert.match(types, /export interface ClientAttachment \{/);
  for (const field of ['attachment_id', 'media_type', 'kind', 'name', 'bytes', 'width', 'height', 'host_path']) {
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
