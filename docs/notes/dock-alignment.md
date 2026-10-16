# dock 与宿主 QueueDock 的集成核对表

> 配套 [设计决策 §8](../design-decisions.md)。给 #28–#32 这批改动做集成用：先看 §1 要不要追平，再看 §3/§4 的归属是否清楚，最后 §5 那几条**只能进真实 GUI**。
>
> 宿主事实来自安装态 `@deepseek-ai/dsh-client-ui-*@0.2.0-rc.2`。两类 CSS 的取法不同，别混：
> - **conversation 包**：CSS 内联进 `lib/client.js`，类名构建期哈希 → 按语义后缀取，如 `grep -o '_panel:after{[^}]*' lib/client.js`；**不引用 bundle 行号**（升级即漂移）。
> - **primitives 包**：CSS **随包发布**为 `lib/*.module.css`（其 `package.json` 的 `files` = `lib/index.js` + `lib/**/*.css` + `lib/types/**/*.d.ts`），可直接读原文，如 `lib/Tooltip.module.css`。
>
> **「已验证？」列口径**：✅ = 本轮在代码里直接读到（附取法）；⚠️ = 只验证了一半 / 依赖版本或需产品决策；❌ = 代码断言不了，必须进真实 GUI。

## §1 像素漂移（要追平 —— Lead 集成后统一改）

| # | 项 | 宿主值 | 插件现值 | 处置 | 谁改 | 已验证？ |
|---|---|---|---|---|---|---|
| P1 | 面板描边粗细 | `.panel:after` `border: .5px solid var(--dsw-alias-border-l1)`、`border-bottom: none`、`border-radius: inherit` | `.ss-dock-body::before` `border: 1px solid var(--dsw-alias-border-l1)` + `border-bottom: none` | 改 `.5px` | Lead | ✅ `grep -o '_panel:after{[^}]*' <conversation>/lib/client.js`；`styles.ts` grep `ss-dock-body::before` |
| P2 | 背景与描边分层 | 两个伪元素：`:before` 只画背景（`--dsw-specific-menu` + `backdrop-filter: --dsw-menu-backdrop-filter`、`z-index: -1`），`:after` 只画描边 | 单个 `::before` 同时承担背景与描边 | 拆两层 | Lead | ✅ 同 P1 两条 grep |
| P3 | 行圆角 | `.row` `border-radius: var(--dsw-radius-md)` | `.ss-dock-row` 字面 `border-radius: 8px` | 换 token | Lead | ✅ styles.ts grep `ss-dock-row {` |
| P4 | 动作按钮圆角形状 | `.action` 带 `corner-shape: round`（另有 `border-radius: 999px`） | `.ss-dock-action` 无 `corner-shape` | 补上；若目标浏览器不支持则在本行登记「有意省略」 | Lead | ✅ `_action{` 子串 + styles.ts |
| P5 | 折叠箭头表达 | `.chevron` 14×14；组件按展开态**换图标** `IconChevronUpOutlineRegular` / `IconChevronDownOutlineRegular` | 固定 `IconChevronDownOutlineRegular size={14}` + `.ss-dock-chevron.ss-open{transform: rotate(180deg)}` | 二者取一并登记结论；保留 rotate 要写明差异，免得下轮走查重复报 | Lead | ✅ bundle grep `IconChevronUpOutlineRegular` 命中；styles.ts grep `ss-dock-chevron` |
| P6 | 折叠态归一条件 | effect：`rowCount === 0 && !collapsed` → `setCollapsed(true)` | effect：`schedules.length <= 1` → `setCollapsed(true)` | **不是冗余**：两边都有归一；插件空态整块不渲染，它的 `<= 1` 实质是「退回单条直出」。若要追平，改 `length === 0` 的同时要保住「单条恒可见」（宿主 `listVisible = rowCount === 1 \|\| expanded`） | Lead（先判语义再动代码） | ✅ bundle grep `if (rowCount === 0`；ScheduleDock.tsx grep `setCollapsed` |
| P7 | 编辑框描边/圆角/高度 | `.editor`：`border: .5px solid var(--dsw-alias-border-l4)`、`border-radius: var(--dsw-radius-sm)`、`min-height: 28px`、`max-height: 127px`、`resize: none`、`padding: 3px 8px`、`background: --dsw-alias-bg-base` | `.ss-dock-edit-input`：固定 `height: 28px`、`border: 1px solid var(--dsw-alias-border-l2)`、`border-radius: 6px`、`padding: 0 8px` | **归 #30**，与 textarea 改造同做，别拆两处 | dock-editor | ✅ `_editor{box-sizing` 子串；styles.ts grep `ss-dock-edit-input {` |

> **集成落地结果（Lead，合并 #28–#32 时统一处理）** —— 上表「插件现值」列记录的是**整改前**状态，此处登记结论，勿再按旧值走查：
>
> | 项 | 结果 | 落点 |
> |---|---|---|
> | P1 描边粗细 | ✅ 已改 `.5px` | `styles.ts` `.ss-dock-body::after` |
> | P2 背景/描边分层 | ✅ 已拆 `::before`(背景) + `::after`(描边) | 同上 |
> | P3 行圆角 | ✅ 已换 `var(--dsw-radius-md)`（原字面 `8px`） | `styles.ts` `.ss-dock-row` |
> | P4 `corner-shape` | ✅ 已补（并注明 `round` 本就是初始值） | `styles.ts` `.ss-dock-action` |
> | P5 折叠箭头 | ⚠️ **有意不追平**：保留 rotate，差异理由已就地登记 | `styles.ts` `.ss-dock-chevron.ss-open` 上方注释 |
> | P6 折叠归一条件 | ✅ 已按语义判定移除该 effect（单条由 `expanded` 强制直出，宿主空态本组件整体不渲染），推理写在代码注释里 | `ScheduleDock.tsx` 折叠态复位口径注释 |
> | P7 编辑框 | ✅ 已随 #30 的 textarea 改造一并对齐（`.5px`/`--dsw-radius-sm`/`min-height 28`/`max-height 127`/`resize:none`） | `styles.ts` `.ss-dock-edit-input` |


## §2 一致项（已对齐，集成时勿改坏）

| # | 项 | 宿主值 | 插件值 | 已验证？ |
|---|---|---|---|---|
| S1 | 外壳几何 | `.dock`：`--dsh-composer-side-clearance` / `--dsh-composer-dock-inset` / `--dsh-composer-card-max-width` 的 calc、`flex: none`、负下边距 `calc(0px - var(--dsh-composer-stack-gap) - 3px)` | `.ss-dock-root` 同 calc 同负 margin | ✅ |
| S2 | 面板 | `.panel`：顶部 `--dsw-radius-lg`、`padding: 2px 0`、`isolation: isolate`、`--dsh-scrollbar-thumb{,-hover}` 用滚动条别名 | `.ss-dock-body` 同 | ✅ |
| S3 | 折叠头 | `.header`：高 36px、`gap: 10px`、`padding: 4px 12px`、`border-radius: var(--dsw-radius-md)`、`:focus-visible` focus ring、`:disabled{cursor:default}` | `.ss-dock-header` 同（radius 实测为 token） | ✅ |
| S4 | 计数排版 | `.count`：13px / 500 / line-height 24px、`Inter, var(--dsw-font-family)` | `.ss-dock-count` 同 | ✅ |
| S5 | 列表滚动 | `.list`：`max-height: 180px; overflow-y: auto` | `.ss-dock-list` 同 | ✅ |
| S6 | 行几何与分隔 | `.row`：`min-height: 36px`、`gap: 10px`、`padding: 4px 5px 4px 12px`；相邻行 `box-shadow: inset 0 1px 0 var(--dsw-alias-border-l1)` | `.ss-dock-row` / `.ss-dock-row + .ss-dock-row` 同 | ✅ |
| S7 | 动作按钮交互态 | `.action`：28×28、`radius 999px`、`--dsw-alias-label-tertiary`、`:hover` → `--dsw-alias-interactive-bg-hover`、`:focus-visible` focus ring、`:disabled{cursor:default;opacity:.45}` | `.ss-dock-action` 全套同值（含 `.45`） | ✅ |
| S8 | 空态 | 条目为 0 不渲染 | 同 | ✅ |
| S9 | 单条直出 | `listVisible = rowCount === 1 \|\| expanded` | `expanded = schedules.length === 1 \|\| !collapsed` | ✅ 语义等价 |

## §3 #32 ①② 的死状态与空类名（含归属变更说明）

| # | 项 | 本轮实测事实 | 处置 | 谁改 | 已验证？ |
|---|---|---|---|---|---|
| D1 | `cancelling` 只写不读 | 本 worktree 基线 `b7fc4b7`：小写标识符 `cancelling` 仅 **1** 次命中（`useState` 声明），`setCancelling` **3** 次（添加 / 2.5s 后清除 / 回滚）→ 该集合从不参与渲染；删除按钮在命令往返期间既无 `disabled` 也无 pending，可连点 | **代码归属变更**，不是文档结论：原记在 #32（文档 issue），现改由 **#29（dock-tooltip／动作区）** 替换 DockTip 时一并处理，倾向宿主式一把 `busy` 锁（`disabled: busy !== null` 覆盖全 dock 动作）。#32 侧只保留记录 | dock-tooltip | ✅ `grep -c`（大小写分列）+ `grep -n "cancelling"` |
| D2 | `.ss-pending` 空类名 | JSX 挂 **3** 处（暂停 / 恢复 / 插话的 className 拼接），`styles.ts` 内 `.ss-pending` 规则 **0** 条 → 在途反馈实际全靠 `.ss-dock-action:disabled{opacity:.45}` | 同归 **#29**：补规则或删类名，不留「看着在做事情」的空类 | dock-tooltip | ✅ `grep -c ss-pending styles.ts` = 0；组件内 3 处命中 |
| D3 | 删除按钮无在途锁 | 宿主是 `busy` 一次锁全 dock；插件按动作分集合（`steering`/`pausing`/`resuming`/`saving`），删除这一路没接进去（与 D1 同源） | 归 #29 一起定；集成时以 #29 的 `busy` 版本为准 | dock-tooltip | ✅ |

> **给 Lead 的冲突提示**：D1/D2/D3 与 #31（折叠／交互锁）碰同一段渲染代码。#31 要求 header 在 `interactionActive` 时禁用，而 `interactionActive` 的定义本身就要用「有没有请求在途」——与 #29 的 `busy` 锁是同一个变量。**集成时合并成一个 `busy`**，别留两套状态。

## §4 tooltip 差异（#29 的落点；风格面可从代码核对）

插件 `.ss-dock-tip` 自带注释「逐字对齐官方 `Tooltip.module.css` `.bubble`（portal: true 层）」。**该说法本轮复核为真**，逐值对照如下（宿主值取自 `dsh-client-ui-primitives/lib/Tooltip.module.css`）：

| # | 项 | 宿主 `.bubble` | 插件 `.ss-dock-tip` | 差异 / 处置 | 已验证？ |
|---|---|---|---|---|---|
| T1 | 层级 | `position: fixed; z-index: 100`；带 `[data-portal]` 时 **`z-index: 1100`** | `position: fixed; z-index: 1100` | 数值等价（插件走的就是 portal 档）。QueueDock 传 `portal: true`，所以替换后仍是 1100 | ✅ 可读原文 |
| T2 | 尺寸与排版 | `width: max-content; max-width: 50vw; padding: 3px 7px; border-radius: var(--dsw-radius-sm); font-size: 13px; line-height: 20px; white-space: pre-line; overflow-wrap: break-word` | 同值 | 无差异；替换时 `maxWidth` 无需另给（CSS 已 `50vw`） | ✅ |
| T3 | 配色 | `background: var(--dsw-alias-tooltip-bg); color: var(--dsw-static-neutral-bluish-00)` | 同 | 无差异 | ✅ |
| T4 | 入场动画 | `animation: tooltip-in 150ms var(--ds-ease-in-out)` + `@media (prefers-reduced-motion: reduce){animation:none}` | `ss-dock-tip-in` 150ms 同 ease + 同 reduced-motion 关闭 | 无差异（换组件后这两条自定义规则与 keyframes 一起删） | ✅ |
| T5 | 定位 transform | `data-side='bottom'` → `translateX(-50%)`；`'top'` → `translate(-50%,-100%)`；另有 `'right'` 与 `[data-align='end']` 两组变体 | 只有 bottom（`translateX(-50%)`）与 `[data-side="top"]` | 插件少 right／end 对齐档；用宿主组件即自动获得 | ✅ |
| T6 | 钉住与快捷键 | `[data-pinned]{pointer-events:auto}`、`[data-has-shortcut]` 的 padding 变体、`.label{min-width:0}` | 无对应实现 | 属能力缺失，替换即补齐 | ✅ |
| T7 | 延迟语义 | `delayMs`（hover）与 `focusDelayMs`（focus）**分档**；Esc／Tab 撤下；`openOnClick` 可钉；`disabled` 可抑制整条 tooltip | 单一 500ms，hover 与 focus 共用；无 Esc／Tab／钉住／disabled | 按 #29 映射表改：`delayMs={500}` + `focusDelayMs`（宿主 QueueDock 不设 → 键盘到位即出）；不可用原因改走 `Tooltip disabled` + 原生 `title` | ✅ |
| T8 | anchor 包裹 | 组件把 ref 合并进 `children`（`children.ref`） | 额外 `<span class="ss-dock-tip-anchor">`（`display: inline-grid; flex: none`） | 替换后可删该 span；注意 `flex: none` 若去掉，按钮列宽会随状态变化而抖动（#3 的行宽预算问题） | ⚠️ 宽度抖动需真机看（→ G2） |

## §5 集成后必须在真实 GUI 核对的项（代码断言不了）

| # | 项 | 判据 | 谁做 | 已验证？ |
|---|---|---|---|---|
| G1 | tooltip **遮挡表现** | 值层面已核对（§4：portal 档 1100），但 fixed 元素是否真压在 composer 卡片／面板浮层之上取决于运行时 stacking context（dock 侧 `isolation: isolate`、面板 `z-index: 1099/1100`）；窄视口下翻转与不裁切 | Lead（真机 + `scripts/capture/`） | ❌ 表现层验证不了；✅ 数值可从 `Tooltip.module.css` 读到 |
| G2 | 按钮列宽与行宽预算 | 去掉 `.ss-dock-tip-anchor` 后，图标列在 pending／done／禁用态之间不抖动；三个 28px 按钮下正文仍不被挤成纯省略号（#3） | Lead | ❌ |
| G3 | 两条 dock 同屏 | 真队列条与提醒条同时出现时，两块面板负 margin 叠加、两个顶圆角相接处无重影／双描边；`.5px` 描边在 DPR=1 与暗色主题下肉眼可见（P1） | Lead | ❌ |
| G4 | textarea 自适应高度 | 编辑多行提醒随行高增长、超上限内部滚动，收起后不留残余；dock `max-height: 180px` 滚动不跳 | dock-editor 作者，Lead 复验 | ⚠️ 宿主算法可读（`scrollHeight + offsetHeight - clientHeight`） |
| G5 | Enter／IME 与 composer 抢键 | dock 内聚焦时 Enter 只保存，不触发宿主提交；`busyEnter=queue` 与 `=steer` 两档一致；输入法组合态 Enter 不提交 | dock-editor | ⚠️ 现有 `event.stopPropagation()` 是宿主没有的一行，动机未证（见 C3） |
| G6 | 进度条动画相位 | 切走会话再切回、折叠→展开重挂载后条长不归零、无每秒跳变；`prefers-reduced-motion` 下走静态宽度不塌缩 | dock-i18n／Lead | ⚠️ 逻辑可读，观感需实测 |
| G7 | 语言切换即时性 | 走插槽 `locale` seat 后切语言，dock 文案与 `t` 引用同步更新，且不出现裸 key（字典晚到的首帧） | dock-i18n | ⚠️ `translate` 缺词条时返回 key 本身（见 #28 时序小节） |
| G8 | 折叠态状态播报 | 收起时「未确认」／「处理中」有 `role="status"` 可读；展开后行内细节仍在且不重复播报 | #31 作者，Lead 复验 | ❌ 需读屏 |

## §6 注释与实现不符（只记录；`ScheduleDock.tsx` 正被并行修改，**本表作者不动它**）

| # | 现有说法 | 实测 | 归谁改 |
|---|---|---|---|
| C1 | 「官方 Tooltip 的完整 API 依赖宿主 slots/portal 上下文」（自研 DockTip 的理由） | **不成立**：`Tooltip` 是 primitives 公共导出（`lib/types/index.d.ts` 的 `export { Tooltip }`）；`TooltipSuppression = createContext(null)`，无 provider 时读到 `null` 即走常规路径；`portal: true` 时组件自己 `createPortal(content, document.body)`。宿主自己用得也多：conversation bundle 内 `primitives.Tooltip` **9** 处、goal 包 **6** 处。**注意**：本仓 `SchedPanel` 目前**并没有**用它（它只从 primitives 导入 `IconCloseOutlineRegular`）——早期调查里「SchedPanel 已在用 Tooltip」的说法经复核不成立，别当依据 | dock-tooltip（#29 替换时自然消失） |
| C2 | 文件头「多条：折叠为『数量 header + **下一条预览**』」 | 折叠时只渲染 header，列表整体不渲染 | #31 作者（与 C3 同段代码） |
| C3 | 编辑 `onKeyDown` 里的 `event.stopPropagation()` | 宿主无此行，注释未写动机；换 textarea 时必须重测（G5） | dock-editor |
| C4 | 本仓文档里的 `CountdownChip.tsx` / `DateTimePicker.tsx` / `client/styles/*.css` / `docs/logo.svg` / `docs/logo-transparent.svg` / `toast.tsx` / `--ss-*` 全套旧 token 表 | 仓库中均不存在（`grep -rn "CountdownChip" src/` = 0；`src/client/toast.tsx` 无此文件；`styles.ts` 只定义 `--ss-bar-divider` 一个自定义属性） | docs（本轮已修，见 §7 备注） |

## §7 有意差异（不要当 bug 追平）

| # | 项 | 宿主 | 插件 | 原因 | 已验证？ |
|---|---|---|---|---|---|
| I1 | 折叠头 lead 图标 | `IconQueueOutlineRegular` | `IconClockOutlineRegular size={16}` | 语义是提醒 | ✅ |
| I2 | 单条时行首图标 | `rowCount === 1` 时行首仍渲染 lead | 无行首图标，`HH:MM` 占第一列 | 行宽预算紧（见 G2、#3） | ✅ |
| I3 | 计数文案 | 「N 条排队消息」 | 「N 条定时提醒」 | 不绑宿主 `conversation` NS 复用词条（§8.3） | ✅ |
| I4 | 行内容 | 单行 preview（200 字截断 + `projectUserText`） | 两行：`时间 · 倒计时 · 正文` + 进度条 | clock-scoped 条目的核心信息 | ✅ |
| I5 | 进度条 | 无 | `.ss-dock-bars` + 三个插件自有变量 `--ss-bar-duration` / `--ss-bar-delay` / `--ss-bar-divider` | 同上；`styles.ts` 只定义 `--ss-bar-divider`，另两个由组件内联注入 | ✅ |
| I6 | 行文本投影 | `projectUserText(text, [])` | `item.prompt` 直出 + `title` | **待产品决策**，不算漂移 | ⚠️ |
| I7 | 折叠／结构可访问性 | `aria-controls` + `id` + `hidden`（保留 DOM）、header `disabled: interactionActive` | ~~只有 `aria-expanded`，列表条件卸载，header 永不 disabled~~ | **已由 #31 修掉**（现与宿主同形：`useId()` + `aria-controls` + `hidden` 常驻 + `interactionActive` 锁头）。保留此行记录原委；修它确实影响了 §4 的 anchor 包裹方式 | ✅ |
| I8 | 附件带横向策略 | `.attachments{max-width:55%; overflow:hidden}`（静默裁切） | `.ss-dock-attachments{flex-wrap:nowrap; overflow-x:auto}`，**不设 max-width** | 宿主那个 55% 是给**单行正文**让路；本插件附件独占第三带，与正文不抢横向（dock 实测 696px，24px 缩略图一行可容 ~20 张，每任务上限 8）。照抄 55% 反而是把别人的约束当自己的 | ✅ |
| I9 | 缩略图 effect 依赖 | `QueueThumb` 依赖 `[attachment, loadImage]`（对象） | 依赖 `[attachment_id, sessionId, loadImage]`，块内容经 `blockRef` 读取 | **隐性前提差异，最容易照抄错的一条**：宿主 dock 没有每秒 tick，对象身份稳定；本仓 `schedules` 每秒由 `.map()` 造新对象，照宿主写法等于**每秒重启一次加载**。宿主内部虽有 `attachmentId` 缓存键去重，但会变成每秒一轮 promise churn | ✅ |
| I10 | 附件降级形态 | 加载失败与加载中都是同一个无声空占位 | 两态分开：**能力缺失**（这台宿主没有 `uiConversation` face）→ 图片位直接不渲染；**读取失败**（本该有却拿不到）→ 退化成「图片不可用 + 大小」可读 chip | 前者不是异常，满屏「不可用」是噪音；后者才值得明说。且元数据（`name`/`bytes`）随块带出，宿主没有这一层信息可用 | ✅ |
| I11 | `loadImage` 注入形状 | `queueDockEntry` 用 `inject: (sessionId) => …` 在注入时绑死会话 | 零参 `inject` + `loadImage(sessionId, ref)`，与仓内既有 `callCommand` 同形 | 本仓 `ClientSlotDeclaration.inject` 的镜像声明是 `() => object`（不收参数），照宿主形状写直接 TS2322。**顺带一条待办**：该镜像声明与宿主契约不符——宿主 `runInject` 实际调用 `inject(binding.key, actions)`，镜像却声明成零参，后来人照镜像会误以为拿不到 sessionId（Lead 拟另开小 issue，不塞进 #38） | ✅ |

## §8 怎么复核

1. 宿主 conversation CSS：`grep -o '_panel:after{[^}]*' …/dsh-client-ui-conversation/lib/client.js`（哈希前缀会变，用后缀 + 伪元素匹配）。
2. 宿主 primitives CSS：直接读 `…/dsh-client-ui-primitives/lib/Tooltip.module.css` 等原文。
3. 插件值：`grep -n 'ss-dock' src/client/styles.ts`；组件侧 grep className 拼接。
4. 死类名自查：JSX 出现的每个 `ss-*` 都要能在 `styles.ts` 找到规则（D2 即此法发现）。
5. 顶替宿主条目这件事**不要尝试**：`list` 槽同 `id` 只在同 `priority` 冲突，priority 不同两条都渲染（§8.1 结论二）。
