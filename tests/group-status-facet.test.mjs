/**
 * 分组状态 facet（issue #36）：dsh-later 自己注册，输出必须与过渡基线逐字一致。
 *
 * ## 这个文件在防什么
 *
 * 迁移前「定时任务」进折叠徽标这件事由 dsh-group-status 的过渡适配器
 * `src/client/legacy/schedule.ts` 代管。issue 的验收口径是：**注册前后徽标逐字不变**
 * （数字、色档、脉冲、`aria-label`、悬停明细）。
 *
 * 所以下面把那份适配器的算法**照抄成 oracle**（`legacy*` 一组函数），让实现与它对拍。
 * oracle 不是「我认为应该怎么显示」，而是「它今天显示什么」——这才是本 issue 要的基线。
 * group-status 侧删掉 `legacy/` 之后，这份 oracle 仍留在本仓当回归线：以后想改口径，
 * 得先在这里把对拍改掉，改动就自带「我单方面偏离了迁移基线」的记录，而不是静默生效。
 *
 * ## 两层覆盖
 *
 *  1. 纯逻辑（`lib/schedule-facet.js`）：fold / merge / label / 取色，零依赖直接跑。
 *  2. 注册面（`lib/client.js` 的 `apply`）：驱动真实 bundle，用假登记面接住 facet，
 *     再按 dsh-group-status 的**同一条调用序列**（getSnapshot → fold → label → renderIcon）
 *     读出徽标会显示的东西，与 oracle 比。三条容错分支（对方缺席 / 无登记面 / 版本不符）
 *     也在这一层——「整插件不能因此不激活」只有跑真实 apply 才算验证过。
 * @module tests/group-status-facet.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LATER_SCHEDULE_FACET_ID,
  LATER_SCHEDULE_FACET_ORDER,
  LATER_SCHEDULE_FACET_PROTOCOL,
  LATER_SCHEDULE_FACET_SETTING_KEY,
  facetIconColor,
  foldLaterSchedule,
  laterScheduleFacetLabel,
  mergeLaterSchedule,
} from '../lib/schedule-facet.js';

// ── 过渡基线（oracle）：逐行照抄 group-status src/client/legacy/schedule.ts ─────────

/** 适配器里的状态优先级。 */
const LEGACY_RANK = { scheduled: 1, urgent: 2, overdue: 3 };

/** 过渡适配器的 fold：`count` 取组内**有任务的会话数**。 */
function legacyFoldSchedule(snapshot, sessionIds) {
  let sessions = 0;
  let tasks = 0;
  let state;
  if (snapshot !== undefined) {
    for (const id of sessionIds) {
      const item = snapshot.get(id);
      if (item === undefined) continue;
      sessions += 1;
      tasks += item.count;
      if (state === undefined || LEGACY_RANK[item.state] > LEGACY_RANK[state]) state = item.state;
    }
  }
  return {
    count: sessions,
    tone: state === 'overdue' ? 'error' : state === 'urgent' ? 'warn' : 'info',
    pulse: state === 'overdue' || state === 'urgent',
    data: { tasks, state },
  };
}

/** 过渡适配器的跨层 merge。 */
function legacyMergeFold(a, b) {
  const rankA = a.data?.state === undefined ? 0 : LEGACY_RANK[a.data.state];
  const rankB = b.data?.state === undefined ? 0 : LEGACY_RANK[b.data.state];
  const state = rankB > rankA ? b.data?.state : a.data?.state;
  return {
    count: a.count + b.count,
    tone: state === 'overdue' ? 'error' : state === 'urgent' ? 'warn' : 'info',
    pulse: a.pulse || b.pulse,
    data: { tasks: (a.data?.tasks ?? 0) + (b.data?.tasks ?? 0), state },
  };
}

/**
 * 过渡适配器的文案：`${count} ${t('status.scheduled')}`。
 * 两个词值取自 group-status `src/client/locales.ts`（zh `定时任务` / en `Scheduled`）。
 */
const LEGACY_WORD = { zh: '定时任务', en: 'Scheduled' };
const legacyLabel = (fold, lang) => `${fold.count} ${LEGACY_WORD[lang]}`;

/** 过渡适配器的取色（legacy/register-legacy-facets.tsx 的 TONE_COLOR）。 */
const LEGACY_TONE_COLOR = {
  info: '#8b5cf6',
  warn: 'var(--dsw-alias-state-warn-secondary)',
  error: 'var(--dsw-alias-state-error-primary)',
};

/** 一条会话摘要事实（store 快照的条目形状）。 */
const entry = (count, state, extra = {}) => ({ count, pausedCount: 0, state, ...extra });
const mapOf = (rows) => new Map(Object.entries(rows));

/** 徽标上真正可见的那几项；`data` 是私有形状，不参与对拍。 */
const badgeVisible = (fold) => ({ count: fold.count, tone: fold.tone, pulse: fold.pulse });

/**
 * 剥掉注释，只留代码体（结构不变式用）。
 *
 * 直接对源文件正则，会被**解释这件事的注释**自己打中：本仓多处注释写着「不要走
 * `globalThis.require`」，于是 `doesNotMatch(/globalThis\.require/)` 永远红。
 * 说明性文字不该参与结构判定，判定只看代码。
 * @param src - 源文件文本。
 * @returns 去掉块注释与行注释后的文本。
 */
function codeOf(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 分组样例表：每组 = 一份 store 快照 + 组内会话 id。
 * fold 对拍与 merge 对拍共用同一批样例，免得「两处 fixture 各写一遍、各漂各的」。
 */
const GROUPS = {
  twoScheduled: { snapshot: mapOf({ a: entry(1, 'scheduled'), b: entry(2, 'scheduled') }), ids: ['a', 'b'] },
  overdueMix: { snapshot: mapOf({ a: entry(1, 'scheduled'), b: entry(3, 'overdue') }), ids: ['a', 'b'] },
  urgentMix: { snapshot: mapOf({ a: entry(1, 'scheduled'), b: entry(3, 'urgent') }), ids: ['a', 'b'] },
  urgentAndOverdue: { snapshot: mapOf({ a: entry(1, 'urgent'), b: entry(1, 'overdue') }), ids: ['a', 'b'] },
  halfEmpty: { snapshot: mapOf({ a: entry(2, 'scheduled'), c: entry(1, 'urgent') }), ids: ['a', 'b', 'c'] },
  allPaused: { snapshot: mapOf({ a: { count: 4, pausedCount: 4, state: 'scheduled' } }), ids: ['a'] },
  noMembers: { snapshot: mapOf({ a: entry(1, 'overdue') }), ids: [] },
  noSnapshot: { snapshot: undefined, ids: ['a'] },
};

/** 同一样例分别过一遍实现与 oracle。 */
const mine = (group) => foldLaterSchedule(group.snapshot, group.ids);
const baseline = (group) => legacyFoldSchedule(group.snapshot, group.ids);

// ── 1. 纯逻辑与基线对拍 ────────────────────────────────────────────────────────────

for (const [name, group] of Object.entries(GROUPS)) {
  test(`fold 与过渡基线一致：${name}`, () => {
    assert.deepEqual(badgeVisible(mine(group)), badgeVisible(baseline(group)));
    assert.equal(
      laterScheduleFacetLabel(mine(group), LEGACY_WORD.zh),
      legacyLabel(baseline(group), 'zh'),
      '文案（进 aria-label 与悬停明细）必须与基线逐字一致',
    );
  });
}

const MERGE_PAIRS = [
  ['twoScheduled', 'overdueMix'],
  ['urgentMix', 'twoScheduled'],
  ['twoScheduled', 'twoScheduled'],
  ['overdueMix', 'urgentMix'],
  ['allPaused', 'urgentMix'],
];

for (const [nameA, nameB] of MERGE_PAIRS) {
  test(`跨层 merge 与过渡基线一致：${nameA} + ${nameB}`, () => {
    const a = GROUPS[nameA];
    const b = GROUPS[nameB];
    assert.deepEqual(
      badgeVisible(mergeLaterSchedule(mine(a), mine(b))),
      badgeVisible(legacyMergeFold(baseline(a), baseline(b))),
      '多层文件夹的合并读数偏离基线',
    );
  });
}

test('merge 的私有 data：会话数 / 任务数 / 暂停数相加，nextAt 取更早', () => {
  const a = foldLaterSchedule(mapOf({ a: { count: 3, pausedCount: 1, nextAt: 5_000, state: 'scheduled' } }), ['a']);
  const b = foldLaterSchedule(mapOf({ b: { count: 2, pausedCount: 0, nextAt: 3_000, state: 'urgent' } }), ['b']);
  const merged = mergeLaterSchedule(a, b);
  assert.deepEqual(merged.data, { sessions: 2, count: 5, pausedCount: 1, nextAt: 3_000, state: 'urgent' });
  assert.equal(merged.count, 2, '徽标数字是会话数，不是任务数（与基线同口径）');
  assert.equal(merged.tone, 'warn');
  assert.equal(merged.pulse, true);
});

test('fold 是纯函数：同一入参重复调用给同样结果', () => {
  const group = GROUPS.urgentAndOverdue;
  assert.deepEqual(mine(group), mine(group));
  assert.deepEqual(
    foldLaterSchedule(group.snapshot, [...group.ids].reverse()),
    mine(group),
    '会话顺序不影响结果',
  );
});

test('取色与过渡适配器逐档一致，未知色档回落 info', () => {
  for (const tone of ['info', 'warn', 'error']) {
    assert.equal(facetIconColor(tone), LEGACY_TONE_COLOR[tone]);
  }
  // 协议允许「加新的 tone 取值不升版本」：陌生色档也必须给出颜色。直接下标取值会拿到
  // undefined，于是图标跟着主题色走——徽标悄悄变色且不报错，正是本 issue 要消灭的那类漂移。
  assert.equal(facetIconColor('critical'), LEGACY_TONE_COLOR.info);
  assert.equal(facetIconColor(undefined), LEGACY_TONE_COLOR.info);
});

test('协议常量：id / settingKey / order / protocol 与过渡适配器同名同值', () => {
  assert.equal(LATER_SCHEDULE_FACET_ID, 'dsh-later.schedule', '换名就顶不掉代管的适配器，同一条事实会被数两遍');
  assert.equal(LATER_SCHEDULE_FACET_PROTOCOL, 1);
  assert.equal(LATER_SCHEDULE_FACET_SETTING_KEY, 'showScheduledInBadge', '挂到既有开关上：用户关掉的还是同一个开关');
  assert.equal(LATER_SCHEDULE_FACET_ORDER, 10, '图标在徽标排格里的位置不随迁移改变');
});

// ── 2. 注册面：驱动真实 bundle ──────────────────────────────────────────────────────

/**
 * 装载 client bundle（与 tests/client-summary-api.test.mjs 同一套 shim）。
 * @param options.groupStatus - 假对端；`null` = 未安装 / 未启用（require 抛错）。
 * @param options.localeActive - 宿主当前语言（可变闭包，用来验语言切换）。
 * @param options.registry - 假登记面（可预置内容模拟过渡适配器已代管）。
 */
async function loadClientBundle({ groupStatus = 'default', localeActive = () => 'zh', registry } = {}) {
  const fakeRegistry = registry ?? makeFakeRegistry();
  const src = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  let captured;
  const savedWindow = globalThis.window;
  globalThis.window = {
    __ModuleLoader__: { load: (def) => { captured = def; } },
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    innerHeight: 800,
  };
  const iconCache = new Map();
  const primitivesHooks = {
    useAnchoredPosition: () => ({ left: '0px', top: '0px' }),
    useDismissOnOutsidePointer: () => {},
  };
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', src)(globalThis.window);
    if (captured === undefined) throw new Error('bundle did not register a module');
    const require = (id) => {
      if (id === 'react') {
        return {
          // 元素要返回**可比较的普通对象**：图标参与基线对拍，一律给 null 就等于没验。
          createElement: (type, props, ...children) => ({ type, props: props ?? null, children }),
          Fragment: 'Fragment',
          useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
          useEffect: () => {},
          useLayoutEffect: () => {},
          useMemo: (f) => f(),
          useCallback: (f) => f,
          useRef: (v) => ({ current: v }),
          useSyncExternalStore: (_sub, get) => get(),
        };
      }
      if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') {
        return { jsx: () => null, jsxs: () => null, Fragment: () => null };
      }
      if (id === 'react-dom' || id === 'react-dom/client') {
        return { createPortal: () => null, createRoot: () => ({ render() {}, unmount() {} }) };
      }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') {
        return new Proxy({}, {
          get: (_t, name) => {
            if (typeof name !== 'string') return undefined;
            if (name in primitivesHooks) return primitivesHooks[name];
            if (!name.startsWith('Icon')) throw new Error(`unexpected primitives export: ${name}`);
            // 同名图标必须给**同一个函数**：React 元素比对要的是身份，每次新建匿名函数
            // 就永远比不出「图标是不是同一个组件」。
            if (!iconCache.has(name)) iconCache.set(name, function IconStub() { return null; });
            return iconCache.get(name);
          },
        });
      }
      if (id === 'dsh-group-status/client') {
        // 未安装 / 未启用：宿主模块表里没有这一行，require 抛错。
        if (groupStatus === null) throw new Error("Cannot find module 'dsh-group-status/client'");
        return groupStatus === 'default' ? fakeRegistry : groupStatus;
      }
      throw new Error(`unexpected host require: ${id}`);
    };
    const mod = captured.factory(require);
    // icons 交出去：图标断言要比**组件身份**，光看名字证明不了「用的是宿主那一份」。
    return { mod, ctx: makeCtx(localeActive), registry: fakeRegistry, icons: iconCache };
  } finally {
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
  }
}

/**
 * 假登记面：复刻 group-status `facets.ts` 的决胜规则——同 id 由来源决胜
 * （provider 恒胜 legacy）、同来源覆盖、`remove(id, facet)` 只摘「还是自己」的那一份。
 */
function makeFakeRegistry() {
  const entries = new Map();
  const originRank = { legacy: 0, provider: 1 };
  return {
    GROUP_STATUS_FACET_PROTOCOL_VERSION: 1,
    registerGroupStatusFacet(facet) {
      const origin = facet.origin === 'legacy' ? 'legacy' : 'provider';
      const existing = entries.get(facet.id);
      if (existing !== undefined && originRank[existing.origin] > originRank[origin]) {
        return () => {}; // 被更高来源顶掉：返回空操作（与真实现同形）
      }
      entries.set(facet.id, { facet, origin });
      return () => {
        const current = entries.get(facet.id);
        if (current !== undefined && current.facet === facet) entries.delete(facet.id);
      };
    },
    /** 预置一个同 id 的代管登记（模拟 group-status 的 apply 先跑）。 */
    preinstallLegacy(id) {
      const facet = { id, origin: 'legacy', fold: () => ({ count: 999, tone: 'info', pulse: false }) };
      entries.set(id, { facet, origin: 'legacy' });
      return facet;
    },
    entries,
  };
}

/** 最小 sessions 服务桩（projectionValues 里放 userSchedules）。 */
function makeSessions(byId) {
  let current = { byId };
  const listeners = new Set();
  return {
    list: {
      getSnapshot: () => current,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    refresh: async () => {},
    set(next) {
      current = { byId: next };
      for (const listener of [...listeners]) listener();
    },
  };
}

/** 驱动 apply 的 ctx 桩（与 tests/client-summary-api.test.mjs 同形）。 */
function makeCtx(localeActive) {
  const slots = {
    register: () => () => {},
    inject: (hole, fn) => {
      try {
        fn();
      } catch {
        /* 插槽注册在本测不参与渲染 */
      }
    },
    subscribe: () => () => {},
    entries: () => [],
    entriesOfSlot: () => [],
  };
  const ctx = {
    get: (name) => {
      if (name === 'slots') return slots;
      if (name === 'sessions') return ctx.sessions;
      if (name === 'locale') {
        return {
          getSnapshot: () => ({ active: localeActive(), revision: 1 }),
          subscribe: () => () => {},
          register: () => () => {},
          bind: () => (key) => key,
        };
      }
      return undefined;
    },
    effect: (fn) => {
      const dispose = fn();
      if (typeof dispose === 'function') ctx.disposers.push(dispose);
      return () => {};
    },
    on: () => () => {},
    inject: (_names, callback) => callback(ctx),
    slots,
    disposers: [],
    sessions: makeSessions({}),
  };
  return ctx;
}

const NOW_MS = Date.now();
const iso = (offsetMs) => new Date(NOW_MS + offsetMs).toISOString();
const ROW_FUTURE = { projectionValues: { userSchedules: { schedules: [{ scheduled_at: iso(60 * 60_000) }] } } };
const ROW_URGENT = { projectionValues: { userSchedules: { schedules: [{ scheduled_at: iso(60_000) }] } } };
const ROW_OVERDUE = { projectionValues: { userSchedules: { schedules: [{ scheduled_at: iso(-60_000) }] } } };

/** 取本插件登记到假登记面上的那一份。 */
function registered(registry) {
  const held = registry.entries.get(LATER_SCHEDULE_FACET_ID);
  assert.ok(held !== undefined, `登记面上必须有一个 ${LATER_SCHEDULE_FACET_ID}`);
  return held;
}

test('注册面：apply 登记 provider facet，并顶掉过渡适配器', async () => {
  const registry = makeFakeRegistry();
  const legacy = registry.preinstallLegacy(LATER_SCHEDULE_FACET_ID);
  const { ctx, mod } = await loadClientBundle({ registry });
  ctx.sessions = makeSessions({ a: ROW_FUTURE });
  mod.apply(ctx);
  try {
    const held = registered(registry);
    assert.notEqual(held.facet, legacy, 'provider 注册必须顶掉 legacy 适配器，否则同一条事实数两遍');
    assert.equal(held.origin, 'provider');
    const facet = held.facet;
    assert.equal(facet.protocol, LATER_SCHEDULE_FACET_PROTOCOL);
    assert.equal(facet.id, LATER_SCHEDULE_FACET_ID);
    assert.equal(facet.settingKey, LATER_SCHEDULE_FACET_SETTING_KEY);
    assert.equal(facet.order, LATER_SCHEDULE_FACET_ORDER);
    for (const name of ['subscribe', 'getSnapshot', 'fold']) {
      assert.equal(typeof facet[name], 'function', `协议必填成员 ${name} 必须在`);
    }
    assert.equal(typeof facet.merge, 'function', '要跨层合并 data 就必须自带 merge');
  } finally {
    for (const dispose of ctx.disposers) dispose();
  }
});

test('注册面：徽标读数 / 文案与基线逐字一致（zh 与 en）', async () => {
  const CASES = [
    { rows: { a: ROW_FUTURE, b: ROW_FUTURE }, ids: ['a', 'b'], lang: 'zh' },
    { rows: { a: ROW_URGENT, b: ROW_FUTURE }, ids: ['a', 'b'], lang: 'zh' },
    { rows: { a: ROW_OVERDUE, b: ROW_URGENT }, ids: ['a', 'b'], lang: 'en' },
    { rows: { a: ROW_FUTURE }, ids: ['a'], lang: 'en' },
    { rows: { a: ROW_FUTURE }, ids: ['a', 'absent'], lang: 'zh' },
    { rows: {}, ids: ['ghost'], lang: 'zh' },
  ];
  for (const { rows, ids, lang } of CASES) {
    const registry = makeFakeRegistry();
    const { ctx, mod } = await loadClientBundle({ registry, localeActive: () => lang });
    ctx.sessions = makeSessions(rows);
    mod.apply(ctx);
    try {
      const { facet } = registered(registry);
      const snapshot = mod.getScheduleSummaryStore().getSnapshot();
      const fold = facet.fold(facet.getSnapshot(), ids, Date.now());
      const label = facet.label(fold, { now: Date.now(), t: (key) => LEGACY_WORD[lang] });
      const expect = legacyFoldSchedule(snapshot, ids);
      assert.deepEqual(
        badgeVisible(fold),
        badgeVisible(expect),
        `组 ${JSON.stringify(ids)}（${lang}）的徽标读数偏离基线`,
      );
      assert.equal(label, legacyLabel(expect, lang), 'aria-label / 悬停明细的措辞必须逐字一致');
      // count 与 label 同源：徽标数字与句子里的数字不许各说一套。
      assert.ok(label.startsWith(`${fold.count} `), `label 要以徽标数字开头：${label}`);
    } finally {
      for (const dispose of ctx.disposers) dispose();
    }
  }
});

test('注册面：图标是同一棵元素树（官方描边时钟 14px + 按色档上色）', async () => {
  const registry = makeFakeRegistry();
  const { ctx, mod, icons } = await loadClientBundle({ registry });
  ctx.sessions = makeSessions({ a: ROW_OVERDUE });
  mod.apply(ctx);
  try {
    const { facet } = registered(registry);
    const snapshot = mod.getScheduleSummaryStore().getSnapshot();
    const icon = facet.renderIcon(facet.fold(snapshot, ['a'], Date.now()), {});
    assert.equal(icon.type, 'span', '外层 span 负责上色（与适配器 glyph() 同构）');
    assert.deepEqual(icon.props.style, {
      color: LEGACY_TONE_COLOR.error,
      display: 'inline-flex',
      alignItems: 'center',
    });
    assert.equal(icon.children.length, 1);
    // 比**组件身份**而不是名字：过渡基线画的就是宿主 primitives 的 IconClockOutlineRegular，
    // 换成自绘 SVG 会让 0.1.x 用户的徽标在迁移当天变样。
    assert.equal(
      icon.children[0].type,
      icons.get('IconClockOutlineRegular'),
      '图标必须取自宿主 primitives 的同一份时钟组件',
    );
    assert.deepEqual(icon.children[0].props, { size: 14 });

    for (const [tone, color] of [
      ['info', LEGACY_TONE_COLOR.info],
      ['warn', LEGACY_TONE_COLOR.warn],
      ['error', LEGACY_TONE_COLOR.error],
    ]) {
      const glyph = facet.renderIcon({ count: 1, tone, pulse: tone !== 'info' }, {});
      assert.equal(glyph.props.style.color, color, `${tone} 档取色不一致`);
    }
  } finally {
    for (const dispose of ctx.disposers) dispose();
  }
});

test('容错：对端未安装 / 未启用时 apply 一切正常，console 无新增输出', async () => {
  const noise = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args) => noise.push(['warn', args.join(' ')]);
  console.error = (...args) => noise.push(['error', args.join(' ')]);
  try {
    const { ctx, mod } = await loadClientBundle({ groupStatus: null });
    ctx.sessions = makeSessions({ a: ROW_FUTURE });
    mod.apply(ctx);
    assert.ok(mod.getScheduleSummaryStore() !== undefined, '对方缺席时本插件的 store 照常建立');
    assert.equal(mod.getScheduleSummaryStore().getSnapshot().size, 1, '定时摘要本身不受影响');
    assert.deepEqual(noise, [], `不该有新增 console 输出：${JSON.stringify(noise)}`);
    for (const dispose of ctx.disposers) dispose();
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test('容错：对端是旧版（还没有登记面）时静默跳过——它仍在替我们画徽标', async () => {
  const noise = [];
  const originalWarn = console.warn;
  console.warn = (...args) => noise.push(args.join(' '));
  try {
    const { ctx, mod } = await loadClientBundle({ groupStatus: { GROUP_STATUS_FACET_PROTOCOL_VERSION: 1 } });
    mod.apply(ctx);
    assert.deepEqual(noise, [], '没有登记面不是错误：每次启动刷一条没人能处理的警告，会淹掉真问题');
    for (const dispose of ctx.disposers) dispose();
  } finally {
    console.warn = originalWarn;
  }
});

test('协议版本对不上时可见地跳过（「注册了为什么没显示」必须能查）', async () => {
  const noise = [];
  const originalWarn = console.warn;
  console.warn = (...args) => noise.push(args.join(' '));
  try {
    const registry = makeFakeRegistry();
    registry.GROUP_STATUS_FACET_PROTOCOL_VERSION = 2;
    const { ctx, mod } = await loadClientBundle({ registry });
    mod.apply(ctx);
    assert.equal(registry.entries.size, 0, '不能把 v1 的实现按 v2 协议登记过去');
    assert.equal(noise.length, 1, `应当恰好一条警告，实际：${JSON.stringify(noise)}`);
    assert.match(noise[0], /dsh-later/);
    assert.match(noise[0], /2/);
    for (const dispose of ctx.disposers) dispose();
  } finally {
    console.warn = originalWarn;
  }
});

test('数据迟到不影响徽标：store 通知就是对方重渲染的时机', async () => {
  const registry = makeFakeRegistry();
  const { ctx, mod } = await loadClientBundle({ registry });
  ctx.sessions = makeSessions({});
  mod.apply(ctx);
  const { facet } = registered(registry);

  let bumped = 0;
  const unsubscribe = facet.subscribe(() => { bumped += 1; });
  assert.equal(facet.fold(facet.getSnapshot(), ['late'], Date.now()).count, 0, '没有数据时按「此刻无贡献」处理');

  ctx.sessions.set({ late: ROW_URGENT });
  assert.ok(bumped > 0, '数据到达必须通知订阅者，否则徽标要等到下一次轮询才出现');
  const fold = facet.fold(facet.getSnapshot(), ['late'], Date.now());
  assert.equal(fold.count, 1);
  assert.equal(fold.tone, 'warn');

  unsubscribe();
  const before = bumped;
  ctx.sessions.set({ late: ROW_OVERDUE, other: ROW_FUTURE });
  assert.equal(bumped, before, '退订后不得再被通知');
  for (const dispose of ctx.disposers) dispose();
});

test('热重载与卸载：新登记不被旧 dispose 摘掉，卸载后不留登记', async () => {
  const registry = makeFakeRegistry();
  const first = await loadClientBundle({ registry });
  first.ctx.sessions = makeSessions({ a: ROW_FUTURE });
  first.mod.apply(first.ctx);
  const facetA = registered(registry).facet;

  // 热重载：新的 apply 先登记，旧的 dispose 后跑（宿主不保证这个先后，两种都得成立）。
  const second = await loadClientBundle({ registry });
  second.ctx.sessions = makeSessions({ a: ROW_FUTURE });
  second.mod.apply(second.ctx);
  const facetB = registered(registry).facet;
  assert.notEqual(facetA, facetB, '每次 apply 各自登记一份实现');

  for (const dispose of first.ctx.disposers) dispose();
  assert.equal(registered(registry).facet, facetB, '旧 dispose 不得摘掉新登记（对端 remove(id, facet) 语义）');

  for (const dispose of second.ctx.disposers) dispose();
  assert.equal(registry.entries.get(LATER_SCHEDULE_FACET_ID), undefined, '本插件卸载后不留登记');
});

test('文案跟随宿主语言切换：label 现取字典，不冻结在激活那一刻', async () => {
  let lang = 'zh';
  const registry = makeFakeRegistry();
  const { ctx, mod } = await loadClientBundle({ registry, localeActive: () => lang });
  ctx.sessions = makeSessions({ a: ROW_FUTURE });
  mod.apply(ctx);
  try {
    const { facet } = registered(registry);
    const fold = facet.fold(facet.getSnapshot(), ['a'], Date.now());
    assert.equal(facet.label(fold, {}), '1 定时任务');
    lang = 'en';
    assert.equal(facet.label(fold, {}), '1 Scheduled', '语言切换后文案要跟着变（label 在对方渲染期现取）');
  } finally {
    for (const dispose of ctx.disposers) dispose();
  }
});

// ── 3. 结构不变式：可选依赖绝不能变成硬依赖 ────────────────────────────────────────

test('不变式：dsh-group-status 既不在 dsh.client.external，也不在模块级 inject', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(pkg?.dsh?.client?.external ?? [], [], '可选搭档写进 external = 对方缺席时本插件卡在 pending');

  const src = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8');
  const start = src.indexOf('const inject = [');
  const injectLine = src.slice(start, src.indexOf('];', start));
  assert.match(injectLine, /'locale'/, 'locale 仍在 client 顶层 inject（dock 的 t seat 依赖它）');
  assert.doesNotMatch(injectLine, /group-status/, '顶层 inject 是激活门控，列了它就等于把整个定时功能抵押出去');
});

test('不变式：对端读取走容错 require，登记排在 locale 字典与 store 之后', async () => {
  const glue = codeOf(await readFile(new URL('../src/client/group-status-facet.ts', import.meta.url), 'utf8'));
  assert.match(glue, /try \{[\s\S]*?require\(GROUP_STATUS_CLIENT\)/, 'require 对端会抛，必须兜住');
  // 宿主没有全局 require：走 globalThis 会静默拿到 undefined，整条集成「看起来装着、
  // 其实一直没工作」。注释里允许出现这个词，所以只在剥掉注释的代码体上断言。
  assert.doesNotMatch(glue, /globalThis\s*\.\s*require/, '必须用 factory 注入的 require');

  const src = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8');
  const localeAt = src.indexOf("'dsh-later: locale'");
  const facetAt = src.indexOf("'dsh-later: group status facet'");
  assert.ok(localeAt >= 0, 'locale 注册段还在');
  assert.ok(facetAt > localeAt, 'facet 登记必须排在 locale 字典注册之后：否则 aria-label 会念出裸键名');
  assert.ok(facetAt > src.indexOf('createScheduleSummaryStore('), 'facet 必须绑已创建的 store');
});
