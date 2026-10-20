/**
 * 管子接缝的实机采集与判据执行（issue #42 §2 + §3）。
 *
 * 与 `criteria.mjs` 的分工：那边是纯函数判据（已被 `tests/seam-pixel-criteria`
 * 用真实帧 + 合成对照验证）；这边负责**产生输入** —— 在浏览器里量出几何、裁出
 * 接缝带、把几何 seamY 交给判据。
 *
 * ## §3 要求"demo 与真机用同一把尺"
 *
 * 下面的 `measureTube()` 逐条对应 `docs/dock-stacking-demo.html` 的 `measure()`：
 * `overlap = hostPanel.bottom - ssBody.top`、`seam = composer.top - ssBody.bottom`、
 * 两面板 `borderRadius`、`ssRoot.marginBottom`。公式保持一致，是为了让 demo 里
 * 判过的结论能直接搬到真机 —— 换一把尺，之前的对照实验就全废了。
 *
 * ## 为什么默认拒绝跑在生产实例上
 *
 * 跑这个脚本需要**真实的待发提醒 + 真实排队消息**，也就是会往所连实例的工作区里
 * 落下持久状态（提醒是 `delivery: user`，到点以用户身份发言并起 agent 回合）。
 * 本仓库开发过程中已经因此出过一次事故：测试提醒被建进了活跃工作区，靠手工隔离
 * 才拆掉。所以这里硬性要求显式指定非 3080 的实例，且必须带 `--allow-state-write`。
 *
 * 用法（配合隔离实例）：
 *   DSH_URL=http://127.0.0.1:3099/?token=… node scripts/seam-check/capture.mjs \
 *     --allow-state-write --out docs/media/seam-live.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { detectSeamLine } from './criteria.mjs';

const PRODUCTION_URL_HINT = ':3080';

function parseArgs(argv) {
  const out = { out: null, allowStateWrite: false, url: process.env.DSH_URL || null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i];
    else if (a === '--allow-state-write') out.allowStateWrite = true;
    else if (a === '--url') out.url = argv[++i];
  }
  return out;
}

/**
 * 安全闸：没有显式授权，就不允许连生产实例、也不允许落任何持久状态。
 * 宁可让脚本"跑不起来"，也不要悄悄往用户正在用的会话里塞代发提醒。
 */
function guard(opts) {
  if (opts.url === null) {
    throw new Error('必须用 --url 或 DSH_URL 指定目标实例（不给默认值，避免误连生产）');
  }
  if (opts.url.includes(PRODUCTION_URL_HINT)) {
    throw new Error(`拒绝在默认端口(3080)上运行：那是正在使用的实例，采集会写入持久提醒。请用隔离实例。`);
  }
  if (!opts.allowStateWrite) {
    throw new Error('需要 --allow-state-write：本脚本会创建真实待发提醒与排队消息');
  }
}

/**
 * 在页面里量接缝几何 —— 与 demo 的 measure() 同一把尺。
 * 作为函数字符串传给 page.evaluate，故**不能引用外层闭包**。
 */
function measureTube() {
  const ssRoot = document.querySelector('.ss-dock-root');
  const ssBody = document.querySelector('.ss-dock-body');
  if (!ssRoot || !ssBody) return { error: '提醒 dock 未渲染（先建至少一条待发提醒）' };
  const queue = document.querySelector('[data-queue-dock]');
  const hostPanel = queue ? queue.querySelector('div[class*="_panel"]') : null;
  const composer = document.querySelector('[contenteditable="true"]');
  const composerCard = composer ? composer.closest('div[class*="_panel"]') || composer.parentElement : null;
  const gap = (el) => (el ? getComputedStyle(el).borderTopLeftRadius : null);
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  };
  const sb = ssBody.getBoundingClientRect();
  const hp = hostPanel ? hostPanel.getBoundingClientRect() : null;
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    dpr: window.devicePixelRatio,
    ssRootRect: rect(ssRoot),
    ssBodyRect: rect(ssBody),
    hostPanelRect: rect(hostPanel),
    composerRect: rect(composerCard),
    // §3 同一把尺
    overlap: hp ? +(hp.bottom - sb.top).toFixed(1) : null,
    seamToComposer: composerCard ? +(composerCard.getBoundingClientRect().top - sb.bottom).toFixed(1) : null,
    queuePanelRadius: gap(hostPanel),
    ssPanelRadius: gap(ssBody),
    ssMarginBottom: getComputedStyle(ssRoot).marginBottom,
    stackGap: ssRoot.parentElement ? getComputedStyle(ssRoot.parentElement).gap : null,
  };
}

/**
 * 接缝行的**视口 y**（判据要的 seamY 必须由几何给出）。
 *
 * 之前踩过的坑：拿"图里最偏离的那一行"当 seamY 是循环论证 —— 任何含文字或
 * 进度条的裁图都必然有一行高偏离，于是永远判 FAIL。实测真机帧用这种猜法会把
 * 进度条（亮度 118、跨度 37%）误当成缝线。
 */
function seamViewportY(geo) {
  if (geo.hostPanelRect) return geo.hostPanelRect.bottom;
  // 没有队列条在场时，接缝语义不成立：交回调用方按 solo 处理
  return null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  guard(opts);
  // playwright 只在真要跑的时候加载：CI 里没有它，判据测试不需要这个脚本可运行
  // eslint-disable-next-line import/no-unresolved
  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9222')
    .catch(async () => chromium.launch());
  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();
  await page.goto(opts.url, { waitUntil: 'networkidle' });

  const geo = await page.evaluate(measureTube);
  if (geo.error) {
    console.error(`✗ ${geo.error}`);
    await browser.close();
    process.exitCode = 2;
    return;
  }

  const seamY = seamViewportY(geo);
  console.log('几何（与 demo 同一把尺）:');
  console.log(`  overlap(队列底 - 提醒顶) = ${geo.overlap}px   ${geo.overlap > 0 ? '（B2 的 3px 重叠是消缝手法，有意）' : ''}`);
  console.log(`  提醒面板圆角 = ${geo.ssPanelRadius}   队列面板圆角 = ${geo.queuePanelRadius}`);
  console.log(`  ss margin-bottom = ${geo.ssMarginBottom}   stack gap = ${geo.stackGap}`);
  console.log(`  与 composer 的缝 = ${geo.seamToComposer}px   DPR = ${geo.dpr}`);

  if (seamY === null) {
    console.log('  无队列条在场 → solo 态，按判据 4（与基线逐像素相同）另行比对');
  }

  if (opts.out) {
    const band = 24;
    await page.screenshot({
      path: path.resolve(opts.out),
      clip: {
        x: geo.ssBodyRect.left,
        y: Math.max(0, seamY - band),
        width: geo.ssBodyRect.width,
        height: Math.min(band * 2, geo.viewport.h - Math.max(0, seamY - band)),
      },
    });
    // 把 seamY 相对裁图的位置写进旁证文件，判据读图时不再靠猜
    fs.writeFileSync(`${opts.out}.meta.json`, JSON.stringify({
      seamYInCrop: seamY - Math.max(0, seamY - band), geo,
    }, null, 2));
    console.log(`  已裁接缝带 → ${opts.out}（判据用 seamY 见 ${opts.out}.meta.json）`);
  }
  await browser.close();
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
});
