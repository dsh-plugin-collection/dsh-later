/**
 * `foldUserState` 缓存判据的回归测试（游标 + sidecar 代数）。
 *
 * 为什么必须新建假 session 而不能沿用 `tests/user-tools.test.mjs` 里的 `FakeSession`：
 * 那个假对象是**旧代形状**（只有 `.events` + `header.seedLength`，没有 `seq`，也没有
 * `ownEvents()`）。而生产内核是 `ownEvents()` + `seq` + `inheritedEventCount`，且
 * fork/子代理会话上 `ownEvents()` 每次 `log.slice()` 返回**新数组**——正是这个行为让
 * 旧的「数组引用」判据恒不命中。也就是说：本仓过去所有 fold 测试都只覆盖回落面，
 * 真正跑在线上的那条形状**一条测试都没有**。这里补的就是那一条。
 *
 * 断言的是两件事，缺一不可：
 *  1. 命中路径**不读日志**（`ownEvents()` 调用次数为 1）——这是这次改动的全部收益；
 *  2. 该失效的两类来源都能失效：日志新增事件（`seq` 变）、sidecar 单独改写（代数变）。
 *     第 2 条尤其重要：缓存一旦开始命中，sidecar 就不再被日志变化顺带刷新，
 *     所有权/投递形态会读到过期值。
 * @module tests/fold-cache-cursor
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
// 先导入 helper：它在求值时就把 sidecar 指向一次性临时目录（见该文件的历史教训）。
import { freshOwnershipDir, markOwnership } from './helpers/ownership-state.mjs';
import { foldUserState, userScheduleCreate } from '../lib/user-tools.js';
import { readFoldInput } from '../lib/upstream-compat.js';
import { ownershipGeneration } from '../lib/ownership-store.js';

let seqCounter = 0;

/**
 * 现代内核形状的假 Session。
 *
 * @param forkOffset - `inheritedEventCount`。>0 时模拟 fork 会话；`ownEvents()` 一律
 *   **每次返回新数组**（`Object.freeze([...])`），复刻内核 `snapshotEvents(offset)`
 *   走 `log.slice()` 的行为——这是旧判据失效的根因，不能在这里 memo 掉。
 */
class ModernSession {
  constructor(forkOffset = 0) {
    this.header = { id: `session-modern-${++seqCounter}` };
    this.inheritedEventCount = forkOffset;
    /** 绝对位置的整表（含继承前缀），前缀填无关类型事件让 fold 跳过。 */
    this.log = Array.from({ length: forkOffset }, (unused, index) => ({
      type: 'session/meta',
      seq: index,
      time: 0,
      data: { note: 'inherited prefix filler' },
    }));
    this.ownEventsCalls = 0;
  }

  get seq() {
    return this.log.length;
  }

  ownEvents() {
    this.ownEventsCalls += 1;
    // 每次新数组：内核在 offset>0 时就是这么做的。
    return Object.freeze(this.log.slice(this.inheritedEventCount));
  }

  eventAt(at) {
    return this.log[at];
  }

  append(type, data) {
    const event = { type, seq: this.log.length, time: Date.now(), data };
    this.log.push(event);
    return event;
  }
}

const atInput = {
  prompt: '检查构建结果',
  at: { date: '2999-01-01', time: '14:00:00', time_zone: 'Asia/Shanghai' },
  time_zone: 'Asia/Shanghai',
};

const fakeCtx = { sessions: { flush: async () => true } };

/** 建一条真实可 fold 的用户提醒，返回 session。
 *
 * fork 场景不再需要垫自有段：`readFoldInput` 之后传给 fold 的前缀长度是 0，
 * 自有段长度与前缀长度不再互为约束（要垫的那种写法，本身就是在迁就双重排除的缺陷）。
 */
async function sessionWithOneSchedule(forkOffset = 0) {
  const session = new ModernSession(forkOffset);
  const result = await userScheduleCreate(atInput, { id: 'a', session, ctx: {} }, fakeCtx);
  assert.ok(result.ok, `create 应成功：${JSON.stringify(result)}`);
  return { session, created: result };
}

test('root 会话：日志没变时第二次 fold 直接命中，且不再读日志', async () => {
  const { session } = await sessionWithOneSchedule(0);
  const callsAfterCreate = session.ownEventsCalls;

  const first = foldUserState(session);
  const second = foldUserState(session);

  assert.equal(second, first, '同一份日志两次 fold 应返回同一个缓存对象');
  // 第一次 fold 读一次日志，第二次必须命中缓存、一次都不读。
  assert.equal(session.ownEventsCalls, callsAfterCreate + 1, '命中路径不该再读一次日志');
});

test('fork 会话（inheritedEventCount>0）：ownEvents 每次新数组仍必须命中', async () => {
  const { session } = await sessionWithOneSchedule(5);
  const before = session.ownEventsCalls;

  const first = foldUserState(session);
  const second = foldUserState(session);
  const third = foldUserState(session);

  assert.equal(second, first, 'fork 会话上缓存失效——旧判据就是这样恒不命中');
  assert.equal(third, first);
  // 三次 fold 只读了日志一次。旧实现这里会是 before+3（外加三次全量 slice）。
  assert.equal(session.ownEventsCalls, before + 1, '命中路径必须零日志读取');
});

test('日志新增事件后必须重算（不能把过期 active 端态留给派发）', async () => {
  // 用 root 会话：这条要测的是「seq 前进必须失效」，不依赖 fork 段语义。
  const { session, created } = await sessionWithOneSchedule(0);
  const before = foldUserState(session);
  assert.equal(before.folded.active.length, 1);

  // 内核写一条 dispatch：该提醒出列。seq 前进一格。
  session.append('schedule/change', { version: 1, operation: 'dispatch', id: created.id });
  const after = foldUserState(session);

  assert.notEqual(after, before, '日志变了却没重算');
  assert.equal(after.folded.active.length, 0, 'dispatch 后该条应不再 active');
});

test('sidecar 单独改写（日志一条没加）也必须让 fold 失效', async () => {
  freshOwnershipDir();
  const { session, created } = await sessionWithOneSchedule(0);
  const sessionId = session.header.id;

  const before = foldUserState(session);
  assert.equal(before.delivery.get(created.id) ?? 'context', 'context');
  const readsBefore = session.ownEventsCalls;
  const generationBefore = ownershipGeneration();

  // 只动 sidecar：把这条改成 /later 的「代发」形态。会话日志的 seq 完全不变。
  markOwnership(sessionId, created.id, 'user');
  assert.ok(ownershipGeneration() > generationBefore, 'writeThrough 没拨代次');
  assert.equal(session.seq, session.log.length);

  const after = foldUserState(session);
  assert.notEqual(after, before, 'sidecar 改了却命中旧缓存——所有权读到了过期值');
  assert.equal(after.delivery.get(created.id), 'user', 'delivery 未反映 sidecar');
  assert.ok(session.ownEventsCalls > readsBefore, '失效后本该重读日志');
});

test('不同 Session 实例各自独立缓存（键是会话不是全局）', async () => {
  const one = await sessionWithOneSchedule(0);
  const two = await sessionWithOneSchedule(0);

  const foldOne = foldUserState(one.session);
  const foldTwo = foldUserState(two.session);
  assert.notEqual(foldOne, foldTwo);
  assert.equal(foldOne.folded.active.length, 1);
  assert.equal(foldTwo.folded.active.length, 1);
});

/**
 * 顺手撞出来的**既存缺陷**（与本文件的缓存改动无关，故 skip 而不是让它红盘）。
 *
 * 上游 `foldScheduleEvents(events, inheritedEventCount)` 的契约是：
 *   `@param events - Complete ordered session log`（**完整**日志）
 *   `@param inheritedEventCount - Inherited prefix length excluded from child ownership`
 * 内核自己的调用是 `foldScheduleEvents(session.ownEvents())`——**不带第二个参数**
 * （dsh-schedule/lib/index.js:2034），因为 `ownEvents()` 返回的已经是**去掉继承前缀的
 * 自有段**（`snapshotEvents(inheritedEventCount)` → `log.slice(inheritedEventCount)`）。
 *
 * 而本插件是 `foldScheduleEvents(readOwnEvents(session), readInheritedEventCount(session))`
 * ——把「已经去掉前缀的段」再按前缀长度 `slice()` 一次，等于**双重排除**：
 *  - 自有段长度 < 前缀长度时：上游当场抛
 *    `ScheduleLogError: schedule inheritedEventCount must be within the supplied event log`
 *    → `foldUserState` 抛 → 所有 `user_schedule_*` 返回 `internal_error`、
 *    `driveOnce` 记一条「fold 失败」后直接 return，**该会话的提醒一条都不会触发**；
 *  - 自有段长度 ≥ 前缀长度时：静默跳过前 `inheritedEventCount` 条**自有**事件，
 *    于是 fork 会话里最早那几条用户提醒既不出现也不触发。
 *
 * 下面三条是这个缺陷的看守（缺陷本身已由 `readFoldInput` 修掉：读自有段就传 0，
 * 读含前缀的整表才传前缀长度，两者成对决定，调用方不再自己拼）。
 */

test('fork 会话：自有段短于继承前缀也必须能建提醒（旧实现当场抛）', async () => {
  const session = new ModernSession(5);
  const result = await userScheduleCreate(atInput, { id: 'a', session, ctx: {} }, fakeCtx);

  assert.ok(result.ok, `fork 会话应能建提醒，实际：${JSON.stringify(result)}`);
  assert.equal(foldUserState(session).folded.active.length, 1, 'fork 会话上 fold 看不见自有提醒');
});

test('fork 会话：自有段长于继承前缀时，最早那几条不能被静默切掉', async () => {
  // 这条专门盯「静默」那一半：先把提醒建成自有段的**第 1 条**事件，再把自有段垫到
  // 长于前缀——旧实现此时不会抛，而是 `slice(offset)` 把最早的几条直接丢掉。
  const session = new ModernSession(3);
  const result = await userScheduleCreate(atInput, { id: 'a', session, ctx: {} }, fakeCtx);
  assert.ok(result.ok, String(JSON.stringify(result)));
  for (let i = 0; i < 4; i += 1) session.append('session/meta', { note: 'pad own segment' });

  const folded = foldUserState(session);
  assert.equal(folded.folded.active.length, 1, '最早的自有提醒被静默跳过');
  assert.ok(folded.owned.has(result.id), '所有权也没跟上');
});

test('兼容层：数组与前缀长度成对决定（ownEvents→0，.events 整表→前缀长度）', async () => {
  const modern = new ModernSession(4);
  const paired = readFoldInput(modern);
  assert.equal(paired.inheritedEventCount, 0, '自有段必须配 0，否则前缀被排除两次');
  assert.equal(paired.events.length, 0, '现代形状只拿到自有段');

  // 旧代 `.events` 含 seed 全长：这时前缀长度**才**该交给 fold 去切。
  const legacy = { header: { id: 'session-legacy-1', seedLength: 3 }, events: Array.from({ length: 6 }, (unused, index) => ({ type: 'session/meta', seq: index, time: 0, data: {} })) };
  const legacyPair = readFoldInput(legacy);
  assert.equal(legacyPair.inheritedEventCount, 3, '含前缀的整表必须把前缀长度传下去');
  assert.equal(legacyPair.events.length, 6);
});
