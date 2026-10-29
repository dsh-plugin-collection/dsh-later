/**
 * 智能时段设置 → 面板计算的端到端与降级（issue #19 的第二半：接上之后**非法值怎么办**）。
 *
 * 全部走真实执行：esbuild 现场编译设置卡与 `useSchedulerSettings`，mini React 真的渲染、
 * 真的调用 `onChange` / 保存按钮；时段由 `lib/smart-window.js` 的同一份纯函数算出来。
 * 没有一处是读源码正则。
 *
 * 覆盖四件事：
 *  1. **接通**：在卡片里改 `workStart` → 面板算出的下一个智能时段跟着变（有真实数字前后对比）；
 *  2. **回退**：点 reset（`unset`）之后回到默认；
 *  3. **降级**：非法 HH:mm 逐项回落、其余字段保留；序关系被破坏则整体回落默认，
 *     下游拿到的永远是可算的配置（`epoch` 是有限数，不是 NaN，也不是静默 `null`）；
 *  4. **拦截**：卡片自己不允许把破坏序关系的组合保存下去（脏值不会落进设置层）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SMART_WINDOW,
  nextSmartAt,
  nextSmartTarget,
  sanitizeSmartWindowConfig,
} from '../lib/smart-window.js';
import {
  compileClientModule,
  findNode,
  makeHostRequire,
} from './helpers/settings-render-harness.mjs';

const TZ = 'Asia/Shanghai';
/**
 * 2026-08-19 23:30（Asia/Shanghai，夜间静默中）。
 * 这个时刻是刻意选的：夜间静默下「下一个智能时段」的唯一候选就是**次日的 workStart**，
 * 所以 workStart 的每一处改动都会 1:1 反映到面板算出的目标时刻上——
 * 换成下午三点，最早候选是 workEnd(18:00)，改 workStart 反而看不出差别。
 */
const NOW = Date.parse('2026-08-19T15:30:00.000Z');

/** 把 epoch 投影成本地墙钟（判据用它，报错信息也用它）。 */
const wall = (ms) => new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(ms);

/**
 * 起一套「设置 namespace + 卡片 + 面板 hook」的活体环境。
 * `store` 就是宿主那一侧的合并值：卡片写它，hook 读它，两侧同一份对象。
 */
async function setUp(initial = {}) {
  const store = { ...initial };
  const hostRequire = makeHostRequire();
  const cardMod = await compileClientModule('client/components/SchedulerSettingsCard.tsx', hostRequire);
  const hookMod = await compileClientModule('client/hooks/useSchedulerSettings.ts', hostRequire);
  const react = hostRequire('react');
  const writes = [];

  const scope = {
    getSnapshot: () => ({ status: 'ready', value: { ...store }, base: {}, user: { ...store }, writable: true }),
    subscribe: () => () => undefined,
    set: async (key, value) => { writes.push({ op: 'set', key, value }); store[key] = value; },
    unset: async (key) => { writes.push({ op: 'unset', key }); delete store[key]; },
  };

  const cardView = react.__mount(react.createElement(cardMod.SchedulerSettingsCard, { scope, t: (key) => key }));

  // 面板那一侧：`SchedButton` 里就是这么调 hook 的，这里直接 mount 一个探针组件。
  let resolved;
  function Probe() { resolved = hookMod.useSchedulerSettings(scope); return null; }
  const hookView = react.__mount(react.createElement(Probe, { scope }));

  const readPanel = () => {
    void hookView.tree; // 重跑一次渲染 = 设置变更后的那一次重渲染
    return resolved;
  };

  /** 在卡片里改某格的值（真实 onChange）。 */
  const type = (key, value) => {
    const control = findNode(cardView.tree, (node) => node.props?.id === `ss-${key}`);
    assert.ok(control, `卡片没有渲染出 ${key}`);
    control.props.onChange({ target: { value } });
  };
  /** 点保存（真实 onClick）。 */
  const clickSave = async () => {
    const button = findNode(cardView.tree, (node) => node.props?.className === 'ss-card-save');
    assert.ok(button, '卡片没有渲染出保存按钮');
    const disabled = button.props.disabled;
    button.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { disabled, writes: writes.slice() };
  };

  return {
    store,
    writes,
    scope,
    type,
    clickSave,
    tree: () => cardView.tree,
    panel: readPanel,
    /** 面板此刻算出来的「智能」那一枚芯片的目标（SchedPanel 用的就是这个调用）。 */
    smartChip: () => nextSmartAt(NOW, TZ, readPanel().smartWindow),
  };
}

test('端到端：设置卡改 workStart → 面板的下一个智能时段随之改变', async () => {
  const env = await setUp();

  const before = env.smartChip();
  assert.ok(before, '默认配置下面板应能算出智能时段');
  assert.equal(before.time, '09:00:00', '默认 workStart=09:00 → 次日 09:00');
  assert.equal(wall(before.epoch), '2026-08-20, 09:00');

  const result = await (async () => {
    env.type('workStart', '11:00');
    return env.clickSave();
  })();
  assert.equal(result.disabled, false, '草稿合法时保存按钮应可点');
  assert.deepEqual(result.writes.at(-1), { op: 'set', key: 'workStart', value: '11:00' }, '保存必须真的写进 namespace');

  const after = env.smartChip();
  assert.equal(env.store.workStart, '11:00', '值已落在设置层');
  assert.equal(after.time, '11:00:00', 'workStart 改成 11:00 → 面板目标必须跟着变成次日 11:00');
  assert.equal(wall(after.epoch), '2026-08-20, 11:00');
  // 前后差的**真实数字**：这正是修复前拿不到的那 2 小时。
  assert.equal(after.epoch - before.epoch, 2 * 60 * 60 * 1000);

  // 再改一格，确认不是一次性巧合。
  env.type('workStart', '07:30');
  await env.clickSave();
  const again = env.smartChip();
  assert.equal(wall(again.epoch), '2026-08-20, 07:30');
});

test('reset（unset）之后回到默认时段', async () => {
  const env = await setUp({ workStart: '11:00' });
  assert.equal(wall(env.smartChip().epoch), '2026-08-20, 11:00');

  // 真实点 reset 按钮 → pending.reset → 保存时走 scope.unset
  const reset = findNode(env.tree(), (node) => node.props?.className === 'ss-card-reset');
  assert.ok(reset, '已覆盖的字段应渲染出 reset 按钮');
  reset.props.onClick();
  const { writes } = await env.clickSave();
  assert.deepEqual(writes.at(-1), { op: 'unset', key: 'workStart' });
  assert.equal(env.store.workStart, undefined);
  assert.equal(wall(env.smartChip().epoch), '2026-08-20, 09:00', 'unset 后面板回到默认 09:00');
});

test('卡片拦下会破坏序关系的草稿：不落进设置层，并指出被写反的那两格', async () => {
  const env = await setUp();
  // workStart=13:00 而午休仍是默认 12:00 起 → 违反 workStart < lunchStart
  env.type('workStart', '13:00');
  const tree = env.tree();
  const save = findNode(tree, (node) => node.props?.className === 'ss-card-save');
  assert.equal(save.props.disabled, true, '序关系不成立时保存必须被禁用（否则用户改完得到一套算不出的时段）');

  const flagged = ['workStart', 'lunchStart'].map((key) => findNode(tree, (node) => node.props?.id === `ss-${key}`)?.props['aria-invalid']);
  assert.deepEqual(flagged, [true, true], '被写反的那两格应各自带 aria-invalid');
  const message = findNode(tree, (node) => node.props?.id === 'ss-window-order');
  assert.ok(message, '段尾应给出一次序关系说明（不是五格各挂一句）');
  assert.equal(message.props.role, 'status');

  await env.clickSave();
  assert.equal(env.store.workStart, undefined, '被拦住的草稿一个字都不该写进 namespace');
});

test('非法 HH:mm 逐项回落，其余字段保留（不因为一格脏就把用户整套抹掉）', async () => {
  const raw = {
    workStart: '25:00',
    workEnd: '20:00',
    lunchStart: '12:30',
    lunchEnd: '13:30',
    eveningEnd: '23:00',
  };
  const got = sanitizeSmartWindowConfig(raw);
  assert.equal(got.workStart, DEFAULT_SMART_WINDOW.workStart, '非法格式 → 该项回落默认');
  assert.equal(got.workEnd, '20:00');
  assert.equal(got.lunchStart, '12:30');
  assert.equal(got.lunchEnd, '13:30');
  assert.equal(got.eveningEnd, '23:00');
  const at = nextSmartAt(NOW, TZ, got);
  assert.ok(at !== null && Number.isFinite(at.epoch), '降级后的配置必须仍然算得出时段');
});

test('序关系被破坏（profile yml 直写这条路）→ 整体回落默认，绝不把 NaN 带进时段计算', async () => {
  const raw = { ...DEFAULT_SMART_WINDOW, workStart: '13:00' }; // 13:00 ≥ lunchStart 12:00
  assert.equal(
    sanitizeSmartWindowConfig(raw),
    DEFAULT_SMART_WINDOW,
    '序关系不成立时整体回落 DEFAULT_SMART_WINDOW（同一个引用，面板与卡片都读到它）',
  );

  const at = nextSmartAt(NOW, TZ, sanitizeSmartWindowConfig(raw));
  assert.ok(at !== null, '消费端降级之后「智能」芯片不该静默消失');
  assert.ok(Number.isFinite(at.epoch), 'epoch 必须是有限数');
  assert.equal(wall(at.epoch), '2026-08-20, 09:00');

  // 反面对照（**这就是修复前那类脏值的下场**，把结论钉在这里）：
  // 脏组合绕过消费端清洗直接进时段计算时，守卫会抛错、`nextSmartAt` 吞成 null，
  // 面板上「智能」那一格直接消失，而另两格仍显示互相矛盾的时刻。
  assert.throws(() => nextSmartTarget(NOW, TZ, raw), TypeError);
  assert.equal(nextSmartAt(NOW, TZ, raw), null);
});

test('逐项回落自己造出违规组合时，也走整体回落（两级降级互不矛盾）', () => {
  // lunchStart=08:00 合法格式，但回落后的 workStart 默认 09:00 就 > 它了
  const got = sanitizeSmartWindowConfig({ lunchStart: '08:00' });
  assert.equal(got, DEFAULT_SMART_WINDOW);
});

test('面板 hook：未就绪时回默认，就绪后跟随设置值（引用稳定由 hook 自己保证）', async () => {
  const env = await setUp();
  assert.equal(env.panel().ready, true);
  assert.equal(env.panel().smartWindow.workStart, '09:00');
  env.type('workStart', '10:15');
  await env.clickSave();
  assert.equal(env.panel().smartWindow.workStart, '10:15', '保存后面板读到的就是新值（applies: live 的客户端一半）');
});
