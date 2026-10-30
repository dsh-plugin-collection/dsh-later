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
| 2026-10-28 | `test/ui-face@d4a7895`（插件 1.9.0） | 同上六代 | **结构性三面 6/6 通过**（按钮在、dock 各 1 行、面板打开、`consoleErrors`=0）；**但侧栏 badge 自 0.1.7 起四代全 FAIL**，且本轮新加的漂移自检**一条都没告**（假阴性，见 §7）。退出码按仓内约定应为 **1（有红）**，不是全绿 | [`docs/media/ui-matrix-2026-10-28-realgui/`](../media/ui-matrix-2026-10-28-realgui/README.md)：`matrix.json` + `badge-probe.json` + 每代 PASS/FAIL 图 |

> 更早一次（2026-10-26 上午）的临时脚本只跑到 **5/6**：0.1.5 的 GUI 起不来（就是上面第 2 条
> 模块回退清单那个 `ENOENT`，加上启动器形态那条）。那次结论没有进仓，因为脚本本身不可复跑；
> 补进仓后同一天完成 6/6。

## 6. 加新代次时要做什么

1. 在 `lib/upstream-compat.js` 的 `KERNEL_GENERATIONS` 加一代（UI 矩阵自动跟着跑）；
2. 本地 `~/dsh-versions/<版本>` 铺好该版本树（`npm i @deepseek-ai/dsh@<版本>`，老代次参考上文第 4 条）；
3. `npm run verify:ui -- --versions <版本>` 看它是否画得出来；
4. 通过后 `npm run verify:ui -- --evidence docs/media/ui-matrix` 刷新证据，并在第 5 节追加一行。

## 7. 2026-10-28 这轮补的扩展判据（结构性三面之外）

`verify:ui` 的三面只回答"画没画出来"，回答不了本轮真正改的那四件事。补的判据与结论：

| 判据 | 结论 | 依据（真 GUI 实测数） |
|---|---|---|
| 无提醒时 dock **不注册**秒级 interval | PASS | `.ss-dock-root` =0；插件归因 1s interval =0（页面全部 1s 也 =0） |
| 有提醒时 tick 起来、倒计时逐秒走 | PASS | 插件归因 1s interval =1（调用栈含 `useNow`）；倒计时 `剩 30:00` →(2.3s) `剩 29:58` |
| 清空提醒后 tick 停摆 | PASS | 归因 =0，页面 1s 总数 0→0 |
| 设置卡·插件详情页 surface | PASS | `.ss-settings-form` =1，5 个 section、10 个 input（含 5 个 `HH:mm`）、6 个 switch；`maxPromptChars` disabled（联动锁在位） |
| 设置卡·保存 | PASS | `workStart` 09:00→07:30，保存后回读 07:30，`pageerror` =0 |
| 设置卡·设置对话框 surface | PASS | 账号菜单 → 设置：`[role=dialog]` =1、`.ss-settings-form` =1、`workStart` =07:30（与详情页同源） |
| hooks 次序（旧缺陷：快照状态翻转时抛 `Rendered more hooks…`） | PASS（运行时未复现）+ 结构判据 | 全轮 0 条该报错；外层组件 hooks 全在早退**之前**（`SchedulerSettingsCard.tsx:278-306`），表单 hooks 在子组件（:343）。⚠️ 真 GUI 里快照首帧就 `ready`，**没观测到 loading 帧**，所以翻转路径本身没被界面触发过 |
| 智能时段设置**真的生效** | PASS | 保存 `workStart=07:30` 后，面板芯片由「明天 09:00」变「明天 07:30」 |
| 暂停/恢复按钮可用态 | PASS | 展开 dock 后两行 `visible=true`：`after` 行 `暂停提醒:enabled`、`at` 行 `暂停提醒:disabled` |
| 侧栏 badge | **FAIL（0.1.7 起四代）** | 见下表 |
| 漂移自检 console.warn | **FAIL（假阴性）** | 见下 |

### 7.1 侧栏 badge 在 0.1.7+ 整块不出现，且自检告不出来

逐代实测（`badge-probe.json`，每代都是真起实例 + 真发一条 `/later` + 等摘要起来后测）：

| 代次 | 会话行 `draggable` | `selectorRows` | 排除后可标注行 | `.ss-presence` | 摘要 `indexSize` | console.warn |
|---|---|---|---|---|---|---|
| 0.1.2-rc.1 | `true` | 12 | 1 | **1** | 1 | 0 |
| 0.1.5-rc.3 | `true` | 12 | 1 | **1** | 1 | 0 |
| 0.1.7-rc.1 | **`false`** | 11 | **0** | 0 | 1 | **0** |
| 0.1.7-rc.2 | `false` | 11 | 0 | 0 | 1 | 0 |
| 0.2.0-rc.2 | `false` | 11 | 0 | 0 | 1 | 0 |
| 0.2.1-rc.2 | `false` | 11 | 0 | 0 | 1 | 0 |

两条独立的结论：

1. **漂了**。`HOST_DOM.sessionRow = '[role="treeitem"][draggable="true"]'` 从 0.1.7 起只命中
   **工作区行**（`YDXeBa_projectRow`，带 `aria-expanded`），会话行（`YDXeBa_sessionRow`）改成了
   `draggable="false"`，于是被 `aria-expanded` 排除规则全部剔掉 → 可标注行恒为 0 → badge 永不注入。
   数据面没漂：同一轮探针里 `indexSize=1`（摘要有这条提醒），所以纯粹是 DOM 假设过期。
2. **新加的漂移自检抓不到它**。`scan()` 的判据用的是**排除前**的 `rows.length`
   （`session-presence.ts:306-323`）：`rows.length>0` 就认定"结构探测仍然对得上"并把
   `sidebarDriftWarned` 复位。而真漂移的形态恰恰是"选择器还命中一堆，但排除后一个都不剩"——
   四代 × 10+ 次扫描，**一条 warn 都没有**。注释里那句「命中过行 = 结构探测仍然对得上」在
   这条路径上是错的。修法（本轮**未改**，只报）：判据改成排除后的可标注行数
   （`badgeable === 0 && index.size > 0` 才告），行选择器另需放宽或加 fiber 反查兜底。

### 7.2 采集件自身的两个缺口（下轮值得补进 `scripts/ui-matrix/`）

- `capture.mjs` 只记 `m.type() === 'error'`，**warning 不进 `matrix.json`** —— 漂移自检发的正是
  `console.warn`，所以六代"控制台 0 错误"完全掩盖了它。
- 三面判据里没有 badge，因此 badge 全红时 `run.mjs` 仍 `process.exit(0)`。**全绿 ≠ 用户看得见**，
  这一轮就是实例。

### 7.3 本轮差点误判的四地方（写下来免得下轮重走）

1. 第一轮扩展判据里 `pause-disabled-for-at` / `smart-window` / `settings-*` 全红，**是驱动的锅不是插件的锅**：
   (a) 没造第二条 `at` 任务就去查"第二行的暂停按钮"；(b) 「无草稿且无提醒」时按钮是 `disabled`，
   点它没反应 → 面板根本没开；(c) 设置卡入口是「插件页 → 已安装插件卡片标题按钮」，按文本匹配会点到侧栏的工作区行。
2. 一张叫 `PASS-pause-states` 的整页截图其实只拍到折叠头（多条时列表带 `hidden`），**图与结论对不上** →
   重拍成"展开 dock + 元素 bounding box 裁切"。
3. `indexSize` 前 8 次扫描都是 0（摘要 store 有分钟级时效），只看前几条会误判成"数据面也漂了"。
4. 跑完后真实 `~/.dsh` 里 `storages/cost-meter/ledger.json`、`storages/workspace.json`、
   `plugin-state/gitea-dispatch/…` 的 mtime 仍在变 —— 用「确认无实例进程后再等 40s 重采样」归因：
   它们由**活着的宿主**持续写，不是本轮写的。

### 7.4 隔离核对（本轮）

- `~/.dsh/.credentials.yaml` sha256 与 mtime **未变**；`sessions/`、`storages/`、`plugin-state/`
  相对基线**无新增条目**。
- 每个实例的会话/存储都落在自己的 `DSH_HOME`（`.verify/…/homes/<版本>/`，各 3–4 个会话目录）。
- 收尾 `pgrep` 无残留实例进程；本轮未在 `/tmp` 造 `fake-dsh-home-*`。`.verify/` 约 80M，已 gitignore。
- 未跑 `--deploy`、未设 `DSH_LATER_RELINK`。

### 7.5 本轮**没能**验证的部分

0.2.1-rc.3 / rc.4（树在本机有，但不在 `KERNEL_GENERATIONS` 表里，矩阵按表跑）；设置卡的
`loading→ready` 翻转路径（真 GUI 首帧即 ready）；悬浮卡片（hover card）的状态行增补；dock 进度条
CSS 动画相位与暂停/恢复的视觉冻结；插话投递的命令往返结果；`prefers-reduced-motion`、焦点管理、
键盘导航；en locale；侧栏收起 / 多工作区折叠等布局分支。

## 8. §7.1 两条缺陷的修复与复验（同日，`fix/badge-drift-detection`）

两条分开修，顺序是刻意的：**先让探测器能说话，再修被探测的东西**。反过来的话，选择器一改
探测器就永远沉默，等于把这次的教训原样留给下一个人。

| 提交 | 改动 |
|---|---|
| `5e4c20b` | 漂移判据从「选择器命中数」改成「**排除工作区行后**可标注行数」 |
| `329289a` | 行选择器去掉 `draggable="true"` 假设（被 0.1.7 证伪的那一个），只押 `aria-expanded` |
| `5485ce7` | 采集件补上 §7.2 两个缺口：console **warning** 进结论；badge 进判据；HTML / manifest / 退出码统一走同一份 `rowVerdict` |

复验用真 GUI，跑三代而不是只跑红的那两代——`0.1.2-rc.1` 原本是**好的**，放宽选择器必须证明
没把它弄坏：

```
0.1.2-rc.1   按钮=Y dock=1 面板=Y badge=1 错误=0 警告=0   matched=12 badgeable=1
0.1.7-rc.1   按钮=Y dock=1 面板=Y badge=1 错误=0 警告=0   matched=12 badgeable=1
0.2.1-rc.2   按钮=Y dock=1 面板=Y badge=1 错误=0 警告=0   matched=12 badgeable=1
汇总：通过 3 / 不通过 0（exit 0）
```

对照 §7.1 修复前在 0.1.7 系上量到的 `selectorRows=11 / badgeable=0 / badges=0`：`matched`
从 11 变 12（会话行重新进入候选集）、`badgeable` 从 0 变 1、badge 实际注入 1 个。
`driftWarns` 为空是**正确**结果——判据现在只在「有提醒且可标注行为 0」时说话，这次是
「有提醒且有可标注行」。

证据：逐代结论在 `docs/media/ui-matrix-2026-10-28-realgui/matrix-after-fix.json`。真 GUI 帧
（三代各一张 PASS + 修复前四张 FAIL，成对保留）**不入库**，留在跑验证的机器
`.verify/ui-matrix/` 下；`0.1.7-rc.1` 那张能直接看到会话行「新会话」上的时钟 badge。
图片为何不入库见该目录 README 开头的说明。

`HTTP 401` 是正常输出不是故障：`instance.mjs:192-200` 把 200/401 都算「服务已起」，鉴权 token
走 URL 查询参数；若真是 401 页，`matched`/`dock`/`badge` 不可能有值。

### 8.1 当时的未判定 → 已由 §9 的全量复跑关闭

那一小节写的时候只复验了三代，剩下五代（0.1.5-rc.3 / 0.1.7-rc.2 / 0.2.0-rc.2 / 0.2.1-rc.3 /
0.2.1-rc.4）仍是"按同族形状推断"，不是实测。随后补了全 8 代的复跑，见 §9。

## 9. 全 8 代复跑（同日，`main` = `53774ac`）

两个面一起跑，且 **mount/function 逐代各起一个独立进程**——这是刻意的：`verify-across-kernels`
在同一进程里连跑多代时，前一代的 cordis / `dsh-*` 实例不会随换树消失，而同源守卫只看**解析
路径**、看不到**已加载实例**，这类污染仍可能报绿（§7.2 记过这条）。逐代一进程直接绕开。

**A. mount + function（8 代，各自独立进程）**

```
0.1.2-rc.1 … 0.2.1-rc.4   全部 GREEN
  内核=<代> · 同源=same · 投递 spliced=1 dispatch=Y · at 形状 5/5
  汇总：绿 8 / 红 0 / 未判定 0（逐代明细 .verify/across-kernels-*.json）
```

**B. UI 面（全 8 代，含此前不在表里的 rc.3 / rc.4）**

```
0.1.2-rc.1   按钮=Y dock=1 面板=Y badge=1 错误=0 警告=0   matched=12 badgeable=1
0.1.5-rc.3   按钮=Y dock=1 面板=Y badge=1 错误=0 警告=0   matched=12 badgeable=1
0.1.7-rc.1   按钮=Y dock=1 面板=Y badge=1 错误=0 警告=0   matched=12 badgeable=1
0.1.7-rc.2   按钮=Y dock=1 面板=Y badge=1 错误=0 警告=0   matched=12 badgeable=1
0.2.0-rc.2   按钮=Y dock=1 面板=Y badge=1 错误=0 警告=0   matched=12 badgeable=1
0.2.1-rc.2   按钮=Y dock=1 面板=Y badge=1 错误=0 警告=0   matched=12 badgeable=1
0.2.1-rc.3   按钮=Y dock=1 面板=Y badge=1 错误=0 警告=0   matched=12 badgeable=1
0.2.1-rc.4   按钮=Y dock=1 面板=Y badge=1 错误=0 警告=0   matched=12 badgeable=1
汇总：通过 8 / 不通过 0
```

对照 §7.1 修复前在 0.1.7+ 量到的 `selectorRows=11 / badgeable=0 / badges=0`：现在
`matched=12`（会话行重新进入候选集）、`badgeable=1`、实际注入 1 个 badge。
`drift=0`（自检不响）是**正确**结果——判据只在「有提醒且可标注行为 0」时说话。

**为什么信这组数而不只信 JSON**（§7.3 的教训：JSON 全绿而界面是空的）：
- 8 个实例目录、8 张 badge 截图 sha256 **各不相同**、mtime 间隔 ~15s，确认是 8 次独立启动；
- 人工看过 0.1.7-rc.1 与 0.2.0-rc.2 两张帧：会话行「新会话」上有时钟 badge，dock 行与面板
  同时在（0.2.0-rc.2 修复前是 FAIL 图）。
- 遗留 `/tmp/fake-dsh-home-*` = 0（§8 之外，`5485ce7` 之后测试不再攒垃圾，这里再次确认）。

证据：`docs/media/ui-matrix-2026-10-28-realgui/matrix-full-8gen.json`（入库）。截图不入库，
PASS/FAIL 成对留在 `.verify/ui-matrix/`；人工核对过的两帧为 `0.1.7-rc.1` 与 `0.2.0-rc.2`。

### 9.1 仍未判定（诚实的剩余部分）
`HTTP 401` 是正常输出（`instance.mjs` 把 200/401 都算服务已起，token 走 URL 参数），但它
意味着**鉴权后的真实用户路径**没有被逐请求核验；§7.5 列的界面分支（hover card 状态行、
进度条 CSS 相位、暂停/恢复视觉冻结、插话命令往返、`prefers-reduced-motion`、焦点与键盘导航、
en locale、侧栏收起/多工作区折叠）本轮**一条都没测**；设置卡 `loading→ready` 翻转路径仍未被
真 GUI 触发过（首帧即 ready），因此 §7 那条"运行时未复现"的定性不变。
