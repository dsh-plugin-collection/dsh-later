# 悬停卡「空闲」证据（issue #153）

真 GUI 取证，**改前 / 改后成对**。两张图由**同一个采集件**同一天跑出，只换被测产物。

## 环境

- 内核：`0.2.2-rc.1`（`~/dsh-versions/0.2.2-rc.1`）
- 采集件：`tests/helpers/hover-capture.mjs`（隔离 `DSH_HOME` + 真 Chromium，`deviceScaleFactor: 2`）
- 流程：新建会话 → 用真实命令通道建一条 `after` 提醒（40 分钟后）→ **悬停那条会话** → 截整页与卡片裁切 → 同时 dump 卡片 DOM
- 样本确认：侧栏那行有插件徽标（`aria: "有 1 条定时提醒，下次 40 分后"`），且**没有宿主「进行中」orb** ⇒ 正是「宿主空闲 + 有提醒待发」

## 两张图

| 文件 | 被测产物 | 卡片状态行 |
|---|---|---|
| `pre-gui-card.png` | `main@4bedb24`（改前） | **`● 空闲`** |
| `post-gui-card.png` | `fix/hover-idle-override`（改后） | **`● 有 1 条定时提醒，下次 40 分后`** |
| `pre-gui-full.png` / `post-gui-full.png` | 同上 | 整页，可看侧栏徽标与卡片同屏 |

机器可读的判定（采集件落盘）：

```
改前：hostStatusRowTexts:["空闲"]           pluginLineInjected:false
改后：adoptedRows:["有 1 条定时提醒，下次 40 分后"]  pluginLineInjected:true
```

## 这张图证明了什么、没证明什么

**证明了**：在有提醒的会话上，悬停卡的状态行**不再单独显示「空闲」**，替换成插件的定时文案；且改前那版连插件行都没注入（不只是"并列"问题，是**根本没生效**）。

**没证明**：其它内核代次的渲染（只跑了 0.2.2-rc.1）；「进行中」档的追加分支（真 GUI 没造出 busy 样本，那一支由单测/代码路径覆盖）；深色主题之外的配色。

## 为什么改前那版没注入（根因，可复核）

`findHoverCard()` 原来只取 `body > firstElementChild` 的**直接子节点**，而真 DOM 是：

```
BODY > SPAN._portal_*        ← body 直系浮层（不是卡片本身）
         > DIV._card_*       ← 卡片壳（firstElementChild，没有状态行）
           > DIV.hoverContent  ← 状态行真正的父容器（隔 2 层）
```

所以状态行从来没被匹配上。现在改成**下钻找状态行容器**（深度上限 5，防御用），并保留「找不到就安静跳过」的语义。
