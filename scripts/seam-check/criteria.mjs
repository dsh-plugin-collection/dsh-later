/**
 * 管子接缝的像素判据（issue #42 §2）。
 *
 * 纯函数、不碰 I/O、不碰浏览器 —— 因此既能被 `tests/` 用仓库里**已采集的真实帧**
 * 直接验证，也能被 capture 脚本复用。判据本身必须可证伪：本模块的测试用一对
 * 已知好/已知坏的真图（`demo-schemeB2-seam.png` 与 `demo-scheme0-seam.png`）
 * 要求它**必须区分得开**，只要求"全绿"是假安全感。
 *
 * ## 为什么判据是"相对偏离"而不是"找 border-l1 那个色值"
 *
 * #42 原文写的是「不存在一整行 `border-l1` 色像素连续横贯面板宽度」。但截图里
 * 拿不到 CSS 变量，只能拿像素；而 `border-l1` 在深/浅主题下取值不同，浅色主题下
 * 描边甚至可能**比面板背景更暗**。所以这里判「该行与接缝带中位亮度的偏离超过阈值」，
 * **方向无关**，一套判据同时覆盖两个主题。
 *
 * @module dsh-later/scripts/seam-check/criteria
 */

/** 行的平均亮度（Rec.601 加权，比简单均值更贴近人眼对"线"的感知）。 */
export function rowLuminance(row, width) {
  let sum = 0;
  for (let x = 0; x < width; x += 1) {
    sum += 0.299 * row[x * 3] + 0.587 * row[x * 3 + 1] + 0.114 * row[x * 3 + 2];
  }
  return sum / width;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * 某行内「与基准亮度偏离超过 delta 的最长连续像素段」占行宽的比例。
 *
 * 用"最长连续段"而非"偏离像素总数"，是因为缺陷形态就是**一条连续的线**；
 * 文字抗锯齿、图标边缘也会产生偏离像素，但它们是零散的，撑不到 spanRatio。
 */
export function maxDeviationSpan(row, width, baseline, delta) {
  let best = 0;
  let cur = 0;
  for (let x = 0; x < width; x += 1) {
    const lum = 0.299 * row[x * 3] + 0.587 * row[x * 3 + 1] + 0.114 * row[x * 3 + 2];
    if (Math.abs(lum - baseline) > delta) {
      cur += 1;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best / width;
}

/**
 * 判据 1：接缝带内不得存在横贯宽度的线。
 *
 * @param img decodePngRgb 的结果
 * @param opts.seamY 接缝锚点行（单一）。采集脚本由几何算出，不是猜的。
 * @param opts.seams 更精确的形式：两个锚点 `[队列面板底边, 提醒面板顶边]`。
 *   **B2 的 3px 消缝重叠让这两个值不相等**，缝线可能落在两者之间 —— 只取单点 ±2px
 *   会漏判。实测踩过：scheme0 对照组的缝线在 `ssBody.top`(171)，而按 #42 原文取
 *   `hostPanel.bottom`(174)±2 的带恰好错过它，把一个**已知有缺陷**的帧判成 PASS。
 *   所以真实采集应传 `seams`；`seamY` 保留给单锚点场景（如已裁好的固定基准图）。
 * @param opts.band 采样带半宽，默认 2（#42 原文「±2px」）
 * @param opts.delta 视为"偏离"的最小亮度差，默认 12
 * @param opts.spanRatio 连续段占行宽的判定阈值，默认 0.9
 */
export function detectSeamLine(img, { seamY, seams, band = 2, delta = 12, spanRatio = 0.9 } = {}) {
  if (img === undefined || img === null) throw new Error('detectSeamLine: 缺 img');
  const anchors = seams ?? (Number.isFinite(seamY) ? [seamY] : null);
  if (anchors === null) throw new Error('detectSeamLine: 需要 seamY 或 seams（由几何算出，不要猜）');
  for (const a of anchors) {
    if (!Number.isFinite(a)) throw new Error(`detectSeamLine: 锚点必须是数字，收到 ${a}`);
  }
  const lo = Math.round(Math.min(...anchors));
  const hi = Math.round(Math.max(...anchors));
  const y0 = Math.max(0, lo - band);
  const y1 = Math.min(img.height - 1, hi + band);
  if (y1 <= y0) throw new Error(`detectSeamLine: 采样带越界 (anchors=${anchors}, h=${img.height})`);

  const rows = [];
  for (let y = y0; y <= y1; y += 1) {
    rows.push({ y, row: img.data.subarray(y * img.width * 3, (y + 1) * img.width * 3) });
  }
  const baseline = median(rows.map((r) => rowLuminance(r.row, img.width)));

  let worst = null;
  for (const r of rows) {
    const span = maxDeviationSpan(r.row, img.width, baseline, delta);
    const lum = rowLuminance(r.row, img.width);
    const hit = { y: r.y, spanRatio: span, luminance: lum, deviation: lum - baseline };
    if (worst === null || span > worst.spanRatio) worst = hit;
  }

  return {
    pass: worst.spanRatio < spanRatio,
    baseline,
    band: [y0, y1],
    worst,
    /** 判定用的阈值，写进结论里便于复核，不让人去猜是不是"调参调出来的通过"。 */
    thresholds: { delta, spanRatio, band },
  };
}

/**
 * 判据 3：整根管子只允许最顶部两个圆角。
 *
 * 做法：在给定"面板顶边行"处，检查左右两端是否存在**圆角造成的背景缺口**
 * （角上若干列的亮度贴合面板背景而非描边）。顶边应当无缺口。
 *
 * @param opts.topY 待检查的面板顶边行
 * @param opts.cornerProbe 从边缘向内探测的列数（圆角半径量级）
 * @param opts.minOffsetColumns 判为圆角所需的最小缺口列数，默认 6。
 *   **这个阈值是按几何真值定标的，不是拍的**：在 `docs/media/seam-matrix` 的 8 帧上，
 *   直角组（计算 `border-radius: 0px`）缺口 1–3 列，圆角组（16px）缺口 11–12 列。
 *   定成 2 会把深色直角帧的描边抗锯齿（3 列）误报成圆角 —— 实测踩过。
 */
export function detectRoundedTopCorners(img, { topY, cornerProbe = 16, delta = 12, minOffsetColumns = 6 } = {}) {
  if (!Number.isFinite(topY)) throw new Error('detectRoundedTopCorners: 需要 topY');
  const row = img.data.subarray(topY * img.width * 3, (topY + 1) * img.width * 3);
  const inner = rowLuminance(row, img.width);
  const probe = (from, to, step) => {
    let off = 0;
    for (let x = from; x !== to; x += step) {
      const lum = 0.299 * row[x * 3] + 0.587 * row[x * 3 + 1] + 0.114 * row[x * 3 + 2];
      if (Math.abs(lum - inner) > delta) off += 1;
    }
    return off;
  };
  const left = probe(0, Math.min(cornerProbe, img.width), 1);
  const right = probe(img.width - 1, Math.max(img.width - 1 - cornerProbe, 0), -1);
  return {
    /** 有圆角时，角上会出现若干列与面板内部亮度不同（背景透出）。 */
    rounded: left >= minOffsetColumns || right >= minOffsetColumns,
    leftOffsetColumns: left,
    rightOffsetColumns: right,
    innerLuminance: inner,
  };
}

/**
 * 判据 2：管子左右缘的描边列从队列顶到提醒底连续、无 x 漂移。
 *
 * 需要**整根管子**的纵向范围（接缝裁图不足以判），由 capture 脚本传入几何。
 *
 * ## 实现要点（第一版这里是错的，别退回去）
 *
 * 第一版拿**整行平均亮度**当"面板内部"基准，逐行在 `edgeX±4` 里找偏离基准的列。
 * 那个基准是面板内(31)与面板外(16)的混合值，于是描边列(62)的偏离被算小、找不到，
 * 所有帧（包括已知良好的 B2）一律判 false —— 因为该函数**从未被任何真实输入喂过**，
 * 写成什么样都不会有人发现。
 *
 * 正确做法：**逐行在边缘内外各取一小段的中位数**作为"背景"与"内部"两个基准，
 * 描边列必须**同时**显著偏离两者（比两者都亮或都暗），且夹在两者之间。
 * 这样与主题无关（浅色下描边可能比内部暗），也不依赖整行统计。
 */
export function detectSideStrokeContinuity(img, { x0, x1, yTop, yBottom, delta = 12, tolerance = 1.5, window: w = 3 } = {}) {
  for (const [k, v] of Object.entries({ x0, x1, yTop, yBottom })) {
    if (!Number.isFinite(v)) throw new Error(`detectSideStrokeContinuity: 缺 ${k}`);
  }
  const lumAt = (row, x) => 0.299 * row[x * 3] + 0.587 * row[x * 3 + 1] + 0.114 * row[x * 3 + 2];
  const medianAt = (row, from, to) => {
    const vals = [];
    for (let x = Math.max(0, from); x <= Math.min(img.width - 1, to); x += 1) vals.push(lumAt(row, x));
    if (vals.length === 0) return null;
    vals.sort((a, b) => a - b);
    return vals[vals.length >> 1];
  };

  const probeEdge = (edgeX, outward) => {
    let found = 0; let breaks = 0; let maxDrift = 0; let prev = null;
    const lo = Math.round(yTop); const hi = Math.round(yBottom);
    for (let y = lo; y <= hi; y += 1) {
      if (y < 0 || y >= img.height) continue;
      const row = img.data.subarray(y * img.width * 3, (y + 1) * img.width * 3);
      // 外侧（背景）与内侧（面板）各取一段中位数，窗口紧贴候选描边列
      const outer = outward < 0 ? medianAt(row, edgeX - 1 - w * 2, edgeX - 2) : medianAt(row, edgeX + 2, edgeX + 1 + w * 2);
      const inner = outward < 0 ? medianAt(row, edgeX + 2, edgeX + 1 + w * 2) : medianAt(row, edgeX - 1 - w * 2, edgeX - 2);
      if (outer === null || inner === null) { breaks += 1; continue; }
      // 描边列：显著偏离内外两个基准，且位于两者之间（夹心结构）
      let bestX = null; let bestScore = 0;
      for (let x = Math.max(0, Math.round(edgeX) - 3); x <= Math.min(img.width - 1, Math.round(edgeX) + 3); x += 1) {
        const l = lumAt(row, x);
        const dOuter = Math.abs(l - outer);
        const dInner = Math.abs(l - inner);
        const between = (l >= Math.min(outer, inner) - 1) && (l <= Math.max(outer, inner) + 1);
        if (dOuter > delta && dInner > delta && !between && Math.min(dOuter, dInner) > bestScore) {
          bestScore = Math.min(dOuter, dInner); bestX = x;
        }
      }
      if (bestX === null) { breaks += 1; continue; }
      found += 1;
      const drift = Math.abs(bestX - edgeX);
      if (drift > maxDrift) maxDrift = drift;
      if (prev !== null && Math.abs(bestX - prev) > tolerance) breaks += 1;
      prev = bestX;
    }
    return { found, breaks, maxDrift };
  };
  const left = probeEdge(x0, -1);
  const right = probeEdge(x1, 1);
  const total = Math.round(yBottom) - Math.round(yTop) + 1;
  return {
    pass: left.breaks === 0 && right.breaks === 0
      && left.found >= total * 0.95 && right.found >= total * 0.95,
    left, right, total,
  };
}

/**
 * 判据 4：solo（只有提醒条）与修复前基线逐像素相同。
 *
 * 两图尺寸必须一致 —— 尺寸不同直接判失败，不做"差不多就行"的缩放，
 * 否则尺寸变化本身就被糊掉了。
 */
export function assertPixelIdentical(a, b) {
  if (a.width !== b.width || a.height !== b.height) {
    return { pass: false, reason: `尺寸不同 ${a.width}x${a.height} vs ${b.width}x${b.height}`, diffPixels: null };
  }
  /**
   * `diff` 逐字节数的是**通道**，而 `totalPixels` 是**像素** —— 第一版把通道数直接
   * 当 `diffPixels` 返回，于是 3 通道下会报出 `diffPixels` 比 `totalPixels` 还大的
   * 荒谬值（实测 109613 > 36540）。改成按像素归并，并单独给出最大通道差。
   */
  let diffPixels = 0;
  let maxChannelDiff = 0;
  for (let p = 0; p < a.width * a.height; p += 1) {
    let pixelDiffers = false;
    for (let c = 0; c < 3; c += 1) {
      const d = Math.abs(a.data[p * 3 + c] - b.data[p * 3 + c]);
      if (d > 0) pixelDiffers = true;
      if (d > maxChannelDiff) maxChannelDiff = d;
    }
    if (pixelDiffers) diffPixels += 1;
  }
  const totalPixels = a.width * a.height;
  return { pass: diffPixels === 0, diffPixels, totalPixels, maxChannelDiff };
}
