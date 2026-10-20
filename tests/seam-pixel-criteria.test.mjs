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
import { decodePngRgb } from '../scripts/seam-check/png.mjs';
import {
  detectSeamLine,
  detectRoundedTopCorners,
  maxDeviationSpan,
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
