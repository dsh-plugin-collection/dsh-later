# UI 面：跨内核代次截图矩阵

> 面向维护者的记录。回答三件事：**怎么测的、怎么判的、历次结论是什么**。
> 与另外两面的分工见 `docs/verification.md`「验证状态」——`verify:kernels` 管装配与到点投递，
> `--steps type` 管类型面，本文件管"画出来、点得动"。

## 1. 一条命令复跑

```bash
npm run build                                   # 脚本与样式先落进 lib/
npm run verify:ui                               # 跑 KERNEL_GENERATIONS 全部代次 → .verify/ui-matrix/
npm run verify:ui -- --versions 0.1.5-rc.3,0.2.1-rc.2
npm run verify:ui -- --evidence docs/media/ui-matrix    # 同时更新进仓证据（拼图 + 缩略图 + 清单）
```

采集件需要 playwright（本仓 devDependencies **没有**它，CI 也**不装**，所以这条链**不进 CI**）：

```bash
PLAYWRIGHT_MODULE=<playwright 包目录> npm run verify:ui     # 指认一份现成的
# 或者本机已装裸 playwright（node 能解析到）时直接跑
```

## 2. 每代拍什么、判什么

| 截图 | 判据（结构性，不是像素） |
|---|---|
| `1-composer` 作曲行 + 定时按钮 | `[class*=ss-sched-btn]` 存在 —— 证明 client bundle 在该代次**加载成功** |
| `2-dock` 待发送 dock 行 | 发一条 `/later +30m 截图矩阵 <代次> …`（真实命令通道、命令本地处理、不烧模型）后出现**精确类名**为 `ss-dock-row` 的行 —— 正文里带代次，所以截图自己能证明跑的是哪一代（同分钟 + 同倒计时 + 同字体时，两张图可能逐字节相同，只有正文能区分）|
| `3-panel` 面板展开 | 点按钮后 `[class*=ss-panel]` 出现 |

**为什么不设像素阈值**：跨代次的字体渲染、图标风格本来就不同（0.1.2/0.1.5 的图标是尺寸后缀的
点阵风格，0.1.7+ 是描边风格）。像素阈值会把"设计差异"判成"回归"，而真正要拦的是"某一代根本
画不出来 / 点了没反应"——这类问题在结构性判据上一定显形。

控制台错误分两档：**资源 404/401 只记录不判红**（老代次少一两个静态资源不该掩盖 JS 错误），
`pageerror` 与其它 console error 计入 `consoleErrors`，非 0 即该代次不通过。

行数按**精确类名 token** 数（`className.split(/\s+/).includes('ss-dock-row')`）：用子串选择器会把
`ss-dock-row-line` / `-time` / `-countdown` / `-prompt` 一起算上，一行会被数成 5 —— 这个坑
第一次写的时候踩了，清单里出现过"dock 5 行"其实是 1 行。

## 3. 隔离与边界

- 隔离靠 `DSH_HOME` 指向 `.verify/ui-matrix/instances/<版本>`：会话、storages、plugin-state 都落那里。
  **没有** unshare/容器 —— 插件若往 `DSH_HOME` 之外写，这里挡不住。dsh-later 已实测只写 DSH_HOME。
- 凭据（`~/.dsh/.credentials.yaml`）**软链**进来：实例自己生成 secret 的话，页面壳能开、API 全 401，
  插件按钮根本不渲染。
- 工作区清单从 `~/.dsh/storages/workspace.json` **只读复制**一份：缺了 composer 是禁用态，同样测不到插件；
  自己造的记录必须严格合 schema（缺 `createdAt/updatedAt` 会让 `workspaceRegistry` 起不来）。
- 用完必须停实例（`stopInstance` 杀进程组）；`.verify/` 已 gitignore，可随时重跑。

## 4. 三处跨代次差异（都在 `scripts/ui-matrix/instance.mjs` 里处理）

| 差异 | 症状 | 处理 |
|---|---|---|
| `.bin/dsh` 形态 | npm 树是**指向 JS 的软链**，pnpm 树是 **POSIX shell 脚本**；`node .bin/dsh` 喂后者 → `SyntaxError: Invalid or unexpected token` | 软链走 `node <realpath>`，实体脚本**直接执行** |
| 模块回退清单 | `dsh-app-boot` 的 `healProfilesModuleFallback()` 读 `<dsh 包>/node_modules/package.json`，缺了抛 `ENOENT`（0.1.5 的 npm 树） | 补一个 `{}` 占位清单（不改变任何解析结果） |
| `cordis.patch.yml` 的 hmr | 0.1.2 的 `watchUserPatches()` 在 hmr 服务缺失时直接 `Error: user patch-layer watching requires the Cordis HMR service` | 引导里**显式开启** hmr（不写 config） |

这三条都是实测出来的，也都进不了"读代码就能发现"的范围 —— 所以它们各有一条结构测试钉住。

## 5. 历次结论（append-only）

| 日期 | 基线 | 代次 | 结论 | 证据 |
|---|---|---|---|---|
| 2026-10-26 | `main@28ca1dc` | 0.1.2-rc.1 / 0.1.5-rc.3 / 0.1.7-rc.1 / 0.1.7-rc.2 / 0.2.0-rc.2 / 0.2.1-rc.2 | **6/6 通过**：按钮在、dock 各 1 行（正文带代次）、面板打开、控制台 0 条真实错误 | [`docs/media/ui-matrix/manifest.json`](../media/ui-matrix/manifest.json) + `matrix.png` + 每代 `-dock.png` |

> 更早一次（2026-10-26 上午）的临时脚本只跑到 **5/6**：0.1.5 的 GUI 起不来（就是上面第 2 条
> 模块回退清单那个 `ENOENT`，加上启动器形态那条）。那次结论没有进仓，因为脚本本身不可复跑；
> 补进仓后同一天完成 6/6。

## 6. 加新代次时要做什么

1. 在 `lib/upstream-compat.js` 的 `KERNEL_GENERATIONS` 加一代（UI 矩阵自动跟着跑）；
2. 本地 `~/dsh-versions/<版本>` 铺好该版本树（`npm i @deepseek-ai/dsh@<版本>`，老代次参考上文第 4 条）；
3. `npm run verify:ui -- --versions <版本>` 看它是否画得出来；
4. 通过后 `npm run verify:ui -- --evidence docs/media/ui-matrix` 刷新证据，并在第 5 节追加一行。
