# Design Tokens 现状

> 本文记录**运行时真实生效**的 token。
>
> **这是一次重写。** 旧版本文列了一整套自建 `--ss-*` token（主色/状态色/中性色/字号/字重/间距/圆角/阴影/时长/缓动/断点/z-index，共约 42 个变量，还带「浅色/深色模式」两列取值）。经逐项复核，**那些变量在代码里一个都没有定义**——`grep -o -- "--ss-[a-z-]*:" src/client/styles.ts` 只返回 `--ss-bar-divider:` 一条。同样不成立的是「`@media (prefers-reduced-motion)` 里有个全局 `*` 覆盖」和「响应式断点变量」：`styles.ts` 里的 `@media` **只有 4 条 `prefers-reduced-motion`**，没有任何宽度媒体查询。旧文档描述的是一版从未落地（或已删除）的自建层，留着只会误导新样式照着写。

## 1. 原则：不自建 token 层

| 类别 | 走哪里 |
|---|---|
| 颜色、圆角、字体、focus ring、菜单面、滚动条、阴影 | 宿主 design-system 变量 `--dsw-*` |
| 动效时长与缓动 | 宿主 `--ds-transition-duration-fast`、`--ds-ease-in-out` |
| dock/面板的宽度、内缩、贴合 | 宿主 composer 布局变量 `--dsh-composer-*` |
| 插件自有变量 | 仅 3 个进度条变量 `--ss-bar-*`（§6） |

新增样式默认引宿主 token，**不要再造 `--ss-*`**。只有宿主没有对应概念的（进度条动画参数）才允许自定义变量。

## 2. 颜色（`--dsw-alias-*`，按 `styles.ts` 实测用量排序）

| token | 用量 | 主要用途 |
|---|---|---|
| `--dsw-alias-label-primary` | 15 | 主文本、折叠头 |
| `--dsw-alias-state-warn-secondary` | 14 | 到期/未确认/错误提示、urgent 状态 |
| `--dsw-alias-label-tertiary` | 13 | 次级文本、时间/倒计时、动作按钮 |
| `--dsw-alias-brand-primary` | 13 | 进度条填充、强调 |
| `--dsw-alias-label-secondary` | 12 | 输入框按钮等次级图标 |
| `--dsw-alias-state-business-primary` | 8 | focus ring 回退色、开关选中、编辑框聚焦 |
| `--dsw-alias-label-dimmed` | 6 | 行内正文预览 |
| `--dsw-alias-border-l1` / `-l2` | 3 / 4 | 面板描边、行间分隔、输入区描边 |
| `--dsw-alias-state-error-primary` / `-secondary` | 4 / 2 | 非法输入、overdue 状态、错误文案 |
| `--dsw-alias-state-success-primary` | 3 | 已发送、可恢复态 |
| `--dsw-alias-interactive-bg-hover` / `-active` | 4 / 2 | 按钮 hover / active |
| `--dsw-alias-bg-base` / `-bg-layer-3` / `-bg-module-platform` | 若干 | 输入区、卡片底、选择器底 |
| 面与高差 | `--dsw-specific-menu`、`--dsw-menu-surface-fill`、`--dsw-menu-backdrop-filter`、`--dsw-elevation-stroke`、`--dsw-elevation-prominent` | dock 面板与浮层材质 |
| focus ring | `--dsw-focus-ring-width`、`--dsw-focus-ring-color`（回退 `state-business-primary`）、`outline-offset: -2px` | 所有可聚焦控件 |
| 文本反色 | `--dsw-static-neutral-bluish-00` | tooltip 文字 |
| 滚动条 | `--dsh-scrollbar-thumb` / `-hover` ← `--dsw-alias-scrollbar-bg-l2` / `-hover-l2` | dock 列表滚动 |

### 2.1 仍在代码里硬编码的色值（4 处）

| 值 | 所在类 | 状态 |
|---|---|---|
| `#8b5cf6` | `.ss-presence` | 侧栏状态点默认色（scheduled） |
| `#f59e0b` / `#f25a5a` | `.ss-hover-status[data-state="urgent"]` / `="overdue"` | 悬浮卡状态点 |
| `#adb2b8` | `.ss-hover-status`、`.ss-hover-status-dot` | **代码注释已挂待办**：实测浅色主题该卡片实际底色后换 token |
| `#fff` | `.ss-toggle-switch::after` | 开关滑块 |

主题适配靠的都是 alias token 本身（宿主切主题即变）；上面 4 处是已知缺口，不是设计选择。旧文档里「每个 token 给浅色/深色两列值」的写法已废弃——**插件不再自己维护双套色值**。

## 3. 字体与字号

| 项 | 值 |
|---|---|
| 字族 | `--dsw-font-family`；dock 的计数与正文写 `Inter, var(--dsw-font-family)`，与宿主 `.count` / `.preview` 逐字一致 |
| 组合 token | `--dsw-font-xs-13`（dock 正文与状态文本） |
| 实测散用字号 | `12px` ×18、`13px` ×10、`11px` ×2、`10px` ×1（`10px` 属于 `.ss-task-status` 状态角标） |
| 字重 | 一律字面数值（`500` 用于计数与角标等），没有 `--ss-font-*` 变量 |
| 等宽数字 | 时间与倒计时用 `font-variant-numeric: tabular-nums`，避免每秒 tick 抖动 |

## 4. 圆角、描边与间距

| 项 | 值 |
|---|---|
| 圆角 token | 只用三档：`--dsw-radius-lg`（面板顶部 ×4）、`--dsw-radius-md`（折叠头、行 ×4）、`--dsw-radius-sm`（chip、tooltip ×1）；圆形按钮与进度条用字面 `border-radius: 999px` |
| 已知漂移 | 面板描边现值 `1px`（宿主 `.panel:after` 是 `.5px`）；行圆角现值字面 `8px`（宿主 `var(--dsw-radius-md)`）；`.action` 缺 `corner-shape: round` → 见核对表 **P1/P3/P4** |
| 间距 | 一律字面 px（`gap: 10px`、`padding: 4px 12px`、`padding: 4px 5px 4px 12px`、`max-height: 180px` 等）。**这些值与宿主同名部件逐条相同，属对齐要求**，不要顺手改成「间距 token」 |

## 5. 动效与层级

| 项 | 值 |
|---|---|
| 时长/缓动 | `--ds-transition-duration-fast` ×11、`--ds-ease-in-out` ×15（无 `--ss-duration-*` / `--ss-ease-*` 变量） |
| `prefers-reduced-motion` | **4 条**独立媒体查询，分别覆盖：进度条（关动画后必须走 JS 静态宽度，否则 `animation-fill-mode` 把宽度停在 0%，整条消失）、暂停/活动条、状态点呼吸、tooltip 淡入。没有旧文档写的全局 `*` 覆盖 |
| z-index 实测档 | `-1` 面板背景伪元素；`1` 进度条填充盖过分隔线；`1099` 浮层遮罩；`1100` tooltip 与面板浮层 |
| 与宿主层级对照 | primitives `Tooltip.module.css`：`.bubble` `z-index: 100`，带 `[data-portal]` 时 **`1100`**。dock 自研 tooltip 现值即 1100（宿主 portal 档）→ #29 换成官方 `Tooltip({ portal: true })` 后层级不变。旧文档的 `--ss-z-panel: 100 / popover: 200 / tooltip: 300 / modal: 400` 这套梯度在代码里不存在 |

## 6. 插件自有变量（全部，仅 3 个）

| 变量 | 定义处 | 消费处 | 说明 |
|---|---|---|---|
| `--ss-bar-divider` | `styles.ts` 的 `.ss-dock-bar`：`color-mix(in srgb, var(--dsw-alias-label-primary) 35%, transparent)` | 组件内联 `repeating-linear-gradient` 画每小时分隔线，带 `rgba(0,0,0,0.45)` 兜底 | 唯一在 CSS 里定义的自有变量 |
| `--ss-bar-duration` | **不在 CSS 里**：`ScheduleDock` 给 fill 内联注入（完整窗口时长） | `.ss-dock-bar-fill` 的 `animation-duration`，CSS 侧兜底默认 `3600s` | 必须固定；随 tick 变化会让浏览器重启动画 |
| `--ss-bar-delay` | 同上，挂载时刻算出的负值 | `.ss-dock-bar-fill` 的 `animation-delay`，CSS 侧兜底 `0ms` | 负 delay 定位绝对相位，使重挂载（切会话回来）不归零 |

进度条动画的数学在 `src/bar-geometry.ts`（两侧共享），语义另见 [设计决策](../design-decisions.md)。

## 7. 响应式：靠宿主变量，不靠断点

代码里**没有任何宽度媒体查询**。dock/面板宽度完全由宿主 composer 变量决定（下表默认值取自安装态 conversation 包，插件只是引用）：

| 变量 | 插件引用次数 | 宿主默认值 |
|---|---|---|
| `--dsh-composer-dock-inset` | 5 | `8px` |
| `--dsh-composer-side-clearance` | 2 | `16px`（嵌入态 `8px`） |
| `--dsh-composer-card-max-width` | 1 | `calc(var(--dsh-chat-content-width) + 32px)`（嵌入态 `min(calc(100% - 16px), 952px)`） |
| `--dsh-composer-stack-gap` | 1 | `6px`（dock 负下边距 = `-(stack-gap + 3px)`，即 `−9px`） |

宿主调这些变量时插件自动跟随——**这是「抄外壳」这件事里唯一不承担维护成本的部分**，其余抄来的数值都要人工追平（见核对表）。

## 8. 相关

- dock 与宿主的逐项漂移与归属：[notes/dock-alignment.md](../notes/dock-alignment.md)
- 为什么是「抄外壳」而不是「复用组件」：[设计决策 §8](../design-decisions.md)
- 图标与配色归属：[notes/icons.md](../notes/icons.md)
