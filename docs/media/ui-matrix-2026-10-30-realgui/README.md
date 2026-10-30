# UI 面证据 · 2026-10-30（`0.2.2-alpha.2` · 真 GUI）

> [!IMPORTANT]
> **这一帧由官方入口产出，不是 `/tmp` 绕过版。** 命令就是 README 里写的那条
> `npm run verify:ui -- --versions 0.2.2-alpha.2`，退出码 **0**。

**来源**：真内核版本树（`~/dsh-versions/0.2.2-alpha.2`）+ 隔离实例（`DSH_HOME` 指向
`.verify/ui-matrix/instances/0.2.2-alpha.2`）+ headless Chromium 真点击真回合。
**没有**任何一张是复刻 DOM 的预览或示意图。

**环境**

| 项 | 值 |
|---|---|
| 内核 | `0.2.2-alpha.2`（`~/dsh-versions/0.2.2-alpha.2`，`--no-install`，树未重装） |
| 插件 | `dsh-later@1.10.0`，分支 `test/118-kernel-022`，HEAD `ffb322d` + 本轮 `instance.mjs` 修复（随后作为 `fix(ui-matrix)` 提交） |
| playwright | `PLAYWRIGHT_MODULE=/home/wujue/.nvm/versions/node/v22.22.2/lib/node_modules/@playwright/mcp/node_modules/playwright` |
| node | v22.22.2 |
| 命令 | `PLAYWRIGHT_MODULE=… npm run verify:ui -- --versions 0.2.2-alpha.2` |

**结果行**

```
### 0.2.2-alpha.2 … HTTP 401 按钮=Y dock=1 面板=Y badge=1 错误=0 警告=0
汇总：通过 1 / 不通过 0
exit 0
```

（`HTTP 401` 是正常输出 —— `instance.mjs` 把 200/401 都算服务已起，token 走 URL 参数。）

## 文件

| 文件 | 是什么 | 判据 | sha256 |
|---|---|---|---|
| `0.2.2-alpha.2-dock.png` | 该代次 dock 里**真出现**的待发送行：`18:14 剩 30:00 截图矩阵 0.2.2-alpha.2:这条会出现在 dock 里`，行尾四个按钮（编辑 / 暂停 / 删除 / 插话发送）都在 | `[class*=ss-dock-row]` 精确类名 ≥1（`dockRows=1`） | `5e31b92778828e58d3758730583da00030590287453eabdeee72745da0844dfc` |

这一帧能自证是哪一代：dock 行的正文里带 `0.2.2-alpha.2`。

同一次运行还产出了 composer / panel / badge 三帧，它们在 gitignore 的
`.verify/ui-matrix/`（`0.2.2-alpha.2-1-composer.png` / `-3-panel.png` / `-4-badge-PASS.png`），
`matrix.json` 里的原始判据是：`buttonFound=true`、`dockRows=1`、`panelOpened=true`、
`badges=1`、`badgeRows={matched:15, badgeable:1}`、`errors=[]`、`warns=[]`、`driftWarns=[]`。
本目录只入库上面那一张 dock 帧（PNG 在 git 里不可压缩，一张能自证的帧足够，其余留 JSON 判据）。

## 为什么目录里没有失败帧

这一代四面是 **GREEN**，本来就没有失败帧可放。

唯一的失败出现在**修 `scripts/ui-matrix/instance.mjs` 之前**：官方入口 exit 1，量到
「按钮=N dock=0 面板=N」，日志 `skipping profile bundle "dsh-later": cannot resolve profile
bundle`。那不是插件的问题，是矩阵的副本清单漏了 `package.json`（`files` 白名单不含它，
而宿主解析 bundle 必须读它），属于**脚手架缺陷**，已修并复验。全过程记在
[`docs/notes/ui-matrix.md` §10](../../notes/ui-matrix.md)。失败帧不入库：它不是"这一代不行"
的证据，如果放进 `docs/media/` 反而会被后来的读者当成代次结论。

## 与其它证据目录的关系

- 2026-10-26 / 10-27 那两批（`docs/media/ui-matrix/`）只描述**旧代码**的结论；
- 2026-10-28 那批（`docs/media/ui-matrix-2026-10-28-realgui/`）是 8 代基线与 badge 漂移修复；
- 本目录只补 `0.2.2-alpha.2` 这一代（issue #118）。逐代结论与口径见
  [`docs/notes/ui-matrix.md`](../../notes/ui-matrix.md) 第 5 节与第 10 节，四面实测总表见
  [`docs/verification.md`](../../verification.md) 的「0.2.2-alpha.2」小节。

## 复跑

```bash
PLAYWRIGHT_MODULE=<playwright 模块目录> \
  npm run verify:ui -- --versions 0.2.2-alpha.2
# 产物：.verify/ui-matrix/{matrix.json,matrix.html,0.2.2-alpha.2-*.png}
```
