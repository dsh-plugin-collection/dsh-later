/**
 * `registerUserScheduleTools` 的注册回滚回归测试。
 *
 * 修前的形态：`const disposers = [register(A), register(B), register(C)]` 后面跟
 * `catch { dispose(); throw }`，而 `dispose` 是个 `() => undefined` 占位。数组字面量
 * 会把三个 register **全部执行完**才绑定，所以第 2 个抛错时第 1 个已进了宿主注册表且
 * 无句柄可拆——之后每次 attach 都撞 `already registered`，该会话永久拿不到 runtime。
 *
 * 这条只能直接驱动本函数才验得到：走完整 `apply` 要假的 cordis 上下文全套，成本高到
 * 从来没人写，于是这条纪律从未被测过。因此本测试是它唯一的看守。
 * @module tests/tool-register-rollback
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerUserScheduleTools } from '../lib/index.js';

const TOOL_NAMES = ['user_schedule_create', 'user_schedule_list', 'user_schedule_delete'];

/** 与宿主注册面同形的最小设置；本函数只读它，不校验来源。 */
const settings = () => ({
  maxSchedules: 20,
  allowLongPrompts: false,
  maxPromptChars: 1000,
  steerDelivery: 'followup',
  confirmDelivery: true,
  onUnconfirmed: 'keep',
  clockIconStyle: 'modern',
  advancedSyntax: true,
});

/**
 * 驱动一次注册。
 *
 * 分开记两件事，因为「注册被调用过」与「注册进了宿主表」在失败点上不一样：
 * - `attempted`：register 被调用的名字（含抛错那一次）
 * - `succeeded`：真正进了宿主注册表、因而**需要**被撤销的名字
 * - `undone`：实际被 disposer 拆掉的名字
 *
 * @param failOn - 第几次 register 调用抛错（1 起）；省略表示全部成功。
 */
function drive({ failOn } = {}) {
  const attempted = [];
  const succeeded = [];
  const undone = [];
  let calls = 0;

  const toolCtx = {
    tools: {
      register(definition) {
        calls += 1;
        attempted.push(definition.name);
        if (calls === failOn) throw new Error(`fake host refuses ${definition.name}`);
        succeeded.push(definition.name);
        // 宿主给每个注册一个**只拆自己**的 disposer。
        return () => undone.push(definition.name);
      },
    },
  };

  /** 半途失败时本函数会原样上抛；这里收下它，让断言只管侧效应。 */
  let error;
  let dispose;
  try {
    dispose = registerUserScheduleTools(
      { logger: { warn: () => undefined } },
      toolCtx,
      { id: 'agent-test' },
      settings,
      () => 'zh-CN',
      () => true,
    );
  } catch (thrown) {
    error = thrown;
  }
  return { attempted, succeeded, undone, dispose, error };
}

test('成功路径：三个用户工具全部注册，撤销按注册逆序拆干净', () => {
  const { attempted, succeeded, undone, dispose, error } = drive();
  assert.equal(error, undefined, `注册不该抛错：${error?.message}`);
  assert.deepEqual(attempted, TOOL_NAMES, '用户工具集变了——SKILL.md 的口径要同步');
  assert.deepEqual(succeeded, TOOL_NAMES);

  dispose();
  assert.deepEqual(undone, [...TOOL_NAMES].reverse());
});

test('撤销可重复调用且不报错（effect 拆两次是 cordis 的常态）', () => {
  const { undone, dispose } = drive();
  dispose();
  dispose();
  assert.equal(undone.length, 3, '第二次撤销重复拆了同一个注册');
});

test('第 2 个注册抛错：异常照原样上抛，第 1 个注册必须已被拆掉', () => {
  const { succeeded, undone, error, dispose } = drive({ failOn: 2 });

  assert.ok(error instanceof Error, '注册失败必须继续上抛，让调用方知道');
  assert.equal(error.message, 'fake host refuses user_schedule_list');
  assert.equal(dispose, undefined, '失败路径不该返回可用的 teardown');
  assert.deepEqual(succeeded, ['user_schedule_create'], '失败点之后的注册被执行了');
  // 修前这里是空数组：第 1 个注册留在宿主里，永远拆不掉。
  assert.deepEqual(
    undone,
    ['user_schedule_create'],
    '已成注册未回滚 → 下次 attach 必撞 already registered，该会话永久 no_runtime',
  );
});

test('第 3 个注册抛错：前两个都要拆掉（倒序）', () => {
  const { attempted, succeeded, undone, error } = drive({ failOn: 3 });
  assert.ok(error instanceof Error);
  assert.deepEqual(attempted, TOOL_NAMES, '第三次应当被尝试过');
  assert.deepEqual(succeeded, TOOL_NAMES.slice(0, 2));
  assert.deepEqual(undone, ['user_schedule_list', 'user_schedule_create'], '漏拆或顺序不对');
});
