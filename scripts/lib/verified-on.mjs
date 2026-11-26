/**
 * 插件版本 ↔ 已在其上验证过的内核代次（**发布通道 tag 的唯一依据**）。
 *
 * ## 它回答什么问题
 *
 * `npm run sync:tags` 要给三个通道 tag 各挑一个插件版本：
 *
 *   latest → 在 kernel@latest 那一代上验证过的版本
 *   next   → 在 kernel@next   那一代上验证过的版本
 *   alpha  → 在 kernel@alpha  那一代上验证过的版本
 *
 * 「装了哪条内核轨」决定用户该装哪个插件版本，而这件事**不能靠人记**——
 * 靠人记的结果是发版时忘了更新通道 tag，用户拿着新内核装上旧插件，出问题才发现。
 *
 * ## 与 `KERNEL_GENERATIONS` 的分工
 *
 * `KERNEL_GENERATIONS` 是**跨版本的能力台账**：它回答「本插件的当前代码兼容哪些内核」，
 * 由 peer 范围与 gate 面共同表达。
 *
 * 这份表回答的是**历史问题**：某个**已发布的插件版本**当初在哪些内核上验过。
 * 两者不能合并——1.14.0 验过 rc.3，不代表 1.13.0 也验过；而发布之后代码就冻结了，
 * 这份映射也就不会再变。
 *
 * ## 维护约定
 *
 * - **每个已发布版本一行**，按版本从旧到新。
 * - 新发版时追加一行，列出**该版本实际跑过的**代次（跑过四面才算，只看 mount 不算）。
 * - **追加代次必须以真实验证为前提**：没跑过就不要写。已发布版本在新内核上验证通过、
 *   且代码零改动（peer 同段已覆盖）时，**可以**把该代次登记进来，不需要发新版——
 *   `next` 通道要靠它跟随内核 rc 前进。禁止的只是「没验证就声称支持」。
 *   （rc.4 即此例：1.14.0 五面实测全绿、依赖包零运行时差异，故登记 rc.4 而不发版。）
 *
 * ⚠️ 这一条是本表唯一的纪律。`tests/channel-tags.test.mjs` 会校验表里的代次都在
 * `KERNEL_GENERATIONS` 里，但它**无法**校验「你真的跑过」——那只能靠发版流程。
 * ## 为什么住在 `scripts/lib/` 而不是 `src/`
 *
 * 本模块只被**构建期脚本**（`scripts/sync-generation-tags.mjs`）与测试使用，
 * **宿主运行时不加载它**。放在 `src/` 下会被 `tsc` 产出 `lib/verified-on.js`，
 * 而 `check:lib-reach` 要求 `lib/` 下每个产物都能从 `lib/index.js` 走到 ——
 * 那个产物永远走不到，门禁会（正确地）判红。
 *
 * 两种"修法"里选了这个：另一种是让宿主模块引用它以消灭告警，那是**伪造依赖**，
 * 为骗过门禁而制造一条假的 import 边，比告警本身坏得多。
 *
 * ## 为什么是 `.mjs` + JSDoc 而不是 `.ts`（issue #208 改的，2026-11）
 *
 * 原先是 `.ts`，靠 Node 24 的类型剥离直连。那条路有两个洞：
 *  1. **两个 tsconfig 都只 `include: ["src/**"]`**，`scripts/**` 整个不在类型检查面内 ——
 *     也就是说这个模块的类型从来没被 tsc 看过一眼。它写着 `type`/`satisfies`，看起来有
 *     类型保障，实际只有运行期行为被测试覆盖；把 `channel: string` 收紧成字面量联合，
 *     两个消费者都照样编译通过（因为压根没编）。
 *  2. **`engines.node` 允许 `^22.19`**，而直连 `.ts` 在 Node 22 上是赌 flag 行为（22.19
 *     的类型剥离默认状态与 24 不同）。CI 用 `node:22` 容器，`npm run sync:tags` 与
 *     `tests/channel-tags.test.mjs` 都要 import 它 —— 那等于把一条发布脚挂在某个版本的
 *     默认开关上。
 *
 * 改成 `.mjs` + JSDoc 是本仓脚本的既有形态（`scripts/*.mjs` 全是这个写法），代价是
 * 类型表达力：字面量联合改用 `@typedef` + `@type {readonly [...]}`，`satisfies` 换成
 * 运行期断言。**这不比原来的"零检查"差**：原来写的类型一行都没被验证过。
 *
 * 另一条路（加 `tsconfig.scripts.json` 进 `DEFAULT_PROJECTS`）会把 `scripts/` 全树拉进
 * tsc 面，那是 30+ 个纯 JS 脚本的隐式 `any` 海洋（`checkJs` 一开就是几百条），本轮不做。
 * 真要那么做，得先给整个 `scripts/` 立一套 gradual-typing 口径，不是顺手加个 include。
 * @module dsh-later/verified-on
 */

/**
 * 版本 → 该版本验证过的内核代次。
 *
 * 类型用 `Record<string, readonly string[]>` 而不是把版本号写成字面量联合：新发版时
 * 追加一行不该要求改类型（那是每发一版就要动类型的不必要耦合）。
 *
 * @type {Record<string, readonly string[]>}
 */
export const VERIFIED_ON = {
  /**
   * 1.15.0：当前发布版。
   *
   * 在 v1.15.0（`685af2b`）上跑 `npm run verify:kernels --steps mount,function,type,gate
   * --no-install`：**绿 15 / 红 0 / 未判定 0**，明细 `.verify/across-kernels-2026-11-20T07-53-07-275Z.json`。
   * 逐代结论与 1.14.0 一致（含 rc.3 / rc.4 / rc.5：投递 `spliced=1 dispatch=Y`、已关闭会话同样、
   * 子会话不该投=Y、at 形状 5/5、type 换线 19 处两 tsconfig 通过）。故三条通道与代际 handle 改指它。
   */
  '1.15.0': [
    '0.1.2-rc.1',
    '0.1.5-rc.3',
    '0.1.7-rc.1',
    '0.1.7-rc.2',
    '0.2.0-rc.2',
    '0.2.1-rc.2',
    '0.2.1-rc.3',
    '0.2.1-rc.4',
    '0.2.2-alpha.2',
    '0.2.2-alpha.3',
    '0.2.2-rc.1',
    '0.2.2-rc.2',
    '0.2.2-rc.3',
    '0.2.2-rc.4',
    '0.2.2-rc.5',
  ],
  /**
   * 1.14.0：上一版（已发布的稳定线）。
   *
   * 全部 15 代都过（`npm run verify:kernels` 全量：绿 15 / 红 0 / 未判定 0，
   * 见 docs/verification.md）。所以三条通道现在都指它。
   * rc.4 / rc.5 为内核 `next` 前进后的跟进验证（五面全绿、零代码改动），见 upstream-compat。
   */
  '1.14.0': [
    '0.1.2-rc.1',
    '0.1.5-rc.3',
    '0.1.7-rc.1',
    '0.1.7-rc.2',
    '0.2.0-rc.2',
    '0.2.1-rc.2',
    '0.2.1-rc.3',
    '0.2.1-rc.4',
    '0.2.2-alpha.2',
    '0.2.2-alpha.3',
    '0.2.2-rc.1',
    '0.2.2-rc.2',
    '0.2.2-rc.3',
    '0.2.2-rc.4',
    '0.2.2-rc.5',
  ],
};

/**
 * @typedef {'latest' | 'next' | 'alpha'} KernelChannel
 */

/**
 * 发布通道：与内核的 dist-tag 一一对应。
 *
 * 为什么只有这三条：内核用 `latest` / `next` / `alpha` 三条轨分发，本表跟着它走。
 * **不做第四条**——多一条就多一个要说清楚「它是干什么的」的负担，而内核没有对应轨道。
 *
 * `@type {readonly KernelChannel[]}` 就是原来 `as const satisfies` 的替身：约束由 JSDoc 给，
 * 元素类型的一致性靠下面那行运行期校验把住（写错一个通道名，`tests/channel-tags.test.mjs`
 * 立刻红，不必等到有人误用）。
 * @type {readonly KernelChannel[]}
 */
export const KERNEL_CHANNELS = ['latest', 'next', 'alpha'];

// `.mjs` 里没有 `satisfies`：这一行是它的运行期等价物。放在模块顶层而不是懒执行，
// 是要让「常量写错」在任何 import 路径上都立刻暴露（脚本与测试都会 import 本模块）。
if (KERNEL_CHANNELS.some((channel) => !['latest', 'next', 'alpha'].includes(channel))) {
  throw new Error(`KERNEL_CHANNELS 里有未知通道：${KERNEL_CHANNELS.join(' / ')}`);
}

/**
 * 给某个通道挑插件版本：**在该通道当前指向的内核代次上验证过的、版本号最高的那个**。
 *
 * @param {string} channel - 通道名（`latest` / `next` / `alpha`）。
 * @param {string | undefined} kernelVersion - 内核在该通道上**当前**指向的版本（如 `0.2.2-rc.3`）。
 * @param {Record<string, readonly string[]>} [verifiedOn] - 版本→代次映射，默认 {@link VERIFIED_ON}（可注入以便测试）。
 * @returns {string | undefined} 挑中的插件版本；**没有任何版本验证过该内核时返回 `undefined`**。
 *   返回 `undefined` 是刻意的：调用方必须把「这条通道没有可用版本」如实报出来，
 *   **不能**悄悄回退到 `latest` —— 那会让用户以为装上了配套版本。
 */
export function pickVersionForChannel(channel, kernelVersion, verifiedOn = VERIFIED_ON) {
  if (!/** @type {readonly string[]} */ (KERNEL_CHANNELS).includes(channel)) {
    throw new Error(`未知通道：${channel}（只支持 ${KERNEL_CHANNELS.join(' / ')}）`);
  }
  if (typeof kernelVersion !== 'string' || kernelVersion.length === 0) return undefined;

  /** @type {string | undefined} */
  let best;
  for (const [version, generations] of Object.entries(verifiedOn)) {
    if (!generations.includes(kernelVersion)) continue;
    if (best === undefined || compareVersions(version, best) > 0) best = version;
  }
  return best;
}

/**
 * 比较两个 `x.y.z` 版本（本仓只发稳定版，不处理预发布后缀）。
 *
 * 为什么自己写而不引 semver：本模块要能被 `scripts/` 与测试在**没有安装依赖**的场景下
 * 直接 import（`sync-tags` 是个纯脚本）。只比较稳定版三段的字典序就够，且可控。
 *
 * @param {string} a - 左版本。
 * @param {string} b - 右版本。
 * @returns {number} 负数表示 a 更小。
 */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
