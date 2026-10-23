/**
 * 判据变异电池（#42）：把「这条静态判据真的会红」变成**仓内可重跑的实验**，而不是口头声称。
 *
 * 为什么必须存在：静态判据最阴的失效形态是「永远通过」。而变异脚本**自己**也会有 bug ——
 * `docs/notes/dock-alignment.md` §8 第 7 条点名的正是这格：「变异脚本自己有 bug → 一排 ✅ →
 * 实际一次有效变异都没发生」。本电池的四条规矩就是从踩过的那两次里长出来的：
 *
 *  1. **每条变异显式 `{ name, file, expect, mut }`** —— 绝不用名字前缀猜该改哪个文件。
 *     早期版本写 `name.startsWith('1')||…` 决定 target，`'10'..'13'` 是被 `'1'` 顺带匹配上的：
 *     就算分类对了也是巧合，读者无从核对「这条到底改了谁」。
 *  2. **空操作自检比同文件同对象**：`mut(原文) !== 原文`，否则判「变异未生效」并计入失败。
 *     早期版本对所有变异都比 `out === styles 原文` —— demo 变异恒不等于它，于是锚点失配
 *     （等于什么都没改）永远报不出问题，自检形同不存在。
 *  3. **对照运行**：先跑一份**完全没变异**的临时树，必须全绿。基线自己是红的时，
 *     「变异让它更红」不说明任何事，整批结果作废。
 *  4. **红要红在该红的地方**：每条变异带 `expect`（预期被触发的断言名正则）。只要求「变红」
 *     会被无关的红糊过去 —— 把 HTML 写进 styles.ts 会让所有断言炸掉，但那什么都没验证。
 *
 * 用法（仓库根）：`node scripts/seam-check/mutation-battery.mjs`
 * 退出码：0 = 对照全绿且每条变异都被**它声称会触发的**断言抓红；非 0 = 有未生效/没抓到/抓错地方。
 * 只在临时目录里改文件，不落任何产物；不依赖 playwright（纯源码级）。
 *
 * **什么时候必跑**：改动 `docs/notes/dock-stack-contract.md` §2 那三条规则（或 `styles.ts`
 * 里的落点）、或改动 `docs/dock-stacking-demo.html` 的 B3 现场形状时。它不进 CI ——
 * 跑一次要起 13 个临时树，且它验的是**判据本身**而不是产物；CI 里守产物的是
 * `tests/dock-tube-seam.test.mjs`。
 * @module dsh-later/scripts/seam-check/mutation-battery
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(process.argv[2] ?? path.resolve(HERE, '../..'));
const Q = String.fromCharCode(34); // "
const A = String.fromCharCode(39); // '

const STYLES = 'src/client/styles.ts';
const DEMO = 'docs/dock-stacking-demo.html';
const TEST = 'tests/dock-tube-seam.test.mjs';
const COPIED = [STYLES, 'src/client/components/ScheduleDock.tsx', DEMO, TEST];

/** §2 三条规则的逐字文本（与测试里的 TUBE 同一份，但这里按字符串拼，避免引号地狱）。 */
const SEL_A = `[data-slot=${Q}conversation.input.dock${Q}] > .ss-dock-root:not(:last-child)`;
const SEL_B1 = `[data-slot=${Q}conversation.input.dock${Q}] > .ss-dock-root:not(:first-child) .ss-dock-body`;
const SEL_B2 = `${SEL_B1}::after`;
const RULE_A = `${SEL_A} { margin-bottom: 0; }`;
const RULE_B1 = `${SEL_B1} { border-radius: 0; }`;
const RULE_B2 = `${SEL_B2} { border-top: none; }`;
/** styles.ts 里规则是一个数组元素（单引号 + 尾逗号）；demo 里带 `.scheme[data-scheme="B3"] ` 前缀。 */
const AS_ARRAY_ITEM = (rule) => `${A}${rule}${A},`;
const AS_DEMO_RULE = (rule) => `.scheme[data-scheme=${Q}B3${Q}] ${rule}`;
const WRAPPER = `<div data-slot=${Q}conversation.input.dock${Q} style=${Q}display:contents${Q}>`;
const ERROR_ANCHOR = `<div data-slot-error class=${Q}b3-error-anchor${Q} style=${Q}display:contents${Q}></div>`;

/** 在 demo/styles 里把某段换成另一段：找不到就原样返回（由自检判为「变异未生效」）。 */
const swap = (from, to) => (text) => (text.includes(from) ? text.replace(from, to) : text);
const insertAfter = (anchor, added) => (text) => (text.includes(anchor) ? text.replace(anchor, anchor + added) : text);

const MUTATIONS = [
  {
    name: '1 demo 选择器漂移（B2 规则的 :first-child 写成 :last-child）',
    file: DEMO,
    expect: /同源/,
    mut: swap(AS_DEMO_RULE(RULE_B2), AS_DEMO_RULE(RULE_B2.replace(':not(:first-child)', ':not(:last-child)'))),
  },
  {
    name: '2 demo 声明漂移（border-top: none → hidden）',
    file: DEMO,
    expect: /同源/,
    mut: swap(AS_DEMO_RULE(RULE_B2), AS_DEMO_RULE(RULE_B2.replace('border-top: none;', 'border-top: hidden;'))),
  },
  {
    name: '3 styles.ts 少一条规则（::after 那条被删）',
    file: STYLES,
    expect: /三条规则/,
    mut: swap(AS_ARRAY_ITEM(RULE_B2), ''),
  },
  {
    name: '4 demo 锚点包裹层消失（不照渲染器形状搭 DOM）',
    file: DEMO,
    expect: /形状/,
    mut: (t) => t.replaceAll(WRAPPER, `<div class=${Q}plain-wrap${Q}>`),
  },
  {
    name: '5 A 规则退回嗅探形态（[data-queue-dock] + .ss-dock-root）',
    file: STYLES,
    expect: /data-queue-dock|三条规则/,
    mut: swap(AS_ARRAY_ITEM(RULE_A), AS_ARRAY_ITEM(`[data-queue-dock] + .ss-dock-root { margin-bottom: 0; }`)),
  },
  {
    name: '6 契约规则加 !important（去跟宿主抢特异性）',
    file: STYLES,
    expect: /!important|三条规则/,
    mut: swap(AS_ARRAY_ITEM(RULE_A), AS_ARRAY_ITEM(RULE_A.replace('margin-bottom: 0;', 'margin-bottom: 0 !important;'))),
  },
  {
    name: '7 基线 -9px 被拉平成 0（初稿 B 的死法）',
    file: STYLES,
    expect: /基线|反向守卫 2/,
    mut: swap(`${A}  margin: 0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px);${A}`, `${A}  margin: 0 auto 0;${A}`),
  },
  {
    name: '8 styles.ts 私自补第四条（给非末位闭合底边，§2 明写不要）',
    file: STYLES,
    expect: /三条规则|同源/,
    mut: insertAfter(AS_ARRAY_ITEM(RULE_B1), `\n${AS_ARRAY_ITEM(`${SEL_A} .ss-dock-body::after { border-bottom: .5px solid red; }`)}`),
  },
  {
    name: '9 demo 私自补第四条（只在 demo 里加一条看着更顺眼的规则）',
    file: DEMO,
    expect: /形状|同源/,
    mut: insertAfter(AS_DEMO_RULE(RULE_A), `\n  ${AS_DEMO_RULE(`${SEL_A} .ss-dock-body { border-radius: 8px; }`)}`),
  },
  {
    name: '10 现场③ 的 B2 对照半被换成 B3（关键对照消失）',
    file: DEMO,
    expect: /形状/,
    mut: swap(`data-scheme=${Q}B2${Q} data-scene=${Q}3${Q}`, `data-scheme=${Q}B3${Q} data-scene=${Q}3${Q}`),
  },
  {
    name: '11 崩溃空锚点现场被删（把 §4 已知降级藏起来）',
    file: DEMO,
    expect: /形状/,
    mut: (t) => t.replaceAll(ERROR_ANCHOR, ''),
  },
  {
    name: '12 锚点丢了 display:contents（形状失真）',
    file: DEMO,
    expect: /形状/,
    mut: (t) => t.replaceAll(WRAPPER, `<div data-slot=${Q}conversation.input.dock${Q}>`),
  },
  {
    name: '13 现场③ 的假邻居被挪到我们下面（「上方有 X」变成「某处有 X」）',
    file: DEMO,
    expect: /形状/,
    mut: (t) => {
      const i = t.indexOf(`data-scheme=${Q}B2${Q} data-scene=${Q}3${Q}`);
      if (i === -1) return t;
      const j = t.indexOf('</section>', i);
      const seg = t.slice(i, j);
      const n = seg.indexOf(`<div class=${Q}host-dock${Q} data-other-dock>`);
      const o = seg.indexOf(`<div class=${Q}ss-dock-root${Q} data-ss-dock>`);
      if (!(n >= 0 && o > n)) return t;
      const nEnd = seg.indexOf('</div></div>', n) + '</div></div>'.length;
      const oEnd = seg.indexOf('</div></div>', o) + '</div></div>'.length;
      if (!(nEnd > 0 && oEnd > nEnd)) return t;
      const neighbour = seg.slice(n, nEnd);
      const ours = seg.slice(o, oEnd);
      const middle = seg.slice(nEnd, o);
      const swapped = seg.slice(0, n) + ours + middle + neighbour + seg.slice(oEnd);
      return t.slice(0, i) + swapped + t.slice(j);
    },
  },
];

const freshTree = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seam-battery-'));
  for (const f of COPIED) {
    fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
    fs.copyFileSync(path.join(REPO, f), path.join(dir, f));
  }
  return dir;
};

const runTests = (dir) => {
  let out = '';
  let ok = false;
  try {
    out = execFileSync('node', ['--test', TEST], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    ok = true;
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  const failed = [...out.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1].replace(/\\#/g, '#').trim());
  const pass = Number((out.match(/^# pass (\d+)$/m) ?? [0, '0'])[1]);
  const total = Number((out.match(/^# tests (\d+)$/m) ?? [0, '0'])[1]);
  return { ok, failed, pass, total, raw: out };
};

/* ---------------- 对照运行：没有变异时基线必须全绿 ---------------- */
const ctrlDir = freshTree();
const ctrl = runTests(ctrlDir);
console.log(`对照（未变异的临时树）：${ctrl.total} 条，pass ${ctrl.pass}，fail ${ctrl.total - ctrl.pass}`);
if (!ctrl.ok) {
  console.log('\n✗ 基线本身就不是全绿 —— 后面所有「红」都不说明抓到了东西，整批作废。');
  console.log(ctrl.failed.map((f) => `  - ${f}`).join('\n'));
  fs.rmSync(ctrlDir, { recursive: true });
  process.exit(1);
}
fs.rmSync(ctrlDir, { recursive: true });

/* ---------------- 逐条变异 ---------------- */
const rows = [];
for (const m of MUTATIONS) {
  const dir = freshTree();
  const fp = path.join(dir, m.file);
  const before = fs.readFileSync(fp, 'utf8');
  let after;
  try { after = m.mut(before); } catch (e) { after = before; }
  // 自检：同一个文件的同一对象比较（不是拿别的文件的原文比）
  if (after === before) {
    rows.push({ name: m.name, verdict: '变异未生效', detail: `锚点串在 ${m.file} 里没找到` });
    fs.rmSync(dir, { recursive: true });
    continue;
  }
  fs.writeFileSync(fp, after);
  const r = runTests(dir);
  fs.rmSync(dir, { recursive: true });
  if (r.ok) {
    rows.push({ name: m.name, verdict: '没抓到', detail: `改了 ${m.file} 后测试仍全绿（判据漏了这条）` });
    continue;
  }
  const hit = r.failed.filter((f) => m.expect.test(f));
  rows.push({
    name: m.name,
    verdict: hit.length ? '抓红' : '抓错地方',
    detail: hit.length
      ? `${hit.length}/${r.failed.length} 条红，命中预期 ${m.expect}：${hit[0].slice(0, 46)}…`
      : `红了 ${r.failed.length} 条但没有一条是预期的 ${m.expect}：${r.failed.map((f) => f.slice(0, 28)).join(' | ')}`,
  });
}

const width = Math.max(...rows.map((r) => [...r.name].length));
for (const r of rows) console.log(`  ${r.verdict.padEnd(6, ' ')} ${r.name.padEnd(width, ' ')}  ${r.detail}`);
const bad = rows.filter((r) => r.verdict !== '抓红');
console.log(`\n${rows.length} 条变异：抓红 ${rows.length - bad.length}，失效 ${bad.length}（对照运行：基线全绿 ✓）`);
if (bad.length) {
  console.log('✗ 有变异未被预期断言抓到 —— 要么判据真有洞，要么这条变异本身没意义，逐条查，别放宽判据凑数。');
  process.exit(1);
}
console.log('✓ 每条变异都改了它声称要改的文件，且都被它声称会触发的断言抓红');
