/**
 * 「管子接缝」（B2）的源码级断言集（设计见 Gitea issue #41，本文件对应 #42 §1）。
 *
 * 缺陷本体：宿主 QueueDock 的根带 `margin: 0 auto calc(0px - var(--dsh-composer-stack-gap) -
 * 3px)`（-9px，抵掉 6px 的 composer gap 后**故意向下重叠 3px**）——那是宿主的消缝手法：队列面板
 * 底边「直角 + 开口」，由下一层不透明底盖掉 3px，接缝处不留发丝缝。本插件 dock（order 30）逐值
 * 抄了这套 attach 壳却排在队列条**之下**，于是队列条那块「底边开口 + 被盖 3px」的收口落到了提醒条
 * 的「圆角顶 + .5px 顶描边」上 → 接缝处双缘重影（2026-10-16 用户截图，demo 实测
 * hostPanel.bottom - ssBody.top = 3px）。这正是 dock-alignment.md §5 G3 当初登记「代码断言不了、
 * 必须进真实 GUI」的那一条。
 *
 * 解法 B2：宿主零改动，插件 styles 追加两条相邻兄弟规则（`[data-queue-dock] + .ss-dock-root …`），
 * 把提醒条顶边改成直角 + 无顶描边；**-9px 重叠保留不动**。
 *
 * 本文件锁的是**只活在 CSS 文本里、一重构就静默失效**的七条性质：
 *
 *  1. 两条管子规则逐字在册（选择器被人「顺手改名」＝管子行为静默消失，且只在两 dock 同屏时才看得见）；
 *  2. 两条规则不带 `!important`（带了就说明有人在跟宿主抢特异性，此后任何覆盖都得接着抢）；
 *  3. 基线未被替换：管子是**叠加**不是改写 —— `.ss-dock-root` 的 -9px、`.ss-dock-body` 的顶圆角、
 *     `.ss-dock-body::after` 的底边开口都还在。管子方案依赖那 3px 消缝重叠，谁动负边距这里必须红；
 *  4. 源序：两条管子规则排在 `.ss-dock-body` / `.ss-dock-body::after` 基础规则**之后**（同特异性靠
 *     后者生效，顺序颠倒＝修复不生效，而这在单条 dock 的回归测试里完全看不出来）；
 *  5. 选择器目标仍存在：组件根仍挂 `className="ss-dock-root"`（改名后两条规则永不命中）；
 *  6. demo 与 styles.ts 同源（#41 的判据来自 docs/dock-stacking-demo.html 实测，两处必须同一把尺；
 *     demo 随 #41 入库，未入库时该条 skip）；
 *  7. 反向守卫：没有任何规则把 `.ss-dock-root` 的负边距拉平成 0 或改成正值 —— 那是 #41 选型过程里
 *     被明确否决的初稿 B 做法（拉平 -6px→0 反而把 3px 消缝打开，接缝出现亮线）。
 *
 * 风格同 `dock-collapse-a11y.test.mjs` / `panel-official-style.test.mjs`：**源码级断言，零依赖**
 * （node:test + node:assert/strict + readFileSync），不搭 DOM、不引渲染库。
 * @module tests/dock-tube-seam
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const styles = read('src/client/styles.ts');
const component = read('src/client/components/ScheduleDock.tsx');
const demoUrl = new URL('../docs/dock-stacking-demo.html', import.meta.url);
const demoExists = existsSync(demoUrl);

/** 数一下 `needle` 出现的次数。 */
const count = (haystack, needle) => haystack.split(needle).length - 1;

/** 管子两条规则：选择器 + 声明，逐字即 #41 设计文本（也是 #42 §1 第一条的核对对象）。 */
const TUBE = [
  { selector: '[data-queue-dock] + .ss-dock-root .ss-dock-body', decl: 'border-radius: 0;' },
  { selector: '[data-queue-dock] + .ss-dock-root .ss-dock-body::after', decl: 'border-top: none;' },
];
/** 单行规则全文（styles.ts 里每条规则是一个数组元素）。 */
const tubeRule = (t) => `${t.selector} { ${t.decl} }`;

/** 队列条 -9px 负边距里的关键片段：管子方案保留的 3px 消缝重叠（#41 根因 3）。 */
const OVERLAP = 'calc(0px - var(--dsh-composer-stack-gap) - 3px)';

/**
 * 把 styles.ts 里 CSS 数组的字符串元素还原成浏览器实际注入的那段 CSS：
 * 只取带引号的行（数组元素）→ 去引号去尾逗号 → 拼起来 → 再剥掉 `/* *\/` 注释块。
 *
 * 为什么不在原文上做规则断言：注释里合法地会提到选择器甚至整条规则（#41 就要求就地写明契约），
 * 拿原文计数会把「注释里引用」误算成「规则存在」；剥掉注释后数到的才是真规则。
 */
const cssFrom = (source) =>
  source
    .split('\n')
    .filter((line) => /^\s*['"]/.test(line))
    .map((line) => {
      const text = line.trim().replace(/,$/, '');
      const quote = text[0];
      return (quote === "'" || quote === '"') && text.length > 1 && text.endsWith(quote)
        ? text.slice(1, -1)
        : text;
    })
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

const css = cssFrom(styles);

/**
 * 行级状态机：把 CSS 拆成 `{ selector, body }` 列表。
 * 单行规则（`'.ss-x { a: b; }',`）与多行规则（收尾行 `'}',`）都收；@media / @keyframes 里的嵌套
 * 规则按「顶层规则」收 —— 对本文件够用：反向守卫正因为这个才连 @media 里的 override 一起管住。
 */
const parseRules = (text) => {
  const rules = [];
  let pending = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const open = line.indexOf('{');
    if (open !== -1) {
      if (pending) { rules.push(pending); pending = null; }
      const close = line.indexOf('}', open + 1);
      if (close !== -1) {
        rules.push({ selector: line.slice(0, open).trim(), body: line.slice(open + 1, close).trim() });
      } else {
        pending = { selector: line.slice(0, open).trim(), body: '' };
      }
      continue;
    }
    if (!pending) continue;
    const close = line.indexOf('}');
    if (close === -1) pending.body = `${pending.body} ${line}`.trim();
    else {
      pending.body = `${pending.body} ${line.slice(0, close)}`.trim();
      rules.push(pending);
      pending = null;
    }
  }
  if (pending) rules.push(pending);
  return rules;
};

const rules = parseRules(css);

/** 取选择器**逐字**等于 `selector` 的规则（管子是叠加，基础规则的选择器不带相邻兄弟前缀）。 */
const ruleOf = (selector) => {
  const hits = rules.filter((r) => r.selector === selector);
  assert.ok(
    hits.length >= 1,
    `styles.ts 里找不到逐字选择器 ${selector} 的规则 —— 基线被动过（改名或并入别的规则）` +
      `，管子的两条规则会因目标消失而静默失效`,
  );
  return hits[0];
};

test('styles.ts 含管子两条规则，逐字且各一条（#41 设计 / #42 §1 第一条）', () => {
  for (const t of TUBE) {
    const full = tubeRule(t);
    assert.equal(
      count(css, full),
      1,
      `缺一条或重复：${full}\n` +
        '选择器被改名（或声明被拆成多行）＝管子行为静默消失：只有宿主队列条与本 dock 同屏时才可见，' +
        '单人回归测试抓不到，接缝双缘重影（#41 的原始缺陷）会原样复发',
    );
    // 数组元素形态：整条规则占一个元素（行尾 `'` + 可选逗号）—— #41 权威文本就是这个形态。
    // 用整行正则而不是「所在行结尾」：契约注释里也会逐字引用规则文本，只查结尾会认错行。
    const form = new RegExp(`^\\s*['"]${full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"],?\\s*$`);
    assert.ok(
      styles.split('\n').some((line) => form.test(line)),
      `管子规则必须是 styles.ts CSS 数组里的单个元素：${full}\n` +
        '规则被拆成多行（或只在注释里出现）本身不一定是缺陷，但与 #41 权威文本的约定不一致，' +
        '需 lead 裁决后同步本断言',
    );
  }
});

/**
 * 取管子规则的**声明体**（按选择器逐字定位）。走剥过注释的规则表而不是原文：
 * #41 要求就地写明契约，注释里合法地会出现同一串选择器，只有规则表才是浏览器真正应用的东西。
 */
const tubeBodyOf = (selector) => {
  const hits = rules.filter((r) => r.selector === selector);
  assert.equal(
    hits.length,
    1,
    `styles.ts 里选择器逐字为 ${selector} 的规则应有且只有一条（实到 ${hits.length} 条）` +
      '—— 缺了或被复制过，都无从再核对 !important',
  );
  return hits[0].body;
};

test('管子两条规则不得使用 !important（#41 设计里它们是普通声明）', () => {
  for (const t of TUBE) {
    const body = tubeBodyOf(t.selector);
    assert.doesNotMatch(
      body,
      /!important/,
      `${t.selector} 里出现了 !important：` +
        '管子靠的是「宿主队列条在场时该规则才命中 + 源序排在基础规则之后」，特异性本就够；' +
        '抢 !important 说明它被写在了错误的位置，此后任何调整（主题、折叠态、第三方 dock）都得继续抢，' +
        '最终只剩硬覆盖能改这条接缝',
    );
    assert.equal(
      body.replace(/\s+/g, ' ').trim(),
      t.decl,
      `${t.selector} 的声明与 #41 设计文本不一致（实到 ${body}，应为 ${t.decl}）`,
    );
  }
});

test('管子是叠加不是替换：负边距 / 顶圆角 / 底边开口三条基线仍在（#41 根因 3、#42 §1 第二条）', () => {
  // ① 外壳负边距：-9px 抵掉 6px gap → 净重叠 3px。管子的「段间消缝」直接依赖它。
  const rootRule = ruleOf('.ss-dock-root');
  assert.match(
    rootRule.body,
    /margin:\s*0 auto calc\(0px - var\(--dsh-composer-stack-gap\) - 3px\)/,
    `.ss-dock-root 的 margin 不再是 0 auto ${OVERLAP}：` +
      '那 3px 重叠是宿主刻意设计的消缝手法（面板底边开口被下一层不透明底盖掉），' +
      '拉平成 0 或改小都会把接缝重新打开 —— 初稿 B 正是死在这里（#41 选型过程第一条 ❌）',
  );
  // ② 面板顶圆角：无队列条时（solo）仍是圆角顶 —— #41 硬约束「solo 像素零差异」的前提。
  const bodyRule = ruleOf('.ss-dock-body');
  assert.match(
    bodyRule.body,
    /border-radius:\s*var\(--dsw-radius-lg\)\s+var\(--dsw-radius-lg\)\s+0\s+0/,
    '.ss-dock-body 的顶圆角被改动：管子只在队列条在场时把顶边拉直（靠追加规则），' +
      '基础规则一旦改成直角，solo 观感就跟着变了，#41 的「无队列条时观感零变化」当场失效',
  );
  // ③ 描边层底边开口：::after 仍留 `border-bottom: none`。
  const afterRule = ruleOf('.ss-dock-body::after');
  assert.ok(
    afterRule.body.includes('border-bottom: none'),
    '.ss-dock-body::after 不再留底边开口：管子论证第 2 条（接缝带内没有任何水平线）依赖' +
      '「队列条 ::after 无底边 + 提醒条 ::after 去顶边」，补回底边就在管子中段横插一条线',
  );
});

test('源序：两条管子规则排在 .ss-dock-body / .ss-dock-body::after 基础规则之后（#41 设计「放在 …::after 之后」）', () => {
  /** 规则在 styles.ts 里的**源序位置**（parseRules 保序，注入时也按这个顺序拼进 <style>）。 */
  const order = rules.map((r) => r.selector);
  const at = (selector) => {
    const i = order.indexOf(selector);
    assert.notEqual(i, -1, `styles.ts 里找不到规则 ${selector}，源序无从核对`);
    return i;
  };
  const baseBodyAt = at('.ss-dock-body');
  const baseAfterAt = at('.ss-dock-body::after');
  assert.ok(baseBodyAt < baseAfterAt, '基础规则自身的顺序也变了（管子注释以 ::after 之后为落点）');
  for (const t of TUBE) {
    const tubeAt = at(t.selector);
    assert.ok(
      tubeAt > baseAfterAt,
      `管子规则 ${t.selector}（位置 ${tubeAt}）没有排在 .ss-dock-body::after 基础规则（位置 ${baseAfterAt}）之后：` +
        '两者特异性同为单类级别、靠源序后者生效，写在前头等于没修 —— ' +
        '而接缝重影只在宿主队列条与本 dock 同屏时出现，日常回归完全看不出来',
    );
  }
});

test('选择器目标仍在：ScheduleDock 根节点挂 ss-dock-root（#42 §1 死类名自查）', () => {
  assert.equal(
    count(component, 'className="ss-dock-root"'),
    1,
    'ScheduleDock.tsx 的 dock 根不再是唯一一处 className="ss-dock-root"：' +
      '管子两条规则以 .ss-dock-root 为锚，类名一改就永不命中，接缝双缘重影复发（且 CSS 侧一切照旧，最难查）',
  );
});

test(
  'demo 与 styles.ts 同源：docs/dock-stacking-demo.html 的 B2 选择器逐字一致（#41 选型依据 / #42 §3）',
  { skip: demoExists ? false : 'docs/dock-stacking-demo.html 尚未入库（它随 #41 的实现分支提交，合并后本条自动生效）' },
  () => {
    /*
     * demo 用 `.scheme[data-scheme="X"]` 把各方案隔离开，所以它的规则头比真实实现多一层前缀；
     * 而 demo 里 `.ss-dock-body` / `.ss-dock-root` 的**基础**规则（抄宿主的 attach 壳）也大量出现。
     * 判据因此只认「带 [data-queue-dock] 的规则头」：剥掉方案前缀后，剩余部分必须与 styles.ts
     * 里的管子选择器逐字相同，声明体也必须含同一条声明 —— #42 §3 说的「demo 与真机同一把尺」。
     */
    const demo = readFileSync(demoUrl, 'utf8');
    const demoLines = demo.split('\n');
    const demoTube = new Map();
    demoLines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line.includes('[data-queue-dock]') || !line.includes('{')) return;
      const open = line.indexOf('{');
      const selector = line.slice(0, open).trim().replace(/^\.scheme\[data-scheme="[^"]*"\]\s*/, '');
      let body = line.slice(open + 1);
      const close = body.indexOf('}');
      if (close === -1) {
        // 声明体写在下一行（demo 的 B2 段正是这种形态）：往下收到第一个 `}` 为止。
        for (let j = i + 1; j < demoLines.length; j++) {
          const next = demoLines[j];
          const end = next.indexOf('}');
          if (end === -1) body += ` ${next.trim()}`;
          else { body += ` ${next.slice(0, end)}`; break; }
        }
      } else {
        body = body.slice(0, close);
      }
      demoTube.set(selector, body.replace(/\s+/g, ' ').trim());
    });
    for (const t of TUBE) {
      assert.ok(
        demoTube.has(t.selector),
        `demo 里没有逐字的选择器 ${t.selector}（实到：${JSON.stringify([...demoTube.keys()])}）：` +
          '#41 的无缝论证是在 demo 上实测出来的，demo 与实现用不同选择器＝判据与产物脱钩，' +
          '以后照 demo 复核真实 GUI 得到的结论代表不了 lib 里的样式',
      );
      assert.ok(
        demoTube.get(t.selector).includes(t.decl.replace(/\s+/g, ' ')),
        `demo 中 ${t.selector} 的声明与 styles.ts 不一致（应含 ${t.decl}，实到 ${demoTube.get(t.selector)}）：` +
          '两处必须同一把尺，否则 demo 绿而实现红（或反之）都说明不了问题',
      );
    }
  },
);

test('反向守卫：没有任何规则把 .ss-dock-root 的负边距改成 0 或正值（#42 §1 第二条 / 否决初稿 B）', () => {
  const offenders = rules.filter(
    (r) =>
      r.selector.includes('.ss-dock-root') &&
      /(?:^|[;\s])margin(?:-(?:top|bottom|left|right))?\s*:/.test(r.body) &&
      !r.body.includes(OVERLAP),
  );
  assert.deepEqual(
    offenders.map((r) => `${r.selector} { ${r.body} }`),
    [],
    '出现了对 .ss-dock-root 的 margin 覆盖，且不含 -9px（' + OVERLAP + '）：' +
      '管子方案明确保留那 3px 消缝重叠，拉平或转正会让队列面板底边重新露出，接缝亮线回来',
  );
});
