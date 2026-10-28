/**
 * `runUserScheduleTransaction` 的串行化回归测试。
 *
 * 修前的形态是 `try { return run } finally { …tails.delete(agent) }`——`finally`
 * 紧跟 `return run` 同步执行，那一刻 promise 还没落定，队尾被当场抹掉，第二个并发
 * 操作 `tails.get(agent)` 取到 undefined 就直接起跑。模块头写的「按 agent 串行化
 * 用户的读改写操作」从未生效，而没有任何测试能发现它——因为**单独看每个操作都对**，
 * 只有并发才露馅，而并发恰好没人测。
 *
 * 时序注意：`run` 是 `.then(operation)`，operation 排在**微任务**里，调用返回的瞬间
 * 一个操作都还没起跑。所以断言前必须先让出一个宏任务（`flush`），否则抓到空 trace
 * 是测试自己的 bug，不是实现的 bug。
 *
 * 三条用例各钉一个失败模式：并发不交错、失败不卡死队列、**第三个操作排在第二个之后**
 * （最后这条区分「落定后清位」与「无条件清位」——后者会让并发在第二位重新打开）。
 * @module tests/host-transaction
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runUserScheduleTransaction } from '../lib/user-tools.js';

/** 本函数只用 agent 当队列身份，不需要真实 Agent 实例。 */
const fakeAgent = () => ({ id: `agent-${Math.random().toString(36).slice(2)}` });

/** 让微任务与定时器各跑一轮：operation 的起跑发生在微任务里，必须让出一次才看得到。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 记录启动/结束顺序的工厂：慢操作先起、快操作后起，才能看出是否真的排了队。 */
const tracked = (trace, label, delayMs, shouldThrow = false) => async () => {
  trace.push(`start:${label}`);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  trace.push(`end:${label}`);
  if (shouldThrow) throw new Error(`boom:${label}`);
  return label;
};

test('两个并发操作必须串行：第二个不得在第一个结束前启动', async () => {
  const trace = [];
  const agent = fakeAgent();

  const first = runUserScheduleTransaction(agent, tracked(trace, 'a', 20));
  const second = runUserScheduleTransaction(agent, tracked(trace, 'b', 1));
  await flush();

  assert.deepEqual(trace, ['start:a'], '并发操作被同时启动 = 串行化失效');

  assert.equal(await first, 'a');
  assert.equal(await second, 'b');
  assert.deepEqual(trace, ['start:a', 'end:a', 'start:b', 'end:b']);
});

test('第三个操作必须排在第二个之后（清位过早会让并发在第二位重开）', async () => {
  const trace = [];
  const agent = fakeAgent();

  const a = runUserScheduleTransaction(agent, tracked(trace, 'a', 15));
  const b = runUserScheduleTransaction(agent, tracked(trace, 'b', 15));
  // c 在 a/b 都还在跑的时候到达：它必须排到 b 后面，而不是因为队尾被抹掉而起跑。
  const c = runUserScheduleTransaction(agent, tracked(trace, 'c', 1));
  await flush();

  assert.deepEqual(trace, ['start:a'], 'b 或 c 提前起跑');
  await Promise.all([a, b, c]);
  assert.deepEqual(trace, ['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
});

test('操作抛错不得卡死队列，后续操作照常执行且仍彼此串行', async () => {
  const trace = [];
  const agent = fakeAgent();

  await assert.rejects(
    runUserScheduleTransaction(agent, tracked(trace, 'bad', 1, true)),
    /boom:bad/,
  );
  assert.deepEqual(trace, ['start:bad', 'end:bad']);

  const first = runUserScheduleTransaction(agent, tracked(trace, 'x', 10));
  const second = runUserScheduleTransaction(agent, tracked(trace, 'y', 1));
  await flush();
  assert.deepEqual(trace.slice(2), ['start:x'], '失败后队列语义走样');

  assert.equal(await first, 'x');
  assert.equal(await second, 'y');
  assert.deepEqual(trace, [
    'start:bad', 'end:bad',
    'start:x', 'end:x', 'start:y', 'end:y',
  ]);
});

test('不同 agent 之间互不排队（队列身份是 agent，不是全局）', async () => {
  const trace = [];
  const one = runUserScheduleTransaction(fakeAgent(), tracked(trace, 'p', 20));
  const two = runUserScheduleTransaction(fakeAgent(), tracked(trace, 'q', 1));
  await flush();

  // 两个不同 agent 并发是**期望行为**，别把它一起锁死。
  assert.ok(trace.includes('start:p') && trace.includes('start:q'), `不同 agent 被错误串行化: ${trace}`);
  await Promise.all([one, two]);
});
