# 插件图标清单

> 本文只记「图标从哪来、什么颜色」。dock 与宿主 QueueDock 的样式差异另见 [dock-alignment.md](./dock-alignment.md)。

## 1. 主 Logo / 包图标

| 文件 | 用途 |
|---|---|
| `icon.svg`（仓库根） | 包图标，`package.json` 的 `"icon": "./icon.svg"` 指向它 |
| `assets/brand/logo.svg` | 品牌 Logo（气泡 + 琥珀色时钟） |
| `assets/icons/*.svg` | README 与文档用的静态展示图；**组件运行时不再内联这些 path** |

> 旧文档里提到的 `docs/logo.svg` / `docs/logo-transparent.svg` 已不存在。

`assets/icons/` 现有：`icon-bubble` · `icon-clock` · `icon-delete` · `icon-edit` · `icon-send` · `icon-schedule-btn` · `icon-presence` · `icon-presence-scheduled` · `icon-presence-urgent` · `icon-presence-overdue`。README 首屏用的是 `assets/icons/icon-presence-scheduled.svg`。

---

## 2. 组件图标：全部来自官方图标集

自 1.3.0 起，UI 图标统一改用 `@deepseek-ai/dsh-client-ui-primitives`，手写内联 SVG 已从组件中删除（Gitea issue #19）。下表按各组件的 import 实测：

| 组件 | 从 primitives 导入 |
|---|---|
| `ScheduleDock` | `IconClockOutlineRegular`（折叠头 lead）、`IconChevronDownOutlineRegular`（展开/收起）、`IconEditOutlineRegular`、`IconTrashOutlineRegular`、`IconPauseOutlineRegular` / `IconPlayOutlineRegular`（暂停·恢复）、`IconSendOutlineRegular`（插话发送）、`IconCloseOutlineRegular`（取消编辑） |
| `SchedButton` | `IconClockOutlineRegular` |
| `SchedPanel` | `IconCloseOutlineRegular` |
| `TaskList` | `IconCloseOutlineRegular` |
| `SchedulerSettingsCard` | `IconInfoOutlineRegular` |

尺寸：dock 的编辑/删除/取消用 `size={14}`，暂停/恢复/插话用 `size={16}`，折叠头 lead 为 `IconClockOutlineRegular size={16}`，chevron 为 `size={14}`（图标尺寸与宿主 `.chevron` 的 14×14 一致）。

> 曾经抄录在本文的 `QueueClockIcon` / `QueueChevronIcon` / `QueueEditIcon` / `QueueDeleteIcon` / `QueueSendIcon` 五个内联组件已随 #19 删除，故不再保留其 path 副本。

---

## 3. 会话状态 Badge 图标（唯一仍在组件里的内联 SVG）

**文件**：`src/client/session-presence.ts`

两个变体常量，按设置选择：`CLOCK_SVG_CLASSIC`（10×10 像素风）与 `CLOCK_SVG_MODERN`；取值来自 `getClockIconStyle?.()`，`'auto' | 'modern' | 'classic'`，仅 `classic` 走像素版，其余走 modern 版。

结构（像素版）：外层 `<g class="ss-presence-ring">` 是 8 个 2×2 方点组成的环，内层 `<g class="ss-presence-hand">` 是两根指针方点；SVG 用 `shape-rendering="crispEdges"` 保持像素硬边，`aria-hidden="true"`。

动画挂靠在 CSS 上（`src/client/styles.ts`）：`.ss-presence .ss-presence-ring` 默认呼吸动画；`[data-state="urgent"]` 换成更快的 pulse；`[data-state="overdue"]` 停住（`animation: none`）。modern 版对应 `.ss-clock-track` 的同名三条规则。

---

## 4. 已移除的图标

- **⏰ 到达 toast**：`src/client/toast.tsx` 已删除，到点以对话消息为准（见 CHANGELOG「移除右下角 ⏰ 到达 toast」）。现在 `⏰` 只剩 `styles.ts` 里一条分节注释，不是运行时图标。
- 组件内所有手写 `<svg>`（§2 那张表的来源），除 `session-presence.ts` 的两个时钟变体外均已清空——`grep -rn "<svg" src/client/` 只应命中 `session-presence.ts`。

---

## 图标颜色规范

| 图标 | 颜色 | 出处（类名，非行号） |
|------|------|---|
| 输入框时钟按钮 | `var(--dsw-alias-label-secondary)`，图标继承 `currentColor` | `.ss-sched-btn` |
| dock 动作按钮 | `var(--dsw-alias-label-tertiary)`；`:disabled` 时 `opacity: .45` | `.ss-dock-action` |
| dock 插话已发送 | `var(--dsw-alias-state-success-primary)` | `.ss-dock-action-steer.ss-done` |
| Badge（scheduled，默认） | `#8b5cf6` | `.ss-presence` |
| Badge（urgent） | `var(--dsw-alias-state-warn-secondary)` | `.ss-presence[data-state="urgent"]` |
| Badge（overdue） | `var(--dsw-alias-state-error-primary)` | `.ss-presence[data-state="overdue"]` |
| 悬浮卡状态点（urgent / overdue） | `#f59e0b` / `#f25a5a` | `.ss-hover-status[data-state=…]` |
| 琥珀时钟点 `#fbbf24` | 仅出现在静态资产 `assets/icons/icon-clock.svg`、`assets/icons/icon-presence-urgent.svg`，运行时代码不使用 | — |
