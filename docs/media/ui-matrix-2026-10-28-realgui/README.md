# UI 面证据 · 2026-10-28（真 GUI）

> [!IMPORTANT]
> **本目录只入库 JSON 与这份 README，图片不入库。**
> 31 张 PNG（4.2 MB）曾随 `release/1.9.0` 一起提交，后在合入前用 `git-filter-repo` 从历史中
> 摘除——PNG 在 git 里不可压缩、永不 dedup，追加一个"删除提交"并不能把体积从历史里拿掉，
> 所以必须改写引入它们的那几个提交。
>
> 原始图片仍在跑验证的那台机器的 `.verify/ui-matrix*/`（已被 `.gitignore` 排除）下，
> 文件名与判据见下表；**下表描述的是那些帧各自证明了什么**，不是仓库里存在的文件链接。
> 逐代结论以本目录的 `matrix.json` / `matrix-full-8gen.json` / `badge-probe.json` 为准——
> 它们是文本、可 diff、可复核，也正是这些结论的真正载体。

**来源全部是 `real-gui`**：真内核版本树（`~/dsh-versions/<代次>`）+ 隔离实例（`DSH_HOME` 指向
`.verify/…`）+ headless Chromium 真点击真回合。**没有**任何一张是复刻 DOM 的预览或示意图。

基线：worktree 分支 `test/ui-face`，commit `d4a7895`，插件 1.9.0。
playwright：`/home/wujue/.npm/_npx/86170c4cd1c5da32/node_modules`（1.62.0-alpha，chromium-1232）。

## 复跑命令

```bash
# ① 结构性三面（按钮 / dock 行 / 面板 / 控制台错误）→ matrix.json + 本目录
PLAYWRIGHT_MODULE=/home/wujue/.npm/_npx/86170c4cd1c5da32/node_modules \
  node scripts/ui-matrix/run.mjs \
    --out .verify/ui-matrix-all \
    --evidence docs/media/ui-matrix-2026-10-28-realgui \
    --port-base 3540

# ② 侧栏 badge 探针（含漂移自检判据）——一次性驱动，源码见
#    docs/notes/ui-face-2026-10-28-badge-probe.mjs（长期该搬进 scripts/ui-matrix/）
node .verify/ui-badge-probe.mjs        # → .verify/badge-probe/badge-probe.json
```

## 文件命名约定

`<代次>-<PASS|FAIL>-<判据>-real-gui.png`。未判定不叫 PASS 也不叫 FAIL，写在 README 的表里。

| 文件 | 是什么 | 判据 |
|---|---|---|
| `matrix.png` | 六代 × 三帧的拼图（由 `matrix.html` 直接截，结论与图同源） | 结构性三面 |
| `<代次>-dock.png` / `<代次>-PASS-dock-real-gui.png` | 该代次 dock 里真出现的待发送行（正文带代次，图能自证是哪一代） | `ss-dock-row` 精确类名 ≥1 |
| `<代次>-PASS-badge-real-gui.png`（0.1.2 / 0.1.5） | 侧栏会话行**左端出现**紫色点阵时钟 badge | `.ss-presence` 计数 =1 |
| `<代次>-FAIL-badge-missing-real-gui.png`（0.1.7 起四代） | 同一位置**什么都没有**：会话行有 `draggable="false"`，选择器命不中 | `.ss-presence` =0 且 `badgeable` =0 而 `indexSize` =1 |
| `0.2.1-rc.2-PASS-dock-pause-states-real-gui.png` | 展开 dock 后两行：`after` 行暂停图标实心、`at` 行暂停图标灰掉 | DOM `disabled` + 两行 `visible=true` |
| `0.2.1-rc.2-PASS-smart-window-real-gui.png` | 详情页把「工作时间开始」存成 07:30 后，面板芯片由「明天 09:00」变「明天 07:30」 | 芯片文本 |
| `0.2.1-rc.2-PASS-settings-detail-surface-real-gui.png` | 设置卡·插件详情页 surface（5 section / 10 input / 6 switch） | `.ss-settings-form` =1 |
| `0.2.1-rc.2-PASS-settings-dialog-surface-real-gui.png` | 设置卡·设置对话框 surface（账号菜单 → 设置），值与详情页互通 | `[role=dialog]` =1 且 `.ss-settings-form` =1 |
| `<代次>-dock.png` | 与上一行同一帧（`verify:ui --evidence` 自己产的那份，manifest 按 sha256 认它），**不是另一张图** |
| `matrix.json` | 逐代次：按钮 / dock 行数 / 面板 / 控制台错误 | `verify:ui` 原始产物 |
| `badge-probe.json` | 逐代次：`selectorRows` / `badgeable` / `indexSize` / `badges` / 是否告警 | 探针原始数据 |
| `manifest.json` | 上面这些文件的 sha256 与采集时间 | `verify:ui --evidence` 生成 |

## 与上一批证据的关系

`docs/media/ui-matrix/`（10-26/10-27 那批）是**旧代码**的结论，不能当本轮证据引用。
本轮的结论与差异见 [`docs/notes/ui-matrix.md`](../../notes/ui-matrix.md) §5、§7。

## 已知不覆盖

0.2.1-rc.3 / rc.4（不在 `KERNEL_GENERATIONS` 表里）、悬浮卡片 hover 增补行、进度条动画相位、
插话/暂停/恢复的命令往返结果、reduced-motion 与键盘焦点、en locale、侧栏收起分支。
