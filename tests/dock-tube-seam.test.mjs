/**
 * 「管子接缝」的源码级断言集（缺陷本体见 Gitea issue #41，判据换形见 #42，
 * 设计事实来源 `docs/notes/dock-stack-contract.md` §2/§3 —— 本文件的 TUBE 就是 §2 的逐字抄本）。
 *
 * 缺陷本体：宿主 QueueDock 的根带 `margin: 0 auto calc(0px - var(--dsh-composer-stack-gap) -
 * 3px)`（-9px，抵掉 6px 的 composer gap 后**故意向下重叠 3px**）——那是宿主的消缝手法：队列面板
 * 底边「直角 + 开口」，由下一层不透明底盖掉 3px，接缝处不留发丝缝。本插件 dock（order 30）逐值
 * 抄了这套 attach 壳却排在队列条**之下**，于是队列条那块「底边开口 + 被盖 3px」的收口落到了提醒条
 * 的「圆角顶 + .5px 顶描边」上 → 接缝处双缘重影（2026-10-16 用户截图，demo 实测
 * hostPanel.bottom - ssBody.top = 3px）。这正是 dock-alignment.md §5 G3 当初登记「代码断言不了、
 * 必须进真实 GUI」的那一条。
 *
 * 判据演进：#41 落的是 **B2** —— 两条 `[data-queue-dock] + .ss-dock-root …` 相邻兄弟规则，而
 * `[data-queue-dock]` 是宿主 QueueDock 的**私有属性**：邻居改属性、或上面换成 goal/todo/第三方
 * dock，判据静默失效，而且「邻居身份对了但位置不对」时观感照样错。#42 把它换成 **B3（栈内位置
 * 契约）**：只依赖 `[data-slot]`（渲染器给所有插槽出口的公开锚点）与我们自己的 `.ss-dock-root`，
 * 读的是「我在栈里排第几」，与邻居是谁无关。
 *
 * 本文件锁的是**只活在 CSS 文本里、一重构就静默失效**的七条性质：
 *
 *  1. §2 三条规则逐字在册，且**恰好三条**（选择器被人「顺手改名」＝管子行为静默消失，且只在两条
 *     dock 同屏时才看得见；多加一条＝绕过设计文档私自改观感）；
 *  2. 三条规则不带 `!important`（带了就说明有人在跟宿主抢特异性，此后任何覆盖都得接着抢）；
 *  3. 基线未被替换：`.ss-dock-root` 的 -9px、`.ss-dock-body` 的顶圆角、`.ss-dock-body::after` 的
 *     底边开口都还在。管子方案依赖那 3px 重叠，谁动负边距这里必须红；
 *  4. 选择器目标仍存在：组件根仍挂 `className="ss-dock-root"`（改名后三条规则永不命中）；
 *  5. **反向守卫（新）**：`data-queue-dock` 在 `styles.ts` 出现 0 次 —— 本仓不再以任何形式引用
 *     那个私有属性；以及只允许 §2 A 那一条把下边距收回 0，别的形态（无前缀、或写成 `:last-child`
 *     的反向）命中即红 —— 它守的仍是「别把 attach 的 -9px 弄丢」；
 *  6. demo 与 styles.ts 同源，且 demo 真的复刻了渲染器形状（选择器依赖 `[data-slot]` 锚点把各条目
 *     包成兄弟，不模拟就等于没验）；
 *  7. 变异自证：把嗅探规则/别的 margin 覆盖塞回**内存里**的 styles.ts，判据必须变红 ——
 *     证明 5 的两条不是永真。
 *
 * 判据的区分力不是声称的，是**仓内可重跑的实验**：`scripts/seam-check/mutation-battery.mjs`
 * （13 条变异，跑法 `node scripts/seam-check/mutation-battery.mjs`，有失效即非 0 退出）。
 * **改了 §2 那三条规则、或改了 demo 的 B3 现场形状，必跑一次**；它不进 CI —— 它验的是判据本身，
 * 且要起 13 个临时树。当前一次运行：对照全绿 + 13/13 被**各自预期的**断言抓红。
 * 「一排 ✅」本身不算证据，电池靠四条规矩自证（细则见该脚本头）：① 每条变异显式
 * `{ name, file, expect, mut }`（早期用 `name.startsWith('1')` 猜改哪个文件，'10'..'13' 是被
 * 前缀巧合顺带匹配上的）；② 空操作自检**同文件同对象**比较（早期对所有变异都比 `out === styles`
 * 原文，demo 变异恒不等于它 → 锚点失配也永远报不出「变异未生效」，那一版因此是不可证的）；
 * ③ **对照运行**：未变异的树必须先全绿；④ **红要红在该红的地方**（无关的红不算抓到）。
 * 电池自己也被反证过：把现场探针退回 substring 版（`count(demo,'data-slot-error')>=2` 那种），
 * 它立刻报 **11/13** ——「删掉两个空锚点元素」「把假邻居挪到我们下面」两条抓不到。
 * 那两处**一开始没抓到**、现已改掉的洞，别再退回去：
 *  - 现场探针按 substring 数：`data-slot-error` 在散文与 JS 分支里也合法出现，删掉元素照样绿
 *    → 改成按**元素**与 **DOM 顺序**数（「上方是 X」不是「页面里某处有个 X」）；
 *  - 同源判据拿测试常量当基准（原 #6 的假绿，见下）。
 * 采集脚本里还有第三处同类问题：拿左右两半在页面原位截图直接比像素，两半 x 不同 →
 * 字形与描边的设备像素相位不同 → 「应相同」的两半实测差 6~1400 像素；改成孤立半区 +
 * 对齐自检（对不齐就判无效，不和稀泥）。
 *
 * ⚠ §3 判据 4 的**像素 AE 那一半不在 CI 里**（要浏览器，CI 的 node:22 容器没有 playwright）：
 *   CI 内只守「同源 + 形状 + 五现场存在」这三条结构判据，AE 走手工
 *   `scripts/seam-check/capture-b3-scenes.mjs`。
 *
 * 风格同 `dock-collapse-a11y.test.mjs` / `panel-official-style.test.mjs`：**源码级断言，零依赖**
 * （node:test + node:assert/strict + readFileSync），不搭 DOM、不引渲染库。
 *
 * ## 删掉的一条：原第 4 条「源序」（为什么这次不是改它而是删它）
 *
 * 原断言是「两条管子规则必须排在 `.ss-dock-body` / `.ss-dock-body::after` 基础规则**之后**」，
 * 理由写的是「两者特异性同为单类级别、靠源序后者生效」。**那个前提是错的**（设计文档 §2 原先也
 * 这么写，已一并改掉）：`[data-queue-dock] + .ss-dock-root .ss-dock-body` 是 (0,3,0)，新的
 * `[data-slot=…] > .ss-dock-root:not(:first-child) .ss-dock-body` 是 (0,4,0)，而基础规则只有
 * (0,1,0) —— 盖过基础规则靠的是**特指度**，把管子规则挪到基础规则前面，观感一个字都不变。
 * 剩下的唯一「次序」语义是 A→B 的阅读因果（A 让出栈底位、B 收顶边），不承载任何优先级，
 * 而且 A 与 B 命中**不同元素的不同声明**，本就互不争。所以这条断言在任何真实改动下都恒为真
 * ——留着就是一条假装在守护什么的永真断言，删。真正要防的「后写的规则反过来盖掉契约」由性质 3
 * （基线仍在）与性质 5（反向守卫）负责，它们都在。
 *
 * ## 修掉的一条假绿：原 #6「demo 与 styles.ts 同源」
 *
 * 原实现比的是 demo ↔ **TUBE 常量**，而 TUBE 与 demo 的 B2 段当时**同时**写着旧选择器，两边旧
 * 所以绿 —— 真实产物 `styles.ts` 根本不在比较链上。现在以 **styles.ts 为唯一基准**：先从
 * styles.ts 的规则表里读出契约规则，再去 demo 里找同一把尺。@module tests/dock-tube-seam
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

/**
 * §2 钉死的三条：选择器 + 声明逐字，**唯一事实来源是设计文档 §2 的代码块**，实现与测试都以它为准，
 * 不许任何一边再发明一遍。
 *
 * 条数从 #41 的两条变三条的理由（不是「数字变了」）：位置判据要表达两件独立的事 ——
 * 「我上面还有东西」（B 两条：顶边直角 + 去顶描边）和「我不是栈底、不该占着贴 composer 的那个位置」
 * （A 一条：负下边距收回 0）。#41 借邻居身份时只有前者，因为那时「上面是队列条」与「我不是栈底」
 * 恰好同真；换成位置判据后这两件事解耦了，A 必须显式写出来。§2 同时明写**不要**再加「非末位时
 * 闭合底边」一类规则（底边开口是基础态，同时正确于贴 composer 与管子中段两种情形），
 * 所以「恰好三条」也是判据的一部分 —— 见下面第 1 条断言。
 */
const TUBE = [
  { name: 'A', selector: '[data-slot="conversation.input.dock"] > .ss-dock-root:not(:last-child)', decl: 'margin-bottom: 0;' },
  { name: 'B1', selector: '[data-slot="conversation.input.dock"] > .ss-dock-root:not(:first-child) .ss-dock-body', decl: 'border-radius: 0;' },
  { name: 'B2', selector: '[data-slot="conversation.input.dock"] > .ss-dock-root:not(:first-child) .ss-dock-body::after', decl: 'border-top: none;' },
];
/** 单行规则全文（styles.ts 里每条规则是一个数组元素）。 */
const tubeRule = (t) => `${t.selector} { ${t.decl} }`;

/** 队列条 -9px 负边距里的关键片段：管子方案保留的 3px 消缝重叠（#41 根因 3）。 */
const OVERLAP = 'calc(0px - var(--dsh-composer-stack-gap) - 3px)';

/** 契约规则的特征：挂在渲染器的插槽锚点上，且以我们自己的 dock 根为锚。 */
const isContractRule = (r) =>
  r.selector.includes('[data-slot="conversation.input.dock"]') && r.selector.includes('.ss-dock-root');

/**
 * 把 styles.ts 里 CSS 数组的字符串元素还原成浏览器实际注入的那段 CSS：
 * 只取带引号的行（数组元素）→ 去引号去尾逗号 → 拼起来 → 再剥掉 `/* *\/` 注释块。
 *
 * 为什么不在原文上做规则断言：注释里合法地会提到选择器甚至整条规则（#42 就要求就地写明契约），
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

/** 取选择器**逐字**等于 `selector` 的规则（契约是叠加，基础规则的选择器不带插槽锚点前缀）。 */
const ruleOf = (selector) => {
  const hits = rules.filter((r) => r.selector === selector);
  assert.ok(
    hits.length >= 1,
    `styles.ts 里找不到逐字选择器 ${selector} 的规则 —— 基线被动过（改名或并入别的规则）` +
      `，契约的三条规则会因目标消失而静默失效`,
  );
  return hits[0];
};

/**
 * styles.ts 规则表里读出的契约规则 —— **同源判据（第 6 条）的基准**。
 * 从产物里派生而不是复用 TUBE：TUBE 与 demo 可以「同时是旧的」而两边一致地绿（原 #6 就是这么
 * 假绿的，见文件头）。产物说了什么，就以它为准去问 demo 是不是同一把尺。
 */
const contractFromStyles = () =>
  rules
    .filter(isContractRule)
    .map((r) => ({ selector: r.selector, decl: r.body.replace(/\s+/g, ' ').trim() }));

/* ---------------- 1. 三条规则逐字在册，且恰好三条 ---------------- */

test('styles.ts 含 §2 三条规则，逐字且各一条；契约形态的规则也恰好这三条（#42 §3 判据 1）', () => {
  for (const t of TUBE) {
    const full = tubeRule(t);
    assert.equal(
      count(css, full),
      1,
      `缺一条或重复：${full}\n` +
        '选择器被改名（或声明被拆成多行）＝管子行为静默消失：只有上面那条 dock 与本 dock 同屏时才可见，' +
        '单人回归测试抓不到，接缝双缘重影（#41 的原始缺陷）会原样复发',
    );
    // 数组元素形态：整条规则占一个元素（行尾 `'` + 可选逗号）—— §2 权威文本就是这个形态。
    // 用整行正则而不是「所在行结尾」：契约注释里也会逐字引用规则文本，只查结尾会认错行。
    const form = new RegExp(`^\\s*['"]${full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"],?\\s*$`);
    assert.ok(
      styles.split('\n').some((line) => form.test(line)),
      `契约规则必须是 styles.ts CSS 数组里的单个元素：${full}\n` +
        '规则被拆成多行（或只在注释里出现）本身不一定是缺陷，但与 §2 权威文本的约定不一致，' +
        '需 lead 裁决后同步本断言',
    );
  }
  // 「恰好三条」：§2 明写不要再加规则（尤其别给「非末位」发明闭合底边 —— 底边开口是基础态，
  // 它同时正确于贴 composer 与管子中段两种情形）。多一条就是绕过设计文档改观感。
  const derived = contractFromStyles().map((r) => `${r.selector} { ${r.decl} }`).sort();
  assert.deepEqual(
    derived,
    TUBE.map((t) => tubeRule(t)).sort(),
    'styles.ts 里挂在 [data-slot] 锚点上的 .ss-dock-root 规则与 §2 三条对不上（见上面的 actual/expected）：' +
      '少了＝契约被动过；多了＝有人绕过 §2 私自补规则（例如给非末位闭合底边），' +
      '那会把管子中段的底边观感改掉，而这条接缝只在两条 dock 同屏时才暴露',
  );
});

/* ---------------- 2. 声明体：不抢特异性，且逐字等于设计文本 ---------------- */

/**
 * 取契约规则的**声明体**（按选择器逐字定位）。走剥过注释的规则表而不是原文：
 * §2 要求就地写明契约，注释里合法地会出现同一串选择器，只有规则表才是浏览器真正应用的东西。
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

test('契约三条规则不得使用 !important，且声明体逐字等于 §2 设计文本', () => {
  for (const t of TUBE) {
    const body = tubeBodyOf(t.selector);
    assert.doesNotMatch(
      body,
      /!important/,
      `${t.name}（${t.selector}）里出现了 !important：` +
        '契约靠的是特指度（基础规则只有 (0,1,0)，A 是 (0,3,0)、B 是 (0,4,0)），本来就盖得住；' +
        '抢 !important 说明它被写在了错误的位置，此后任何调整（主题、折叠态、第三方 dock）都得继续抢，' +
        '最终只剩硬覆盖能改这条接缝。（styles.ts 别处的 !important 不在本条射程内，也不该在：' +
        '那是 reduced-motion 一类真需要抢的声明。）',
    );
    assert.equal(
      body.replace(/\s+/g, ' ').trim(),
      t.decl,
      `${t.selector} 的声明与 §2 设计文本不一致（实到 ${body}，应为 ${t.decl}）`,
    );
  }
});

/* ---------------- 3. 基线仍是 attach 壳：契约是叠加不是改写 ---------------- */

test('契约是叠加不是替换：负边距 / 顶圆角 / 底边开口三条基线仍在（#41 根因 3）', () => {
  // ① 外壳负边距：-9px 抵掉 6px gap → 净重叠 3px。管子的「段间消缝」直接依赖它。
  const rootRule = ruleOf('.ss-dock-root');
  assert.match(
    rootRule.body,
    /margin:\s*0 auto calc\(0px - var\(--dsh-composer-stack-gap\) - 3px\)/,
    `.ss-dock-root 的 margin 不再是 0 auto ${OVERLAP}：` +
      '那 3px 重叠是宿主刻意设计的消缝手法（面板底边开口被下一层不透明底盖掉），' +
      '拉平成 0 或改小都会把接缝重新打开 —— 初稿 B 正是死在这里（#41 选型过程第一条 ❌）。' +
      '注意 §2 A 只把「不是栈底」那一条的下边距收回 0，attach 态（末位）仍是 -9px，两件事别混',
  );
  // ② 面板顶圆角：solo 时（既 :first-child 又 :last-child）三条全不命中，仍是圆角顶 ——
  //    这是 #41/#42 共同的硬约束「solo 像素零差异」的前提。
  const bodyRule = ruleOf('.ss-dock-body');
  assert.match(
    bodyRule.body,
    /border-radius:\s*var\(--dsw-radius-lg\)\s+var\(--dsw-radius-lg\)\s+0\s+0/,
    '.ss-dock-body 的顶圆角被改动：契约只在上面还有兄弟时把顶边拉直（靠叠加规则），' +
      '基础规则一旦改成直角，solo 观感就跟着变了，「无邻居时观感零变化」当场失效',
  );
  // ③ 描边层底边开口：::after 仍留 `border-bottom: none`。
  const afterRule = ruleOf('.ss-dock-body::after');
  assert.ok(
    afterRule.body.includes('border-bottom: none'),
    '.ss-dock-body::after 不再留底边开口：管子论证第 2 条（接缝带内没有任何水平线）依赖' +
      '「上段 ::after 无底边 + 本段 ::after 去顶边」，补回底边就在管子中段横插一条线',
  );
});

/* ---------------- 4. 选择器目标仍然存在 ---------------- */

test('选择器目标仍在：ScheduleDock 根节点挂 ss-dock-root（#42 §1 死类名自查）', () => {
  assert.equal(
    count(component, 'className="ss-dock-root"'),
    1,
    'ScheduleDock.tsx 的 dock 根不再是唯一一处 className="ss-dock-root"：' +
      '契约三条规则以 .ss-dock-root 为锚，类名一改就永不命中，接缝双缘重影复发（且 CSS 侧一切照旧，最难查）。' +
      '另一头的前提（.ss-dock-root 必须是 [data-slot] 锚点的直接子元素）在真实宿主里，静态断言管不到，' +
      '由 #42 §3 判据 5 的隔离实例实测兜（见设计文档 §6）',
  );
});

/* ---------------- 5. 两条反向守卫（判据不是永真，见第 8 节的变异自证） ---------------- */

/**
 * 反向守卫 1：`styles.ts` 里 `data-queue-dock` 出现 **0 次**。
 *
 * 为什么数**原文**而不是剥过注释的 css：§3 判据 1 要的是「本仓不再以任何形式引用那个私有属性」。
 * 注释里留着它，读代码的人会以为嗅探还在（或以为随时可以捡回来），而这条判据也就管不住注释里
 * 「顺手加回来」的规则头；追溯 #41 的历史请写进 docs/notes/，事实来源本来也在那儿。
 * 代价写明：以后谁想在 styles.ts 注释里提一嘴旧写法，这里会红 —— 那是**有意的**摩擦。
 */
const queueDockCount = (source) => count(source, 'data-queue-dock');

const assertNoNeighbourSniffing = (source) => {
  assert.equal(
    queueDockCount(source),
    0,
    `styles.ts 里还有 ${queueDockCount(source)} 处 data-queue-dock：` +
      '那是宿主 QueueDock 的私有属性（#41 借它判接缝），契约的整条理由就是不再把观感绑在邻居身份上 —— ' +
      '宿主改属性、或上面换成 goal/todo/第三方 dock，判据会静默失效（§1 第 1、2 条）。' +
      '真要以邻居身份为判据，那是设计变更，得先改 dock-stack-contract.md §2 再动这里',
  );
};

test('反向守卫 1：styles.ts 里 data-queue-dock 出现 0 次 —— 不再嗅探宿主私有属性（#42 §3 判据 1）', () => {
  assertNoNeighbourSniffing(styles);
});

/**
 * 反向守卫 2：唯一允许把 `.ss-dock-root` 下边距从 -9px 收回 0 的规则，就是 §2 A **那一条**（逐字）。
 *
 * 这条收窄的正是 #41 时代的「任何 .ss-dock-root 的 margin 都必须带 -9px」。契约故意加了 A：
 * 不在栈底就不该占着「贴 composer」那个位置（负边距会把下边 3px 压进下一段的面板里）。
 * 所以豁免**精确到逐字选择器 + 逐字声明**，不是放宽成「含 :not(:last-child) 就算合法」：
 * 无前缀的 `.ss-dock-root { margin-bottom: 0 }`、把 A 写成 `:last-child`（反向，等于盖掉基线）、
 * 或把 A 的落点从 margin-bottom 改成 margin 简写，全都照样报红。守的还是同一件事：
 * attach 态（栈底）那 3px 消缝重叠不许丢。
 */
const flattenersOf = (source) =>
  parseRules(cssFrom(source))
    .filter(
      (r) =>
        r.selector.includes('.ss-dock-root') &&
        /(?:^|[;\s])margin(?:-(?:top|bottom|left|right))?\s*:/.test(r.body) &&
        !r.body.includes(OVERLAP),
    )
    .map((r) => `${r.selector} { ${r.body.replace(/\s+/g, ' ').trim()} }`);

const assertOnlyContractFlattens = (source) => {
  assert.deepEqual(
    flattenersOf(source),
    [tubeRule(TUBE[0])],
    '把 .ss-dock-root 下边距收回 0 的规则，与 §2 A 逐字的那一条对不上（actual 见上）。' +
      '契约只允许「不是栈底（:not(:last-child))」让位；任何别的形态 —— 无前缀、`:last-child` 反向、' +
      '改成 margin 简写 —— 都会把 attach 态那 3px 消缝重叠弄丢（' + OVERLAP + '），' +
      '接缝亮线回来，而那正是初稿 B 被否决的死法（#41 选型过程第一条 ❌）',
  );
};

test('反向守卫 2：只有 §2 A 那一条能把下边距收回 0，其余形态一律红（#42 §3 判据 1 的收窄版）', () => {
  assertOnlyContractFlattens(styles);
});

/* ---------------- 6. demo 与 styles.ts 同一把尺 ---------------- */

/**
 * demo 的规则头检测：从 styles.ts 派生的每条契约规则，都要在 demo 里有一条**剥掉
 * `.scheme[data-scheme="…"]` 前缀后逐字相同**的选择器，且其声明体含同一条声明。
 *
 * 判据形状与 #42 一致（逐字选择器 + 声明包含），没放宽成 includes 一类的模糊匹配；
 * 认的规则头从「只带 [data-queue-dock]」扩成「带 [data-queue-dock] **或** 带
 * [data-slot="conversation.input.dock"]」——demo 的 B2 段作为历史基线原样保留，现行契约在 B3 段，
 * 两代规则头都收进表里，将来产物若被改回嗅探形态，这里也还认得。
 * 注释行跳过：demo 的注释里会逐字引用选择器来讲道理，算进规则表就把「说明」当成了「规则」
 * （styles.ts 侧早就为同一个坑剥注释，这里是对称的处理）。
 */
const DEMO_RULE_MARKERS = ['[data-queue-dock]', '[data-slot="conversation.input.dock"]'];

const demoContractRules = (text) => {
  const lines = text.split('\n');
  /** selector（剥前缀后）→ 该选择器在 demo 里的**全部**声明体（多实例不复用同一个 key 覆盖）。 */
  const map = new Map();
  const push = (selector, body) => {
    if (!map.has(selector)) map.set(selector, []);
    map.get(selector).push(body);
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (/^(?:\/\*|\*|<!--|-->|\/\/)/.test(line)) return;
    if (!line.includes('{') || !line.includes('.ss-dock-root')) return;
    if (!DEMO_RULE_MARKERS.some((m) => line.includes(m))) return;
    const open = line.indexOf('{');
    const selector = line.slice(0, open).trim().replace(/^\.scheme\[data-scheme="[^"]*"\]\s*/, '');
    let body = line.slice(open + 1);
    const close = body.indexOf('}');
    if (close === -1) {
      // 声明体写在下一行（demo 的 B2 段正是这种形态）：往下收到第一个 `}` 为止。
      for (let j = i + 1; j < lines.length; j += 1) {
        const end = lines[j].indexOf('}');
        if (end === -1) body += ` ${lines[j].trim()}`;
        else { body += ` ${lines[j].slice(0, end)}`; break; }
      }
    } else {
      body = body.slice(0, close);
    }
    push(selector, body.replace(/\s+/g, ' ').trim());
  });
  return map;
};

test(
  'demo 与 styles.ts 同源：以产物为基准，docs/dock-stacking-demo.html 的 B3 规则是同一把尺（#42 §3 判据 3）',
  { skip: demoExists ? false : 'docs/dock-stacking-demo.html 尚未入库（它随 #41 的实现分支提交，合并后本条自动生效）' },
  () => {
    const baseline = contractFromStyles();
    assert.ok(
      baseline.length > 0,
      '从 styles.ts 派生不出任何契约规则 —— 本条会退化成永真；先去看第 1 条断言为什么红',
    );
    const demoTube = demoContractRules(readFileSync(demoUrl, 'utf8'));
    for (const r of baseline) {
      const bodies = demoTube.get(r.selector);
      assert.ok(
        bodies,
        `demo 里没有逐字的选择器 ${r.selector}（实到：${JSON.stringify([...demoTube.keys()])}）：` +
          '#41 的无缝论证是在 demo 上实测出来的，demo 与实现用不同选择器＝判据与产物脱钩，' +
          '以后照 demo 复核真实 GUI 得到的结论代表不了 lib 里的样式',
      );
      assert.ok(
        bodies.length > 0,
        `demo 里 ${r.selector} 的声明体解析为空，无从比对（判据不许对空输入返回成功）`,
      );
      // 每一个实例都必须带同一条声明：B3 的四个现场共用这三条规则，若某一处的声明体漂了，
      // 「取第一个」会把不一致读成一致。
      for (const body of bodies) {
        assert.ok(
          body.includes(r.decl.replace(/\s+/g, ' ')),
          `demo 中 ${r.selector} 的声明与 styles.ts 不一致（应含 ${r.decl}，实到 ${body}）：` +
            '两处必须同一把尺，否则 demo 绿而实现红（或反之）都说明不了问题',
        );
      }
    }
  },
);

test(
  'demo 复刻了渲染器形状：[data-slot] 锚点包住各兄弟条目，四种现场 + 两个反例都在（#42 §3 判据 4 的形状前提）',
  { skip: demoExists ? false : 'docs/dock-stacking-demo.html 尚未入库' },
  () => {
    /*
     * 契约三条选择器**全部**依赖「各 dock 根是 [data-slot] 锚点的直接子元素」这一形状。
     * demo 若不照这个形状建 DOM，它验的是另一个结构，肉眼看到的无缝与真机无关 ——
     * 那不是少几张截图，是整段证据作废。所以这里静态钉住形状，而不是靠人眼看图时想起来。
     *
     * ⚠ 本条只管**形状**。§3 判据 4 的另一半（四现场的像素 AE / 差异落在哪一行）
     *   **不在 CI 里**：采集要浏览器，CI（node:22 容器）没有 playwright。那条走手工：
     *   `scripts/seam-check/capture-b3-scenes.mjs`（产物落 /tmp，不进仓）。
     *   这里把形状钉死，是为了让手工采集的结论至少建立在"现场确实存在、确实照真机搭"之上。
     */
    const demo = read('docs/dock-stacking-demo.html');
    const missing = [];
    const need = (label, ok) => { if (!ok) missing.push(label); };

    /*
     * 探针一律按**元素**数，不按 substring。这不是洁癖：`data-slot-error` / `data-other-dock`
     * 这两个名字在 demo 的散文与 JS 分支里都合法出现，按 substring 数会把「现场已被删掉」
     * 数成「现场还在」（V11 变异实测过：删掉两个空锚点元素，substring 判据照样绿）。
     */
    const tags = (re) => [...demo.matchAll(re)].map((m) => m[0]);
    const slotAnchors = tags(/<div\b[^>]*\bdata-slot="conversation\.input\.dock"[^>]*>/g);
    need('渲染器锚点容器 <div data-slot="conversation.input.dock"> ≥ 8 处（4 现场 × 两半 + 现场⑤）',
      slotAnchors.length >= 8);
    need('每个锚点容器都带 display:contents（真机形状：锚点不产生盒子）',
      slotAnchors.every((t) => /display:\s*contents/.test(t)));

    /** 按开标签取某个现场段的内容（属性顺序不参与判据，别把写法顺序当契约）。 */
    const sectionTags = tags(/<section\b[^>]*>/g);
    const sectionBody = (impl, scene) => {
      const tag = sectionTags.find((t) =>
        t.includes('class="scheme"') && t.includes(`data-scheme="${impl}"`) && t.includes(`data-scene="${scene}"`));
      if (!tag) return null;
      const from = demo.indexOf(tag) + tag.length;
      const end = demo.indexOf('</section>', from);
      return end === -1 ? null : demo.slice(from, end);
    };
    const hasSection = (impl, scene) => sectionBody(impl, scene) !== null;

    // 四个现场，每个都要 B2（历史判据）与 B3（现行契约）同框，否则「肉眼可比」不成立。
    for (const scene of ['1', '2', '3', '4']) {
      need(`现场 ${scene} 的 B2 对照段`, hasSection('B2', scene));
      need(`现场 ${scene} 的 B3 段`, hasSection('B3', scene));
    }
    need('现场 5：我们不在末位（§2 A 规则唯一的可见覆盖）', hasSection('B3', '5'));

    /** 现场内的兄弟顺序也是形状的一部分：「上方是 X」不是「页面里某处有个 X」。 */
    const aboveProbe = (impl, scene, attr) => {
      const body = sectionBody(impl, scene);
      if (body === null) return false;
      const neighbour = new RegExp(`<div\\b[^>]*\\b${attr}\\b[^>]*>`);
      const n = body.search(neighbour);
      const ours = body.search(/<div\b[^>]*\bdata-ss-dock\b[^>]*>/);
      return n !== -1 && ours !== -1 && n < ours;
    };
    for (const impl of ['B2', 'B3']) {
      need(`现场 3（${impl}）：中性假邻居 <div data-other-dock> 排在我们上方`,
        aboveProbe(impl, '3', 'data-other-dock'));
      need(`现场 4（${impl}）：崩溃空锚点 <div data-slot-error> 排在我们上方`,
        aboveProbe(impl, '4', 'data-slot-error'));
    }
    const scene5 = sectionBody('B3', '5') ?? '';
    const s5Ours = scene5.search(/<div\b[^>]*\bdata-ss-dock\b[^>]*>/);
    const s5Below = scene5.search(/<div\b[^>]*\bdata-other-dock\b[^>]*>/);
    need('现场 5：我们之后还有一条 dock（:not(:last-child) 真的成立，不是摆设）',
      s5Ours >= 0 && s5Below > s5Ours);

    assert.deepEqual(missing, [], `demo 的 B3 段缺以下形状（缺任何一项，四现场的证据就不成立）：\n  - ${missing.join('\n  - ')}`);

    // demo 里带契约形态的规则头也必须恰好是这三条：防止「只在 demo 里多加一条看着更顺眼的规则」。
    const demoTube = demoContractRules(demo);
    const demoContract = [...demoTube.keys()].filter((sel) => isContractRule({ selector: sel })).sort();
    assert.deepEqual(
      demoContract,
      TUBE.map((t) => t.selector).sort(),
      'demo 里挂在 [data-slot] 锚点上的规则头与 §2 三条不一致 —— demo 与实现必须同一把尺',
    );
  },
);

/* ---------------- 7. 变异自证：上面两条反向守卫不是永真 ---------------- */

/** 锚点：契约 B1 那一行；变异规则插在它后面，仍在 CSS 数组内（数组外的东西浏览器读不到）。 */
const MUTATE_ANCHOR = tubeRule(TUBE[1]);

const withExtraRule = (ruleText) => {
  const lines = styles.split('\n');
  const at = lines.findIndex((line) => {
    const t = line.trim();
    return t === `'${MUTATE_ANCHOR}',` || t === `"${MUTATE_ANCHOR}",`;
  });
  assert.notEqual(
    at,
    -1,
    `变异自证失效：styles.ts 里找不到锚点行 ${MUTATE_ANCHOR}（先修好第 1 条断言再谈自证）`,
  );
  const indent = lines[at].match(/^\s*/)[0];
  lines.splice(at + 1, 0, `${indent}'${ruleText}',`);
  return lines.join('\n');
};

test('反向自证：把嗅探规则或别的 margin 覆盖塞回 styles.ts，两条反向守卫必须立刻变红（#42 §3 判据 2）', () => {
  /*
   * 判据失效最阴的形态是「永远通过」。这里在**内存里**改文本再跑同一把尺（手法同
   * client-class-guard.test.mjs 的反向自证，不碰磁盘、不依赖 ref 名）。
   * 三个变异都是「看起来合理但会改观感」的历史形态，不是随手造的字符串。
   */
  // ① #41 的旧判据捡回来 → 守卫 1 必须红。
  assert.throws(
    () => assertNoNeighbourSniffing(withExtraRule('[data-queue-dock] + .ss-dock-root .ss-dock-body { border-radius: 0; }')),
    /data-queue-dock/,
    '把 [data-queue-dock] + .ss-dock-root … 塞回 styles.ts，守卫 1 却没过 —— 它是个摆设',
  );
  // ② 抄 A 时把落点写成 B 的 `:not(:first-child)`（上面有东西就让位，而不是「不是栈底才让位」）
  //    → 守卫 2 必须红：solo 时若上面有 goal 浮卡，attach 的 -9px 就没了。
  assert.throws(
    () => assertOnlyContractFlattens(withExtraRule('[data-slot="conversation.input.dock"] > .ss-dock-root:not(:first-child) { margin-bottom: 0; }')),
    /下边距收回 0/,
    '多一条 :not(:first-child) 的下边距覆盖，守卫 2 却没抓到 —— 豁免范围写宽了',
  );
  // ③ 无前缀的裸类名覆盖（历史上初稿 B「把 -6px 拉平成 0」就是这么写的）→ 守卫 2 必须红。
  assert.throws(
    () => assertOnlyContractFlattens(withExtraRule('.ss-dock-root { margin-bottom: 0; }')),
    /下边距收回 0/,
    '多一条无前缀的 margin-bottom: 0，守卫 2 却没抓到 —— 它已退化成只对逐字那一条生效的摆设',
  );
  // 前提自证：变异文本确实进了规则表（否则上面三个 throws 可能只是因为解析失败）。
  assert.equal(flattenersOf(withExtraRule('.ss-dock-root { margin-bottom: 0; }')).length, 2,
    '变异没生效：插入的规则没被解析进规则表，上面的自证不成立');
});
