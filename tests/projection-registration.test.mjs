/**
 * 投影注册的**跨代收敛点**回归测试（issue #118）。
 *
 * ## 这条护栏挡的是什么
 *
 * `sessionProjections.register()` 的返回契约在 `0.2.2-alpha.2` 变了：
 *
 * - ≤0.2.1：`register(definition): () => void`，同步语义的 disposer；
 * - 0.2.2-alpha.2+：`register(definition): Promise<ProjectionHandle<S>>`，并附一条时序要求
 *   —— *Callers must await registration before publishing consumers*。
 *
 * ## 先把一条**错误叙事**排除掉（SPEC §3.2a）
 *
 * 不能写成「不 await 就会读不到投影 / 会掉 dock」。实测证伪了它：alpha.2 的注册表写入发生在
 * `acquire()` 的**同步段**（`dsh-session-projection/lib/index.js:127-151`，由 `ctx.effect`
 * 同步执行），唯一的 `await` 在 :153，消费者读面（`summaryKeys()` / `snapshot()`）全是同步
 * 读注册表，注册过程中没有任何「发布消费方」点。同 turn 探针实测：`register()` 返回后立刻
 * `summaryKeys()` 就已包含 `userSchedules`；端到端连「只改 engines、lib 仍是不 await 的 HEAD
 * 代码」也是 mount+function GREEN、投递 5/5、首读即见。
 *
 * 所以本文件钉的是**契约对齐**，不是"修一个已观测到的 bug"：上游把 callable 形态标了
 * deprecated 并要求先 await，我们照契约做；这里的判据把「我们真的在 await」固定成事实，
 * 免得哪天有人把它简化回 `.then()` 而没人发现——那种简化今天不可观测，等上游取掉兜底那天
 * 才会变现。
 *
 * ## 为什么第一条用例最要紧：alpha.2 的返回值**既是函数又是 thenable**
 *
 * 实测 `~/dsh-versions/0.2.2-alpha.2/node_modules/@deepseek-ai/dsh-session-projection/lib/index.js:80-109`：
 * `register()` 返回 `Object.assign(dispose, { then, catch, finally, [Symbol.toStringTag]: 'Promise' })`。
 * 也就是说**不 await 也能 `typeof === 'function'` 通过**。于是「先判函数、再判 thenable」
 * 这个实现顺序的问题不会以失败形式出现 —— 它会静默走老分支、跳过 await。
 * 只有「可调用 + thenable」这一条形状能把该回归判红，因此它排在最前面。上游同时把
 * callable 形态标了 deprecated，方向是 thenable 优先。
 *
 * ## 第二条要紧的：两代返回的是**同一种形状、两种解析值**（SPEC §3.2b）
 *
 * 老代次的 `register()` 返回的也不是裸函数，而是 cordis `ctx.effect` 产出的、带 `.then` 的
 * AsyncDisposable（`0.2.1-rc.4 …/dsh-session-projection/lib/index.js:68`；
 * `cordis/lib/index.js:1239/1274`）。只是它 **await 出来的解析值是 disposer 函数本身**，
 * `.dispose` 为 undefined；而 alpha.2 await 出来的是 `{dispose, stateOf, readerFor}` 对象。
 *
 * 只判「是不是 thenable、是就当 handle」的简化实现会在**全部老代次**上静默回归：解析出的函数
 * 被当成「缺 dispose 的 handle」→ warn 一次、返回空 disposer → **注册永不被释放**（泄漏
 * 一个 registration）。这条回归在装配面看不出来，所以下面必须有「解析值为函数」的用例。
 *
 * ## 判定的是哪一个实现
 *
 * 被测物是 `src/projection-registration.ts` 的 `registerUserSchedulesProjection(registry, warn?)`
 * （issue #118 引入的唯一收敛点）。这里不复述内部写法，只断言**外部可观测**的行为：
 * thenable 时真的等它、按解析值分岔、以及所有异常形状都降级成空 disposer 而不是抛。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerUserSchedulesProjection } from '../lib/projection-registration.js';

/**
 * 让出到**宏任务**边界：微任务 flush 不足以区分「已经 await 过」与「还没轮到」，
 * 而 `setImmediate` 一定落在当前 tick 的微任务全部跑完之后。
 * @returns {Promise<void>}
 */
const flushToMacrotask = () => new Promise((resolve) => setImmediate(resolve));

/** 记录 warn 调用的收集器（顺序敏感：断言「恰好一次」而不是「至少一次」）。 */
function collectWarnings() {
  const messages = [];
  return { messages, warn: (message) => messages.push(String(message)) };
}

/** 一个手写的 deferred：只有测试自己决定何时 resolve。 */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * 复刻 alpha.2 的真实返回形状：可调用 + thenable + `Symbol.toStringTag === 'Promise'`。
 *
 * 注意 `callableCalls`：如果实现把这个对象当「老代次同步 disposer」直接调用，计数会 +1。
 * 这条计数是「先判函数」回归的第二个指纹（第一个是 then 从未被观测）。
 * @param {Promise<unknown>} promise - 真正决定注册何时完成的 promise。
 * @returns {{ thenable: object, callableCalls: () => number, thenCalls: () => number }}
 */
function callableThenable(promise) {
  let callableCalls = 0;
  let thenCalls = 0;
  const thenable = Object.assign(
    () => {
      callableCalls += 1;
    },
    {
      then(onFulfilled, onRejected) {
        thenCalls += 1;
        return promise.then(onFulfilled, onRejected);
      },
      catch(onRejected) {
        thenCalls += 1;
        return promise.catch(onRejected);
      },
      finally(onFinally) {
        thenCalls += 1;
        return promise.finally(onFinally);
      },
      [Symbol.toStringTag]: 'Promise',
    },
  );
  return { thenable, callableCalls: () => callableCalls, thenCalls: () => thenCalls };
}

/** 假 handle：只记 dispose 被调了几次，形状对齐 alpha.2 的 `ProjectionHandle`。 */
function fakeHandle() {
  const handle = {
    disposeCalls: 0,
    async dispose() {
      handle.disposeCalls += 1;
    },
    stateOf: () => undefined,
    readerFor: () => () => undefined,
  };
  return handle;
}

// ---------------------------------------------------------------------------
// 1. 最高优先级：可调用 + thenable（alpha.2 真实形状）必须先走 await 分支
// ---------------------------------------------------------------------------

test('可调用且 thenable（alpha.2 真实形状）：必须观测 then 并等它 resolve，不得当同步 disposer 用', async () => {
  const gate = deferred();
  const { thenable, callableCalls, thenCalls } = callableThenable(gate.promise);
  const handle = fakeHandle();
  const registry = { register: () => thenable };
  const { messages, warn } = collectWarnings();

  let settled = false;
  const pending = registerUserSchedulesProjection(registry, warn);
  // 断言「已经 settle」需要先挂回调，再跨过一个宏任务边界。
  void pending.then(() => {
    settled = true;
  });
  await flushToMacrotask();

  assert.ok(
    thenCalls() >= 1,
    '实现没有观测返回值的 .then：它被 typeof === "function" 短路了。alpha.2 的 register() 返回' +
      ' Object.assign(dispose, {then,...})，不 await 也照样是 function —— 这条短路不会报错，' +
      '只会静默丢掉「注册完成前不对外发布消费方」的时序。',
  );
  assert.equal(
    callableCalls(),
    0,
    '实现把 thenable 当老代次同步 disposer 调用了：那会把一个尚未物化的注册当成已释放',
  );
  assert.equal(settled, false, '返回值还没 resolve，注册函数就已经返回了 —— await 时序丢失');
  assert.equal(handle.disposeCalls, 0, 'registration 尚未完成，handle.dispose 不该被调用');

  gate.resolve(handle);
  const dispose = await pending;

  assert.equal(typeof dispose, 'function', 'await 完成后必须拿到可调用的 disposer');
  assert.equal(handle.disposeCalls, 0, '拿到 disposer 不等于已释放：dispose 应当是惰性的');
  await dispose();
  assert.equal(handle.disposeCalls, 1, 'disposer 必须调到 handle.dispose，且恰好一次');
  assert.deepEqual(messages, [], '这条形状是正常路径，不该 warn');
});

// ---------------------------------------------------------------------------
// 2. ≤0.2.1 的真实形状：thenable，但解析值是 disposer 函数本身（SPEC §3.2b）
// ---------------------------------------------------------------------------

test('thenable 解析为函数（老代次的真实形状，rc.2/rc.4）：当 disposer 用、不 warn', async () => {
  // 复刻 cordis `ctx.effect` 的 AsyncDisposable：它本身带 `.then`，await 出来是 disposer 函数，
  // 那个函数上**没有** `.dispose`（`cordis/lib/index.js:1274`）。0.2.1-rc.4 的 register()
  // 直接 `return this.ctx.effect(...)`，所以老代次拿到的就是这个形状。
  let upstreamCalls = 0;
  const legacyDispose = () => {
    upstreamCalls += 1;
  };
  const settledFunction = { then: (onFulfilled) => Promise.resolve(legacyDispose).then(onFulfilled) };
  const registry = { register: () => settledFunction };
  const { messages, warn } = collectWarnings();

  const dispose = await registerUserSchedulesProjection(registry, warn);

  assert.equal(typeof dispose, 'function', '解析值是函数，收敛点必须给出可调用的 disposer');
  assert.deepEqual(
    messages,
    [],
    '解析值为函数就是老代次的正常路径，**一次 warn 都不该有**。出现 warn 只可能是一个原因：' +
      '实现把 this 函数当成了「缺 dispose 的 ProjectionHandle」，而那意味着注册永不释放。',
  );
  await dispose();
  assert.equal(upstreamCalls, 1, '解析出的函数必须被当 disposer 调回上游恰好一次');
  await assert.doesNotReject(async () => dispose());
});

// ---------------------------------------------------------------------------
// 3. 新代次：Promise<handle>
// ---------------------------------------------------------------------------

test('新代次 Promise<handle>：resolve 之前拿不到可用 disposer，await 之后 dispose 被调用一次', async () => {
  const gate = deferred();
  const handle = fakeHandle();
  const registry = { register: () => gate.promise };
  const { messages, warn } = collectWarnings();

  let settled = false;
  const pending = registerUserSchedulesProjection(registry, warn);
  void pending.then(() => {
    settled = true;
  });
  await flushToMacrotask();

  assert.equal(settled, false, 'register 返回的 promise 还没 resolve，收敛点就先返回了');
  assert.equal(handle.disposeCalls, 0, '注册未完成时不该有 dispose');

  gate.resolve(handle);
  const dispose = await pending;
  assert.equal(typeof dispose, 'function');
  await dispose();
  assert.equal(handle.disposeCalls, 1);
  assert.deepEqual(messages, []);
});

// ---------------------------------------------------------------------------
// 4. 老代次（防御分支）：非 thenable 的裸同步 disposer
// ---------------------------------------------------------------------------

test('老代次同步 disposer：注册时不提前调用，dispose 时恰好调回上游一次', async () => {
  // 注意：这条测的是**非 thenable 的裸函数**返回（防御分支），不是老内核的真实形状。
  // 真实的老代次走上面那条「解析值为函数」的 thenable 路径（SPEC §3.2b）；这里保留裸函数，
  // 因为假 registry 与将来某个同步实现会直接返回函数，这条分支不能被静默删掉。
  let upstreamCalls = 0;
  const registry = {
    register: () => () => {
      upstreamCalls += 1;
    },
  };
  const { messages, warn } = collectWarnings();

  const dispose = await registerUserSchedulesProjection(registry, warn);
  assert.equal(typeof dispose, 'function', '老代次形态也要收敛成同一个签名（disposer 可调用）');
  assert.equal(upstreamCalls, 0, '注册阶段不得调用上游 disposer');

  await dispose();
  assert.equal(upstreamCalls, 1, 'dispose 一次就调回上游一次，不多不少');
  assert.deepEqual(messages, []);
});

test('老代次 disposer 二次调用不抛（幂等性属于上游那一代，收敛点只负责不把异常外抛）', async () => {
  let upstreamCalls = 0;
  const registry = {
    register: () => () => {
      upstreamCalls += 1;
    },
  };
  const dispose = await registerUserSchedulesProjection(registry, () => {});
  await dispose();
  // 不锁「第二次是否重复委托」：老代次 disposer 自身是否幂等是那一代的契约，
  // 收敛点的职责只是不额外抛错、不吞掉第一次调用。
  await assert.doesNotReject(async () => dispose());
  assert.ok(upstreamCalls >= 1);
});

// ---------------------------------------------------------------------------
// 5. handle 缺 dispose（防御）
// ---------------------------------------------------------------------------

test('handle 缺 dispose：warn 一次、不抛，返回可安全调用的空 disposer', async () => {
  const gate = deferred();
  const registry = { register: () => gate.promise };
  const { messages, warn } = collectWarnings();

  const pending = registerUserSchedulesProjection(registry, warn);
  gate.resolve({ stateOf: () => undefined }); // 没有 dispose
  const dispose = await pending;

  assert.equal(typeof dispose, 'function');
  assert.equal(messages.length, 1, '缺 dispose 是契约降级，必须 warn —— 恰好一次，别在 dispose 时再喊');
  assert.match(messages[0], /dispose/, 'warn 要指明缺的是什么，否则日志读不出结论');
  await assert.doesNotReject(async () => dispose());
});

// ---------------------------------------------------------------------------
// 6. 未知返回形状
// ---------------------------------------------------------------------------

test('未知返回形状（42 / 裸字符串 / 无原型对象）：warn、不抛，返回空 disposer', async () => {
  // 用显式标签而不是 `String(value)` 拼消息：`Object.create(null)` 转原始值本身就会抛
  // （`Cannot convert object to primitive value`），那会让用例在报错信息里失败而不是在被测行为上失败。
  const shapes = [
    { label: '42', value: 42 },
    { label: "'dispose-me'", value: 'dispose-me' },
    { label: 'Object.create(null)', value: Object.create(null) },
  ];
  for (const { label, value } of shapes) {
    const { messages, warn } = collectWarnings();
    const registry = { register: () => value };
    const dispose = await registerUserSchedulesProjection(registry, warn);
    assert.equal(typeof dispose, 'function', `形状 ${label} 也要降级成空 disposer`);
    assert.equal(messages.length, 1, `形状 ${label} 必须 warn 一次`);
    await assert.doesNotReject(async () => dispose());
  }
});

test('未知形状且没传 warn：不抛（warn 是可选的诊断通道，不是前置条件）', async () => {
  const registry = { register: () => 42 };
  const dispose = await registerUserSchedulesProjection(registry);
  assert.equal(typeof dispose, 'function');
  await assert.doesNotReject(async () => dispose());
});

// ---------------------------------------------------------------------------
// 7. thenable reject
// ---------------------------------------------------------------------------

test('thenable reject：warn 带原因、不抛、我们这侧不留 unhandledRejection', async () => {
  const failure = new Error('refusing to share key userSchedules');
  // 构造一个「被 await 时 reject」的 thenable。注意先在同一 tick 内挂上处理者，
  // 免得这份夹具自己就成为 unhandledRejection 的来源（那会让本用例变成在测测试自己）。
  const rejected = Promise.reject(failure);
  const thenable = {
    then: (onFulfilled, onRejected) => rejected.then(onFulfilled, onRejected),
  };
  rejected.catch(() => {});

  const { messages, warn } = collectWarnings();
  const registry = { register: () => thenable };

  /** @type {unknown[]} */
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const dispose = await registerUserSchedulesProjection(registry, warn);
    assert.equal(typeof dispose, 'function', '注册失败也必须给一个可调用的空 disposer，让 effect 能收尾');
    await assert.doesNotReject(async () => dispose());
    // 跨两个宏任务边界：unhandledRejection 的判定发生在微任务队列清空之后。
    await flushToMacrotask();
    await flushToMacrotask();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }

  assert.equal(messages.length, 1, 'reject 必须 warn 一次，不许静默吞掉');
  assert.match(messages[0], /refusing to share key userSchedules/, 'warn 必须带上原因，否则日志里只剩「失败了」');
  assert.deepEqual(
    unhandled,
    [],
    '收敛点自己不许漏出一条未处理的 rejection。注意理由不是「否则会炸」：alpha.2 内部对未被观测的 ' +
      'reject 有 setImmediate 兜底（走 owner.logger.error），所以这条断言挡的是**我们**在 await 分支里' +
      '丢了处理者这种实现缺陷，不是宿主没有护栏。',
  );
});
