/**
 * 冷唤醒的「消化宽限期」从哪一刻起算（GitHub issue #206）。
 *
 * ## 缺陷本体（一句话）
 *
 * 宽限期从**尝试起点**计时，而 `wake()` 的 promise 在 `registry.drive()` 之后就 resolve
 * （接线侧明说"刻意不 await"）——于是"唤醒刚落定"与"可以判失败了"是同一时刻：投递还在
 * followup → 确认窗（2000ms）→ `dispatchedAt` 镜像这条链上走，扫描器已经每 500ms 一轮地
 * 给它数失败。退避梯子 1s→2s→4s→8s 走完只要 ~15.5s，`gaveUp` 一到该会话的冷提醒就哑到
 * 用户亲手改动它或进程重启。
 *
 * 更糟的是**整个过程只唤醒过 1 次**：失败计数是从那一次观察里随时间爬满的，于是那句
 * 「连续 5 次冷唤醒失败」描述的是一件没发生过的事。排查时"唤不醒"与"唤醒了但投递没收敛"
 * 是两个完全相反的方向，而这句告警把人指向错的那个。
 *
 * ## 这个文件为什么与 `due-index-consumption.test.mjs` 分开
 *
 * 那个文件钉的是「到期点有没有被消化」这条**判据**（#139）；本文件钉的是「什么时候才
 * 允许下这个结论」这条**时序**（#206）。两者的假件形状不同：这里必须把 `wake` 写成
 * **异步慢 resolve**（真接线里它就是这样），否则永远踩不到界；而那边的 `wake` 一律同步，
 * 正是"修好判据也测不到时序"的原因。
 *
 * ## 判据纪律
 *
 * 一律断言**状态与告警口径**（`failuresOf` / `wakesOf` / 告警里的实际唤醒次数），不按
 * 文本命中判定成功——见 `scripts/verify-across-kernels.mjs` 的判据纪律与本仓
 * "文本匹配是禁用判据"的约定。
 *
 * @module tests/cold-wake-grace
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createExpirySweeper } from '../lib/expiry-sweeper.js';
import { readDueIndex } from '../lib/due.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

/** 一条已过期的条目（`consumed` 由 `dispatchedAt` 表达）。 */
const dueEntry = (target, extra = {}) => ({ delivery: 'context', createdAt: target - 1, scheduledAt: target, ...extra });

/**
 * 造一个带**假时钟 + 手动驱动**的扫描器。
 *
 * 手动驱动（而不是走注入的假定时器）是刻意的：这里要量的是"投递在 N 秒后落盘"这条**时间
 * 关系**，而不是定时器排得对不对。每步推进一个固定步长，就能复刻出真机上 500ms 一轮的
 * 扫描节奏，且完全确定。
 *
 * @param deliveryLandsMs - 模拟「投递真正落盘」所需的毫秒数（0 = 同步落盘）。
 * @param wakeAsync - `wake` 是否以微任务异步 resolve（真接线就是这样）。
 * @returns 假时钟驱动器与观察口。
 */
function slowWakeSweeper({ deliveryLandsMs = 0, wakeAsync = true } = {}) {
  const t0 = 1_000_000;
    let clock = t0;
  const entry = dueEntry(t0 - 1000);
  const wakeCalls = [];
  const warned = [];
  const sweeper = createExpirySweeper({
    snapshots: () => [{ sessionId: 'session-slow', entries: { 'schedule-1': entry } }],
    wake: () => {
      wakeCalls.push(clock);
      return wakeAsync ? new Promise((resolve) => setImmediate(resolve)) : undefined;
    },
    wakeable: () => true,
    resolveScheduledAt: () => undefined,
    warn: (message) => warned.push(String(message)),
    now: () => clock,
    // 全走手动驱动：注入的定时器一律不排（`sweepNow()` 才是本轮唯一入口）。
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  });
  /**
   * 推进假时钟：每步固定 500ms（真机上的扫描节奏），到点就把投递"落盘"。
   * @param ms - 推进多少毫秒。
   * @param opts - `until` 满足即提前停（省掉几百轮空转）。
   * @returns 是否是因为 `until` 而停。
   */
  const advance = async (ms, opts = {}) => {
    const { step = 500, until } = opts;
    const endAt = clock + ms;
    while (clock < endAt) {
      clock = Math.min(clock + step, endAt);
      if (deliveryLandsMs !== undefined && clock - t0 >= deliveryLandsMs && entry.dispatchedAt === undefined) {
        // 投递落地 = runtime 把 fold 的端态镜像进 sidecar（`dispatchedAt`）。
        entry.dispatchedAt = clock;
      }
      await sweeper.sweepNow();
      await flush();
      if (until !== undefined && until()) return true;
    }
    return false;
  };
  return { sweeper, entry, t0, wakeCalls, warned, advance, now: () => clock };
}

test('慢投递：一次成功的唤醒不得被数成 5 次失败（#206 的核心回归）', async () => {
  // 修复前的实测阈值：投递 ≤15s 落地安全，16s 触发 gaveUp；时间线
  // 0.5s:w1/f1 1.5s:f2 3.5s:f3 7.5s:f4 15.5s:f5 → 16s 判死。这里取 16s 正是那条界。
  const { sweeper, wakeCalls, warned, advance } = slowWakeSweeper({ deliveryLandsMs: 16_000 });
  const gaveUp = await advance(120_000, { until: () => warned.some((w) => /已停止自动/.test(w)) });
  assert.equal(
    gaveUp,
    false,
    `一次慢投递不得把会话哑化：failures=${sweeper.failuresOf('session-slow')} wakes=${sweeper.wakesOf('session-slow')} warn=${JSON.stringify(warned).slice(0, 400)}`,
  );
  assert.equal(sweeper.failuresOf('session-slow'), 0, '投递最终落地 ⇒ 一条失败都不该记下');
  assert.equal(wakeCalls.length, 1, '整个过程只该唤醒一次（它本来就投出去了）');
  await sweeper.dispose();
});

test('真投不出去时仍然会放弃，但告警必须如实报出「唤醒过几次」', async () => {
  // 这条是上一条的反面：不放弃就等于把"真的投不出去"变成永久重试风暴。
  // 判据同时钉住文案口径——「连续 N 次冷唤醒失败」与「唤醒 1 次、失败 5 次」是
  // 两种完全相反的结论（issue #206）。
  const { sweeper, wakeCalls, warned, advance } = slowWakeSweeper({ deliveryLandsMs: 10_000_000 });
  const gaveUp = await advance(300_000, { until: () => warned.some((w) => /已停止自动/.test(w)) });
  assert.equal(gaveUp, true, '一条永远投不出去的提醒必须最终停下并告警');
  const line = warned.find((w) => /已停止自动/.test(w)) ?? '';
  const wakes = sweeper.wakesOf('session-slow');
  // 每一次失败都必须对应**一发真的唤醒**：这是 `pending` 那条状态机的全部意义。
  assert.equal(
    sweeper.failuresOf('session-slow'),
    wakes,
    `失败次数必须与唤醒次数一致（failures=${sweeper.failuresOf('session-slow')} wakes=${wakes}）`,
  );
  assert.equal(
    line.includes(`连续 ${wakes} 次冷唤醒失败`),
    true,
    `唤醒 ${wakes} 次、失败 ${wakes} 次时，告警就该说"连续 ${wakes} 次冷唤醒失败"；实际: ${line}`,
  );
  assert.ok(wakeCalls.length >= 5, `放弃之前必须真的重试过（实测唤醒 ${wakeCalls.length} 次）`);
  await sweeper.dispose();
});

test('唤醒落定后先给投递留结算窗：`nextAttempt` 不得停在这一发唤醒的起点', async () => {
  // 白盒但不脆：这条量的是那次 `poll` 之后 `nextAttempt` 有没有被往后推。
  // 修复前它等于 `at`（"可以判失败"与"唤醒落定"是同一时刻），正是 #206 的机制。
  const sessionId = 'session-slow';
  const t0 = 1_000_000;
  let clock = t0;
  const entry = dueEntry(t0 - 1000);
  const warned = [];
  const sweeper = createExpirySweeper({
    snapshots: () => [{ sessionId, entries: { 'schedule-1': entry } }],
    wake: () => new Promise((resolve) => setImmediate(resolve)),
    wakeable: () => true,
    resolveScheduledAt: () => undefined,
    warn: (message) => warned.push(String(message)),
    now: () => clock,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  });
  await sweeper.sweepNow();
  await flush();
  // 唤醒刚落定：此刻条目仍然到期，但**不允许**下"投递失败"的结论。
  clock += 1000;
  await sweeper.sweepNow();
  await flush();
  assert.equal(sweeper.failuresOf(sessionId), 0, '唤醒落定后的结算窗内不得记失败');
  assert.equal(warned.some((w) => /冷唤醒失败/.test(w)), false, '结算窗内不得告警');
  // 结算窗过去、提醒仍然到期 ⇒ 这才是"这一发真的没投出去"。
  clock += 60_000;
  await sweeper.sweepNow();
  await flush();
  assert.equal(sweeper.failuresOf(sessionId) >= 1, true, '窗口过后仍然到期才允许记第一次失败');
  await sweeper.dispose();
});

test('undelivered 的两个读数分开：本轮会随会话消失清算，累计不会（#206）', async () => {
  const t0 = 1_000_000;
  let clock = t0;
  const snapshots = { value: [{ sessionId: 'session-quiet', entries: { 'schedule-1': dueEntry(t0 - 1000) } }] };
  const sweeper = createExpirySweeper({
    snapshots: () => snapshots.value,
    wake: () => undefined,
    wakeable: () => false,
    refuseReason: () => 'quiet-window',
    resolveScheduledAt: () => undefined,
    warn: () => undefined,
    now: () => clock,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  });
  await sweeper.sweepNow();
  await flush();
  assert.equal(sweeper.undeliveredReasons().get('quiet-window'), 1, '本轮有一批被暂缓');
  assert.equal(sweeper.undeliveredTotal().get('quiet-window'), 1, '累计也是 1');

  // 会话的 sidecar 被删：它"正被暂缓"这件事不再成立 ⇒ 本轮读数必须清零，
  // 而累计读数记的是历史事实，不清。
  snapshots.value = [];
  clock += 1000;
  await sweeper.sweepNow();
  await flush();
  assert.equal(sweeper.undeliveredReasons().get('quiet-window'), undefined, '会话消失后本轮读数应被清算');
  assert.equal(sweeper.undeliveredTotal().get('quiet-window'), 1, '累计读数记的是历史，不清零');
  await sweeper.dispose();
});

test('「无法回算」的告警在条目消失后可以再响一次（两个 Set 不得只增不减）', async () => {
  // #206 的附带缺口：`warnedUnresolved` / `warnedUndelivered` 键形如 `会话/条目`，
  // 旧实现只增不减，而模块头承诺「条目删除后可解除」。后果是一次性的沉默：
  // 会话的提醒被删、后来又建一条同名 id 的，它那句告警再也不会响。
  const t0 = 1_000_000;
  let clock = t0;
  const warned = [];
  const entryOf = () => ({ delivery: 'context', createdAt: t0 - 10_000 }); // 缺 scheduledAt ⇒ 走回算
  const snapshots = { value: [{ sessionId: 'session-unresolved', entries: { 'schedule-1': entryOf() } }] };
  const sweeper = createExpirySweeper({
    snapshots: () => snapshots.value,
    wake: () => undefined,
    wakeable: () => true,
    resolveScheduledAt: () => undefined, // 回算不出来
    warn: (message) => warned.push(String(message)),
    now: () => clock,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  });
  await sweeper.sweepNow();
  await flush();
  assert.equal(warned.filter((w) => /无法从会话日志回算/.test(w)).length, 1, '缺时刻且回算不出来必须告警一次');

  // 同一轮再扫：不得刷屏（每项只喊一次）。
  clock += 1000;
  await sweeper.sweepNow();
  await flush();
  assert.equal(warned.filter((w) => /无法从会话日志回算/.test(w)).length, 1, '同一项只喊一次');

  // 会话从快照里消失 ⇒ 这句告警的"记忆"必须解除；它再出现（同名 id）时要能再喊。
  snapshots.value = [];
  await sweeper.sweepNow();
  await flush();
  snapshots.value = [{ sessionId: 'session-unresolved', entries: { 'schedule-1': entryOf() } }];
  await sweeper.sweepNow();
  await flush();
  assert.equal(
    warned.filter((w) => /无法从会话日志回算/.test(w)).length,
    2,
    '条目消失后同一形状的新条目必须能再告警一次（设置不能只增不减）',
  );
  await sweeper.dispose();
});

test('读侧三态在假时钟下不变：已消化的条目一次都不该唤醒', async () => {
  // 保护带：上面几条改了"什么时候判失败"，但**判据本身**（consumed 优先）不能被带着改。
  const past = Date.now() - 1000;
  assert.deepEqual(readDueIndex({ scheduledAt: past, dispatchedAt: past + 10 }), { kind: 'consumed' });
  assert.deepEqual(readDueIndex({ scheduledAt: past }), { kind: 'due', target: past });
});
