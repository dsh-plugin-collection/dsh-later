/**
 * 门禁：设置卡**渲染出来的可写字段**必须是宿主 schema 声明的字段（issue #19）。
 *
 * ## 病灶
 *
 * `SchedulerSettingsCard` 的「时间设置」段一直在写 `workStart` / `workEnd` /
 * `lunchStart` / `lunchEnd` / `eveningEnd`，而宿主 `Config` 里一个都没有。于是：
 * 卡片照常渲染、用户照常改、面板照常工作，但值永远进不到设置层快照，客户端
 * `sanitizeSmartWindowConfig` 的逐项 `pick` 恒落空 → 面板永远用默认时段。
 * 用户看到的现象是「改了没反应」，没有任何一处会报错。
 *
 * ## 为什么这条缺陷能长期存活
 *
 * 本仓原有的设置面测试几乎全是 `readFileSync + 正则`：它们钉的是「某行代码还在」，
 * 而不是「两侧集合的关系」。`Config` 少五个字段、卡片多五个字段，正则各自都验得过，
 * 中间那条缝从来没人量。本文件补的就是那道缝，而且**不走正则读源码**：
 *
 *  - 卡片一侧：esbuild 现场编译 `src/client/components/SchedulerSettingsCard.tsx`，
 *    用 mini React **真的渲染**一次，从元素树里取出字段控件的 `id`（执行结果）；
 *  - 宿主一侧：`import { Config } from '../lib/index.js'`，读真实 schema 对象的 `dict`
 *    （与 0.2.0 宿主 `describe()` 生成表单时读的是同一个东西）。
 *
 * 因此改卡片（增删字段、改 id 约定）、改 schema（增删声明），两侧都会真的动起来，
 * 不需要谁去同步一份手抄清单。反向门禁（`Config` 声明了但卡片没渲染）在
 * `tests/upstream-compat.test.mjs`，两条合起来才是双向闭合。
 *
 * ## 「有牙」的判据
 *
 * 从 `src/index.ts` 的 `configSchema` 里删掉任意一个字段，本文件第一条断言必须变红；
 * 从卡片的 `SECTIONS` 里删掉一个 time 字段，第三条断言必须变红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../lib/index.js';
import { DEFAULT_SMART_WINDOW, SMART_WINDOW_ORDER } from '../lib/smart-window.js';
import {
  captureClientDicts,
  compileClientModule,
  findNode,
  makeHostRequire,
  writableFieldKeys,
} from './helpers/settings-render-harness.mjs';

/** 一个恒 ready、可写的设置 namespace（卡片的三条早退里只有 ready 会渲染出字段）。 */
function readyScope(value = {}) {
  return {
    getSnapshot: () => ({ status: 'ready', value, base: {}, user: {}, writable: true }),
    subscribe: () => () => undefined,
    set: async () => undefined,
    unset: async () => undefined,
  };
}

/**
 * 渲染一次设置卡，返回它真实画出来的可写字段 key 列表。
 * @param {Record<string, unknown>} [value] - 设置层快照的值（默认空 = 全部走默认渲染）。
 */
async function renderedFields(value = {}) {
  const hostRequire = makeHostRequire();
  const mod = await compileClientModule('client/components/SchedulerSettingsCard.tsx', hostRequire);
  const react = hostRequire('react');
  const view = react.__mount(react.createElement(mod.SchedulerSettingsCard, {
    scope: readyScope(value),
    t: (key) => key,
  }));
  return writableFieldKeys(view.tree);
}

/** 宿主 schema 真实声明的字段 key。 */
function schemaFields() {
  assert.equal(typeof Config?.dict, 'object', 'Config 应是一个 schemastery object schema');
  return Object.keys(Config.dict);
}

test('设置卡渲染出的可写字段 ⊆ 宿主 schema 声明的字段（issue #19 的门禁）', async () => {
  const rendered = await renderedFields();
  const declared = new Set(schemaFields());
  // 渲染没跑出来也算失败：否则「卡片整体白屏」会伪装成「字段集合是 schema 的子集」这条绿。
  assert.ok(rendered.length >= 15, `渲染出的可写字段异常地少（${rendered.length}）：${rendered.join(',')}`);
  const orphans = rendered.filter((key) => !declared.has(key));
  assert.deepEqual(
    orphans,
    [],
    `设置卡能写、但宿主 schema 没声明的字段：${orphans.join(', ')}——这些字段的改动永远不会落到设置层，面板只会一直用默认值`,
  );
});

test('五个智能时段字段两侧都在（防止「两边一起删」把上面的子集断言架空）', async () => {
  const rendered = new Set(await renderedFields());
  const declared = new Set(schemaFields());
  for (const key of Object.keys(DEFAULT_SMART_WINDOW)) {
    assert.ok(declared.has(key), `宿主 Config 缺少 ${key}：0.2.0 的表单由 Config 生成，缺它就没有这一项`);
    assert.ok(rendered.has(key), `设置卡没有渲染 ${key}：README 里「可在设置里改时段」的指引不可达`);
  }
});

test('卡片渲染出的 time 字段集合恰好等于序关系表覆盖的字段集合', async () => {
  const rendered = await renderedFields();
  // 卡片里 time 字段的判据：id 是 `ss-<key>`，且控件是 `<input type="time">`。
  const hostRequire = makeHostRequire();
  const mod = await compileClientModule('client/components/SchedulerSettingsCard.tsx', hostRequire);
  const react = hostRequire('react');
  const view = react.__mount(react.createElement(mod.SchedulerSettingsCard, {
    scope: readyScope(),
    t: (key) => key,
  }));
  const timeInputs = [];
  const walk = (node) => {
    if (node === null || typeof node !== 'object' || !('type' in node)) return;
    if (node.type === 'input' && node.props?.type === 'time') timeInputs.push(node.props.id.replace(/^ss-/, ''));
    for (const child of node.children ?? []) walk(child);
  };
  walk(view.tree);
  const coveredByOrderTable = new Set(SMART_WINDOW_ORDER.flat());
  assert.deepEqual(
    [...new Set(timeInputs)].sort(),
    [...coveredByOrderTable].sort(),
    '卡片的 time 输入框必须正好覆盖序关系表里的字段——多出来的格子没有跨字段校验，少掉的格子说明表与卡片漂移了',
  );
  assert.ok(rendered.length >= timeInputs.length, 'time 字段本就该在可写字段集合里');
});

test('Config 里五个时段字段的默认值与 DEFAULT_SMART_WINDOW 同源', () => {
  const json = Config.toJSON();
  const root = json.refs[String(json.uid)];
  assert.ok(root && root.type === 'object', 'Config.toJSON() 应给出根 object 节点');
  for (const [key, fallback] of Object.entries(DEFAULT_SMART_WINDOW)) {
    const child = json.refs[root.dict[key]];
    assert.ok(child, `Config 里没有 ${key}`);
    assert.equal(child.type, 'string', `${key} 必须是 string schema（HH:mm）`);
    assert.equal(
      child.meta?.default,
      fallback,
      `${key} 的 schema 默认值应与 DEFAULT_SMART_WINDOW.${key} 一致，否则「设置页显示的回退值」与「面板实际回退的值」会分家`,
    );
  }
});

/**
 * 卡片在一次真实渲染里向 `t()` 要过哪些 key。
 * @param {Record<string, unknown>} [value] - 喂给快照的值；给一组序关系不成立的值可以把
 *   段尾那句跨字段提示也逼出来。
 */
async function askedKeys(value = {}) {
  const hostRequire = makeHostRequire();
  const mod = await compileClientModule('client/components/SchedulerSettingsCard.tsx', hostRequire);
  const react = hostRequire('react');
  const asked = new Set();
  const view = react.__mount(react.createElement(mod.SchedulerSettingsCard, {
    scope: readyScope(value),
    t: (key) => {
      asked.add(key);
      return key;
    },
  }));
  void view.tree;
  return asked;
}

test('卡片渲染时要过的每一个文案 key，zh / en 两份真字典里都取得到值', async () => {
  // 两份都渲染：正常一组 + 序关系被写反的一组（后者才会渲染出段尾那句提示）。
  const asked = new Set([...(await askedKeys()), ...(await askedKeys({ workStart: '13:00' }))]);
  assert.ok(asked.size >= 20, `渲染只问到 ${asked.size} 个 key，卡片大概没跑起来`);
  assert.ok(asked.has('smartWindowOrderHint'), '序关系被写反时应当问到跨字段提示的 key');

  const { dicts, dispose } = await captureClientDicts();
  try {
    for (const lang of ['zh', 'en']) {
      const dict = dicts[lang];
      assert.ok(dict && typeof dict === 'object', `字典缺少 ${lang} 分支`);
      const absent = [...asked].filter((key) => typeof dict[key] !== 'string' || dict[key].trim().length === 0);
      assert.deepEqual(
        absent,
        [],
        `${lang} 字典里取不到这些 key（宿主对未注册的 key 是原样回显键名，界面上会直接显示 ${absent[0] ?? '…'} 这种裸 key）`,
      );
    }
  } finally {
    dispose();
  }
});

test('已保存的序关系违规（profile yml 那条路）也照样在段尾说明，而不是静默', async () => {
  const hostRequire = makeHostRequire();
  const mod = await compileClientModule('client/components/SchedulerSettingsCard.tsx', hostRequire);
  const react = hostRequire('react');
  const view = react.__mount(react.createElement(mod.SchedulerSettingsCard, {
    // 没有任何草稿，脏值来自已保存的 namespace（等价于 profile yml 手写了一组反序值）
    scope: readyScope({ workStart: '13:00', lunchStart: '12:00' }),
    t: (key) => key,
  }));
  const tree = view.tree;
  assert.ok(findNode(tree, (node) => node.props?.id === 'ss-window-order'), '已保存的组合违规时也应当给出说明');
  assert.equal(
    findNode(tree, (node) => node.props?.className === 'ss-card-save').props.disabled,
    true,
    '没有草稿时本来就不该可保存（这条把上面那句的存在性变成有意义的判据，而不是恰好 disabled）',
  );
});
