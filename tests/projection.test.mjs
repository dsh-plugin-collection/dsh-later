/**
 * userSchedules 投影 fold 测试：create/owned/dispatch/delete、fork 隔离，
 * 以及附件随 wire 带出（issue #37）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyUserScheduleProjection,
  initUserScheduleProjection,
  userSchedulesSchema,
  viewUserScheduleProjection,
} from '../lib/projection.js';
import { OWNED_EVENT } from '../lib/domain.js';
import { recordOwnership, recordPaused } from '../lib/ownership-store.js';
import { freshOwnershipDir, markOwnership } from './helpers/ownership-state.mjs';

/** 构造一条 schedule/change create 事件（与 dsh-schedule 完全兼容）。 */
function createEvent(schedule, seq = 0) {
  return {
    type: 'schedule/change',
    seq,
    time: 0,
    data: { version: 1, operation: 'create', schedule },
  };
}

/** 构造一条伴生所有权 add 事件。 */
function ownedEvent(id, seq) {
  return { type: OWNED_EVENT, seq, time: 0, data: { version: 1, operation: 'add', id } };
}

function dispatchEvent(id, seq, acceptedAt) {
  return {
    type: 'schedule/change',
    seq,
    time: 0,
    data:
      acceptedAt === undefined
        ? { version: 1, operation: 'dispatch', id }
        : { version: 1, operation: 'dispatch', id, acceptedAt },
  };
}

function deleteEvent(id, seq) {
  return { type: 'schedule/change', seq, time: 0, data: { version: 1, operation: 'delete', id } };
}

const atSchedule = {
  id: 'schedule-1',
  kind: 'at',
  prompt: '检查构建结果',
  scheduledAt: '2999-01-01T06:00:00.000Z',
};

const everySchedule = {
  id: 'schedule-2',
  kind: 'every',
  prompt: '检查服务状态',
  everySeconds: 300,
  scheduledAt: '2999-01-01T07:00:00.000Z',
};

test('只展示 user-owned 的活动任务', () => {
  let state = initUserScheduleProjection();
  // 用户创建
  state = applyUserScheduleProjection(state, createEvent(atSchedule));
  state = applyUserScheduleProjection(state, ownedEvent('schedule-1', 1));
  // 模型创建（无 owned）
  state = applyUserScheduleProjection(state, createEvent(everySchedule));
  const view = viewUserScheduleProjection(state);
  assert.equal(view.schedules.length, 1);
  assert.equal(view.schedules[0].id, 'schedule-1');
  assert.equal(view.schedules[0].kind, 'at');
  assert.equal(view.schedules[0].scheduled_at, '2999-01-01T06:00:00.000Z');
  assert.equal(view.schedules[0].delivery_mode, 'session-local');
});

test('dispatch 后一次性任务移除、every 推进', () => {
  let state = initUserScheduleProjection();
  state = applyUserScheduleProjection(state, createEvent(atSchedule));
  state = applyUserScheduleProjection(state, ownedEvent('schedule-1', 1));
  // one-shot dispatch（无 acceptedAt）
  state = applyUserScheduleProjection(state, dispatchEvent('schedule-1', 2));
  assert.equal(viewUserScheduleProjection(state).schedules.length, 0);

  state = initUserScheduleProjection();
  state = applyUserScheduleProjection(state, createEvent(everySchedule));
  state = applyUserScheduleProjection(state, ownedEvent('schedule-2', 1));
  // every dispatch（带 acceptedAt）：推进下一次
  const accepted = Date.parse('2999-01-01T08:00:00.000Z');
  state = applyUserScheduleProjection(
    state,
    dispatchEvent('schedule-2', 2, new Date(accepted).toISOString()),
  );
  assert.equal(viewUserScheduleProjection(state).schedules.length, 1);
  // 下一次 = 锚点 07:00 + k*300s，最后 <= accepted 后 +300s
  const target = Date.parse(viewUserScheduleProjection(state).schedules[0].scheduled_at);
  assert.ok(target > accepted);
  assert.equal((target - Date.parse('2999-01-01T07:00:00.000Z')) % (300 * 1000), 0);
});

test('delete 后任务移除', () => {
  let state = initUserScheduleProjection();
  state = applyUserScheduleProjection(state, createEvent(atSchedule));
  state = applyUserScheduleProjection(state, ownedEvent('schedule-1', 1));
  state = applyUserScheduleProjection(state, deleteEvent('schedule-1', 2));
  assert.equal(viewUserScheduleProjection(state).schedules.length, 0);
});

test('fork 隔离：session/end-seed 后不继承父会话任务（AC-07）', () => {
  let state = initUserScheduleProjection();
  let seq = 0;
  // 父会话前缀：已有用户任务
  state = applyUserScheduleProjection(state, createEvent(atSchedule, seq));
  state = applyUserScheduleProjection(state, { ...ownedEvent('schedule-1', ++seq), seq });
  // 派生边界（seq=2）
  state = applyUserScheduleProjection(state, {
    type: 'session/end-seed',
    seq: ++seq,
    time: 0,
    data: {},
  });
  assert.equal(viewUserScheduleProjection(state).schedules.length, 0);
  // 子会话自己新建（seq=3,4）
  const child = { ...atSchedule, id: 'schedule-3' };
  state = applyUserScheduleProjection(state, { ...createEvent(child), seq: ++seq });
  state = applyUserScheduleProjection(state, { ...ownedEvent('schedule-3', ++seq), seq });
  const view = viewUserScheduleProjection(state);
  assert.equal(view.schedules.length, 1);
  assert.equal(view.schedules[0].id, 'schedule-3');
});

test('无关事件返回同一引用（不触发推送）', () => {
  const state = initUserScheduleProjection();
  const unrelated = { type: 'user/message', seq: 0, time: 0, data: {} };
  assert.equal(applyUserScheduleProjection(state, unrelated), state);
});

test('所有权走 sidecar：init(header) 装载 + create 事件按 sidecar 判定归属', () => {
  freshOwnershipDir();
  const header = { id: 'session-sidecar-case' };
  markOwnership(header.id, 'schedule-1', 'context');
  let state = initUserScheduleProjection(header);
  assert.deepEqual([...state.owned], ['schedule-1']);
  state = applyUserScheduleProjection(state, createEvent(atSchedule, 0));
  const view = viewUserScheduleProjection(state);
  assert.equal(view.schedules.length, 1);
  assert.equal(view.schedules[0].id, 'schedule-1');
  // sidecar 未标记的 create → 非 user-owned（模型经核心工具创建）
  state = applyUserScheduleProjection(state, createEvent(everySchedule, 1));
  assert.equal(viewUserScheduleProjection(state).schedules.length, 1);
});

test('delete 事件同时撤销视图内所有权（sidecar 清理由工具路径负责）', () => {
  freshOwnershipDir();
  const header = { id: 'session-delete-view-case' };
  markOwnership(header.id, 'schedule-1', 'context');
  let state = initUserScheduleProjection(header);
  state = applyUserScheduleProjection(state, createEvent(atSchedule, 0));
  state = applyUserScheduleProjection(state, deleteEvent('schedule-1', 1));
  assert.deepEqual([...state.owned], []);
  assert.equal(viewUserScheduleProjection(state).schedules.length, 0);
});

// ── 附件随 wire 带出（issue #37）──────────────────────────────────────
//
// 附件的**存储**早就在 ownership sidecar 里（`recordOwnership` 第 6 个参数），
// 缺的只是投影把它序列化给客户端这一跳。以下断言全部针对这一跳。

const imageBlock = (n) => ({
  type: 'image',
  attachment: { attachmentId: `img-${n}`, mediaType: 'image/png', bytes: 1200 + n, width: 8, height: 8 },
});
const fileBlock = (n) => ({
  type: 'file',
  attachment: { attachmentId: `file-${n}`, name: `log-${n}.txt`, bytes: 2048 + n },
});

/** 建一个「用户拥有 schedule-1 且带指定附件」的投影状态。 */
function stateWithAttachments(sessionId, blocks) {
  recordOwnership(sessionId, 'schedule-1', 'user', undefined, undefined, blocks);
  let state = initUserScheduleProjection({ id: sessionId });
  return applyUserScheduleProjection(state, createEvent(atSchedule, 0));
}

test('活动项 wire 带出附件：2 图 1 文件全字段可见且保持原顺序（#37）', () => {
  freshOwnershipDir();
  const state = stateWithAttachments('session-att-active', [imageBlock(1), fileBlock(1), imageBlock(2)]);
  const item = viewUserScheduleProjection(state).schedules[0];
  assert.deepEqual(
    item.attachments,
    [
      { kind: 'image', attachment_id: 'img-1', media_type: 'image/png', bytes: 1201, width: 8, height: 8 },
      { kind: 'file', attachment_id: 'file-1', name: 'log-1.txt', bytes: 2049 },
      { kind: 'image', attachment_id: 'img-2', media_type: 'image/png', bytes: 1202, width: 8, height: 8 },
    ],
  );
  // 未截断时不得出现 total，客户端据此区分「全部」与「被裁」
  assert.equal('attachments_total' in item, false);
});

test('无附件时整个键不出现，而不是空数组（#37）', () => {
  freshOwnershipDir();
  const header = { id: 'session-att-none' };
  markOwnership(header.id, 'schedule-1', 'user');
  let state = initUserScheduleProjection(header);
  state = applyUserScheduleProjection(state, createEvent(atSchedule, 0));
  const item = viewUserScheduleProjection(state).schedules[0];
  assert.equal('attachments' in item, false, '空态必须是「键不存在」，否则客户端要区分两种空');
  assert.equal('attachments_total' in item, false);
});

test('超过 8 个只带前 8 个并给出原始总数（#37）', () => {
  freshOwnershipDir();
  const blocks = Array.from({ length: 9 }, (_, i) => imageBlock(i + 1));
  const item = viewUserScheduleProjection(stateWithAttachments('session-att-cap', blocks)).schedules[0];
  assert.equal(item.attachments.length, 8);
  assert.equal(item.attachments_total, 9);
  assert.equal(item.attachments[7].attachment_id, 'img-8');
});

test('暂停项的 wire 同样带附件（留档是暂停项唯一素材来源）（#37）', () => {
  freshOwnershipDir();
  const sessionId = 'session-att-paused';
  recordPaused(sessionId, {
    uid: 'uid-p1',
    prompt: atSchedule.prompt,
    delivery: 'user',
    kind: 'after',
    remainingSeconds: 300,
    originalScheduledAt: atSchedule.scheduledAt,
    originalAfterSeconds: 900,
    lastScheduleId: 'schedule-1',
    pausedAt: 1700000000000,
    attachments: [imageBlock(1), fileBlock(1)],
  });
  const state = initUserScheduleProjection({ id: sessionId });
  const paused = viewUserScheduleProjection(state).schedules.find((s) => s.status === 'paused');
  assert.ok(paused, 'sidecar 里的暂停项应出现在视图内');
  assert.deepEqual(paused.attachments.map((a) => a.kind), ['image', 'file']);
  assert.equal(paused.attachments[1].name, 'log-1.txt');
});

test('带附件的载荷能通过 wire viewSchema（.strict() 那一环不炸）（#37）', () => {
  freshOwnershipDir();
  const state = stateWithAttachments('session-att-schema', [imageBlock(1), fileBlock(1)]);
  const view = viewUserScheduleProjection(state);
  // viewSchema 是「离开宿主前」的校验；漏改 schema 而只改 builder 会在这里抛。
  assert.doesNotThrow(() => userSchedulesSchema.parse(view));
  assert.equal(userSchedulesSchema.parse(view).schedules[0].attachments.length, 2);
});
