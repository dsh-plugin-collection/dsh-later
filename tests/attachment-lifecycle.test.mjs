/**
 * 附件生命周期回归矩阵（Gitea issue #39）。
 *
 * 附件的**存储**与**显示**分属两套持久化：任务在投影（projcache，按事件推进），
 * 附件在 ownership sidecar（按文件读写）。两者生命周期不同步，正是最容易出
 * "看起来丢了其实没丢 / 看起来在其实失效"的地方。本文件锁 wire→客户端→DOM 这一跳，
 * 以及一个更根本的机制问题：**手写镜像的类型不会自动同步**。
 *
 * 三处与初版矩阵不同的口径（来自 #39 的更正评论，都是实测结论）：
 *  - 第 7 项不是「list 与 wire 互比」，而是「各自与 ownership sidecar 对齐」——
 *    `ScheduleRecordView` 从来没有 attachments，两面互比会**反向变红**；
 *  - `userScheduleList` 只遍历 `folded.active`，**暂停项在 agent 面连条目都不存在**，
 *    所以断言 list 时不把 paused 算进期望值；
 *  - 第 8 项的 wire 侧（无附件时键不出现）已由 #37 覆盖，本文件只补 DOM 侧。
 *
 * 断言风格沿用本仓既有的源码级 + 行为级混合（`dock-attachments.test.mjs`、
 * `projection.test.mjs` 是模板）。计数/形状类断言一律限定在**函数体切片**内，
 * 不做全域禁令——上一轮已有队员因整文件计数把别人的正常改动判成假失败。
 * 锚点用函数名 / 类型名 / CSS 选择器，**不写绝对行号**（同批文件会被并行修改）。
 * @module tests/attachment-lifecycle
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyUserScheduleProjection,
  initUserScheduleProjection,
  viewUserScheduleProjection,
} from '../lib/projection.js';
import { OWNED_EVENT } from '../lib/domain.js';
import {
  recordOwnership,
  recordPaused,
  resetCacheForTests,
  sanitizeAttachments,
} from '../lib/ownership-store.js';
import { serializeScheduleView } from '../lib/user-tools.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

const read = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

const component = read('client/components/ScheduleDock.tsx');
const styles = read('client/styles.ts');
const userTools = read('user-tools.ts');
const runtime = read('runtime.ts');
const projection = read('projection.ts');
const domain = read('domain.ts');

/**
 * 从 marker 起切到下一个**顶格** `function ` 或文档块 `/**` 为止。
 * ⚠️ 不要用「切到第一个顶格 `}`」：解构形签名的 `}: {` 那行 `}` 就在列 0，
 * 会把切片静默截空（本仓已有测试第一版就是这么四条全红才发现的）。
 */
function sliceFrom(source, marker, label) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `找不到 ${label}`);
  const rest = source.slice(start + marker.length);
  const end = rest.search(/^function |^\/\*\*/m);
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * 取 styles.ts 里某条规则的**体**。
 * 闭合必须写 `\n'}`：CSS 是字符串数组，收尾行是 `'}',`。找 `\n\}` 会一路吃到
 * 数组末尾的 `}`，把整份文件当成规则体——`panelRule()` 就栽过，三条 elevation
 * 断言的作用域因此是虚的（锁的其实是注释位置）。
 */
function cssRule(source, selector, label) {
  const at = source.indexOf(`'${selector} {`);
  assert.notEqual(at, -1, `styles.ts 里找不到规则 ${label}`);
  const rest = source.slice(at);
  const end = rest.indexOf("\n'}");
  assert.notEqual(end, -1, `规则 ${label} 的闭合不是预期的 \\n'}'`);
  return rest.slice(0, end);
}

// ── 夹具 ────────────────────────────────────────────────────────────────────

const IMG = (n) => ({
  type: 'image',
  attachment: { attachmentId: `img-${n}`, mediaType: 'image/png', bytes: 100 + n, width: 8, height: 8 },
});
const FILE = (n) => ({
  type: 'file',
  attachment: { attachmentId: `file-${n}`, name: `log-${n}.txt`, bytes: 200 + n },
});

const schedule = (id, at = '2999-01-01T06:00:00.000Z') => ({
  id,
  kind: 'at',
  prompt: '带图提醒',
  scheduledAt: at,
});
const createEvent = (s, seq) => ({
  type: 'schedule/change',
  seq,
  time: 0,
  data: { version: 1, operation: 'create', schedule: s },
});
const ownedEvent = (id, seq) => ({
  type: OWNED_EVENT,
  seq,
  time: 0,
  data: { version: 1, operation: 'add', id },
});
const deleteEvent = (id, seq) => ({
  type: 'schedule/change',
  seq,
  time: 0,
  data: { version: 1, operation: 'delete', id },
});

/** 把若干 active 任务折进投影并返回 wire（**不**写 sidecar）。 */
function foldActive(sessionId, ids, extraEvents = []) {
  let state = initUserScheduleProjection({ id: sessionId });
  let seq = 0;
  for (const event of [...extraEvents, ...ids.flatMap((id) => [createEvent(schedule(id), seq++), ownedEvent(id, seq++)])]) {
    state = applyUserScheduleProjection(state, event) ?? state;
  }
  return viewUserScheduleProjection(state).schedules;
}

/** 当前状态目录里该会话的 sidecar 文件路径（文件名被消毒过，所以扫目录）。 */
function sidecarFile(dir, sessionId) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const hit = files.find((f) => f.includes(sessionId.replace(/[^a-z0-9]/gi, '').slice(0, 12))
    || f === `${sessionId}.json`);
  assert.ok(hit, `sidecar 文件必须落盘（目录里有：${files.join(', ') || '空'}）`);
  return join(dir, hit);
}

// ── 1 重启持久 ──────────────────────────────────────────────────────────────

test('带 2 图的提醒：丢空缓存后 wire 仍带出同一批附件，且 sidecar 确实落盘（#39-1）', () => {
  const dir = freshOwnershipDir();
  const sid = 'session-39-restart';
  recordOwnership(sid, 'schedule-1', 'user', undefined, undefined, [IMG(1), IMG(2)]);

  const first = foldActive(sid, ['schedule-1'])[0];
  assert.deepEqual(first.attachments.map((a) => a.attachment_id), ['img-1', 'img-2']);
  assert.ok(existsSidecar(dir, sid), 'sidecar 必须是磁盘文件——重启后的可读性是这条的生命线');

  // 模拟进程重启：内存缓存全丢，只靠磁盘重读。
  resetCacheForTests();
  const again = foldActive(sid, ['schedule-1'])[0];
  assert.deepEqual(again.attachments, first.attachments, '重启前后 wire 必须逐字段相同');
});

function existsSidecar(dir, sessionId) {
  return readdirSync(dir).some((f) => f.endsWith('.json'));
}

// ── 2 pause → resume ────────────────────────────────────────────────────────

test('暂停项在 wire 里带出冻结的附件；恢复出的新条目同样带（#39-2）', () => {
  freshOwnershipDir();
  const sid = 'session-39-pause';
  recordPaused(sid, {
    uid: 'uid-paused-1',
    prompt: '带图提醒',
    delivery: 'user',
    kind: 'after',
    remainingSeconds: 300,
    originalScheduledAt: '2999-01-01T06:00:00.000Z',
    originalAfterSeconds: 600,
    lastScheduleId: 'schedule-1',
    pausedAt: Date.now(),
    attachments: [IMG(1)],
  });
  // view 以 sidecar 为准重读 paused（不依赖事件），所以空投影也必须能读出暂停项。
  const paused = viewUserScheduleProjection(initUserScheduleProjection({ id: sid }))
    .schedules.find((s) => s.status === 'paused');
  assert.ok(paused, '暂停项必须出现在 wire 里');
  assert.equal(paused.attachments?.[0]?.attachment_id, 'img-1', '冻结的附件要随暂停项带出（#38 的附件带依赖它）');

  // resume 的真实形状：新 schedule id + 同一批附件的 ownership。
  recordOwnership(sid, 'schedule-2', 'user', 'uid-paused-1', 600, [IMG(1)]);
  const resumed = foldActive(sid, ['schedule-2'])[0];
  assert.equal(resumed.attachments?.[0]?.attachment_id, 'img-1');
});

// ── 3 edit ──────────────────────────────────────────────────────────────────

test('edit 跨「删旧建新」：旧项消失、新项带同一批附件（#39-3）', () => {
  freshOwnershipDir();
  const sid = 'session-39-edit';
  recordOwnership(sid, 'schedule-old', 'user', undefined, undefined, [FILE(1)]);
  recordOwnership(sid, 'schedule-new', 'user', undefined, undefined, [FILE(1)]);

  // 事件顺序即语义：先有旧项，再删旧，最后建新。反过来排会 fold 成两行（我第一版
  // 就是把 extraEvents 前置，delete 落在 create 之前，测出个假缺陷）。
  const events = [
    createEvent(schedule('schedule-old'), 0),
    ownedEvent('schedule-old', 1),
    deleteEvent('schedule-old', 2),
    createEvent(schedule('schedule-new'), 3),
    ownedEvent('schedule-new', 4),
  ];
  let state = initUserScheduleProjection({ id: sid });
  for (const event of events) state = applyUserScheduleProjection(state, event) ?? state;

  const items = viewUserScheduleProjection(state).schedules;
  assert.equal(items.length, 1, '旧项必须已被删掉（只建新不删旧会留下双行）');
  assert.equal(items[0].id, 'schedule-new');
  assert.equal(items[0].attachments?.[0]?.attachment_id, 'file-1');
});

// ── 4 多次写法 ──────────────────────────────────────────────────────────────

test('多次写法：每条任务各自带出附件，引用逐条独立（#39-4）', () => {
  freshOwnershipDir();
  const sid = 'session-39-multi';
  const ids = ['schedule-a', 'schedule-b', 'schedule-c'];
  ids.forEach((id, i) => recordOwnership(sid, id, 'user', undefined, undefined, [IMG(i + 1), FILE(i + 1)]));

  const items = foldActive(sid, ids);
  assert.equal(items.length, 3);
  for (const item of items) assert.equal(item.attachments?.length, 2, '每条都必须是完整的 2 块，不能只第一条有');
  assert.deepEqual(items.map((i) => i.attachments[0].attachment_id), ['img-1', 'img-2', 'img-3']);
});

// ── 5 every 每轮取同一 record 的附件 ────────────────────────────────────────

test('every 循环：投递取附件必须以 record.id 为键，且读失败不得崩（#39-5）', () => {
  const body = sliceFrom(runtime, 'private attachmentsOf(', 'attachmentsOf');
  assert.match(
    body,
    /getOwnership\(sessionId, scheduleId\)\?\.attachments \?\? \[\]/,
    '必须按 id 从 ownership 取——同一条 every 的每轮才拿得到同一批附件',
  );
  assert.match(body, /catch/, 'sidecar 读失败必须吞掉并返回空，不能让整次投递崩');

  // 两处代发路径都按 record.id 取（不是按 occurrence / 不是按消息序号）。
  const calls = [...runtime.matchAll(/this\.attachmentsOf\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 2, `user 代发的两条路径都要取附件，实测 ${calls.length} 处`);
  for (const arg of calls) {
    assert.match(arg, /record\.id/, `attachmentsOf(${arg}) 必须以 record.id 为键`);
  }
});

// ── 6 引用失效 / 非法块 ─────────────────────────────────────────────────────

test('sidecar 被外部改坏时：读路径逐块滤净，全非法则整个键不出现（#39-6）', () => {
  const dir = freshOwnershipDir();
  const sid = 'session-39-garbage';
  recordOwnership(sid, 'schedule-1', 'user', undefined, undefined, [IMG(1)]);

  // 直接篡改落盘文件，模拟「外部改写 / 旧版本残留」——写路径的 sanitize 被绕过。
  const file = sidecarFile(dir, sid);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const key = Object.keys(raw.entries)[0];
  raw.entries[key].attachments = [
    { type: 'image' },                                  // 缺 attachment
    { type: 'image', attachment: { attachmentId: 42 } }, // id 非字符串
    { type: 'nope', attachment: { attachmentId: 'x' } }, // 未知 kind
    IMG(2),
  ];
  writeFileSync(file, JSON.stringify(raw));
  resetCacheForTests();

  const item = foldActive(sid, ['schedule-1'])[0];
  assert.deepEqual(
    item.attachments.map((a) => a.attachment_id),
    ['img-2'],
    '非法块必须被读路径滤掉，且不能牵连同侧合法块',
  );
  assert.equal(
    sanitizeAttachments([{ type: 'image' }, { type: 'bogus' }]),
    undefined,
    '全非法 → undefined（不是 []），客户端因此只需处理一种空态',
  );
});

// ── 7 list 与 wire 各自与 sidecar 对齐（含手写类型漂移锁）──────────────────

test('wire 的附件与 sidecar 经 sanitize 后的结果逐块一致（#39-7 · wire↔sidecar）', () => {
  freshOwnershipDir();
  const sid = 'session-37-wire-align';
  const blocks = [IMG(1), { type: 'image' }, FILE(1)];   // 中间那块非法
  recordOwnership(sid, 'schedule-1', 'user', undefined, undefined, blocks);

  const item = foldActive(sid, ['schedule-1'])[0];
  const expected = sanitizeAttachments(blocks);
  assert.ok(expected, '夹具本身必须至少留下一块');
  assert.equal(item.attachments.length, expected.length, 'wire 块数 = sidecar 合法块数');
  assert.deepEqual(
    item.attachments.map((a) => a.kind),
    expected.map((b) => b.type),
    'kind 多重集必须一致（顺序也不许漂）',
  );
});

test('ScheduleRecordView 的每个成员都必须被 serializeScheduleView 输出（#39-7 · 分叉的机制根因）', () => {
  const typeBody = /export type ScheduleRecordView = \{([\s\S]*?)\n\};/.exec(userTools);
  assert.ok(typeBody, '找不到 ScheduleRecordView');
  const declared = [...typeBody[1].matchAll(/^\s*readonly ([a-z_]+)\??:/gm)].map((m) => m[1]);
  assert.ok(declared.length >= 5, `夹具解析到的成员数异常：${declared.join(',')}`);

  const fn = sliceFrom(userTools, 'export function serializeScheduleView(', 'serializeScheduleView');
  // **必须先剥注释**：`delivery_mode` 前面压着一段三行 `//` 注释，直接按「逗号后接键名」
  // 匹配会被注释切断，把已输出的字段误报成漂移（我第一版就是这么假红了一次）。
  const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const emitted = [
    ...[...code.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]),
    // 条件展开 `...(cond ? { after_seconds: x } : {})` 里的键也算输出
    ...[...code.matchAll(/\{\s*([a-z_]+):/g)].map((m) => m[1]),
  ];
  const missing = declared.filter((k) => !emitted.includes(k));
  assert.deepEqual(
    missing,
    [],
    `类型声明了但序列化器没输出：${missing.join(', ')} —— agent 面会静默少字段，`
    + '这正是 #37 之前「sidecar 有、GUI 没有」分叉跑了好几轮的机制',
  );
});

test('两个手写类型互不同步：list 面当前不输出附件，wire 面输出（#39-7 · 显式记录分歧）', () => {
  // ScheduleRecordView（agent 面）与 UserScheduleWireItem（GUI 面）是**两个独立手写
  // 类型**，一侧加字段不会传导到另一侧。本仓 host↔client 一直是这个惯例，但正因为
  // 如此，"agent 侧早就有附件"这类直觉推断会错——#39 的初版前提就是这么错的。
  assert.doesNotMatch(userTools, /import[^;]*UserScheduleWireItem[^;]*from/, '两面刻意不共用类型');

  const row = serializeScheduleView({
    id: 's-1', kind: 'after', prompt: 'p', afterSeconds: 60,
    scheduledAt: '2999-01-01T06:00:00.000Z', state: 'scheduled',
  });
  assert.equal('attachments' in row, false,
    'agent 面当前**不**输出附件。若将来给 ScheduleRecordView 加了 attachments，'
    + '必须同时改这条断言与 #39 第 7 项的口径——不要让它变成"看起来有其实没有"');
  // 而 GUI 面（wire）在同一条数据上是有的，两面分歧是**已知且被记录**的，不是无人知晓。
  assert.match(domain, /readonly attachments\?: readonly WireAttachment\[\]/);
  assert.match(projection, /\.\.\.attachmentWireOf\(/, '两个 builder 共用同一份映射');
});

// ── 8 无附件时 DOM 无节点 ───────────────────────────────────────────────────

test('无附件时附件带整个不渲染，而不是渲染一个空容器（#39-8 · DOM 侧）', () => {
  const band = sliceFrom(component, 'function DockAttachments(', 'DockAttachments');
  assert.match(band, /blocks === undefined \|\| blocks\.length === 0\) return null/,
    '无附件（键不存在或空数组）→ null');
  assert.match(band, /shown\.length === 0\) return null/,
    '只剩图片又拿不到解析服务 → 也不留空容器');
});

// ── 9 八附件时进度条不被裁出可视区 ─────────────────────────────────────────

test('附件带留在文档流内且列表滚动上限不动（#39-9 · 高度守护）', () => {
  const band = cssRule(styles, '.ss-dock-attachments', '附件带');
  assert.doesNotMatch(band, /position:\s*(absolute|fixed)/,
    '附件带必须留在文档流里：脱离流就轮到进度条被挤/被裁（宿主 .attachments 也是流内）');
  assert.match(band, /overflow-x:\s*auto/, '超宽要横向可滚，而不是静默裁掉（宿主是 overflow:hidden，这里有意更好）');
  assert.match(band, /min-width:\s*0/, 'flex 子项没有 min-width:0 会撑破容器');

  const list = cssRule(styles, '.ss-dock-list', '列表');
  assert.match(list, /max-height:\s*180px/, '列表滚动上限不得被改小/去掉，否则 8 附件时进度条被推出可视区');
  assert.match(list, /overflow-y:\s*auto/);

  // 结构顺序（本轮改）：附件带提到**行首**，与宿主 QueueDock 同位置。纵向预算比旧布局
  // 更松——附件不再独占一带，行从「正文/附件/条」三带回到「正文/条」两带，「附件把
  // 进度条挤出可视区」这个旧风险随之消失；仍要守的是它留在流内 + 超宽可滚（上面三条）。
  const previewAt = component.indexOf('<div className="ss-dock-preview">');
  const bandAt = component.indexOf('<DockAttachments ');
  const barAt = component.indexOf('<MultiBar item={item}');
  assert.ok(bandAt > 0 && bandAt < previewAt && previewAt < barAt,
    '必须是 附件（行首）→ 正文 → 进度条');
});

// ── 10 同带内单块失败不牵连 ─────────────────────────────────────────────────

test('单块图片加载失败只退化该块：每块独立实例 + 独立状态 + alive 守卫（#39-10）', () => {
  const band = sliceFrom(component, 'function DockAttachments(', 'DockAttachments');
  assert.match(band, /<DockThumb key=\{`\$\{block\.attachment_id\}:\$\{index\}`\}/,
    '每块必须是独立组件实例（key 唯一），否则 state 会在块间串用');

  const thumb = sliceFrom(component, 'function DockThumb(', 'DockThumb');
  // 失败态挂在每块自己身上；#58 起从布尔 `failed` 升级为**分类**（待发送 vs 真失败），
  // 但"每块独立、拒绝只影响本块"这条不变。
  assert.match(thumb, /const \[failure, setFailure\]/, '失败态挂在每块自己身上');
  assert.match(thumb, /let alive = true/, '卸载后不得 setState（宿主 QueueThumb 同款）');
  assert.match(thumb, /if \(alive\) setFailure\(classifyAttachmentFailure\(error\)\)/, '拒绝分支存在且不牵连同带其它块');
  assert.match(thumb, /attachment_id/, '加载依赖按 attachment_id 而非 block 对象——dock 每秒 tick 会重建对象，按对象依赖等于每秒重启加载');
});

// ── 11 真机/测试探针：data-* 视同公共接口 ───────────────────────────────────

/**
 * 约定（本条断言就是这个约定的载体）：
 *   **被测试或真机验证用作定位目标的 `data-*` 属性视同公共接口**，改名必须与
 *   断言在同一次提交里变更——和函数签名同等对待。
 * 样式钩子（类名）不受此约束：改名肉眼可查；验证接口改名是**静默失效**，
 * 失败形态是"查不到元素"，极易被误判成"这条提醒没附件 / dock 没渲染出来"，
 * 而不是"探针没了"。
 */
test('三枚 DOM 探针存在且语义稳定：dock 根 / 行 / 附件带（#39-11）', () => {
  // ① dock 根：判断"到底渲不渲染"的唯一探针，也是"空列表不渲染""sessionId 缺失
  //    不渲染"两条性质最直接的观测点。已被真机验证依赖。
  assert.match(component, /<div className="ss-dock-root" data-ss-dock="">/,
    'dock 根必须带 data-ss-dock（空列表/无会话时整块不渲染，靠它判定）');
  // ② 行：按行取样的唯一句柄；正常行与编辑行都要有，否则"编辑中"的行在真机上定位不到。
  assert.equal(
    [...component.matchAll(/data-ss-dock-row=\{item\.id\}/g)].length,
    2,
    '正常行与编辑行都必须带 data-ss-dock-row（两处）',
  );
  // ③ 附件带：值与 data-ss-dock-row 同为 item.id，所以"哪一行有附件"能与行一一对应。
  assert.match(component, /<div className="ss-dock-attachments" data-ss-dock-attachments=\{item\.id\}>/,
    '附件带容器必须带 data-ss-dock-attachments={item.id}，且与行的 id 同源');

  // 探针与类名不能互相顶替：类名是样式钩子，改名肉眼可查；data-* 是验证接口。
  assert.match(styles, /\.ss-dock-attachments \{/, '类名仍是样式钩子（与探针解耦）');
});
