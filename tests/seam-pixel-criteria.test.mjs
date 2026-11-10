/**
 * issue #42 §2/§3：管子接缝的像素判据，用**仓库里已采集的真实帧**验证。
 *
 * 这个文件的存在理由不是"多几个测试"，而是把 #42 里那段散文判据变成可执行、
 * 可进 CI 的东西。此前它的交付是 4 张一次性 PNG —— 那只能回答"10 月 19 号人眼
 * 看着没问题"，回答不了"下次宿主升级后接缝还在不在"。
 *
 * ## 为什么必须有合成对照
 *
 * 只用真图有一类失败模式测不出来：判据写坏了、对任何输入都返回 pass。所以这里
 * 除了已知好/已知坏的一对真图，还**合成**了"纯背景"与"纯背景 + 一条横线"，
 * 强制要求判据把它们区分开。少了这组，"三张真图全绿"是假安全感。
 *
 * ## 一条踩过的坑（写在代码里，别再犯）
 *
 * seamY **必须由几何给出**（capture 脚本用 `hostPanel.bottom` 算），不能
 * "扫描找最偏离的那一行"。后者是循环论证：任何含文字/进度条的裁图都必然有一行
 * 高偏离，于是永远判 FAIL。实测 `tube-live-seam-4x.png` 用"找最坏行"会命中
 * 第 63 行（进度条，亮度 118、跨度 37%）而误报有缝；给它真实接缝行 31，
 * 跨度只有 2.1%，正确判 PASS。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodePngRgb } from '../scripts/seam-check/png.mjs';
import {
  assertPixelIdentical,
  detectRoundedTopCorners,
  detectSeamLine,
  detectSideStrokeContinuity,
  maxDeviationSpan,
  toImagePx,
} from '../scripts/seam-check/criteria.mjs';

const frame = (name) => decodePngRgb(new URL(`../docs/media/${name}.png`, import.meta.url).pathname);

/** 造一张纯色图，可选在第 lineY 行画一条横贯的线。 */
function synthetic({ width = 400, height = 40, bg = [28, 31, 35], lineY = null, line = [56, 61, 67] }) {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 3] = bg[0]; data[i * 3 + 1] = bg[1]; data[i * 3 + 2] = bg[2];
  }
  if (lineY !== null) {
    for (let x = 0; x < width; x += 1) {
      const p = (lineY * width + x) * 3;
      data[p] = line[0]; data[p + 1] = line[1]; data[p + 2] = line[2];
    }
  }
  return { width, height, channels: 3, data };
}

/* ---------------- 1. 真实帧：已知坏必须判坏，已知好必须判好 ---------------- */

test('真实帧判据具备区分力：scheme0(有缝) FAIL / B2(无缝) PASS', () => {
  const bad = detectSeamLine(frame('demo-scheme0-seam'), { seamY: 31 });
  const good = detectSeamLine(frame('demo-schemeB2-seam'), { seamY: 31 });
  assert.equal(bad.pass, false, 'scheme0 是被否决的方案，必须判出接缝线');
  assert.equal(good.pass, true, 'B2 是采纳方案，必须判为无缝');
  // 区分度要够大，否则说明判据在阈值边缘靠调参勉强通过
  assert.ok(bad.worst.spanRatio > 0.9, `坏帧跨度应接近满宽，实际 ${(bad.worst.spanRatio * 100).toFixed(1)}%`);
  assert.ok(good.worst.spanRatio < 0.1, `好帧跨度应接近零，实际 ${(good.worst.spanRatio * 100).toFixed(1)}%`);
});

test('真机采集的 B2 接缝判为无缝（#41 的实际效果）', () => {
  const live = detectSeamLine(frame('tube-live-seam-4x'), { seamY: 31 });
  assert.equal(live.pass, true, `真机 B2 实拍不应有缝线，实测最差行 ${live.worst.y} 跨度 ${(live.worst.spanRatio * 100).toFixed(1)}%`);
});

/* ---------------- 2. 合成对照：堵住"对任何输入都 pass"这类空判据 ---------------- */

test('合成对照：纯背景判 PASS，加一条横线必须判 FAIL', () => {
  const clean = detectSeamLine(synthetic({ lineY: null }), { seamY: 20 });
  assert.equal(clean.pass, true, '无合成图不应误报');

  const lined = detectSeamLine(synthetic({ lineY: 20 }), { seamY: 20 });
  assert.equal(lined.pass, false, '合成一条横线必须被抓出来');
  assert.ok(lined.worst.spanRatio > 0.99, '合成满宽线的跨度应≈100%');
});

test('合成对照：密集但零散的亮像素（模拟文字行）不得误判为线', () => {
  /**
   * 判据用「最长连续段」而非「偏离像素总数」，本条就是钉住这个区别的。
   *
   * 样本必须让两个量**分道扬镳**才有效：总偏离 > 阈值、最长连续段 < 阈值。
   * 所以用「19 列亮 + 1 列暗」的周期 —— 总偏离 95%（> 0.9），最长段仅 4.75%。
   * 若像最初那样只画稀疏点（总偏离 ~17%），变异成"数偏离像素"的实现也会
   * 勉强通过，这条就成了摆设；是变异测试把它暴露出来的。
   */
  const img = synthetic({ width: 400, height: 40, lineY: null });
  for (let x = 0; x < 400; x += 1) {
    if (x % 20 === 19) continue; // 每 20 列留 1 列背景，切断连续段
    const p = (20 * 400 + x) * 3;
    img.data[p] = 200; img.data[p + 1] = 200; img.data[p + 2] = 200;
  }
  const row = rowOf(img, 20);
  // 前提自检：两个量确实分开了，否则本条退化成空测试
  let total = 0;
  for (let x = 0; x < 400; x += 1) {
    const lum = 0.299 * row[x * 3] + 0.587 * row[x * 3 + 1] + 0.114 * row[x * 3 + 2];
    if (Math.abs(lum - 30.5) > 12) total += 1;
  }
  assert.ok(total / 400 > 0.9, `样本总偏离应 >90%，实际 ${(total / 4).toFixed(1)}%`);
  assert.ok(maxDeviationSpan(row, 400, 30.5, 12) < 0.1, '最长连续段应远小于阈值');

  const r = detectSeamLine(img, { seamY: 20 });
  assert.equal(r.pass, true, '零散亮点被误判为线：判据退化成了"数偏离像素"');
});

test('合成对照：浅色主题（线比背景暗）同样能判出 —— 判据方向无关', () => {
  // 浅色底 + 更暗的线：如果实现写成"比背景亮"，这里会漏判
  const light = synthetic({
    width: 400, height: 40, bg: [245, 246, 248], lineY: 20, line: [200, 204, 210],
  });
  const r = detectSeamLine(light, { seamY: 20 });
  assert.equal(r.pass, false, '浅色主题下描边比背景暗，判据必须方向无关');
});

/* ---------------- 3. 采样带：线在带外时不该被算进来 ---------------- */

test('采样带生效：线落在带外则不影响判定', () => {
  const img = synthetic({ lineY: 35 });
  const r = detectSeamLine(img, { seamY: 20, band: 2 });
  assert.equal(r.pass, true, '第 35 行的线不该污染 seamY=20±2 的采样带');
});

test('拒绝把 seamY 猜成"最坏行"——缺 seamY 直接报错', () => {
  assert.throws(() => detectSeamLine(synthetic({}), {}), /seamY/);
  assert.throws(() => detectSeamLine(synthetic({}), { seamY: 9999 }), /越界/);
});

/* ---------------- 4. §3：与 demo 同一把尺（圆角读数） ---------------- */

test('圆角判据：直角顶边不判圆角，带缺口的顶边判圆角', () => {
  // 直角：整行同色 → 两端无背景透出
  const square = synthetic({ width: 400, height: 40, lineY: null });
  const a = detectRoundedTopCorners(square, { topY: 20 });
  assert.equal(a.rounded, false, '同色行不应判出圆角');

  // 圆角：顶边两端各 8 列透出背景（比内部暗）
  const round = synthetic({ width: 400, height: 40, bg: [80, 84, 90], lineY: null });
  const y = 20;
  for (let x = 0; x < 8; x += 1) {
    for (const col of [x, 399 - x]) {
      const p = (y * 400 + col) * 3;
      round.data[p] = 28; round.data[p + 1] = 31; round.data[p + 2] = 35;
    }
  }
  const b = detectRoundedTopCorners(round, { topY: y });
  assert.equal(b.rounded, true, '两端透出背景应判出圆角');
});

/* ---------------- 5. 解码器自证：与已知像素值一致 ---------------- */

test('PNG 解码器与参照值逐字节一致（判据不建立在错像素上）', () => {
  const img = frame('demo-scheme0-seam');
  assert.equal(img.width, 820);
  assert.equal(img.height, 68);
  const channelMean = (y, c) => {
    const row = rowOf(img, y);
    let s = 0;
    for (let x = 0; x < img.width; x += 1) s += row[x * 3 + c];
    return Math.round(s / img.width);
  };
  const mean = (y) => [0, 1, 2].map((c) => channelMean(y, c));
  // 参照值由 PIL 独立算出（见 issue #42 讨论），对不上说明解码器错了
  assert.deepEqual(mean(30), [28, 31, 35], '接缝上一行应是面板背景色');
  assert.deepEqual(mean(31), [56, 61, 67], '接缝行应是 border-l1 描边色');
  assert.deepEqual(mean(32), [28, 31, 35], '接缝下一行应是面板背景色');
  // 跨度也必须对得上：31 行近乎满宽，30 行几乎为零
  const base = 30.5;
  assert.ok(maxDeviationSpan(rowOf(img, 31), img.width, base, 12) > 0.9);
  assert.ok(maxDeviationSpan(rowOf(img, 30), img.width, base, 12) < 0.1);
});

function rowOf(img, y) {
  return img.data.subarray(y * img.width * 3, (y + 1) * img.width * 3);
}

/* ---------------- 6. 实采矩阵（docs/media/seam-matrix） ---------------- */

/**
 * 这一节喂的是 `scripts/seam-check/capture-demo.mjs` 从
 * `docs/dock-stacking-demo.html` 实采的 8 帧矩阵（浏览器真实渲染）。
 *
 * 它的价值在于让判据 2/4 第一次**跑过真实输入** —— 在此之前这两个函数
 * 「实现写着、测试引用 0 次」，而判据 2 的第一版就是这么活下来的：它拿整行
 * 平均亮度当基准，对**每一帧**都判 false（包括已知良好的 B2），写成什么样都没人发现。
 */
const MATRIX_MANIFEST = new URL('../docs/media/seam-matrix/manifest.json', import.meta.url).pathname;
const matrix = JSON.parse(readFileSync(MATRIX_MANIFEST, 'utf8'));
const mframe = (rel) => decodePngRgb(new URL(`../${rel}`, import.meta.url).pathname);

/**
 * 去掉 `-dprN` 后缀得到「组合身份」：同一组合在两档 DPR 下各有一帧，
 * 用它做配对比较（issue #62）。模块级——多条用例都要按它配对。
 */
const baseOf = (tag) => tag.replace(/-dpr\d+$/, '');

/**
 * 矩阵齐备（issue #62）：断言的是**DPR 档位覆盖**，不是帧数。
 *
 * ⚠️ 这条用例的写法本身就是护栏的一部分。原来只有一句 `matrix.length === 8`，
 * 最省事的"升级"是把它改成 `=== 16` —— 那等于把护栏从「两档都采了」退化成
 * 「数帧数」：采 16 帧、全部 dpr=1，照样绿，而 #62 要的恰恰是 2x 那一档。
 * 所以这里断三件事：① dpr 集合 ⊇ {1,2}；② **组合集在两档完全相同**
 * （否则"两档判定一致"是在拿不同样本互比）；③ 每档的帧数相等。
 */
test('矩阵齐备：DPR 档位 ⊇ {1,2}，且每个组合在两档都采到', () => {
  const dprs = new Set(matrix.map((e) => e.dpr));
  assert.ok(dprs.has(1) && dprs.has(2), `manifest 必须同时覆盖 dpr=1 与 dpr=2，实得 {${[...dprs].sort().join(', ')}}`);

  /** 同一组合在两档各出现一次（`baseOf` 见模块级定义）。 */
  const combosByDpr = new Map();
  for (const e of matrix) {
    if (!combosByDpr.has(e.dpr)) combosByDpr.set(e.dpr, new Set());
    combosByDpr.get(e.dpr).add(baseOf(e.tag));
  }
  const sizes = [...combosByDpr.values()].map((s) => s.size);
  assert.ok(Math.max(...sizes) === Math.min(...sizes), `各 DPR 档的组合数必须相等，实得 ${sizes.join(' / ')}`);
  const [first, ...rest] = [...combosByDpr.values()].map((s) => [...s].sort().join('|'));
  for (const other of rest) assert.equal(other, first, '2x 档必须采到与 1x 完全相同的组合集');

  const tags = matrix.map((e) => e.tag);
  assert.ok(tags.some((t) => t.startsWith('B2-')));
  assert.ok(tags.some((t) => t.startsWith('0-')));
  assert.ok(tags.some((t) => t.startsWith('solo-')));
  // 深浅主题都要有，否则"方向无关"这条没被真实数据覆盖
  assert.ok(tags.some((t) => t.endsWith('dark')));
  assert.ok(tags.some((t) => t.endsWith('light')));
});

test('判据 1 在真实矩阵上：B2 全 PASS、scheme0 全 FAIL（两档 DPR 都是）', () => {
  let checked = 0;
  const checkedDprs = new Set();
  for (const e of matrix) {
    if (!e.crop || !e.seamsInCrop) continue;
    /**
     * `band` 是 #42 原文的「±2px」，那是 **1x 的物理距离**；2x 帧上要量同一段距离就得
     * 传 `toImagePx(2, 2)`。直接用默认值等于把采样窗口砍半 —— 锚点换算修好了、窗口没修，
     * 结果照样是假结论（只是方向相反：窗口变窄更容易 PASS）。
     */
    const r = detectSeamLine(mframe(e.crop), { seams: e.seamsInCrop, band: toImagePx(2, e.dpr) });
    const expected = e.scheme === 'B2';
    assert.equal(r.pass, expected,
      `${e.tag} (dpr=${e.dpr}): 期望 ${expected ? 'PASS' : 'FAIL'}，实得 span=${(r.worst.spanRatio * 100).toFixed(1)}%`);
    checked += 1;
    checkedDprs.add(e.dpr);
  }
  const expectedFrames = matrix.filter((e) => e.crop && e.seamsInCrop).length;
  assert.equal(checked, expectedFrames, '带接缝裁图的帧应全部被判定过，不能有静默跳过');
  assert.ok(checkedDprs.has(1) && checkedDprs.has(2), `判据 1 必须在两档 DPR 上都被验过，实得 {${[...checkedDprs].join(', ')}}`);
});

test('判据 1 的双锚点不可省：按 #42 原文的单锚点会漏判 scheme0（两档 DPR 都成立）', () => {
  /**
   * 这条以前只取 1x 那一帧。现在按 DPR 成对跑：如果 2x 档上「单锚点漏判」不复现，
   * 说明锚点换算或带宽换算有一处没对齐 —— 那正是 #62 要防的「1x 巧合成立」。
   */
  const pairs = matrix.filter((e) => baseOf(e.tag) === '0-r1-s1-dark' || e.tag === '0-r1-s1-dark');
  assert.equal(pairs.length, 2, 'scheme0 深色对照帧应在 1x 与 2x 各一帧');
  for (const e of pairs) {
    const img = mframe(e.crop);
    const [a, b] = e.seamsInCrop; // [hostPanel.bottom, ssBody.top]，相差 3 CSS px（消缝重叠）
    assert.notEqual(a, b, `${e.tag}: B2 的消缝重叠让两个锚点不相等，这正是本用例的前提`);
    const band = toImagePx(2, e.dpr);
    const dual = detectSeamLine(img, { seams: e.seamsInCrop, band });
    assert.equal(dual.pass, false, `${e.tag} (dpr=${e.dpr}): 双锚点应判出缝线`);

    /**
     * 断言的是**实质区别**，不是"两个数不相等"。
     * 第一版写成 `assert.notEqual(single.worst.spanRatio, dual.worst.spanRatio)` —— 太弱：
     * 把 `seams` 参数整个忽略掉（退回单锚点）时它照样通过，是变异测试抓出来的。
     *
     * 真实情况：缝线在 ssBody.top，而按 #42 原文取 hostPanel.bottom ± 2 的带
     * **恰好把线让过去** —— 一个已知有缺陷的帧会被判成 PASS。
     */
    const singleAtBottom = detectSeamLine(img, { seamY: a, band });
    assert.equal(singleAtBottom.pass, true, `${e.tag} (dpr=${e.dpr}): 按 #42 原文的单锚点确实会漏判（已知局限，见函数注释）`);
    assert.ok(dual.worst.spanRatio > 0.9, `${e.tag}: 双锚点跨度应接近满宽，实得 ${(dual.worst.spanRatio * 100).toFixed(1)}%`);
    assert.ok(singleAtBottom.worst.spanRatio < 0.1, `${e.tag}: 单锚点跨度应接近零（漏判形态），实得 ${(singleAtBottom.worst.spanRatio * 100).toFixed(1)}%`);
    // 采样带必须真的不同，否则说明 seams 没被用上
    assert.notDeepEqual(dual.band, singleAtBottom.band, `${e.tag}: seams 未生效：采样带与单锚点相同`);
  }
});

test('判据 2 在真实矩阵上：B2 侧线连续、scheme0 断裂（两档 DPR）', () => {
  let checked = 0;
  const checkedDprs = new Set();
  for (const e of matrix) {
    if (!e.tube) continue;
    const img = mframe(e.tube);
    /**
     * 这里的每一个长度都是 **CSS px 定标**、经 `toImagePx` 换算成图像像素。
     * 以前是裸写的 `2 / 3 / 20 / 21`：1x 下图像像素 == CSS px，所以全绿；2x 下
     * 「上下各留 20px 避开圆角区」只避开了 10 CSS px，圆角内收段被算进"应当连续"的范围，
     * 于是一个**正确**的 B2 帧被判成 breaks=13 —— 这是假 FAIL，也是 #62 的实测来源。
     */
    const d = e.dpr;
    const r = detectSideStrokeContinuity(img, {
      x0: toImagePx(2, d),
      x1: img.width - toImagePx(3, d),
      yTop: toImagePx(20, d),
      yBottom: img.height - toImagePx(21, d),
      window: toImagePx(3, d),
      tolerance: toImagePx(1.5, d),
    });
    if (e.scheme === 'B2') {
      assert.equal(r.pass, true, `${e.tag} (dpr=${d}): B2 侧线应连续，found=${r.left.found}/${r.total} breaks=${r.left.breaks}`);
      assert.equal(r.left.maxDrift, 0, `${e.tag} (dpr=${d}): B2 侧线不应有 x 漂移`);
    } else if (e.scheme === '0') {
      assert.equal(r.pass, false, `${e.tag} (dpr=${d}): scheme0 圆角相撞应导致侧线断裂`);
    }
    checked += 1;
    checkedDprs.add(d);
  }
  assert.ok(checkedDprs.has(1) && checkedDprs.has(2), `判据 2 必须在两档 DPR 上都验过，实得 {${[...checkedDprs].join(', ')}}`);
});

/**
 * 判据 3 的探针行（#62 的第二处单位错，比 `seamsInCrop` 那个更隐蔽）。
 *
 * 旧写法是 `2 + Math.round(e.geo.ssBodyRect.top - …)` —— 拿 **CSS px 的几何**现场重算，
 * 再当成图像行下标去切 `img.data`。1x 下两者数值相等所以八帧全绿；2x 下探针落在真实位置
 * 上方约一半的行数，实测 `solo-r0-s1-dark-dpr2` 在 CSS 行 2 上量到 `L=0 R=0`，把有 16px
 * 圆角的帧说成直角。
 *
 * 现在测试**只消费** manifest 里已换算的 `panelTopInCrop`，禁止再从 `e.geo` 推锚点。
 * 换算口径（为什么是「旧 CSS 行 × dpr」而不是「内侧第一行」）写在
 * `capture-demo.mjs` 的 `toCropRowPx` 注释里 —— 那是一次真实的返工：换成内侧第一行
 * 会让 1x 的 scheme0 从 `15/15` 掉到 `5/5`，与直角组的 `3/3` 再也分不开，等于为了单位
 * 对齐悄悄改了判据语义。
 */
const cornerProbeRow = (e) => {
  assert.ok(Number.isInteger(e.panelTopInCrop), `${e.tag}: manifest 缺已换算的 panelTopInCrop，不能退回 CSS 几何重算`);
  return e.panelTopInCrop;
};

test('判据 3 在真实矩阵上与几何真值一致（阈值按 DPR 换算，两档都验）', () => {
  const checkedDprs = new Set();
  for (const e of matrix) {
    if (!e.tube) continue;
    const img = mframe(e.tube);
    /**
     * `cornerProbe`（16px 圆角探针）与 `minOffsetColumns`（6 列缺口阈值）都是**按 1x 定标**的
     * 物理长度：2x 帧上不换算，就只量到半段圆角、且用半宽的尺去数缺口列 —— 实测 2x 的直角帧
     * 会量出 `L=6 R=6` 而被误判成有圆角（假 FAIL），圆角帧则可能量不到缺口（假 PASS）。
     */
    const r = detectRoundedTopCorners(img, {
      topY: cornerProbeRow(e),
      cornerProbe: toImagePx(16, e.dpr),
      minOffsetColumns: toImagePx(6, e.dpr),
    });
    const radius = Number.parseFloat(e.geo.ssPanelRadius) || 0;
    assert.equal(r.rounded, radius > 0,
      `${e.tag} (dpr=${e.dpr}): 几何 radius=${radius}px，像素判定 rounded=${r.rounded}（探针行 ${cornerProbeRow(e)}，缺口 L=${r.leftOffsetColumns} R=${r.rightOffsetColumns}，阈值 ${toImagePx(6, e.dpr)}）`);
    checkedDprs.add(e.dpr);
  }
  assert.ok(checkedDprs.has(1) && checkedDprs.has(2), `判据 3 必须在两档 DPR 上都验过，实得 {${[...checkedDprs].join(', ')}}`);
});

test('判据 3 阈值定标：直角组与圆角组的缺口列数在**每一档 DPR 内**都必须可分', () => {
  /**
   * 按 DPR 分组，而不是把两档的缺口数混在一个池子里比。混池子是错的：2x 的缺口列数天然
   * 是 1x 的两倍，跨档一比就得出「直角组最大 12 > 圆角组最小 10」这种假不可分。
   * 分离性必须在**每一档内部**成立 —— 这才是「阈值定标有没有依据」的真实问题。
   */
  const byDpr = new Map();
  for (const e of matrix) {
    if (!e.tube) continue;
    const img = mframe(e.tube);
    const r = detectRoundedTopCorners(img, {
      topY: cornerProbeRow(e),
      cornerProbe: toImagePx(16, e.dpr),
      minOffsetColumns: toImagePx(6, e.dpr),
    });
    const g = Math.max(r.leftOffsetColumns, r.rightOffsetColumns);
    const radius = Number.parseFloat(e.geo.ssPanelRadius) || 0;
    if (!byDpr.has(e.dpr)) byDpr.set(e.dpr, { square: [], round: [] });
    (radius > 0 ? byDpr.get(e.dpr).round : byDpr.get(e.dpr).square).push(g);
  }
  assert.ok(byDpr.has(1) && byDpr.has(2), `阈值定标必须在两档 DPR 上都能算，实得 {${[...byDpr.keys()].join(', ')}}`);
  for (const [dpr, gaps] of [...byDpr.entries()].sort((a, b) => a[0] - b[0])) {
    assert.ok(gaps.square.length > 0 && gaps.round.length > 0, `dpr=${dpr}: 直角组或圆角组没有样本，分离性无从谈起`);
    const maxSquare = Math.max(...gaps.square);
    const minRound = Math.min(...gaps.round);
    const threshold = toImagePx(6, dpr);
    assert.ok(maxSquare < minRound,
      `dpr=${dpr}: 直角组最大缺口(${maxSquare}) 必须小于圆角组最小缺口(${minRound})，否则阈值 ${threshold} 没有分离依据`);
    assert.ok(threshold > maxSquare && threshold <= minRound,
      `dpr=${dpr}: 换算后的阈值 ${threshold}（= toImagePx(6, ${dpr})）应落在分离区间 (${maxSquare}, ${minRound}]`);
  }
});

test('判据 4：solo 基线自比零差异、跨主题判不同（每一档 DPR 各自比）', () => {
  /**
   * 以前用 `matrix.find(...)` 取 solo 的两帧 —— DPR 升级后 `find` 只会命中 1x 那一档，
   * 于是这条用例悄悄退回只验 1x。改成**按档配对**：同档内自比、同档内跨主题比，
   * 绝不跨档比（1x 与 2x 的图尺寸不同，跨档比的是分辨率而不是内容）。
   */
  const dprs = new Set(matrix.map((e) => e.dpr));
  assert.ok(dprs.has(1) && dprs.has(2), `solo 基线要在两档 DPR 上都有，实得 {${[...dprs].join(', ')}}`);
  for (const dpr of [...dprs].sort((a, b) => a - b)) {
    const dark = matrix.find((e) => e.scheme === 'solo' && e.theme === 'dark' && e.dpr === dpr);
    const light = matrix.find((e) => e.scheme === 'solo' && e.theme === 'light' && e.dpr === dpr);
    assert.ok(dark?.tube && light?.tube, `dpr=${dpr}: solo 深色/浅色基线缺一帧`);
    const A = mframe(dark.tube);
    const self = assertPixelIdentical(A, A);
    assert.equal(self.pass, true, `dpr=${dpr}: 自比必须零差异`);
    assert.equal(self.diffPixels, 0, `dpr=${dpr}: 自比的 diffPixels 必须是 0`);
    const cross = assertPixelIdentical(A, mframe(light.tube));
    assert.equal(cross.pass, false, `dpr=${dpr}: 跨主题必须判不同`);
    // 修正过的口径：diffPixels 是像素数，不可能超过总像素
    assert.ok(cross.diffPixels <= cross.totalPixels,
      `dpr=${dpr}: diffPixels(${cross.diffPixels}) 不该超过 totalPixels(${cross.totalPixels}) —— 超过说明数的还是通道`);
  }
});
