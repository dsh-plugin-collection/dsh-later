# dock 栈位置契约：把「借邻居私有钩子」换成「读自己的位置」

> 状态：**待实现**。配套 [设计决策 §8](../design-decisions.md) 与 [dock-alignment.md](dock-alignment.md) §5 G3。
> 上游诉求（宿主提供 dock 栈契约）另跟踪 **#43**；本文件是**本仓这一半**——不等宿主就能落地的部分。

## §0 一句话

#41 的管子接缝靠 `[data-queue-dock] + .ss-dock-root` 实现，那是**宿主 QueueDock 的私有属性**。
本文件把它换成一条与邻居身份无关的判据：**我在 dock 栈里排第几**。选择器只依赖
`[data-slot]`（渲染器给每个插槽出口的公开标记）与我们自己的 `.ss-dock-root`。

## §1 为什么「位置」比「邻居是谁」对

我们要表达的事实一直是「**我上面还有东西**」（顶边要接上段）与「**我是栈底**」（底边贴 composer）。
#41 用「上面那条是不是队列条」来近似前者，代价三条：

1. **耦合邻居身份**：队列改类名/改属性、或上面换成 goal/todo/第三方 dock，我们的判据就静默失效
   （宿主 rc 升级需人工复查 `[data-queue-dock]` 还在不在，见 `styles.ts` 现行注释）；
2. **答不上真正的问题**：如果将来上面那条**不是**队列而是别的 dock，我们就该方角时仍是圆角——
   邻居身份对了、位置不对，观感照样错；
3. **规模不对**：同一条插槽上宿主自己占着三家（实测 `todo(0) / goal(10) / queue(20)`，注册处
   `dsh-client-ui-conversation` 与 `dsh-client-ui-goal`），**每家各自画自己的壳**——`0.2.1-rc.2` 里
   只有 queue 是 attach 式（`_dock{… margin:0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px)}`），
   todo 与 goal 都是 `margin:0 auto` 的浮卡壳（todo 还带全圆角 + `--dsw-elevation-panel`）。**写死 attach
   的两家（queue 与我们 `order: 30`）都把"我是栈底"当隐含前提**，而没有任何 API 说谁是栈底：谁在上面
   多一条 dock，前提就悄悄翻转。这不是补一个特例能收口的，是缺一个「栈内位置」的表达；#43 向宿主所要的
   正是它，本文件先把**我们能自己表达的那一半**做掉。

位置判据在浏览器里是免费的：渲染器把 `list` 型插槽的每个条目**直接**渲染成
`[data-slot="<插槽名>"]` 锚点的兄弟子元素（`display:contents`，见
`@deepseek-ai/dsh-client-ui-renderer` 的 `SlotOutlet` / `renderOutletContent`），
条目组件自己不额外包一层 DOM —— 我们的 dock 根正是 `.ss-dock-root`（`ScheduleDock.tsx` 里唯一一处
`className="ss-dock-root"`，`tests/dock-tube-seam.test.mjs` 已有断言守着这条）。

## §2 钉死的选择器（实现与测试都以此为准，不许各自再发明一遍）

`src/client/styles.ts` 中，**删掉**现有两条 `[data-queue-dock] + …` 规则，**换成**下面三条
（A 在前、B 在后，照抄）：

```css
/* A. 不是栈底 → 不再占「贴 composer」那个位置（负下边距收回 0） */
[data-slot="conversation.input.dock"] > .ss-dock-root:not(:last-child) { margin-bottom: 0; }

/* B. 上面还有兄弟 → 本段是管子的下段：顶边直角 + 无顶描边 */
[data-slot="conversation.input.dock"] > .ss-dock-root:not(:first-child) .ss-dock-body { border-radius: 0; }
[data-slot="conversation.input.dock"] > .ss-dock-root:not(:first-child) .ss-dock-body::after { border-top: none; }
```

**A 与 B 不争优先级**（写下来免得后人以为次序是载荷）：A 的特指度是 (0,3,0)、B 是 (0,4,0)
（B 走 `::after` 的那一支是 (0,4,1)，对应基础规则 `.ss-dock-body::after` 的 (0,1,1)），
而且两者命中**不同元素的不同声明**（A 打 `.ss-dock-root` 的 `margin-bottom`，B 打 `.ss-dock-body`
的 `border-radius` / `::after` 的 `border-top`）。真正让它们盖过基础规则的是特指度——基础规则
`.ss-dock-root{…}` / `.ss-dock-body{…}` 只有 (0,1,0)——**不是源码次序**。所以次序只是为了读起来
按「先说让位、再说接缝」的因果，挪动它不会改变渲染结果；写测试的人如果要保留一条「源序」断言，
必须先说清它在防什么，防不住就别留（见 §3 判据 3 的备注）。

三条就够，**不要**再加「非末位时闭合底边」一类规则：底边开口是基础态（`::after` 无 bottom 边），
它同时正确于「贴 composer」与「下面还有一段管子」两种情形——下一段自己的顶边规则负责那个接缝。
同理不需要给「中段」特判：A+B 同时命中时结果是「顶直角 + 无顶描边 + 底开口 + 不占末位」，
正是管子中段该有的样子。

### 与 #41 现物的一致性（回归基线）

| 现场 | #41（借钩子） | 本方案（读位置） |
|---|---|---|
| 只有我们一条 dock | `:first-child` 成立、两条规则都不命中 → 观感不变 | 同：`:first-child` 且 `:last-child` → 两条都不命中 → **逐像素不变** |
| 队列条在上、我们在下 | 命中 `[data-queue-dock] + …` → 顶直角、无顶描边 | 命中 `:not(:first-child)` → 同上，**逐像素不变** |
| 上面是 goal / todo / 第三方 dock | **不命中**（邻居身份不对）→ 圆角顶，接缝错 | 命中 → 正确 |
| 我们不在末位（将来 order>30 的插件） | 无此概念（我们仍占着负边距） | A 命中 → 让出栈底位 |
| 上面那条渲染崩了（宿主插 `[data-slot-error]` 空锚点） | 不命中 → 圆角顶 | `:not(:first-child)` 命中 → 顶方角，而上方无实际内容 → **已知降级**，见 §4 |

**fail-open 方向**：任何一条新选择器在真实宿主里永不命中（例如出口结构与我们理解的不一致），
结果就是回到 #41 之前的观感（接缝多一条描边），**不会更糟**。这是刻意的：改动不能让常见路径依赖
「选择器必须命中」，所以基础态仍是 attach（末位态），只有明确不是末位时才让位。

## §3 验收（每条都要有可跑的判据，不接受「看着没问题」）

| # | 判据 | 落在哪 |
|---|---|---|
| 1 | `styles.ts` 里不再出现 `data-queue-dock`；三条新规则**逐字**出现且次序为 A→B（这条次序只是**文本锁**，防有人改写规则文本；按 §2 它**不承载优先级**，别读成「次序错了就渲染错」） | `tests/dock-tube-seam.test.mjs` 静态断言 |
| 2 | 反面自证：把 `data-queue-dock` 塞回去，判据 1 必须变红（防永真） | 同上（内存内改文本再跑，同 `client-class-guard` 的手法） |
| 3 | demo `docs/dock-stacking-demo.html` 的 B3 段选择器与 `styles.ts` 同源（剥掉 `.scheme[data-scheme=…]` 前缀后逐字相同），且声明体含同一条声明 | 同文件的 demo 同源判据（扩到 B3） |
| 4 | demo 四种现场（独存 / 上方队列 / 上方非队列 dock / 上方崩溃空锚点）各有截图与像素结论 | demo 页 + `tests/seam-pixel-criteria.test.mjs` 既有口径；结果写进本文件 §6 |
| 5 | 真机结构前提：`.ss-dock-root` 确实是 `[data-slot="conversation.input.dock"]` 的**直接子元素**，且其 `display` 为 `contents` | 隔离实例 + 独立 headless 浏览器，结论写进 §6。**工具不在本仓**：`devkit/` 是本工作区的兄弟目录（`../devkit/instance.mjs`），不随插件发布——没有它的人只能把这条判据交给维护者采集 |
| 6 | 真机观感零变化：单独存在时改前/改后截图逐像素相同（这是**唯一**不能靠静态断言保证的一条） | 同上 |
| 7 | `npm run typecheck` + `npm run build` + `npm test` 全绿；`lib/client.js` 随提交更新 | CI / 本地 |

### §3 附注：判据落在 src 还是 lib（踩过一次，写死口径）

- **静态断言一律在 `src/client/styles.ts` 上做**（中文是原文，`cssOf` 那套拼回文本的做法也只在 src 侧）；
- **只有「必须证明产物」时才碰 `lib/client.js`**，而 esbuild 把非 ASCII 转义成 `\uXXXX`，所以判据必须写成
  「**原文 || 转义形态**」二者之一命中即可 —— 只比转义形态同样是错的：esbuild 的转义策略不是我们的契约，
  换版本/换 minify 档就可能出原文，那会造出一条永远判红的断言；
- **纯 ASCII 探针可以裸 grep**（如 `data-queue-dock` 在 lib 里应为 0），别给它套转义，只会让断言更难读；
- 归因记一句：`grep` 返回空的真实含义是「**这种形态下没命中**」，不是「不存在」。跨「源码↔产物」的判据
  必须显式建模形态差异，否则就是把工具的输出当成了语义。

## §4 已知边界（写清楚，不留「以后再补」）

- **崩溃锚点会占一个兄弟位**：上方某条 dock 抛错时，渲染器在同一父节点下留一个
  `[data-slot-error]` 空 div，于是我们 `:not(:first-child)` 成立而上方并无可见内容 → 顶边画成方角。
  这是**已经在降级**的场景（少一条 dock）里的次级观感问题，本文件不为此引入 `:nth-child(… of …)`
  之类的脆弱写法；demo 第 4 变体把它量化，若实测刺眼，后续用「上方兄弟是否有可见尺寸」的
  单独选择器再收（需要宿主提供语义 → #43 的 a 方案）。
- **仍然依赖 `[data-slot]` 这一手**：比私有属性公开得多（它是渲染器给**所有**插槽的通用锚点，
  不是某一家 dock 的身份牌），但终归是 DOM 结构耦合。真正的收口在宿主侧：#43 的 a
  （`data-dock-attach="first|mid|last"`）或 b（共享壳公共导出）。**a 单独落地不解决壳复用**——
  几何仍四方各抄一遍，#28–#32 那类「人工追平」不会消失；所以本仓把 a 视为止血、b 视为收口。
- **不做**：不给「我们不在末位」发明闭合底边规则（§2 已述理由）；不改 `order: 30`；不动宿主。

## §5 退出路径

宿主若落地 #43 的 a：本文件三条选择器的 `:first-child` / `:last-child` 换成
`[data-dock-attach="…"]`，`#42` 的升级复查项从「`[data-queue-dock]` 还在不在」改成
「attach 标记值与 order 是否一致」；若长期不做，本方案就是**最终形态**（它已不再依赖任何邻居身份）。

## §6 实测结论（实现后填，逐条对应 §3）

判据 1、2、3、7 不由本节填（静态与同源断言归 `tests/dock-tube-seam.test.mjs`）。本节两块：**判据 5 与 6**
全部来自真机 —— 宿主 0.2.1-rc.2 的隔离实例 + 独立 headless chromium，无一处来自 demo 页；**判据 4** 是
`docs/dock-stacking-demo.html` 上 B2 ↔ B3 的成对像素对照，写在最后那节，**demo 页采集、DPR=1、非真机现场**，
数字由 seam-fixtures 采集、本文件代笔落账，它不替代也不参与上面两节的真机结论。

### 共用方法与现场怎么造

| 项 | 值 |
|---|---|
| 实例 | `devkit/instance.mjs create/check/boot/stop --dsh 0.2.1-rc.2`。`lv-before`（插件源＝主检出，改前）端口 3213；`lv-after`（插件源＝本 worktree，改后）端口 3211。各自独立 `DSH_HOME=~/dsh-instances/<name>`，全程未触 `127.0.0.1:3080` 与 `~/.dsh`；测毕两个实例均已 stop，端口已释放 |
| 浏览器 | 自起独立 headless chromium（复用 `@playwright/mcp` 内置 playwright 库），1280x860，deviceScaleFactor 2，locale zh-CN；鉴权 cookie 由 `scripts/capture/mint-cookie.cjs 127.0.0.1:<端口>` 现铸 |
| 造 dock | 隔离实例首屏 composer 是禁用态（没有「定时发送」按钮），必须先在「选择工作区」目录选择器里选一个工作区，否则后面全都测不到。随后：新建会话 → 输入「真机验证 dock 结构前提」→ 定时发送 → 自定义 → 固定 `2026-10-24 15:00`（快捷档会随「现在」漂移，两边必须钉同一绝对时间） |
| 跑的是哪份构建 | 不 grep 中文（esbuild 把非 ASCII 转义，会假阴性）。从运行时 `document.styleSheets` 抓回命中 `.ss-dock-*` 的规则原文：3213 侧的**接缝规则**只有 `[data-queue-dock] + .ss-dock-root …` 两条，3211 侧只有 `[data-slot="conversation.input.dock"] > …` 三条；两边都另有 `.ss-dock-body` 及其 `::before`/`::after` 三条基础规则且逐字相同。接缝规则互斥且各自唯一，构成「两边跑的就是那两份构建」的现场证据（记在各 `-dom.json` 的 `probe.seamRules`） |
| 稳定读口径 | 加完提醒后 `sleep 2500ms` 读一次（`probeEarly`），再 `sleep 1500ms` 读一次（`probe`），**只取 `probe`**，两边同一套等待策略；`earlyVsSettledDiffer` 两边均为 `false`（即稳定读不是靠「多等一会」救回来的，见下条）。比对 `::after` 时必须显式断言 `getComputedStyle(body,'::after').content === '""'`：读到 `"normal"` 说明**根本没读到伪元素**（本文件 §6 的第一版探针就是这么假阴的：一个把 `'::after'` 参数吞掉的 `getComputedStyle` 包装函数，返回的是元素自身初值 `border-top-style:none`、`border-top-width:0px`，看起来像「描边消失了」）。这是测量缺陷不是时序现象，两边同读会得出「假相等」 |
| 产物 | `/tmp/dock-verify/{before-3213,after-3211}[-queue\|-goal]-dom.json`（DOM + computed 全量）、`*-css-eval.json`、同名 `-page.png` / `-dock.png` / `-dock-frozen.png`、差异高亮 `lv-diff-*.png`。**`/tmp` 会被清**：这些是复核材料不是仓内资产，要长期留得由负责人搬进仓 |

### 判据 5：真机结构前提

**结论：成立。** 方法：`document.querySelector` + `parentElement` + `matches()` + `getComputedStyle` 实测，
读值记入 `-dom.json`。独存现场两份构建的 probe 结果除 `url` 与 `seamRules` 外**逐字段零差异**。

| 实测项 | 值（改前＝改后） |
|---|---|
| `[data-slot="conversation.input.dock"]` 是否存在 | 存在，`outletCount=1`，`tagName=DIV`，属性只有 `data-slot` 本身 |
| 该出口 computed `display` | **`contents`** |
| `.ss-dock-root` 的 `parentElement.dataset.slot` | **`conversation.input.dock`**；`parentElement.matches('[data-slot="conversation.input.dock"]')` = true；`childIndexInParent` = 0；`outlet.childElementCount` = 1 → **直接子元素** |
| `matches(':first-child')` / `matches(':last-child')`（独存） | **true / true**（两条新规则都不命中，与 §2 预期一致） |
| 同层兄弟清单（独存） | 只有 `DIV.ss-dock-root[data-ss-dock]` 一个；该现场**没有** `[data-queue-dock]`、**没有** `[data-slot-error]` |
| dock 根 computed | `display:block`、`margin-bottom:-9px`、`width`/`max-width:696px` |
| `.ss-dock-body` computed | `border-radius:16px 16px 0px 0px`、`margin-bottom:0px` |
| `.ss-dock-body::after` computed | `border-top:1px solid rgba(0, 0, 0, 0.04)`（声明 `.5px`，dpr 2 下 used value 为 1px）、`border-bottom:0px none`（底边开口，与 §2 的「基础态底边开口」一致） |

三条真现场的兄弟清单（同层 class 与 data-* 全列，全部真机渲染，非插入）：

| 现场 | outlet 子元素（按 DOM 序） | 我们的 `:first-child` / `:last-child` |
|---|---|---|
| 独存 | `DIV.ss-dock-root[data-ss-dock]` | true / true |
| 上方真队列条 | `DIV._7yHdaG_dock[data-queue-dock]`(h=40)、`DIV.ss-dock-root[data-ss-dock]`(h=40) | **false** / true |
| 上方真 GoalDock | `DIV.nLMEza_dock[data-goal-bar=true]`(h=36)、`DIV.ss-dock-root[data-ss-dock]`(h=40) | **false** / true |

「上方真队列条」和「上方真 GoalDock」都是**构造出来的真实现场**：前者让 agent 跑起来再发一条消息进排队，
后者让 agent 建一个 goal，宿主自己的 GoalDock（order 10）就排到我们（order 30）上面，同槽同父且不带 `data-queue-dock`。

**局限**：只测 0.2.1-rc.2 一个宿主代次。宿主 dock 的 class（`_7yHdaG_dock`、`nLMEza_dock`）是构建期哈希，
跨代次必变；但本方案只依赖 `data-slot` 与 `:first-child`/`:last-child`，这两条不随 class 变。
`[data-slot-error]` 现场未能用真实崩溃构造（见下）。

### 判据 6：真机观感零变化

**结论：成立。** 独存与「上方真队列条」两条现场，四项 computed 逐字相同，且 dock 区域逐像素相同。

| 现场 | root `margin-bottom` | body `border-radius` | `::after` `border-top` | `::after` `border-bottom` | 像素 AE（1488x240 裁剪） |
|---|---|---|---|---|---|
| 独存：改前 → 改后 | `-9px` → `-9px` | `16px 16px 0px 0px` → 同 | `1px solid` → 同 | `0px none` → 同 | **0** |
| 上方真队列条：改前 → 改后 | `-9px` → `-9px` | `0px` → `0px` | `0px none` → `0px none` | `0px none` → `0px none` | **0** |

- 全量 deep diff：两条现场的 probe 结果除 `url` 与 `seamRules` 外**每一个字段**（含几何坐标）零差异。
- **正对照**（证明 AE=0 不是「比较失效」）：改后独存 vs 改后 + 临时假兄弟（顶边规则命中）= AE **171240**。
- 像素比对口径：比对前把每次都会动的部分在两边同样冻掉。`.ss-dock-status` 与 `.ss-dock-bar` 置
  `visibility:hidden`；倒计时必须置 `flex:0 0 0;min-width:0;width:0;overflow:hidden`，只 `visibility:hidden` 不够
  （数字宽度不同会把后面的正文推走亚像素，实测残留 121 个差异像素；改零宽后 AE=0）。
- **局限**：AE=0 是「冻结动态位后的 dock 区域裁剪图」，不是整页逐像素。整页含会话正文与倒计时，两次运行天然不同
  （独存未冻版 AE=351，全部落在倒计时与正文抗锯齿上）。

### 附带：§2 表第 3 行的真机证据（超出 §3 清单，但它是本改动的全部理由）

「上方是非队列 dock」这条现场在真机构造出来了（宿主 GoalDock）。这正是旧方案静默失效、新方案命中的那一格：

| 同一条现场（两边 `:first-child`=false、`:last-child`=true 实测相同） | 改前 | 改后 |
|---|---|---|
| body `border-radius` | `16px 16px 0px 0px`（圆角顶，接缝错） | `0px` |
| `::after` `border-top` | `1px solid`（多一条顶描边） | `0px none` |
| root `margin-bottom` | `-9px` | `-9px`（未动） |
| `::after` `border-bottom` | `0px none` | `0px none`（未动） |

两边该现场的 computed **全部**差异只有顶边那几项（`borderTopLeft/RightRadius`、`::after` 的 top 三件套与其
`border-radius`）；底边、负边距、几何坐标零差异 → 改动的作用面与 §2 的声称一致。像素 AE=**3261**（预期有差异，
高亮见 `lv-diff-goal.png`）。

### 未能构造的现场（照实记，不用 demo 页冒充）

- **「我们不在末位」（规则 A 的真实观感）：未能构造。** 原因：需要一条 `order > 30` 的 dock 排在我们下面，
  宿主自带的 todo(0)/goal(10)/queue(20) 全在我们上面，而隔离实例只挂了 `dsh-later` 一个第三方插件，
  没有任何第二条 dock 会落到 30 之后。
  **替代证据（CSS 求值实验，非现场观感）**：真机 DOM 里在我们**后面**临时 append 一个空 div →
  改前 `margin-bottom` 仍 `-9px`（旧方案没有这个概念，仍占着栈底位），改后变 `0px`（规则 A 命中）；
  删除后两边都回到 `-9px`、`childElementCount` 回到 1、无残留节点（两份 `*-css-eval.json` 的 `expA`）。
- **上方 dock 抛错留 `[data-slot-error]` 空锚点（§4 的已知降级）：未能用真实崩溃构造**（要让宿主某条 dock 抛错
  得改宿主或注入故障装置，超出本仓范围）。
  **替代证据（CSS 求值实验，非现场观感）**：真机 DOM 里在我们前面插一个 `div[data-slot-error]`（无尺寸无内容）→
  改后 `border-radius` 变 `0px`、`::after border-top` 变 `0px none`，即 §4 预测的「顶边画成方角而上方无可见内容」
  在真机样式表上量化成立；改前不命中（仍 `16px` / `1px solid`）。删除后复原（`expB`）。
- **实验卫生要求**：插假兄弟只用于测 CSS 命中，测完必须删除并回读一次干净探针确认复原。
  脚本已把 `restored` 与 `childCountRestored` 写进 JSON，本轮全部为复原态（`clean.leftoverFake=false`）。

### 判据 4：demo 页 B2 ↔ B3 成对像素对照（**demo 采集、DPR=1、非真机现场**）

**这一节不是真机结论**（真机见上面判据 5 与 6 那两节，deviceScaleFactor 2 的隔离实例）。它回答的是另一件事：**同一份 DOM 形状下，两套判据各自画出什么**。每档成对采集：左半套 #41 的 B2（`[data-queue-dock] + .ss-dock-root` 那两条），右半套本文件 §2 的三条；两半 DOM 逐字符相同（每档 `shape.anchorDataSlot` 都是 `"conversation.input.dock"`、`shape.anchorDisplay` 都是 `"contents"`，即锚点把各条目包成兄弟），**差别只在套哪份规则 → 任何像素差都只能来自判据本身**。

| 项 | 值 |
|---|---|
| 命令 | `node scripts/seam-check/capture-b3-scenes.mjs --out <本地目录>`（2026-10-23 采集）。playwright 走仓库既有惯例：先 `await import('playwright')`，解析不到再读 `PLAYWRIGHT_MODULE` 覆盖，两条都不通就打印提示并退出非 0（同 `capture.mjs`；**CI 不装 playwright，所以这脚本与像素 AE 都不进 CI**） |
| 现场参数 | 视口 1600×1200、`deviceScaleFactor=1`、暗色主题、`rows=1`（`evidence.json` 头部字段） |
| 产物 | `/tmp/seam-b3-shots/scene{1..5}-{B2,B3}-{stack,tube}[-seam].png`、每档一张 `sceneN-pair.png`、`evidence.json`（下表每个数字都取自它）。**`/tmp` 会被清、也不进仓**：要把这组数当长期证据，由 seam-fixtures 或 Lead 决定搬哪些关键帧进 `docs/media/` 并接进 `tests/seam-pixel-criteria.test.mjs` |
| 读取时机 | 每个可见 `.ss-dock-body` 的 `::after.content === '""'`、且连续两帧几何/计算值签名一致（固定 sleep 会让「未生成」与「已生成」两边同假） |
| 自检 | `problems: []`（本轮无告警）；表里的 AE 与差异行取自 `pairs[]`，③④⑤ 三档 `expectedSame=false`（预期就有差异），落点看「差异行」列 |

| 档 | 现场（两半共同的 DOM 形状） | 命中（嗅探 / 位置 / 非末位） | 顶边 B2 → B3 | tube AE（差异行数） | 这一档说明什么 |
|---|---|---|---|---|---|
| ① | 独存：`siblingCount=1`、`isFirst=isLast=true` | 全 false | `16px 1px solid` → 同 | **0**/28796（0 行）；stack 0/66930 | 新旧判据在这格都不命中 → 逐像素相同，即 §3 判据 6「单条观感零变化」的 demo 侧（那一格真机也测了，见上） |
| ② | 上方 = 宿主队列条：`prevSibling=data-queue-dock`、`isFirst=false` | 嗅探 true、位置 true | square → square（两边 `overlap=3`、`margin-bottom:-9px`） | **0**/74494；stack 0/117300；两边接缝判据 1 都 PASS（`worstSpanPct` 均 0.2%） | 与 #41 **等价**：换判据没把已经修好的那一格改坏 |
| ③ | 上方 = 非队列的别的 dock：`prevSibling=data-other-dock` | 嗅探 **false**、位置 **true** | **round → square** | **726**/51958（差异行 39..54，全在顶边带；stack 726/92460） | **整套改动的理由**：同一现场 B2 的接缝带是 **95.8%** 满宽横线（判据 1 FAIL），B3 是 0.2%（PASS）。§1 理由②「邻居身份对了、位置也可能错」的像素证据 |
| ④ | 上方 = 崩溃空锚点：`prevSibling=data-slot-error`、`errorAnchorHeight=0` | 位置 true | **round → square** | **778**/28796（差异行 2..17；stack 778/66930） | §4 的**已知降级**量化到像素、不藏：上方没有任何可见内容，顶边仍画方角 |
| ⑤ | 我们不在栈底：`nextSibling=data-other-dock`、`isLast=false` | 非末位 **true** | `16px 1px solid` → **同**（顶边零差异） | **1845**/28796，差异只在最后 5 行（41..45）；stack 半区**不可比**（高 129.5 → 138.5，差 9px） | 规则 A 唯一的可见覆盖：`margin-bottom: -9px → 0px`。stack 那 9px 高度差正是 A 让出来的，所以这档只能比 tube |

**⑤ 的判据是实测校正过的**（值得记，因为"判据写错了"和"实现错了"长得一模一样）：原判据写「顶边带应相同」，第一次跑出 AE=1845，看着像实现失败；查差异行才确认顶边带确实是 0，1845 全落在底边 5 行 —— B2 的 `-9px` 让下段压回我们底边 3px，B3 让出栈底位后不再叠，那是**预期的底边差异**。判据遂改成「差异只许在底边带」，其余行仍必须为 0。

**三条方法边界（都是采出来的坑，别退回去）**：

1. **B3 段排在全页最后**（`grep -n 'data-scene=' docs/dock-stacking-demo.html` 第一处在第 873 行，`solo` 段之后）。插在 solo 之前会改页高 → 设备像素相位跟着变 → 老基线出现 ±1 抖动；挪到末尾后 `docs/media/seam-matrix/` 的 14 张 PNG **逐字节不变**（`git status docs/media` 为空）。
2. **比像素要孤立半区 + 显式断言 rect 逐位相等**（`isolation.width=720`，每对 `aligned=true`）：同页原位比时两半 x 不同 → 字形与描边的栅格化相位不同 → 实测 6~1400 像素的**假差异**。对不齐就判该次测量无效，不和稀泥。
3. **clip 用视口坐标，别再减一次 `scrollY`**：`getBoundingClientRect()` 已经是视口坐标，多减一次会把裁框推出视口，截出 2px 高的空条，而「逐像素相同」对一张空图返回成功 —— 典型假绿。脚本头注释第 28–30 行记着这条，全程用 rect 原值。

**像素 AE 不进 CI**：CI 是 node:22 容器、没有浏览器，`tests/dock-tube-seam.test.mjs` 只守结构判据（同源 + 形状 + 五现场存在），AE 这一段靠上面的手工脚本。本节的数字是 **demo 页证据**，与真机那两节互补而非互证：真机构造不出的 ④⑤ 两档（见上节「未能构造的现场」）在这里有像素对照；反过来，demo 的 ② 档不能当成"真机也验过了"。
