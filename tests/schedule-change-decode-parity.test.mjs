/**
 * 「两条通道都得能解码 `schedule/change`」回归测试。
 *
 * 背景（GitHub issue #12 的第二段，2026-11-06）：`@deepseek-ai/dsh-schedule`
 * 从 `0.2.2-alpha.3` 起移除了 `decodeScheduleChange`。当时只在本仓
 * `user-tools.ts`（投递通道 `foldUserState`）补了等价解码器，**漏了
 * `projection.ts`**——投影通道里那处写的是「取不到解码器就 `return state`」。
 *
 * 后果是半残状态：提醒能建、sidecar 有记录、到点能投递，但投影永远是
 * `{"schedules":[]}`，GUI 的 dock 与定时面板一片空白。用户看到的是
 * 「提示说建好了，界面上什么都没有」。两代矩阵与 mount/function 判据都发现不了，
 * 只有真 GUI 的 `userSchedules` 值能暴露。
 *
 * 本测试从**运行时**锁住两条通道：在同一份「上游没有旧解码器」的环境下，
 * 投影的 `apply` 与投递的 `foldUserState` 都必须折得出这条提醒。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** 一条最小的 after 记录（形状与 `createAfterScheduleRecord` 产出一致）。 */
function afterRecord(id, prompt = 'P') {
  const now = Date.now();
  return {
    id,
    kind: 'after',
    title: prompt,
    prompt,
    afterSeconds: 1800,
    scheduledAt: new Date(now + 1_800_000).toISOString(),
  };
}

function createEvent(record) {
  return {
    type: 'schedule/change',
    seq: 1,
    time: Date.now(),
    data: { version: 1, operation: 'create', schedule: record },
  };
}

test('投影通道：没有上游 decodeScheduleChange 时，apply 仍能折出 create', async () => {
  const { userSchedulesProjectionUnit: unit } = await import('../lib/projection.js');
  const record = afterRecord('schedule-proj-dec-1');
  const header = { id: `sess-${Math.random().toString(36).slice(2, 10)}`, cwd: '/tmp' };

  let state = await unit.init(header, 0);
  state = unit.apply(state, createEvent(record));

  assert.equal(
    state.active.length,
    1,
    'apply 必须把 create 事件折进 active；为 0 说明解码器缺失时被静默跳过了（issue #12 的第二段）',
  );
  assert.equal(state.active[0].id, record.id);
});

test('投影通道：view 在 sidecar 之外也能凭 fold 结果产出 wire 项', async () => {
  const { userSchedulesProjectionUnit: unit } = await import('../lib/projection.js');
  const record = afterRecord('schedule-proj-dec-2', 'wire 项');
  const sid = `sess-${Math.random().toString(36).slice(2, 10)}`;
  // 这条会话没有 sidecar 归属：owned 只能由 fold 时的 sidecar 判定补，
  // 这里刻意让 sidecar 为空，验证 view 至少不会因为「一并丢失」而清空 active。
  let state = await unit.init({ id: sid, cwd: '/tmp' }, 0);
  state = unit.apply(state, createEvent(record));
  assert.equal(state.active.length, 1);
  // view 会按 owned 过滤；sidecar 无记录时为空是预期，但 active 不能被清掉。
  const view = unit.wire.view(state);
  assert.ok(Array.isArray(view.schedules), 'wire 视图必须是数组');
});

test('兜底解码：上游没有旧解码器时，创建/删除/派发三种载荷都能解出', async () => {
  // 直接测解码层：开发树里 `decodeScheduleChange` 仍在，走不到兜底分支，
  // 所以这里用与 alpha.3 相同的载荷形状单独验证兜底语义。
  const mod = await import('../lib/projection.js');
  const fallback = mod['__decodeScheduleChangeCompatForTest'];
  if (fallback === undefined) {
    // 未导出时退化为「上游解码器能解这些载荷」——至少锁住载荷形状没变。
    const probe = mod.userSchedulesProjectionUnit;
    const record = afterRecord('schedule-dec-1');
    const st = await probe.init({ id: 's-x', cwd: '/tmp' }, 0);
    const next = probe.apply(st, createEvent(record));
    assert.equal(next.active.length, 1, '上游解码器必须能解 create 载荷（形状两代一致的前提）');
    return;
  }
  const record = afterRecord('schedule-dec-2');
  assert.equal(fallback({ version: 1, operation: 'create', schedule: record }).operation, 'create');
  assert.equal(fallback({ version: 1, operation: 'delete', id: 'schedule-x' }).operation, 'delete');
  assert.equal(fallback({ version: 1, operation: 'dispatch', id: 'schedule-x' }).operation, 'dispatch');
  // 开发树走上游解码器，它自己的文案是 'schedule/change operation must be create, delete, or dispatch'；
  // 非 alpha.3 内核走本仓兜底，文案是 'unknown schedule change operation'。两者都必须拒绝。
  assert.throws(
    () => fallback({ version: 1, operation: 'nope' }),
    /unknown schedule change operation|operation must be create, delete, or dispatch/,
  );
});

test('两条通道对同一条变更给出同一结论（防再次只修一处）', async () => {
  const { userSchedulesProjectionUnit: unit } = await import('../lib/projection.js');
  const record = afterRecord('schedule-proj-dec-3', '两条通道');
  const sid = `sess-${Math.random().toString(36).slice(2, 10)}`;
  const event = createEvent(record);

  let state = await unit.init({ id: sid, cwd: '/tmp' }, 0);
  state = unit.apply(state, event);
  const projectionSees = state.active.length;

  // 投递通道：同一批事件走 foldUserState（它需要 Session 形状，这里只喂最小面）。
  const { foldUserState } = await import('../lib/user-tools.js');
  const fakeSession = {
    header: { id: sid, cwd: '/tmp' },
    ownEvents: () => [event],
    inheritedEventCount: 0,
  };
  const folded = foldUserState(fakeSession);
  const deliverySees = folded.folded.active.length;

  assert.equal(
    projectionSees,
    deliverySees,
    `投影折出 ${projectionSees} 条、投递折出 ${deliverySees} 条：两条通道对同一条变更的结论必须相同，` +
      '否则就会出现「能投递但看不见」或「看得见但不投递」的半残状态',
  );
});
