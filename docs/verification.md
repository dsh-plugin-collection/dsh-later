# 验证状态与验收对照

> 面向开发者/维护者的技术文档。测试、E2E 与跨代兼容的完整记录。

## 验证状态

### UI 面：跨代次截图矩阵（`npm run verify:ui`）

`verify:kernels` 证明"装配起来、到点发得出去"，`--steps type` 证明"能对着那一代的类型编译"；
**UI 面**是第三件事："画出来、点得动"，只能看。所以这里给的是**结构性判据 + 截图**：

| 每代三张 | 判据 |
|---|---|
| 作曲行 + 定时按钮 | `[class*=ss-sched-btn]` 存在（client bundle 在该代次加载成功） |
| 待发送 dock 行 | 发 `/later +30m …`（真实命令通道，不烧模型）后 `[class*=ss-dock-row]` 出现 |
| 面板展开 | 点按钮后 `[class*=ss-panel]` 出现 |

产物 `.verify/ui-matrix/{matrix.json,matrix.html,*.png}`（gitignore）。不设像素阈值 —— 跨代次的
字体渲染差异不该被当回归；截图是给人复核的。

**方法与历次结论**记在 [`notes/ui-matrix.md`](notes/ui-matrix.md)（含"每代拍什么/判什么"、
三处跨代次差异、以及 append-only 的结论表）；**进仓证据**在
[`media/ui-matrix/`](media/ui-matrix/)：一页拼图 `matrix.png` + 每代 `-dock.png` 缩略图 + `manifest.json`
（把"哪次运行、什么结论、哪个文件、文件 sha256"钉在一起）。

实例引导自包含在 `scripts/ui-matrix/instance.mjs`，处理了三处实测出来的跨代次差异：
`.bin/dsh` 可能是软链（npm 树）或 shell 脚本（pnpm 树，混用会 `SyntaxError`）；
模块回退层要的 `<dsh 包>/node_modules/package.json` 占位；`cordis.patch.yml` 里 **hmr 必须开启**
（0.1.2 的 `watchUserPatches()` 缺 hmr 服务会直接抛错）。隔离靠 `DSH_HOME`，**没有** unshare/容器 ——
插件若往 `DSH_HOME` 之外写，这里挡不住（dsh-later 已实测只写 DSH_HOME）。


### 跨代回归脚本的四个面（2026-10-26，issue #97 补齐后两个）

`npm run verify:kernels`（`scripts/verify-across-kernels.mjs`）是"某代次到底支不支持"的判决者，
所以它的口径本身要可复核。现在它分四个面，`--steps` 可选（默认 `mount,function`）：

| step | 面 | 判据 |
|---|---|---|
| `mount` | 装配 | 真内核冷启动、插件 `activated`、AgentRegistry 可用 |
| `function` | 功能 | `at` 五种文法经真实命令派发 + 到点投递的事件形状 |
| `type` | 类型 | 依赖线换成该代次后跑**两个** tsconfig（复用 `typecheck-all.mjs`，不短路） |
| `gate` | 门禁 | 该代次自己的 `evaluatePluginCompatibility` 判一遍 + 最新语义判一遍，两值进产物 |

三点口径（都是这轮实测出来的）：

1. **代次按 rc 粒度判**：`dsh@0.1.5-rc.1` 的内部依赖 `^0.1.5-rc.1` 会装出 `rc.3` 的兄弟包。
   脚本现在逐包 pin + 记录 `requested`/`resolved`，不一致即判「未判定（组合漂移）」。
2. **"跑现成 `lib/` 产物能挂上"不算支持**：类型面才是能拦住"旧内核没有该能力/符号改名"的那一面
   （`0.1.5` 19 条、`0.1.2` 宿主 2 条 + client 21 条）。
3. **越界自检覆盖 `sessions`/`storages`/`plugin-state` 与根级文件**：只扫 `sessions/` 会漏掉
   `plugin-state/` 的残留。


> ⚠️ **支持面调整（2026-10-26，issue #95 / PR #98 + #101）：内核下界为 `>=0.1.2-rc.1`。**
> 本文档下面记录的「0.1.1 / 0.1.2 / 0.1.5 已通过」是**当时的实测**，它们只证明了装配与功能面，
> 没证明**类型面**。把整条 `@deepseek-ai/dsh*` 依赖线换成目标代次后跑本仓 tsc，当时的结论是：
> `0.1.5-rc.1` 19 条红（图标改名 + props 形状）、`0.1.2-rc.1` 2 条红且 client 项目被 `&&` 短路没跑、
> `0.1.1-rc.2` 依赖在 registry 未发布**无法自证**。
>
> 据此先把下界收到 `0.1.7-rc.1`（PR #98），随后按同一份测量把能兼容的补回来（PR #101）：
> **`0.1.2-rc.1` 与 `0.1.5` 线（按 rc.3 验证）现在两个 tsconfig 都是 0 条错误**，且装配与到点投递在真内核上跑绿，已回到代次表；
> `0.1.1-rc.2` 仍不入表（依赖装不出，任何工具都给不出结论）。
> 补法见 `src/client/primitives-compat.ts`（图标/Tooltip/FileTypeIcon/fileSizeText）、
> `src/client/workspace-path-compat.ts`（fileMediaUrl）、`src/upstream-shims.ts`（宿主侧类型缺口），
> 以及 0.1.2 运行期把文件附件降级成文本的说明。
>
> 新的**入表标准 = 装配/功能 + 跨代类型编译两面都过**；表里**当时**六代
> （`0.1.2-rc.1` / `0.1.5-rc.3` / `0.1.7-rc.1` / `0.1.7-rc.2` / `0.2.0-rc.2` / `0.2.1-rc.2`）两面都已通过。
> （这句是 1.8.0 前后的记录，数量保留不改；**现状是 9 条**，逐代结论见下文「跨内核代次」各节与
> §0.2.2-alpha.2。）
> `0.1.5` 列 rc.3 而非 rc.1：rc.1 的默认安装会 caret 混装 rc.3 组件、装配即失败（与本插件无关），
> 用户实际拿到的就是统一 rc.3。


- **单元/集成测试（2026-11-02 复核，基线 `main@33c76b3`，取代此前的 183 与 620）**：
  **747 条 / 747 passed / 0 failed / 0 skipped**（`npm test`，71 个文件），
  `node scripts/typecheck-all.mjs` 两个 tsconfig 都通过，`npm run build` 幂等（重跑后 `lib/` 零脏改）。
  ⚠️ **同一份代码在隔离 worktree 里报的是 743 passed / 4 skipped**，这不是回归：那 4 条是
  `tests/peer-facet-integration.test.mjs` 的**真对端**用例，skip 条件是「逐级向上找不到
  `dsh-group-status` 仓」。主仓 `dsh-plugins/dsh-later` 旁边就放着那个仓 → 真跑；
  建在 `~/dsh-worktrees/<x>` 的 worktree 找不到 → skip。
  **报测试数请连带说明在哪棵树上跑的**（issue #103 的落点就是这句没写清楚）。
- **历史数量（保留原文，别当现状读）**：2026-09-28 复核 **183 个全绿**；2026-10-27 复核
  **620 条 / 613 passed / 0 failed / 7 skipped**（基线 `main@4ef6af5`，含 `SKILL.md` provider 那 30 条；
  那 7 条 skip 全在构建端到端用例，条件 `skip: !existsSync('<repo>/node_modules/esbuild')`，
  在没装依赖的 worktree 里跑会跳，CI 装齐依赖时会跑）。
  更早「typecheck 有预存依赖类型噪音」的记录已随 `0.1.7` 适配一并消除 —— 噪音的真实后果见下文
  「一个隐蔽的构建耦合」：**任何类型错误都会让 `build.mjs` 从 tsc 回退到 esbuild bundle**，
  而 bundle 会内联本地模块、产生双副本，进而改变运行时语义。故 typecheck 干净
  不只是代码整洁问题，**它是构建产物形态的前置条件**。
- **产物体积：注释不进 `lib/`、`lib/client.js` 按 UTF-8 写出（issue #145 A 面，2026-11-11 实测）**：
  `tsconfig.json` 的 `removeComments: true` 让 tsc 逐文件 emit 时丢掉注释（`lib/*.js` 与
  `lib/types/*.d.ts` 都受影响），`build.mjs` 的 client esbuild 步骤加 `charset: 'utf8'`，中文
  界面文案不再写成 `\uXXXX`。

  **两套口径**：基线取自合并点 `0be9b8d` 的已提交 `lib/`（`git ls-tree -r --name-only 0be9b8d lib/`
  列文件 + `git cat-file -s 0be9b8d:<path>` 逐个取字节数求和，可复跑）；改后取本树 `npm run build`
  之后的实测值。不把两者混成一列，也不引用 issue 审计正文里的数字（那是另一棵树上的测得）。

  改后那一列的取样树里 **`lib/*.js` 与 `lib/types/*.d.ts` 是 31 个文件**，即 client-only 模块尚未
  移出 host emit 的状态。两侧文件数相同，差值才归因于这两个选项；布局重排之后再测会再减少若干个
  文件，那部分不计入本表，应由布局那一步单独记账。

  | 产物 | 基线 = `0be9b8d` 的 `lib/` | 改后 = 本树实测 | 差 |
  |---|---|---|---|
  | `lib/*.js`（31 个文件，不含 `client.js`） | 489,782 B | 230,753 B | −259,029 B（−52.9%） |
  | `lib/types/*.d.ts`（31 个文件） | 233,092 B | 55,821 B | −177,271 B（−76.1%） |
  | `lib/client.js` | 237,314 B | 221,731 B | −15,583 B（−6.6%） |

  `lib/client.js` 里 `\uXXXX` 出现次数 **5177 → 3**（基线取 `git show 0be9b8d:lib/client.js` 计数，
  改后取本树产物），其中中日韩区间的 **5074 → 0**。剩下 3 处
  是同一个正则字面量 `/[\u0000-\u001f\u007f]/u`（`isAbsoluteWorkspacePath` 的路径校验）里的
  控制字符，属于 esbuild 文档写明的边界：它不处理正则字面量里的非 ASCII。控制字符在源码里
  本来就必须写成转义，与 `charset` 无关。

  `charset: 'utf8'` 的前提是**送出侧声明了 UTF-8**，这一条已在宿主侧取证：插件 bundle 经
  `dsh-client-modules` 的 `/plugins/<id>/client.js` 与 combo 各条响应送出，`content-type` 一律是
  `text/javascript; charset=utf-8`（`dsh-client-modules/lib/index.js` 的 `compose()` 与
  `chunkResponse()`），前端静态服务对 `.js` 也是同一串（`dsh-host-frontend-static/lib/index.js`
  的 `MIME` 表）。产物本身由 `writeFileSync` 以 UTF-8 落盘，两边一致。

  **`removeComments` 的代价与口径：线上排障读 `src/`，不靠 profile 里 `lib/` 的注释。**
  产物已经是逐文件 tsc 形态、模块边界看得见，方法名与结构也不变，缺的是注释；而注释的权威
  版本永远在 `src/`，两者按同一处 `src/**/*.ts` 对应，读 `src/` 拿到的只会更全。例外是
  `lib/types/*.d.ts` 面向第三方消费者的契约描述也一并被压掉，若后续要对外暴露这些类型，
  这个选项需要重新取舍（见 [`design-decisions.md`](design-decisions.md) §12）。
  **运行时依赖：`zod` 必须在 `peerDependencies`（issue #145 C 组，2026-11-11 实测）**

  **结论（本地实测）**：`src/projection.ts` 的 `import { z } from 'zod'` 是**值 import**，emit 后
  `lib/projection.js:28` 保留同一条 ESM import，文件里 `z.` 出现 47 次。而 `package.json` 原先没有
  `dependencies`，`peerDependencies` 里也没有 zod——它只写在 `devDependencies`。

  | 判据 | 实测 | 手段 |
  |---|---|---|
  | 缺 zod 时入口真的挂 | **成立**：`ERR_MODULE_NOT_FOUND: Cannot find package 'zod' imported from lib/projection.js` | 造一份摘掉 zod 的隔离 `node_modules`（其余包逐个软链回仓库），把真 `lib/` 放进去 `import()` |
  | 补回 zod 后同一次加载转绿 | 成立 | 同一隔离目录里补 `node_modules/zod` 后再 `import()` |
  | 谁在替它兜住 | 宿主 `@deepseek-ai/dsh-session-projection` 的 `dependencies` 里是 `zod: 4.4.3`；`~/.dsh/profiles/cc-tui` 与 `~/.dsh/profiles/web` 下都有 `node_modules/zod` | 读该包的 `package.json`；`ls` 两个 profile |
  | 迁移到 schemastery 是否可行 | **未评估**（没做）。审计点了 `.strict()` 的拒读语义与 optional 字段报错文案两处要先验，本轮没验，所以没迁 | — |

  修法取「写进 `peerDependencies`」而不是 `dependencies`：宿主 `ProjectionDefinition.stateSchema` 的
  类型就是 `ZodType`（`node_modules/@deepseek-ai/dsh-session-projection/lib/types/index.d.ts:20,42,62`），
  自带一份 zod 会引入两个实例的风险。`pnpm-lock.yaml` 不需要跟着改：本仓 lockfile 的 importer 段
  不记录 peers（`@deepseek-ai/dsh-agent` 等既有 peer 也不在里面），`pnpm install --frozen-lockfile`
  在只有 peers 变化时退出码 0，已实测。

  **判据**：`tests/runtime-dependency-declaration.test.mjs`。第一层对 `lib/` 做静态说明符扫描——
  每条裸包 import 都必须在 `dependencies`/`peerDependencies` 里（`devDependencies` 不算）；
  第二层是上面那条端到端反证；第三层钉住 zod 仍是值 import，免得判据前提悄悄消失。
  变异验证：把 zod 从 `peerDependencies` 拿回 `devDependencies` → 前两层各红一条。

  **这条判据自己踩过一次版本坑，记下来**：初版让「补回 zod 后再 import 一次」在**同一进程**里做，
  用 query string 区分模块身份。它在 node **24**（本机）上绿、在 CI 的 node **22** 上红。实测隔离
  （24.22.0 与 22.23.4 各跑一份探针）：先 import 一个依赖不存在的 `a.mjs`（`ERR_MODULE_NOT_FOUND`），
  装上依赖后再 import `a.mjs?q=2`——**node 24 仍报 `ERR_MODULE_NOT_FOUND`，node 22 返回 OK**。
  即 node 24 会把一次失败的解析按文件路径记住，此后换任何 query 都不再重新解析。
  所以初版在两个版本上验的都不是那句话本身。现改为 `spawnSync` 起**新进程**重试（新进程没有
  解析缓存），两个版本都是 4/4。

  **node 22 上的复核（2026-11-11，`npx -p node@22`，22.23.4）**：全量 `scripts/run-tests.mjs`
  **883 pass / 0 fail**，与 node 24 一致；两条门禁在 node 22 下的**变异路径**也验过——
  塞 `lib/zzz-orphan.js` → `check:lib-reach` 退出码 1 并点名该文件；删 `SKILL.md` →
  `check:release` 退出码 1 并报「包内缺 SKILL.md」。都不是静默放行。
  ⚠️ 前提说明：本仓 `.gitea/workflows/ci.yml` 迄今**一次都没被 Gitea Actions 执行过**
  （查过最近四个合并提交，commit status 全是 `pending` / 0 条），所以 CI 里的这两步目前
  只是「写进去了」，门禁的实际执行要靠本地复跑或 Actions 打通之后。

  **未做（明确留给发布面决策）**：审计给的另一个选项是迁到已在 peers 的
  `@deepseek-ai/schemastery`，那样能少一个 peer。迁移要先验 `.strict()` 拒读与 optional 报错文案
  两处语义，本轮没验就不迁——「没验就迁」会把一个确定性修复换成一个未验的行为变更。

- **独立实例线上 E2E（Playwright 无头真点 UI）**（**2026-09-08 的记录，不是现状态口径**；
  「≈计划 75s，实测 72s」是那一轮的单次观测，别当 SLA 读）：按钮渲染→开面板→自定义时间→确认→
  芯片出现→任务列表可见→到期真触发→对话出现 `user/message`。
  ⚠️ 那句里的 `source=plugin:later` **已随 issue #75 过时**：`kind:'plugin'` 从 `0.1.7-rc.1` 起被
  v4 准入拒绝，注入消息一律用 `kind:'schedule'`，更早的代次才是 `plugin` —— 判定在
  `src/schedule-compat.ts`，逐代结论见下文「已解决（2026-10-23，issue #75）」。
  要拿当前的端到端证据，跑 `npm run verify:kernels`（装配 + 真投递事件形状）与
  `npm run verify:ui`（真 GUI），这两条命令的产物才是活的。
- **内核代次兼容（2026-09-07 实测）**：`0.1.1-rc.2` 与 `0.1.2-rc.1` 两代均通过 host 入口链接（运行时符号 17/17 存在）、headless 真实启动（停在 `MISSING_CREDENTIAL`，在插件加载之后）与 web 真实启动（`lib/client.js` HTTP 200）。跨代做法有三处：
  1. **peer 枚举完整覆盖**：除了 `dsh-schedule / dsh-session / dsh-session-projection`，把宿主直接 import 的 `@deepseek-ai/{cordis,dsh-agent,dsh-commands,dsh-llm,dsh-settings,dsh-tools,schemastery}` 全部列入 peer + dev——`0.1.1-rc.2` 经 `dsh-schedule` 传递提升到顶层 `node_modules/@deepseek-ai/` 时这些包是可达的；`0.1.2-rc.1` 的 hoisting 策略变化把它们留在 `.pnpm/`，**未声明 peer 的会运行时报 `ERR_MODULE_NOT_FOUND`**（已实测 `lib/runtime.js` import `@deepseek-ai/dsh-llm` 在 0.1.2 直接崩）。
  2. **设置命名空间**写作 `'dsh-later' as SettingsNamespace`（`settingsNamespace()` helper 在 `0.1.2` 已删除，运行时导入会让整个模块链接失败）。
  3. **设置卡片所需的 `SettingsScope`** 在 `src/client/components/SchedulerSettingsCard.tsx` 内本地声明，不从 `@deepseek-ai/dsh-client-runtime/client` 取类型——该包是 `0.1.1` 内核特有，`0.1.2` 已拆走，且同名 `SettingsScope` 在 host（`dsh-settings`）与 client 两侧成员并不相同。peer 为逐代枚举 `^0.1.1-rc.2 || ^0.1.2-rc.1`（node-semver 不把预发布版算进任何范围，除非比较符带同一 `[major.minor.patch]` 元组，故无跨代区间写法）：**上游每发布新 rc 代次就要补一个枚举项**。
- **Session API 跨代**：探测与 peer 矩阵已收敛到 `src/upstream-compat.ts`（2026-09-17）。
  - `readOwnEvents` / `readInheritedEventCount`：`0.1.1` = `.events` + `header.seedLength`；
    `0.1.2` = `ownEvents()` + `inheritedEventCount`。`foldUserState` 只调这两处。
  - `KERNEL_GENERATIONS` 是 peer 代次的唯一事实来源；改完跑
    `node scripts/sync-peer-matrix.mjs` 重写 package.json，再 `npm test`。
  - 护栏：`tests/upstream-compat.test.mjs`（两代形状一致 + peer/dev 同步 + seedLength 回归）。
- **插话投递改动的跨代核对（2026-09-28，静态比对 4 代产物）**：新增的投递/确认路径逐项确认
  在其声明支持的两代内可用，并额外核对到**尚未声明**的更新代次。
  - 方法：从 npm 拉取 `0.1.1-rc.2 / 0.1.2-rc.1 / 0.1.5-rc.3 / 0.1.7-rc.2` 四代 tarball 解包比对
    （而非只跑本地 devDependency 的单一版本——本地只有 `0.1.2-rc.1`）。
  - 结论：改动依赖的 4 个 API 在**四代全部存在且契约一致**：
    `agent.followup` / `agent.steer`（四代 doc comment 逐字相同）、
    `sessions.flush(session)`、`createUserMessage` / `boundContextSummary`。
    Session 形状仍是两轨：`0.1.1-rc.2` 为 `.events`+`seedLength`，`≥0.1.2-rc.1` 为
    `ownEvents()`+`inheritedEventCount` —— 与 `KERNEL_GENERATIONS` 的二元模型吻合，
    **无需新增代次**。
  - 送达确认走 `readOwnEvents` 兼容层（非直接读 `session.events`）；已加护栏
    `tests/delivery.test.mjs` 的三个形状用例，并反向验证：把 `readOwnEvents` 换回
    直接读 `.events` 后，`0.1.2+` 用例立即失败。
  - 设置枚举用 `s.union([s.const(...)])`，`schemastery@3.18.2` 具备该 API；实测非法值
    **抛错而非静默回落**，故 `getSettings` 的 `try/catch`（回落 `startSettings`）+
    逐字段精确比对（只认 `'steer'`/`'discard'`）是必要的双重保险。
  - ⚠️ **peer 代次缺口已实测定位（2026-09-28）**：peer 枚举只到 `^0.1.2-rc.1`，实际运行的
    宿主已是 `0.1.5-rc.3`。为决定「补哪些代次」做了实测：

    | 代次 | host 入口链接 | 结论 |
    |---|---|---|
    | `0.1.5-rc.1` / `rc.2` / `rc.3` | 15/15 模块导入通过 | ✅ **可补** |
    | `0.1.7-rc.1` | 导出仍含 `allocateScheduleId` | ⚠️ **「可补」只对了一半**（2026-10-23 复核）：
      这一面确实兼容，但**消息 `source.kind:'plugin'` 在这一代已被淘汰**，当时没核对那一面 ⇒ 提醒到点
      100% 不投递。详见「已解决（2026-10-23，issue #75）」一节 |
    | `0.1.7-rc.2` | 起初 11/15 失败 | ✅ **已适配并落地验证**（见下节） |

    方法：在隔离目录按代次 `npm install` 内核作用域包（`--ignore-scripts`，各代 9 个包 +
    cordis），把 `lib/` 拷入后逐个 `import()` 全部 15 个 host 模块。

  - **`0.1.7-rc.2` 适配已完成（2026-09-28 实测通过）**。
    此前结论是「破坏性、不可补、需单独适配工作」——适配现已完成，全部差异收敛到新模块
    **`src/schedule-compat.ts`**，调用点无版本分支。

    **差异清单与处置**（全部读实现确认，非猜测）：

    | 变更 | 性质 | 处置 |
    |---|---|---|
    | `allocateScheduleId` 导出被删（5 处调用） | 行为变更 | `ScheduleId("schedule-${randomUUID()}")` —— 与官方 `ScheduleService.create` 的内联实现一致；旧实现是确定性递增，新的是 UUID |
    | `renderEveryReminderBatchFraming` → `renderRecurringReminderBatchFraming` | 纯改名 | namespace 属性访问，按存在性择一 |
    | `createAfter/At/EveryScheduleRecord` 新增必填 `title` | 新增参数 | 按函数 `arity >= 5` 择一；`title` 由 `deriveScheduleTitle` 从 prompt 派生 |
    | `MessageSourceMap` 删除 `plugin` / `host` kind | 枚举收紧 | 0.1.7 新增 `kind:'schedule'`（官方 `dsh-schedule` 注入提醒用的正是它） |
    | `ScheduleRecord` 联合 3→6 变体（+daily/weekly/cron） | 类型变宽 | `StoredScheduleRecord` 显式列举 after/at/every；**`Extract` 在此 tsc 配置下不收窄** |
    | `ScheduleDeliveryMode` `'session-local'` → `'host'` | 值变更 | wire 契约归一到稳定值，不让内核改名传导到客户端 |
    | `agent/created` 回调改为异步串行 | 签名变更 | 回调显式 `async` |
    | `SettingsProvider.register` → `SettingsForms`（无 `register`） | **架构级** | 代次门控：探测不到 `register` 就保持 `startSettings`（profile yml 的 `base`）。**0.1.7 下设置页不可用**，见遗留项 |

    **踩到的关键坑**：最初用 `import { renderEveryReminderBatchFraming as X } from '…'`
    + `as unknown as` 兜底，这在 0.1.7 上直接
    `SyntaxError: does not provide an export named` —— **ESM 具名 import 是链接期硬失败，
    类型断言救不了**。改用 `import * as sched` + 属性访问才真正双代次兼容。
    这个坑不真跑 0.1.7 发现不了。

    **`title` 截断有数据支撑**：真实存量 979 条记录中，最长 prompt 575 字符，
    **22 条超过 0.1.7 的 120 上限**。故 `deriveScheduleTitle` 必须截断（按词边界优先），
    直接透传会在编辑这些记录时抛 `invalid_prompt`。

  - **`0.1.7` 存量数据兼容：零损坏（2026-09-28 离线实测）**

    用 0.1.7-rc.2 的真实解码器读 `~/.dsh/sessions` 的全部历史日志：

    | 指标 | 结果 |
    |---|---|
    | 扫描会话日志 | 1211 个 |
    | `schedule/change` 事件 | **979 条** |
    | 解码通过 | **979（100%）** |
    | 整份日志 `foldScheduleEvents` | 180/180 文件通过 |
    | 无法读取的日志文件 | 0 |

    ⚠️ **修正一处此前的误判**：曾记录「缺失 `title` 的存量记录会被 `decodeStoredTitle`
    判损坏并整份拒读」。**这是错的。** 0.1.7 实际实现了双轨解码：

    | 函数 | 用途 | 对 `title` |
    |---|---|---|
    | `decodeHistoricalRecordTitle` | 读 `schedule/change` **事件** | **可选**，缺失合法 |
    | `decodeRecordTitle` | Host 内部持久化记录 | 必填 |

    反向验证确认只有「**有 key 但值非法**」才拒（空串 / 未 trim / >121）；
    「**缺失 key**」是合法的历史形态。

    **结论：升级到 0.1.7 不需要任何存量数据迁移。**

  - **`0.1.7-rc.2` 真实宿主端到端验证（2026-09-28 实测通过）**

    此前所有验证都基于「用 0.1.7 的包」，未过真实宿主。本次补齐：

    - **隔离环境**：独立 `DSH_HOME` + 独立安装目录
      （`@deepseek-ai/dsh@0.1.7-rc.2`，291 个包），全程不触碰运行中的 `0.1.5-rc.3` 宿主。
    - **profile 装载**：`dsh plugin --profile <name> add file:…` 成功；
      插件被**自动登记为 bundle**（`dsh.bundle.patch` 检测生效），组合进配置树（行 id `later`）。
    - **host 模块确实被求值**：临时往 `lib/index.js` 插入加载标记，0.1.7 启动日志打出该标记
      → 证明不是「静默跳过」。已还原。
    - **client 模块被宿主正确服务**：从 `index.html` 的插件清单可解析到
      `dsh-later/client.js`，拉取 HTTP 200（468KB 合并包内可定位到 dsh-later 模块块）。
    - **工具级端到端**（真实模型驱动）：
      - `user_schedule_create` → `{"ok":true,"id":"schedule-0639dcca-…","kind":"after",…}`
        —— **UUID 格式 id 确认生效**
      - sidecar 落盘：`{"schedule-0639dcca-…":{"delivery":"context","uid":"…","windowSeconds":600}}`
      - `user_schedule_list` **读回同一条**，id/kind/state 一致
    - **最终状态**：0 类型错误，`npm test` **183 通过 / 0 失败**，全部基于 0.1.7 依赖。

  - **测试污染真实状态目录（2026-09-28 已修）**

    排查中发现 `~/.dsh/plugin-state/later/` 累积了测试产物：

    - **根因**：`tests/helpers/ownership-state.mjs` 要求「在导入 lib **之前**调用
      `freshOwnershipDir()`」，但 ESM import 会被提升——该约束在语法上无法满足。
      15 个测试里有 11 个实际写进真实用户目录（13 个 `session-test-*.json`
      + `session-delete-case` / `session-edit-case` / `x.json`），并让断言因残留状态
      互相干扰（P0-1 两条单独跑通过、整文件跑失败）。
    - **处置**：helper 改为**导入即隔离**（模块求值时自动指向一次性临时目录），结构上杜绝；
      清理 16 个脏文件，保留真实的 v1 格式旧会话残留。跑测试后生产目录零写入。
    - **顺带修复一个真实 bug**：`resolveStateDir()` / `legacyStateDir()` 里写成
      `process.env['DSH_LATER_STATE_DIR'] ?? process.env['DSH_LATER_STATE_DIR']`
      —— **同一变量自比较**，旧名 `DSH_SESSION_SCHEDULER_STATE_DIR` 的回退从未生效；
      且因「有 override」，`legacyStateDir()` 直接返回 `undefined`，
      **改名迁移也不会发生**。已抽成 `stateDirOverride()` 统一处理两个名字。

  - **一个隐蔽的构建耦合（值得记住）**

    `build.mjs` 先跑 `tsc`，**tsc 因任何类型错误失败时才回退到 esbuild `bundle: true`**，
    而 bundle 模式会把本地 import **内联**：

    ```
    lib/ownership-store.js     ← 真正的模块
    lib/user-tools.js:202      ← 被内联了一份自己的 recordOwnership
    lib/index.js               ← 同样内联
    ```

    两份副本各有独立的 `cachedDir` 与内存缓存，`freshOwnershipDir()` 只重置了前者的缓存。
    于是：**`0.1.7` 的那个 `SettingsForms.register` 类型错误，经由
    「tsc 失败 → esbuild bundle → 模块双副本」，最终表现为 14 个测试失败。**

    修掉该类型错误后构建回到 tsc 路径（`lib/user-tools.js` 恢复为
    `import … from './ownership-store.js'`），14 个失败**同时消失**。

    教训：**类型错误不只是类型错误** —— 它会静默改变构建产物形态，进而改变运行时语义。

  - **`0.1.5-rc.1` 的落地验证（2026-09-28 实测）**：
    - 隔离目录安装内核作用域包（各代 9 包 + cordis，`--ignore-scripts`）后，
      **host 入口链接**：15/15 模块 `import()` 通过。
    - **运行时实例化**（不止 import —— 捕捉「导入 OK 但 `apply()` 崩」）：以最小假 ctx
      调 `apply()` 成功，注册顺序为
      `inject[sessionProjections] → inject[settings] → effect×2 → on(agent/created)`。
    - **对照 `0.1.2-rc.1`**（原有代次）：同样 15/15 + `apply()` 成功，注册顺序**逐项相同**
      —— 未因本次改动产生代次间行为分叉。
    - 运行的宿主 `0.1.5-rc.3` 现已满足新声明的 peer 范围（`semver.satisfies` 默认语义下
      亦为 true，不再依赖 `includePrerelease`）。
  - **本地开发代次已对齐到 `0.1.7-rc.2`（2026-09-28 更新）**：
    原先固定 `0.1.5-rc.1`；`0.1.7` 适配完成后同步推进到 `0.1.7-rc.2`，使本地与目标运行时一致。
    以下为推进到 `0.1.5-rc.1` 时的处置记录（方法仍适用）：
    - 起因：devDependencies 原先写的是**完整 peer 范围串**，npm/pnpm 因此解析到
      「满足范围的最老可用版本」= `0.1.2-rc.1`，而真实运行时是 `0.1.5-rc.3` ——
      **测试环境落后运行环境整整一代**，API 漂移在本地无从暴露（peer 缺口正是这样漏掉的）。
    - 处置：`devDependencies` 改为**固定到最新已验证代次** `0.1.5-rc.1`（全部
      kernel-scoped 包同代次，避免类型面自相矛盾）；`peerDependencies` 仍为完整范围串。
    - `scripts/sync-peer-matrix.mjs` 同步改造：peer 写范围、dev 写固定代次；且**只在该
      字段已是范围串或缺失时**才改写 dev，避免把有意固定的版本冲掉（幂等）。
    - 结果：`npm run typecheck` **通过且无新增错误**（0.1.2 → 0.1.5 的类型面兼容），
      `npm test` **183 通过 / 0 失败**（新增 2 条 dev 固定性守卫）。
    - 新增守卫（`tests/upstream-compat.test.mjs`）：dev 必须是**具体代次**而非范围串、
      必须落在已验证列表内、全部包同代次、且等于最新已验证代次；另有一条显式登记
      「当前 dev 代次」的断言，使代次变更在 diff 中可见而非被 install 悄悄改掉。
      反向验证两种情形均被挡下：dev 回退成范围串、dev 固定到未验证的 `0.1.7-rc.2`。
  - **代次守卫改为数据驱动**（原先硬编码「两代」，每加一代都要改测试）。
    现断言结构不变量：首代 legacy、其余 own-events、`peerRange` 下界必须**恰为该代次
    本身**（逐代留痕，不借用更早下界）、代次表严格递增。并附 `verGt` / `caretCovers`
    的自测，防止守卫自身失效。
    反向验证：把 `0.1.5-rc.1` 的范围偷写成 `^0.1.2-rc.1`，守卫立即失败。

- **`0.2.0` 兼容核对（2026-10-08 实测通过）**
  - **现象**：插件在 DSH `0.2.0-rc.2` 上**完全不加载**（无按钮、无命令、无工具）。
    宿主日志：`skipping profile bundle "dsh-later": Plugin dsh-later@1.0.0 is
    incompatible with dsh 0.2.0-rc.2 …`。
  - **根因（不是代码失效，是 peer 声明缺口）**：内核自 0.2.0 起把 peer 校验
    **从警告升级为硬门槛**（`dsh-app-boot` 的 `evaluatePluginCompatibility`）——
    peer 范围不满足即**整插件跳过**，而非此前的「打印警告后照常加载」。
    本插件 peer 枚举止于 `^0.1.7-rc.2`，`0.2.0-rc.2` 对全部 8 个 kernel-scoped 包
    均不满足（预发布版必须显式枚举，`^0.1.7-rc.2` 不覆盖 `0.2.0-rc.2`），故被挡下。
  - **API 面逐项核对（结论：全部保持，无需改动任何业务代码）**
    | 依赖面 | `0.2.0-rc.2` 实测 |
    |---|---|
    | Session 形状 | `ownEvents()` + `inheritedEventCount` **未变** → `readOwnEvents` / `readInheritedEventCount` 原样可用 |
    | `dsh-schedule` 导出 | `foldScheduleEvents` / `renderReminderFraming` / `resolveEveryOccurrence` / `decodeScheduleChange` / `scheduleView` / `ScheduleId` **均在**；`renderRecurringReminderBatchFraming` **仍在**，`schedule-compat.ts` 的三处桥接照旧命中 0.1.7 分支 |
    | `dsh-llm` | `createUserMessage` / `boundContextSummary` 在；`MessageSourceMap` 已无 `plugin` kind，仅剩 user/model/tool/system-prompt，而 `schedule` kind 由 `dsh-schedule` 经 module augmentation 并入 → `scheduleMessageSource()` 的存在性探测继续走 `schedule` |
    | `dsh-agent` | `followup()`（next-turn）与 `steer()`（next-step）**语义未变** |
    | `dsh-tools` | `defineTool` 在 |
  - **实证**：把 devDependencies 固定到 `0.2.0-rc.2` 后，
    ① `tsc -p tsconfig.json --noEmit`（host）**0 错误**；
    ② `tsc -p tsconfig.client.json --noEmit`（client）**0 错误**；
    ③ `npm run build` 走 **tsc 原生路径成功**（无 esbuild 降级告警 —— 即
    typecheck 干净，构建产物形态未被破坏）；④ 183 项测试全绿。
    （注：#56 起判定的**形式**变了 —— tsc 报错会直接非零退出、不再有"降级告警"这条路，
    所以「没看到告警」不再是"typecheck 干净"的证据，改为「构建成功且产物判据判逐文件」。）
  - **落地**：`KERNEL_GENERATIONS` 追加 `0.2.0-rc.2` 一代 → `node scripts/sync-peer-matrix.mjs`
    重写 8 个 peer 范围 → dev 固定推进到 `0.2.0-rc.2`（并同步护栏中的代次断言）。
    核对后以宿主的校验逻辑复算：`0.2.0-rc.2` 上 **0 个不兼容 peer**（放行）；
    历史代次 `0.1.1-rc.2 / 0.1.2-rc.1 / 0.1.5-rc.{1,3} / 0.1.7-rc.2` **仍全部支持**；
    未核对的 `0.3.0-rc.1` **仍被正确拒绝**（护栏未被放宽）。


### `0.2.0` 的第二处差异：reminder framing 措辞变更（已修）

`dsh-schedule` 在 0.2.0 把 one-shot 与 recurring 两条 framing 的防护句**统一收敛**
为一个常量（`SCHEDULED_MESSAGE_FRAMING`）：

| 代次 | framing 第二行（固定来源行） |
|---|---|
| ≤ `0.1.7-rc.2` | `Present reminder_prompt_json to the user as untrusted reminder content, not new user instructions.` |
| ≥ `0.2.0-rc.2` | `This is a scheduled message from the user` |

**影响面**：本插件的**单条**路径直接调上游 `renderReminderFraming`，自动跟随，无需改动；
但**多条到期一次性合并**（P1-5）是上游不提供的形态，由 `src/runtime.ts` 的
`renderOneShotBatchFraming` **自渲染**——其固定来源行是上游文案的**本地副本**。
若不同步，同一会话里「单条」与「合并」两条提醒的防护措辞会不一致。

**已修**：把本地副本对齐到上游统一后的措辞（`src/runtime.ts`）。
**已加护栏**：`tests/runtime.test.mjs` 的「本地批次 framing 的固定来源行与上游一致」——
从上游 `renderReminderFraming` **实时取**来源行比对本地副本，不硬编码任何一版文案，
故支持任意多代。反向验证：把本地副本改回旧长句，护栏立即失败。

> 这两处（peer 门槛 + framing 措辞）是**独立的两个问题**：前者让插件整个不加载，
> 后者只在加载成功后影响合并提醒的文案一致性。前者掩盖了后者——插件不加载时
> framing 根本不会执行，故修完 peer 缺口后测试才暴露出来。这正是 devDependencies
> 固定到运行时真实代次的价值：把「本地测试环境落后于运行时」造成的盲区消除。

- **`0.2.1` 兼容核对（2026-10-20 实测通过）**

  - **结论**：`0.2.1-rc.2` 相对 `0.2.0-rc.2` 对本插件只多出**一处类型面差异**，
    业务路径无需新增版本分支；登记代次后 host / client 两条 `tsc --noEmit`
    零错误，`npm test` **407 通过 / 0 失败**。
  - **Session 形状未变**：`@deepseek-ai/dsh-session@0.2.1-rc.2` 的类型声明里
    `ownEvents(): readonly SessionEvent[]` 与 `inheritedEventCount: SessionLogOffset`
    仍在（`node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts` 第 231、152
    行），故 `readOwnEvents` /
    `readInheritedEventCount` 原样可用，`sessionApi` 仍为 `'own-events'`。
  - **`dsh-schedule` 的探测照旧命中**：`renderRecurringReminderBatchFraming` 仍在导出；
    `scheduleMessageSource()` 在这一代同样返回 `kind:'schedule'`——但依据已从「该符号是否存在」
    换成**内核版本号**（issue #75：0.1.7-rc.1 上「符号还在、kind 已死」，存在性探测会选错），
    两种口径在 0.2.1 上结论一致；
    `createAfterScheduleRecord` 的 arity 仍为 5（`title` 照旧由 `deriveScheduleTitle`
    提供）；`foldScheduleEvents` / `renderReminderFraming` / `resolveEveryOccurrence` /
    `decodeScheduleChange` / `scheduleView` / `ScheduleId` 逐个 `import()` 实测均在。
  - **唯一的真实差异：`ScheduleInputError` 多一个码**。0.2.1 给输入错误闭包加了
    `subagent_session`（目标 Session 属于委派子代理，投递永远到不了，故其 `create`
    拒绝、`update` 返回非变更结果）。本插件的写路径**不经过** `ScheduleService`
    （自己 append `schedule/change` 再 fold），因此不会真收到该码；但
    `toInputError` 是上游闭包的直通翻译器，本地联合不补就编译不过（升级依赖时
    `tsc` 已如实报出 `TS2322`）。处置：`UserScheduleErrorCode` 补入该码并注明来源，
    另加一条运行期护栏，构造 `ScheduleInputError('subagent_session', …)` 经翻译后
    **码原样透出**，不降级成 `internal_error`。
  - **落地**：`KERNEL_GENERATIONS` 追加 `0.2.1-rc.2`（`peerRange: '^0.2.1-rc.2'`，
    `sessionApi: 'own-events'`）→ `node scripts/sync-peer-matrix.mjs` 重写 8 个 peer
    范围 → devDependencies 里 9 个 `@deepseek-ai/*` 精确版本推进到 `0.2.1-rc.2`
    （含只出现在 dev 的 `dsh-client-ui-primitives`；`cordis` / `schemastery` 不动）
    → `pnpm-lock.yaml` 同步刷新。
  - **证据**：`tsc -p tsconfig.json --noEmit` 0 错误；`tsc -p tsconfig.client.json
    --noEmit` 0 错误；`npm test` 407 通过 / 0 失败（基线 406，新增 1 条错误码护栏）。
  - **变异验证**：从 `KERNEL_GENERATIONS` 删掉 `0.2.1-rc.2` 并重建 `lib/` 后，
    `peerDependencies 与 KERNEL_GENERATIONS 完整范围一致` 与
    `devDependencies 固定到某个已验证代次（不与 peer 范围混同）` 双双变红
    （407 → 405 通过 / 2 失败）；还原后回到 407 全绿。护栏确实绑在代次表上，
    不是被 package.json 里的常量蒙混过关。
  - **未覆盖**：本次没有在真实宿主里加载 0.2.1 内核（只做依赖面、类型面与单测冒烟）；
    `engines.dsh` 的既有区间已覆盖 0.2.1（`>=0.2.0-rc.2 <0.3.0-0`），未改动。
  - **合并后复核（2026-10-20，main 合入 #63–#66 之后）**：在 0.2.1-rc.2 的**真实** devDependency 下
    重跑 —— `pnpm install --frozen-lockfile` 通过且**不改写** `pnpm-lock.yaml`；
    host / client 两条 `tsc --noEmit` 零错误；`npm test` **443 通过 / 0 失败**
    （基线 406 + #55 的 1 + #54 的 2 + #56 的 18 + #57 的 16）；`npm run build` 后 `lib/` 与源码
    同步（`git status` 零脏改），产物仍是逐文件 tsc 形态。
    这也补上了 #54 交接里"0.2.1 内核下的最终 typecheck 未验"那一项 —— 该错误码是在真实 0.2.1
    类型面下编译通过的，不是在 0.2.0 上"看起来没问题"。

### 0.2.2-alpha.2：投影注册契约变更（issue #118）

这一代对本插件是**两条契约变更**：一条在类型层"静默失效"，一条在运行时要求 await 时序。
装配面本身没坏（见下面的对照组），所以改法的形状不是"修一个炸掉的 bug"。

代次表因此从 **8 条变 9 条**。本文档上面各处写的「六代」是 **1.8.0 那轮基线实际跑过的数量**，
属于历史记录，不随本轮改写；本节给的是这一代的新数字。

| 变更 | `0.2.2-alpha.2` 的形状 | 本仓落点 |
|---|---|---|
| `SessionProjectionStateMap` 移除 | 类型包里已无该接口（`grep -c SessionProjectionStateMap lib/types/*.d.ts` 两个文件都是 0）；状态类型改由单元自身的 `stateSchema` 泛型承载 | `src/domain.ts`（删掉死的 `declare module` StateMap 块，**保留**同块里的 `SessionProjectionMap`）、`src/upstream-compat.ts` 的代次注释 |
| `register()` 返回 `Promise<ProjectionHandle<S>>` | 附一条时序要求 *Callers must await registration before publishing consumers*；handle 提供 `stateOf` / `readerFor` / `dispose` | `src/projection-registration.ts`（唯一的跨代收敛点，含 `as never` 边界转换）+ `src/index.ts`（注册包进 async `ctx.effect`） |

**先别把它读成"修编译错误"。** 类型包里 `SessionProjectionStateMap` 确实被删了，但 TypeScript 的
module augmentation 允许**新增**一个不存在的 interface，所以 `tsc` 不报错 —— 它是**静默无效**
（一段没人读的死声明），而不是编译失败。静默无效比报错更危险，这也正是 issue 前提里
"类型层破坏 tsc"一条实测不成立的原因。

**`register()` 的返回形状是"可调用 + thenable"，而且**两代都是**。** `0.2.2-alpha.2` 的实现返回
`Object.assign(dispose, { then, catch, finally, [Symbol.toStringTag]: 'Promise' })`
（`~/dsh-versions/0.2.2-alpha.2/node_modules/@deepseek-ai/dsh-session-projection/lib/index.js:80-109`），
即**不 await 也照样 `typeof === 'function'`**。老代次也不是裸函数：`0.2.1-rc.4` 的 `register()`
直接 `return this.ctx.effect(...)`（`…/dsh-session-projection/lib/index.js:68`），而 cordis 的 effect
返回带 `.then` 的 AsyncDisposable（`cordis/lib/index.js:1239/1274`）。所以收敛点必须**两步判**：

1. **thenable 优先** —— 先看 `typeof value?.then === 'function'` 并 `await`。先判函数会静默走
   老分支、跳过 await 且**不报错**（上游同时把 callable 形态标了 deprecated，方向一致）。
2. **按 await 的解析值分岔** —— 两代是"同一种形状、两种解析值"，这一步不能省：

| 代次 | `typeof`（await 前） | thenable | **await 解析值** | 正确处置 |
|---|---|---|---|---|
| ≤0.2.1（代次表里其余 8 条） | `function` | 是 | **函数**（disposer 本身），`.dispose` 为 `undefined` | 当老代次 disposer 用 |
| `0.2.2-alpha.2` | `function` | 是 | **对象** `{dispose, stateOf, readerFor}` | 用 `handle.dispose()` |

只写第一步（"thenable 就当 handle"）会在**全部老代次**上静默回归：解析出的函数被当成"缺 dispose
的 handle"，于是每次加载 warn 一次、且**注册永不被释放**（泄漏一个 registration）。这个错在装配面
看不出来，只有 `tests/projection-registration.test.mjs` 里"thenable 解析为函数（rc.2/rc.4 真实形状）"
那条能判红 —— 变异验证：把实现换成"只判 thenable、不判解析值"后，9 条里只红这一条。

**`stateOf` 已 `@deprecated`。** 这一代起 `registry.stateOf(session, key)` 每个 key 首次读会 warn 一次，
推荐改用 awaited registration 的 `handle.stateOf(session)`（或所属领域服务）；本插件没有直接调用
（`grep stateOf src/` 无命中），知悉即可。

**`wire.summary` / `SessionProjectionSummaryExcluded<T>` 本次不采纳。** 佐证不是"它是可选参数所以不做"：
这一代的擦除层在 `wire.summary !== false` 时**默认按 true** 落进 registration
（`lib/index.js` 的 `acquire()`：`summary: wire.summary !== false`），也就是本插件现状（根本不声明
`summary`）在该代已经是"参与摘要"的语义，运行时行为不变。而把 map 条目包成
`SessionProjectionSummaryExcluded<T>` 会让其余老代次的跨代 tsc 报"找不到名字"（类型层没有
"某代次没有就退化成 T"的写法，除非在 `upstream-shims.ts` 里造条件类型），而运行时 `summary:false`
又会被老代次当未知字段忽略 —— 两边语义不对等。这是一个有意识的"不做"，记在这里免得后人以为漏了。

#### 对照组：只放开声明面就 GREEN（2026-10-30 实测）

只把 `engines.dsh` 与 8 个 kernel-scoped peer **临时**各加一条 `>=0.2.2-alpha.2 <0.2.3-0`，
**不改任何代码**，同一个脚本立刻变成：

```
### 0.2.2-alpha.2 … GREEN
    内核=0.2.2-alpha.2 · 同源=same · 投递 spliced=1 dispatch=Y · at 形状 5/5 · gate 本代=pass 最新=pass
```

（合并前的对照组在 `/tmp/repro-118c` 跑过、package.json 已还原。那是一次性临时目录，复查不要
指望它还在 —— 用本节的复跑命令重新生成 `.verify/` 产物。）结论要这么读：

- 本 issue 在装配/投递面上**不是"坏了"，而是"被门禁关在门外"** —— 真正的阻断只有声明面
  （`engines.dsh` 上界原为 `<0.2.2-0`，按 semver §11 排除 `alpha.2`；0.2.1 起内核**单独按
  `engines` 判定**，peer 不再兜底）；
- 因此 `register()` 的 await 改动是**契约对齐**，不是"修一个已经炸掉的 bug"；
- 而且**不 await 在这一代上实测也没有可观测差异**：注册表写入发生在 `acquire()` 的**同步段**
  （`dsh-session-projection/lib/index.js:127-151`，由 `ctx.effect` 同步执行），唯一的 `await` 在
  :153，其后只剩 `fiber.assertActive()` 与 handle 构造；消费者读面（`summaryKeys()` /
  `snapshot()`）全是同步读注册表，注册过程中**没有任何"发布消费方"点**。同 turn 探针实测：
  `register()` 返回后立刻 `summaryKeys()` 就已包含 `userSchedules`；端到端连「只改 engines、
  lib 仍是不 await 的 HEAD 代码」也是 mount+function GREEN、投递 5/5、首读即见。
- 所以本文档与 CHANGELOG、PR 描述里**都不许**写"不 await 会读不到投影 / 会掉 dock" —— 那是
  虚假因果，一句"你复现了吗"就能打穿。这条改动真正的价值是：照上游契约做（callable 形态已
  deprecated），上门取掉兜底时不被动；`tests/projection-registration.test.mjs` 钉住的是
  **"我们真的在 await"** 这个实现事实，而不是"修了一个可观测 bug"。

#### 实测结论

2026-10-30 测，插件基线 `ffb322d`，由 verify-kernels 在 `verify/118-integration` 上跑。原始产物：
`.verify/task4-full/across-kernels-2026-10-30T09-34-49-655Z.json`（9 代次全量）与
`.verify/task4-alpha2/across-kernels-2026-10-30T09-36-09-882Z.json`（`0.2.2-alpha.2` 单独一轮）。
两者都在 gitignore 的 `.verify/` 下，**不存在于仓库**，复查请用本节末尾的命令重新生成。

| 面 | 结论 |
|---|---|
| mount + function（9 代次，各自独立进程） | **9/9 GREEN**；`同源=same` 9/9、`投递 spliced=1 dispatch=Y`、`at 形状 5/5`；总退出码 **0**（单代 17–19s，9 代共 161s，全程 `--no-install`） |
| type（9 代次，两个 tsconfig） | **9/9 绿、0 错误** |
| gate（该代自己的 `evaluatePluginCompatibility`） | 7 代 **pass**；`0.1.2-rc.1` / `0.1.5-rc.3` 是**结构性未判定** —— 那两代的 `dsh-app-boot` 根本不导出该函数，**不是**插件被判过，不许记成绿 |
| gate（最新语义） | **9/9 pass** |
| UI（真 GUI，官方入口 `npm run verify:ui -- --versions 0.2.2-alpha.2`） | 按钮=Y · dock=1 · 面板=Y · badge=1 · 错误=0 · 警告=0，exit **0**；`0.2.2-alpha.2` 单独一轮同样 exit 0、GREEN。截图入库：[`docs/media/ui-matrix-2026-10-30-realgui/`](./media/ui-matrix-2026-10-30-realgui/README.md) |
| 投影物化探针（本 issue 要求的判据，见 §1.0） | `summaryKeys()` 含 `userSchedules`；`snapshot().values.userSchedules` 存在（`schedules=0, asOfSeq=2`）；建一条 `after_seconds=2` 后 `schedules 0→1` 且含该 prompt（`asOfSeq=5`）；到点投递后回 0（`asOfSeq=10`）；显式 `snapshot(['userSchedules'])` 正常；`pluginWarns=[]` |
| 全量单测 | **747 tests / 743 pass / 0 fail / 4 skipped**（71 文件）。4 条 skip 是 `tests/peer-facet-integration.test.mjs` 的真对端用例：它的 skip 条件是「逐级向上找不到 `dsh-group-status` 仓」，这轮跑在 `~/dsh-worktrees/` 的隔离树上所以跳；同一份代码在主仓 `dsh-plugins/` 下跑是 **747/747/0/0**（那个仓就在旁边） |

复跑命令（逐条落 JSON 到 `.verify/`）：

```
node scripts/verify-across-kernels.mjs --steps mount,function,type,gate --no-install
node scripts/verify-across-kernels.mjs --versions 0.2.2-alpha.2 --steps mount,function,type,gate --no-install
PLAYWRIGHT_MODULE=<playwright 模块目录> npm run verify:ui -- --versions 0.2.2-alpha.2
```

**devDependencies 不动**（仍固定 `0.2.1-rc.2`）：alpha 不进本地编译基线，新代次靠 `--steps type`
与真内核四面覆盖。`0.2.2-alpha.2` 在本仓算"支持"要**两侧声明**（`engines.dsh` + kernel-scoped
peer 各追加 `>=0.2.2-alpha.2 <0.2.3-0`）**与**四面实测共同成立，缺一不算。

#### 发布前的老代次回归复核（2026-11-02，基线 `main@33c76b3`）

上面那张表跑在合并**前**的分支上，而这次改动动的是**所有代次共用**的注册路径，所以发布前在
合并后的 `main` 上又补了一轮，专门回答「会不会把老代次弄坏」：

| 判据 | 结果 |
|---|---|
| 声明面 | `git diff 2043c81..33c76b3 -- package.json`：**8 枚 peer 与 `engines.dsh` 的旧条款逐字未变**，只在末尾各追加一条 `>=0.2.2-alpha.2 <0.2.3-0`。老内核评估自己那个版本时的判定与发布前一致 |
| 框架假设 | 异步 effect body 需要 cordis await `Promise<Disposable>`。九棵版本树里的 cordis 是 **4.0.2 ~ 4.0.6-alpha.1**（peer 声明 `^4.0.1`，全代次同一 major）；最低那版 4.0.2 的产物里 `wrapper.then`（`lib/index.js:1274`）与 `_execute` 的 await（`:1355`）都在 |
| 投影物化探针 × **5 代** | `0.1.2-rc.1` / `0.1.5-rc.3` / `0.1.7-rc.1` / `0.2.1-rc.2` / `0.2.2-alpha.2`：`snapshot().values.userSchedules` 全存在、建一条后 `schedules 0→1` 且 nonce 命中、**`pluginWarns` 全空**。最后那列是关键——两步判若在老代次取错分支（把 await 出的 disposer 函数当「缺 dispose 的 handle」），必然在这里冒一条 warn |
| UI 面官方入口 × **3 个老代次** | `0.1.2-rc.1` / `0.1.7-rc.2` / `0.2.1-rc.2`：按钮=Y · dock=1 · 面板=Y · badge=1 · 错误=0，汇总 exit **0**（补上「上一轮六代 UI 矩阵跑在本次改动之前」这个缺口） |
| `npm test` 在主仓 | **747 / 747 passed / 0 failed / 0 skipped**；隔离 worktree 里同一份代码是 743 + 4 skipped（真对端用例找不到 `dsh-group-status` 仓才跳，见上文「验证状态」） |

**一处行为变化，方向是改善**：老代次过去把 `register()` 的返回值丢掉，而那条注册 effect 挂在
`sessionProjections` **服务自己的** context 上，插件卸载/重载时不释放；现在由我们的子 fiber 持有，
卸载即释放。重复注册在老代次本来就容忍（只有 `stateVersion` 不一致才抛），所以这不是修崩溃，
是修滞留。

**仍未覆盖，别读成已覆盖**：`0.2.2` 段只验了 `alpha.2`（range 语义会连带放行同段更晚的 rc 与
`0.2.2` 正式版，那是既有契约，不是本次验过的结论）；UI 面本轮只补跑 3 个老代次，
`0.1.5-rc.3` / `0.1.7-rc.1` / `0.2.0-rc.2` / `0.2.1-rc.3` / `rc.4` 的 UI 结论仍是 10-28 那轮（改动前）。

## 会话日志兼容：`session-scheduler/user-schedule`（#58，2026-10-20 定案）

插件在 1.4.0 之前把「定时任务所有权」写进会话日志（自定义事件类型），之后改存 sidecar。
旧日志里那些记录仍在，而宿主持久层对**不认识的类型**是**整份拒读**：

```js
// dsh-session-persistence/lib/index.js
if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true)
  throw unsupported(`… unknown to this harness and not marked ignorable; refusing to interpret the log …`)
```

- **上游立场**：事件名注册**不是**兼容机制。`dsh-session/lib/types/known-event-types.d.ts` 的注释写着
  「event-name registration was rejected … would make reads composition-dependent」。上游认的是 envelope 的
  `ignorable: true`（未知但标记为可忽略的记录按 log-only 保留、正常读过去）。
- **决定（#58 C 路线）**：删掉启动时的读兼容注册；旧日志改由 `scripts/migrate-owned-events.mjs`
  一次性迁移——只给这些记录补 `ignorable: true`，不动 `seq`、不动 `type`（**不能删行**：读路径要求
  seq 连续，删行会造出缺口反而更读不了）。脚本默认 dry-run、`--apply` 时先备份、幂等可重跑。
- **暴露面（实测，不是 grep）**：会话日志是 `session.v*.jsonl.zstd`，`grep` 读不进去。
  按 zstd 解压 + JSON `type` 精确匹配扫全库：**1666 份日志（v3 813 / v4 853）→ 0 份命中**。
  并且该事件在 `2026-09-10`（`80c8775` sidecar 化）就停止写入，而最早 release `v1.0.0` 是
  `2026-09-12` —— **没有任何已发布版本写过它**，受影响面只可能是 2026-08-26 至 09-10 之间从 git
  直装的开发版。
  （教训：用 `grep` 扫压缩日志会同时给出假阳性和假阴性；第一次重扫时 46 个"命中"全是 `tool/result`
  里**文本提到**这个类型名。）
- **迁移不能承诺什么**：它让**会话历史**重新可读，但**不保证**插件从那批老日志恢复提醒状态 ——
  1.4.0 起 sidecar 才是权威；V3 老日志在 V4 读取时还会把未知 ignorable 事件重命名进 `plugin:`
  命名空间。`src/user-tools.ts` / `src/projection.ts` 里按 `OWNED_EVENT` 读取的代码保留（对未迁移的
  环境仍是防御性分支），但不再是状态来源。

## 验收对照（v1.0.0）

| 编号 | 场景 | 落地 |
|---|---|---|
| AC-01 | 输入内容点击 ⏰ | ✅ 线上 E2E 实测：按钮渲染、面板可开 |
| AC-02 | 智能时段确认 | ✅ 线上 E2E 实测：自定义时间→确认→芯片显示｜任务列表 |
| AC-03 | 过去时间拒绝 | 面板校验 + 宿主 `not_future` 兜底 |
| AC-04 | 到期注入消息 | ✅ 线上 E2E 实测：到期（≈计划 75s）后对话出现 user/message（source=plugin）|
| AC-05 | 关网页重开仍在 | 事件日志持久化 + `userSchedules` 投影冷恢复 |
| AC-06 | 草稿变更 | 有意取舍：不静默取消（见 [设计决策 §4](./design-decisions.md)） |
| AC-07 | fork 不继承 | 按 `init(header, inheritedEventCount)` 的**继承前缀长度**丢前缀（`seq < 切点` 不进状态）。**不**按 `session/end-seed` 判：内核每次冷恢复都会在尾部补一条（`dsh-session/lib/index.js:1428`），拿它当边界会把本会话自己的待发提醒抹掉（#11） |
| AC-08 | 100 并发创建 | agent 事务串行化 + 单 session 上限 100 |
| AC-20 | 与 dsh-schedule 共存 | `schedule/change` 荷载零改动（严格兼容） |

## 已知限制

### 服务端重启后，没人打开过的会话不会按时投递（issue #11 → #128 → **#11b 已修**）

**现象**（真进程重启实测，0.2.1-rc.4 + dsh-later）：`/later +2m` 建好提醒 → 停掉 dsh 进程 → 用同一 `DSH_HOME` 重启 → 全程不连浏览器，到期后再等 90s：会话日志里 `user/message` 投递计数 **0**，sidecar 与 `schedule/change create` 都还在；打开那条会话，**立刻补发**（`delivered=1`）。

**成因**：投递依赖每个 root agent 的 runtime，而 runtime 只挂在「已存在的 live agent」上（`src/index.ts` 的 `hydrate()` 只遍历 `ctx.agents.roots()`，`agent/created` 才补挂）。重启时没有会话被拉起 ⇒ 一个 runtime 都不挂 ⇒ 没有 timer 源。另外 `arm()` 前还有一道 `agent.state === 'running'` 闸门，所以**不重启、只把 agent 回收掉**同样命中。

**已修的半面（issue #11a / PR #124，1.12.0）**：投影与投递两条通道原来口径不同——宿主每次冷恢复会话都会追加一条 `session/end-seed {}`（内核 `dsh-session/lib/index.js:1428`），旧投影据此把 `active` 抹空，于是提醒**照发但看不见、取消不掉**。现在两通道同按 `init(header, inheritedEventCount)` 的继承前缀切点判，`stateVersion` 升到 5 让旧的中毒缓存行作废。

**已修（issue #11b / 分支 `feat/11b-host-level-sweep`，1.12.0）**：宿主级到期扫描器 `src/expiry-sweeper.ts` 挂在插件 apply 的顶层 fiber 上，看 sidecar 里每条提醒的到期时刻（v3 起 `OwnedEntry.scheduledAt`），到点用「惰性取 `ctx.get('sessionController')` → 回退 `ctx.agents.resume({ resumeSessionId })`」把会话拉起来，再走**原有** runtime 链路投递（确认窗口、`schedule/change dispatch` 记账、`/later` 代发语义一个字没改）。

上面那条「停进程重启、不开浏览器、到期后 0 条」现在变成：**到期后由扫描器自己叫醒会话并投递**。判据是事件形状（`agent/inbox/spliced` 的 `inserted[].content` 带 nonce + 随后一条 `schedule/change operation: dispatch`），跨内核 `function` 面每个代次都单列一维（`冷会话 spliced=N dispatch=Y`），与热会话分开数——任何一方为 0 都单独判红，不许互相打掩护。

**dispatch 的归属口径**：`schedule/change` 事件本身只带 schedule id、不带会话 id，所以脚本按**会话日志文件**归属——内核把每个会话写成 `<home>/sessions/<cwd 编码>/<sessionId>/session.v4.jsonl(.zstd)`，目录名就是 sessionId，这是确定性事实而非猜测。早期版本在全量事件里 `some()`，热用例与冷用例的 `dispatched` / `coldDispatched` 因此**恒等**（永远同真同假），冷那一维对结论的贡献是 0 却显示成 `true`；现在两者各自看自己会话的日志，`sessionsSeen` 里也留下本次出现的会话目录，便于复核。

落地时踩到、现在写死在实现里的四条（改动这些之前先读源码注释）：

1. **扫描器启动就要同步扫一轮**。`apply()` 那一刻 sidecar 往往还是空的，若只靠「先排 timer 等它触发」，排出来的延迟是 0、`unref` 之后又不再唤醒进程，等于**整个生命周期只剩 60s 兜底 tick**。
2. **建/改/暂停/恢复之后必须让扫描器重新武装**（`activeSweeper?.rearm(sessionId)`，不是 `reschedule()`）。runtime 那边有 `requestDrive()`，扫描器没有第二个知情者，新写进 sidecar 的到期时刻只能等兜底 tick；而 `reschedule()` 是**纯重排**，不碰退避状态——一个已经放弃（`gaveUp`）的会话光靠重排永远不会被新提醒叫起来，这正是 #139 的第二半（D2）。
3. **静默期只拦"扫描器猜着去打开"，不拦"确实已到期"**。`agent/disposed` 之后内核会把会话日志封口（实测 `foldUserState` 折出 `active: 0`），所以"到期"这件事只能由 sidecar 这个断点索引回答：`hasOverdueEntry()` 为真时静默期让路。被挡下的条目记 `undelivered(quiet-window)` 并 warn 一次，**不静默丢**。
4. **到期判定只有一处**（`src/due.ts` 的 `isDue` / `dueTargetOf`），runtime 读折叠记录、扫描器读 sidecar，两边共用同一口径；时刻非法/缺失一律不算到期。

**剩余边界（改动前请先读这一节）**：

- **只有产生 root agent 的 profile 支持冷唤醒**：web（`dsh-web-app` 提供 `sessionController`，走 `resolveAgent`）与其余 profile（回退 `agents.resume`）都覆盖；两条都不通时记 `undelivered` 并告警一次，不重试风暴。
- **被委托子会话（`delegationDepth > 0`）不冷唤醒**：上游对子会话的 reminder 投递本来就拒绝（`session/agent-busy`），拉起来只会白跑一轮。这条是**硬拒绝**——在扫描器的枚举层就被摘掉，连"失败的唤醒"都不记，避免为一条永远投不出去的子会话提醒反复退避、最后刷出"已停止自动唤醒"的假告警。深度取自会话头的 `delegationDepth` 与运行期 `options.subagentDepth` 的较大者（与上游 `delegationDepthOf` 同义）。
- **非 root 不冷唤醒**：`ctx.agents.roots()` 里没有它 ⇒ 本插件的 runtime 挂不上 ⇒ 唤醒等于白拉。同样按硬拒绝处理（枚举层摘掉）。注意冷会话在这里看到的是「此刻没有对应 agent」，属正常现象，不算拒绝——判定只在**此刻存在 agent** 时才有信息。
- **静默期（120s）只对"扫描器主动打开"生效，"确实已到期"可以旁路**：用户关掉某个会话后 120s 内，扫描器不会主动去打开它。但旁路**只对「sidecar 里确实已过期」的条目生效**——判据是 `hasOverdueEntry(sessionId)`（`src/index.ts`，走 `src/due.ts` 的统一判定），即 sidecar 里那条 `scheduledAt <= now`。其余情况（没有到期条目、或到期时刻缺失/非法）**仍按 120s 静默期**，扫描器不会去碰它。被静默期挡下的到期条目记 `undelivered(quiet-window)` 并 warn 一次，宽限后再试——不无声滤掉。
- **冷唤醒会计一个 turn**：`agents.resume` 是真建 agent。宿主没有 provider 时那一轮以 `turn/end` 错误收尾（`agent "…" has no provider/model`）。扫描器用「1s→2s→4s→8s 退避、连续 5 次放弃并只告警一次」兜住"反复投不出去"，正常投递不受影响。
- **叫起来的会话在投递收敛之后释放**（#140，决策 D1）：本插件自己 `agents.resume` 出来的句柄会被 `dispose()`，会话回到冷的状态、写者位让回去；`sessionController` 路径交回的 agent 归控制器，本插件不拆。turn 未结束且 30s 内没收敛时**故意保留**并 warn 一次（宁热不丢）。
- **`every` 周期任务的重挂仍归 runtime**：扫描器只负责叫醒，不搬周期逻辑。
- **老 sidecar（v1/v2）缺 `scheduledAt` 的条目**：读时从会话日志 `schedule/change create` 回算（`after` = `createdAt + afterSeconds`，`at` = 记录自带的时刻）；回算不出来就**保守跳过并告警一次**——不猜、也不当成"永久逾期"去反复唤醒。回算需要会话句柄，冷会话拿不到时这条只能等会话被打开。
- **静默期监听的撤销契约只有单测覆盖了一半**：完整那条（监听挂在 effect 作用域里 ⇒ 拆 fiber 后必须摘掉）由 `tests/11b-cold-delivery.test.mjs` 的「撤销契约」用例钉住；「apply 期间注册的监听会不会被 cordis 拆」**不是**本插件的问题（真 cordis 上顶层注册同样有效，最小实验 `hits=1`），所以这里不记成已知限制。

**因此本文件之外的那些承诺请按这句读**：「关网页也准时触发」现在**两档都成立**——浏览器关掉、服务端在跑：一直以来成立；服务端重启、会话没被打开：**1.12.0 起成立**，边界见上面的「剩余边界」。

### 到期索引与投递真相同源、冷唤醒句柄释放（issue #139 / #140，1.12.1 之后）

**结论（实测，HEAD `3e6eef1` 的缺陷在本地修复分支上复跑）**：一次性提醒投递成功之后，sidecar 条目
不再被扫描器判成「到期且未消化」；`gaveUp` 的三条解除路径都能被测试驱动；冷唤醒的会话在投递收敛
之后被释放。取舍写在 `docs/design-decisions.md` 的 D1/D2/D3。

| 判据 | 实测结果 | 手段 |
|---|---|---|
| 投递之后条目仍在索引里、但到期视图读成 `consumed`（**不摘条目**，`rearmOneShot` 依赖它的 uid/附件） | 成立 | `tests/due-index-consumption.test.mjs`：装配层用真 `lib/index.js` + 假宿主，判据是 `agent/inbox/spliced` 带本次 nonce + 随后 `schedule/change operation:dispatch` |
| 验收① 同会话第一条投完，第二条仍能被冷唤醒并投递 | 成立 | 同上（第二条走真 `user_schedule_create` 工具路径，经 `rearm` 排精确 timer；直接写 sidecar 只能等 60s 兜底 tick，测不到用户实际时序） |
| 验收② 重启后带历史已投条目**不被白白拉起** | **分两档成立** | 新数据（1.12.1+ 镜像写下的标记）：`agents.resume` **0 次**；遗留数据（无标记）：**恰好 1 次**，之后永不再拉。第二档是边界不是失败——冷会话读不到自己的判据（`SessionStore.get` 只返回 live 会话），所以第一次拉起既是唤醒也是唯一能对账的时机 |
| 验收③ `every` 连续两次 occurrence 之间不攒失败、不误报 `gaveUp` | 成立 | 索引被推进到 `> now` 的下一次；镜像源是 fold 自己的端态，**没有第三次 occurrence 计算** |
| `gaveUp` 解除路径 ①条目删/推远 ②正常消化 ③用户改动 `rearm` | 三条各自可达 | 注入假时钟的扫描器单测；①在修复前**结构性不可达**（`settle()` 的 `gaveUp` 短路排在清算之前） |
| 冷唤醒 → 投递 → 释放 → 第二条到期 → 再唤醒并投递 | 成立 | `tests/cold-wake-release.test.mjs` 序列用例（同一条测试同时覆盖 #140 的释放与 #139 的第二条，不拆成各测一半的两个断言） |
| turn 未结束不释放；`sessionController` 路径不释放 | 成立 | 同上两条独立用例 |

**未判定（不许因为上面绿了就当它绿）**：

- **30s 未收敛「故意保留 + warn」那一支没驱动**：单测不真等 30s（`COLD_WAKE_RELEASE_WAIT_MS` 是
  代码常量）。可达的那一半（busy ⇒ 不拆、转 idle ⇒ 补拆）有用例；上限本身属推断。
- **跨内核四面已在合并后的集成树上复跑（2026-11-10，`integration/closeout`）**：
  `node scripts/verify-across-kernels.mjs --steps mount,function,type,gate --no-install` →
  **11/11 绿、0 红、0 未判定，退出码 0**（明细 `/tmp/closeout-verify/across-kernels-2026-11-10T06-27-52-177Z.json`，
  gitignore 目录，复跑即得）。逐代都报 `同源=same`、`投递 spliced=1 dispatch=Y`、
  **`已关闭会话 spliced=1 dispatch=Y`**、`at 形状 5/5`、type 两 tsconfig 0 错、gate 本代与最新都 pass
  （`0.1.2-rc.1` / `0.1.5-rc.3` 的 gate 本代仍是**结构性未判定** —— 那两代不导出
  `evaluatePluginCompatibility`，不许记成绿）。
  ⚠️ 这一维现在叫「已关闭会话」而不是「从没被打开过」：脚本做的是 create→`dispose()`→等，
  每次跑还是**全新 sessionId**，所以它覆盖不到「同会话第二条」与「重启后带历史已投条目」，
  那两条由 `tests/due-index-consumption.test.mjs` 在单测层覆盖。**矩阵绿 ≠ #139 被真内核验过**，
  两边是不同的判据面。
- **UI 面（本轮补跑）**：`PLAYWRIGHT_MODULE=… npm run verify:ui -- --versions 0.2.2-rc.1,0.2.1-rc.4,0.1.2-rc.1`
  → 三代都是 `按钮=Y · dock=1 · 面板=Y · badge=1 · 错误=0 · 警告=0`，退出码 0。
  取最新 / 中间 / 最老三档是为了确认「镜像写进 sidecar」与「冷唤醒句柄释放」没有动到 dock 与
  投影的读面；**其余 8 个代次的 UI 面本轮没跑**，仍是各自那轮的历史结论。
- **越界自检**：本轮 nonce（`XK-FIRE` / `XK-COLD`）在真实 `~/.dsh/sessions` 下 **0 命中**；
  临时 `DSH_HOME` 由脚本自己建。`find ~/.dsh -newermt …` 会列出一堆文件，但那是本机别的服务
  （gitea-dispatch / wakatime / dsh-web）在写 —— **可归因的检查是 nonce，不是时间戳**。

- **真宿主上「写者持有」那条后果没有直接实测**：D1 的依据是内核 `AgentHandle` 与
  `sessionController.resolveAgent` 的契约文本 + 本仓 `index.ts` 里那条 `{ error }` 分支注释，
  不是端到端跑出来的 GUI 现象。

**顺带纠正一处会误导人的判据命名**：`scripts/verify-across-kernels.mjs` 里那条"冷会话"维度实际做
的是 **create → 建提醒 → `dispose()` → 等**，测的是「**被打开过又关掉**的会话」（每次跑用全新
sessionId，`gaveUp` 又是进程内状态，所以它既覆盖不到「同会话第二条」也覆盖不到「重启后带历史
条目」）。现在这一维在脚本与报告里改名为**已关闭会话**；#128 要求的「**从未被打开过**」那一面由
`tests/due-index-consumption.test.mjs` 的验收②两条用例覆盖（假宿主里 sidecar 有、`published`
里没有，正是"从没被打开过"的形状）。

### `0.1.7` 下设置页不可用

`0.1.7` **删除了整个 `settings.yaml` 体系**：

- `SettingsProvider.register()` 不复存在，`ctx.settings` 变为 `SettingsForms`
  （只有 `configure` / `describe` / `prepareDocument`）
- 命名空间 schema 改为**由 profile 声明驱动**
  （内核注释原文：*Move the sections of the removed `settings.yaml` into the active profile*）

**处置**：`src/index.ts` 做代次门控 —— 探测不到 `register` 即保持 `startSettings`
（profile yml 的 `base` 值）。插件核心功能（命令、工具、调度器、投递）**不受影响**，
但以下能力在 `0.1.7` 上缺失：

| 能力 | 状态 |
|---|---|
| GUI 设置页（`SchedulerSettingsCard`） | ❌ 不显示 |
| `steerDelivery` / `confirmDelivery` 运行时热改 | ❌ 用 yml `base` 值 |
| `maxSchedules` / `allowLongPrompts` 运行时热改 | ❌ 用 yml `base` 值 |
| 命令与工具本身 | ✅ 正常 |

代码中留有 `TODO(0.1.7 配置迁移)`。**这是跨 15 个插件的架构课题，不应塞进单插件适配**：
需要先确定 profile 声明式配置的写法，再统一迁移各插件的设置面。

### 已解决（2026-10-20，issue #58）：读兼容注册已移除

历史上这里记着一条**已知限制**：插件需要 `Set.add()` 改写宿主的只读集合
`KNOWN_SESSION_EVENT_TYPES` 才能读旧日志 —— 非官方支持面、`link:` 开发态下还会静默失效（#57）。

该限制已消除：注册模块与调用已删除，旧日志改由 `scripts/migrate-owned-events.mjs` 一次性迁移
（补 envelope 的 `ignorable: true`，不动 seq/type）。实测暴露面、为什么不删行、以及踩过的坑
（用 `grep` 扫 zstd 日志会同时给假阴性与假阳性）都已收在本文档的
**「会话日志兼容：`session-scheduler/user-schedule`」** 一节，此处不再重复。

### 已解决（2026-10-23，issue #75）：0.1.7-rc.1 上提醒 100% 不投递

**现象**：宿主 `dsh 0.1.7-rc.1` 上，提醒到点全部失败，面板显示「发送失败 / 超时未确认」。
**且插件侧没有任何可读的错误**——会话日志里既没有 `schedule/change operation:dispatch`，
也没有那句准入报错（它只出现在宿主 stdout）。

**根因**：`schedule-compat.ts` 拿 `renderRecurringReminderBatchFraming` 是否存在推断
「是不是 0.1.7」。但上游两个破坏性变更**不在同一个 rc 落地**：

| | `plugin` kind 是否被收 | render 新名是否存在 | `allocateScheduleId` 是否存在 |
|---|---|---|---|
| `0.1.5-rc.1` | ✅ 收 | ❌ | ✅ |
| `0.1.7-rc.1` | ❌ **已删** | ❌ **仍用旧名** | ✅ |
| `0.1.7-rc.2` | ❌ | ✅ | ❌ |

中间那行就是事故窗口：按符号探测会把它判成 0.1.5，于是交出
`{ kind:'plugin', … }`，被 `@deepseek-ai/dsh-session-format-v3-to-v4` 的准入
（`value["kind"] === "plugin"` 直接 throw）拒绝。

**为什么不能换个符号再探**（issue 里建议的 `allocateScheduleId` 也不成立）：上表显示
`0.1.5-rc.1` 与 `0.1.7-rc.1` 的 `dsh-schedule` 导出面**逐符号相同**——两个版本在 registry 里
都存在（`@deepseek-ai/dsh-schedule@0.1.5-rc.1` / `@0.1.7-rc.1`），实测两边都有
`renderEveryReminderBatchFraming` 与 `allocateScheduleId`、都没有新名。任何单符号推断都会
在这里踩空。**能区分的只有版本号。**

**改法**：判定换成「内核版本 + 显式阈值」——`PLUGIN_KIND_RETIRED_SINCE = '0.1.7-rc.1'`，
版本从 `@deepseek-ai/dsh` → `dsh-schedule` → `dsh-llm` → `dsh-session` 依次解析后向上读
`package.json`（**不能**直接 `require('<pkg>/package.json>')`：实测 0.1.5 的 `exports` 里没有
`./package.json` 这一条，0.1.7 起才有）。版本读不到时才退回符号探测，并且**警告一次**——
静默的错判正是本次事故的成因。比较器自己实现（semver §11 的预发布序），不引依赖：
阈值两侧都是 `rc.N`，按字符串比会得出 `rc.10 < rc.2`。

**实测矩阵**（本机 `~/dsh-versions/`，各版本 `npm i @deepseek-ai/dsh@<v>` 的真树）：

| 版本 | `dsh` 的 package.json version | 判定 kind |
|---|---|---|
| 0.1.5-rc.1 | 0.1.5-rc.1 | plugin ✅ |
| 0.1.7-rc.1 | 0.1.7-rc.1 | **schedule** ✅（修复前：plugin ❌） |
| 0.1.7-rc.2 | 0.1.7-rc.2 | schedule ✅ |
| 0.2.1-rc.2 | 0.2.1-rc.2 | schedule ✅ |

**端到端验收**：`node devkit/func-later.mjs --plugin <本仓> --dsh ~/dsh-versions/<版本> --case drive-gates --hold 8`。
判据是**事件形状**（一条 `agent/inbox/spliced` 且其 `inserted[].content` 带提醒正文，随后
`schedule/change operation:dispatch`），不是「日志里能不能搜到 nonce」——创建事件与命令回执里
也含同样的文本，拿它当判据会得出假结论（实测踩过）。修复前 rc.1 为 RED
（`spliced=0`、`dispatch=无`、`fold` 由 active 1 → 0 即窗口过期而非消费），修复后四代全 GREEN。

**顺带登记代次**：`KERNEL_GENERATIONS` 显式加入 `0.1.7-rc.1` 并跑 `scripts/sync-peer-matrix.mjs`。
`package.json` 的 `engines.dsh` 早就把 rc.1 圈在支持范围内（`>=0.1.1-rc.2 <0.2.0-0`），而 peer
强制拦截要到 0.2.0 才生效——所以这条坑路一直对外可达，只是没人验过。

**未做的部分（如实）**：issue 建议 3 里「把 append 抛出的真实校验错误透出来」做不到——那句
throw 发生在宿主写入路径，插件侧 `followup()` 不抛、也拿不到（实测）。改为能拿到的那一半：
投递未确认时把**自己的判定依据**（`kind=` + 内核版本 + 出处）记进宿主日志，
让下一次同类事故不用重跑跨代次实测就能定位。`DELIVERY_CONFIRM_TIMEOUT_MS` 仍是 2000ms，未调。

## 面板锚定：0.2.2-rc.2 删除 `useAnchoredPosition`（issue #158）

### 现象与取证口径

`0.2.2-rc.2` 的 `dsh-client-ui-primitives` 不再导出 `useAnchoredPosition`（`0.2.2-rc.1` 还导出，
且**同时**导出 `useAnchoredMaxHeight`）。发布包导出面原样摘录在
`tests/fixtures/anchor-backends/`，复核：

```sh
cd /tmp && rm -rf p && mkdir p && cd p
npm pack @deepseek-ai/dsh-client-ui-primitives@0.2.2-rc.1 && tar xzf *.tgz
grep -E '^export .*(useAnchoredPosition|useAnchoredMaxHeight|usePointerGrace)' package/lib/types/index.d.ts
```

装配面（`mount`）在这次改动前后都是绿的，所以「矩阵绿」不能证明锚定还在——这正是 #158
第 3 条建议要进符号台账的原因。本轮的判据因此是**几何**，见下。

### 真机几何（`verify:ui` 之外的一次性探针）

在 `.verify/ui-158/instances/` 同款隔离实例里开面板，读三个矩形：

| 代次 | 后端 | 触发元素 | 面板 | `anchor-name`（触发元素） | `position-anchor`（面板） |
|---|---|---|---|---|---|
| 0.2.2-rc.2 | `css-anchor` | top 541 / left 955 | **top 198 · bottom 537 · left 955** | `--dsh-later-sched-anchor` | `--dsh-later-sched-anchor` |
| 0.2.2-rc.1 | `hook` | top 541 / left 955 | **top 198 · bottom 536 · left 955** | `none`（不写） | `normal` |

两档落在同一点：面板下沿 = 触发元素上沿 − 4px（配置的 `gap`），左缘与触发元素对齐。
`0.2.2-rc.2` 上控制台 0 告警——改动前那一代会出现一次
`dsh-later: 宿主 primitives 未导出 useAnchoredPosition…`。

**反向对照（证明起作用的确实是 CSS 锚点定位）**：把触发元素的 `anchor-name` 清成 `none` 后
面板的 `top/left` 退回 `auto`/`0`（落在视口左下角），再恢复即回到上表的值。也就是说面板位置
是锚点解析出来的，不是某个巧合的静态定位。

⚠️ 做反向对照时**必须在读到基线几何之后**再改 `anchor-name`，并且用
`style.removeProperty('anchor-name')` 还原（赋 `''` 不会把 `none` 撤掉）。本轮第一次探针就是
先改后读，得到一张「`anchor-name` 为 `none` 但面板已锚定」的自相矛盾结果——那是探针顺序的
问题，不是插件的。改动后连跑 4 次纯净测量均稳定命中上表。

### 回归面

```sh
PLAYWRIGHT_MODULE=<playwright 目录> npm run verify:ui -- --versions 0.2.2-rc.2 --out .verify/ui-158
PLAYWRIGHT_MODULE=<playwright 目录> npm run verify:ui \
  --versions 0.2.2-rc.1,0.2.1-rc.4,0.1.2-rc.1 --out .verify/ui-158-legacy
```

| 面 | 结果 |
|---|---|
| `verify:ui` · 0.2.2-rc.2 | 按钮=Y · dock=1 · 面板=Y · badge=1 · 错误=0 · **警告=0**，exit 0 |
| `verify:ui` · 0.2.2-rc.1 / 0.2.1-rc.4 / 0.1.2-rc.1 | 三代同样是 按钮=Y · dock=1 · 面板=Y · badge=1 · 错误=0 · 警告=0，exit 0 |
| 单测 | 892 / 892 pass，0 fail（87 文件；新增 `tests/panel-anchor-backends.test.mjs` 9 条） |
| `typecheck` | 两个项目 0 错误 |
| 跨代 tsc（换线 0.2.2-rc.2） | `tsconfig.client.json` **0 错误**（改动就在这个项目）；`tsconfig.json` 4 条，见下 |

### 本轮**没有**解决、也不在 #158 范围内的

`0.2.2-rc.2` 上还有一处与本条无关的不兼容，是宿主 API 变更，**不在这次改动里修**：

1. **`AgentRegistry.roots()` 在 0.2.2-rc.2 被移除**（rc.1 的 `dsh-agent` 仍有 `roots(): Agent[]`，
   rc.2 只有 `get()` / `list()`）。本插件 4 处调用：`src/index.ts:611`、`:851`、`:1073`、
   `src/runtime.ts:202`。后果是跨代 tsc 的 `tsconfig.json` 4 条错误，以及 `verify:kernels` 在
   rc.2 上 `投递 spliced=0`（告警「runtime 未能驱动（root 判定未命中）」）。同一份代码在
   `0.2.2-rc.1` 上同一条判据是 `spliced=1 dispatch=Y` GREEN。
   **基线对照**：把 `main` 换线到 rc.2 跑 tsc，同样是这 4 条 —— 与本次改动无关。

⚠️ **更正一处此前的误判**：这一节曾把这句回执登记为「第二处 rc.2 不兼容 —— 宿主对 `at` 字符串
的时区校验更严，属上游文法收紧」。**这是错的。** `at` 的时区校验在 rc.2 上没有问题：

| 判据 | 0.2.2-rc.2 实测 |
|---|---|
| 面板原生 `HH:mm` / 个位小时带秒 / 个位无秒 / 严格基线 | 4 条 `built: true`，回执 `{"ok":true,…}` |
| 无偏移字符串应拒+提示 | `built: false` · `hinted: true` · `pass: true` —— **预期通过** |
| 合计 | **5/5 PASS** |

那句 `invalid_rule: at 字符串需带显式时区…` 是 `atShapes` 里
`{ label: '无偏移字符串应拒+提示', mustBuild: false, mustHint: true }`
（`scripts/verify-across-kernels.mjs:542-556`）的**预期结果**，不是失败：无偏移字符串必须被拒
并给出可执行提示，猜宿主时区会把用户意图的时刻改掉。而且这句文案出自本插件自己的
`src/user-tools.ts:451`，请求根本没到宿主。原始记录见
`.verify/across-kernels-2026-11-12T08-42-46-150Z.json` 的 `at` 数组。

也就是说：`0.2.2-rc.2` 目前**不应登记进 `KERNEL_GENERATIONS`**——入表标准是「装配功能 + 跨代
tsc 两面都过」，挡路的只有 `roots()` 那一处：它在 rc.2 上让 `tsconfig.json` 4 条 tsc 报错、
`verify:kernels` 的 `投递 spliced=0`。`engines.dsh` 的 `>=0.2.2-alpha.2 <0.2.3-0` 本来就放行 rc.2，
本轮没有改动 peer/engines。

## rc.2 的 `AgentRegistry.roots()` 移除（#158 后续）

上一节末尾登记的那处阻塞已修掉，rc.2 也随之入表。本书记录的是**它后来怎么了**。

### 现象与根因

`0.2.2-rc.2` 删掉了 `AgentRegistry.roots()`。rc.1 的实现是
`[...store.values()].filter(e => e.owner === void 0).map(e => e.agent)`；rc.2 的 store entry
**已没有 `owner` 字段**，注册表的 owner 关系在这一代不可见，只剩 `get(id)` / `list()`。
本插件有 4 处调用，全部在 `try/catch` 里：

| 调用点 | 失效后的表现 |
|---|---|
| `src/index.ts` 的 `coldWakeRefusal` | 冷唤醒全判 `'not-root'`，根本不去 resume |
| `src/index.ts` 的 `hasLiveRootAgent` | 恒 `false` |
| `src/index.ts` 的 runtime 注册表 `roots` 注入 | 拿不到 root 列表，runtime 挂不上 |
| `src/runtime.ts` 的 `isLive()` | 恒假 |

四处叠加后的症状是**静默失效**，而不是崩溃：`catch` 把 TypeError 吞掉，插件继续跑，只是永远
看不见任何 root。脚本侧的可观测面是 `verify:kernels` 在 rc.2 上报「runtime 未能驱动（root 判定
未命中）」与 `投递 spliced=0`。

### 判据链的两档

判定收敛到 `src/upstream-compat.ts` 一处，两代共用：`readDelegationDepth` / `isRootAgentShape` /
`isRootAgent` / `liveRootAgents`，分别对应 `src/index.ts:608`、`:844`、`:1066` 与 `src/runtime.ts:206`。

| 档 | 条件 | 判据 | 为什么 |
|---|---|---|---|
| 1 | `typeof agents.roots === 'function'` | 逐字用 `roots()`，**不叠加**任何本地判据 | 老代的权威面说了算。宿主文档写明 **resume 出来的 fork 子会话可以带着 `delegationDepth > 0` 被重新登记为顶层 root**（*a resumed fork may still be a root*）——先读深度会在 rc.1 上凭空多出一个旧版本没有的拒绝面 |
| 2 | 没有 `roots()` | `list()` 成员的会话面上：深度 `> 0` **或** `origin === 'subagent'` 任一命中即非 root | `list()` 只含活体 agent，回答「live」那一半；「root」那一半注册表已答不了，只能问会话头 |

⚠️ 第 2 档有两个必须绕开的坑，都钉进了 `tests/roots-compat.test.mjs`：

- **`parentSession` 不能当判据。** 内核文档原文：*Presence alone does not classify a Session as a
  subagent; use `origin` for that distinction.* 普通 fork 也带这个字段，用它判会误杀 fork 会话。
- **`delegationDepth` 是 optional，「缺省即 0」。** 所以比较必须是归一化后的「是否 `> 0`」，
  写成 `delegationDepth === 0` 会让 `undefined !== 0` 成立、把**所有真正的 root 全部判丢**——
  症状与本次事故一模一样，却是自己造的。这是最容易犯也最隐蔽的一类错。

两个来源都读深度（会话头持久化的那份 + 宿主内部的 `options.subagentDepth`，后者在两代 `.d.ts`
里都没声明，按可选形状读），取较大者：任一侧说是子代理就算。脏深度（非有限/负数）归一成 0、
即**判 root**，是刻意的——丢 root 是静默故障，误挂一份 runtime 幂等且可回收，两个方向的代价不对称。
不调上游的 `delegationDepthOf`：它在非安全整数上会抛 TypeError，一个坏 agent 就能毁掉整次枚举。

`liveRootAgents` 的过滤判据与单点判定同源，不另写一份——两处一旦分叉，就会出现「注册表认为
它是 root、冷唤醒拒绝它」这种自相矛盾的组合。

### 实测矩阵

判据一律是 `verify-across-kernels` 的事件形状，字符串照抄报告，不转述。

**rc.2 单代，修复前后对照**：

| 面 | 修复前（`.verify/across-kernels-2026-11-12T08-42-46-150Z.json`） | 修复后（`.verify/across-kernels-2026-11-12T10-52-27-230Z.json`） |
|---|---|---|
| verdict | **RED** | **GREEN** |
| 同源 | same | same |
| 投递 | `spliced=0 dispatch=N` | `spliced=1 dispatch=Y` |
| 已关闭会话 | `spliced=0` | `spliced=1 dispatch=Y` |
| `at` 形状 | 5/5 | 5/5 |
| 跨代 tsc | `tsconfig.json` **4 条** · `tsconfig.client.json` 0 条 | 换线 19 处，两个 tsconfig **0 条** |
| gate | 本代 pass · 最新 pass | 本代 pass · 最新 pass |

修复前那条插件告警原文：

```
later: 会话 <id> 已被唤醒，但 runtime 未能驱动（root 判定未命中），本轮按未投递处理；该会话被打开时会立即补投。
```

⚠️ 这条告警读起来像「会话已唤醒」，实际那一侧也没走通；判断红绿**只看 `spliced` 与 `dispatch`**，
不要看告警措辞。

**老代次回归（不是上面那次全量跑，是单跑的对照）**：`0.2.2-rc.1` / `0.2.1-rc.4` / `0.2.1-rc.2`
三代均 `spliced=1 dispatch=Y`，汇总绿 3 / 红 0 / 未判定 0。这三代都有 `roots()`，走的是第 1 档，
所以它们是「第 1 档逐字行为没有被这次改动扰动」的证据，而不是第 2 档的证据。

**全量矩阵 12 代**：`node scripts/verify-across-kernels.mjs --steps mount,function,type,gate --no-install`
→ **绿 12 / 红 0 / 未判定 0，退出码 0**（明细
`.verify/across-kernels-2026-11-12T11-03-10-870Z.json`，gitignore 目录，复跑即得）。

| 代次 | verdict | 投递 | type（两个 tsconfig） | gate 本代 |
|---|---|---|---|---|
| 0.1.2-rc.1 | GREEN | `spliced=1` | 0 错 | **结构性未判定** |
| 0.1.5-rc.3 | GREEN | `spliced=1` | 0 错 | **结构性未判定** |
| 0.1.7-rc.1 | GREEN | `spliced=1` | 0 错 | pass |
| 0.1.7-rc.2 | GREEN | `spliced=1` | 0 错 | pass |
| 0.2.0-rc.2 | GREEN | `spliced=1` | 0 错 | pass |
| 0.2.1-rc.2 | GREEN | `spliced=1` | 0 错 | pass |
| 0.2.1-rc.3 | GREEN | `spliced=1` | 0 错 | pass |
| 0.2.1-rc.4 | GREEN | `spliced=1` | 0 错 | pass |
| 0.2.2-alpha.2 | GREEN | `spliced=1` | 0 错 | pass |
| 0.2.2-alpha.3 | GREEN | `spliced=1` | 0 错 | pass |
| 0.2.2-rc.1 | GREEN | `spliced=1` | 0 错 | pass |
| **0.2.2-rc.2** | GREEN | `spliced=1` | 0 错 | pass |

⚠️ `0.1.2-rc.1` / `0.1.5-rc.3` 的 gate「本代」是**结构性未判定**（那两代不导出
`evaluatePluginCompatibility`，见「已知限制」那一节），**不许记成 pass**。它们进「绿 12」是因为
该面按结构性豁免计入，不是因为测过。

**回归面**：

| 面 | 结果 |
|---|---|
| 单测 | **907 / 907 pass，0 fail**（88 文件；基线 892，新增 `tests/roots-compat.test.mjs` 15 条） |
| `typecheck` | 两个项目 0 错误 |
| 跨代 tsc（换线 rc.2） | 两 tsconfig 均 0 错误（修复前 `tsconfig.json` 4 条） |
| `verify:kernels`（12 代） | 绿 12 / 红 0 / 未判定 0，exit 0 |

### dev 固定代次落后于表内最新一代是允许的（当前已不落后）

⚠️ 这一段写于 dev 还固定 `0.2.1-rc.2` 的时候。**现状已变**：devDependencies 的 11 个
`@deepseek-ai/dsh-*` 现已跟到 `0.2.2-rc.2`（见本节末尾「升级到 0.2.2-rc.2」）。下面讲的机制
仍然成立——它约束的是**将来**再出现落后时的行为，不是当下的状态。

由两条测试钉住：

- `tests/upstream-compat.test.mjs` 的「devDependencies 固定到某个已验证代次」：要求 dev 是
  **某一代的精确版本**（不能是范围串）、且全部 kernel-scoped 包**同代次**，但**不要求是最新那代**；
  落后时会打一行 `ℹ️ dev 固定代次 … 落后于最新已验证代次 …`。
- 同一文件「dev 与运行时代次的对齐说明」把 dev 代次写成**常量断言**
  （`assert.equal(dev, '0.2.1-rc.2', …)`）：升级依赖必须同步改这个常量，好让代次变更加在 diff 里
  看得见，而不是被 install 悄悄改掉。

理由：**「表里有几代验过」与「本地开发装的是哪一代」是两回事**，混成一条会让断言互相打脸——
本轮加 `0.2.1-rc.3/rc.4` 时就同时红过这两类。覆盖面在别处：比 dev 更新的代次由
`verify-across-kernels --steps type` 逐代换线跑 tsc，不依赖本地装的是哪一代。

### 升级到 0.2.2-rc.2：一个一直存在、升级才照出来的产品缺陷

`devDependencies` 从 `0.2.1-rc.2` 升到 `0.2.2-rc.2` 后，`npm test` 是 **809 pass / 37 fail**。
追下去发现红的不全是"测试数据过时"：

**`title` 从 `0.1.7-rc.2` 起就是存量记录的必填项**（不是 rc.2 才收紧）。本机 11 棵代次树实测：
`0.1.2-rc.1` / `0.1.5-rc.3` / `0.1.7-rc.1` 三代的 `dsh-schedule` 里**没有**这句校验，
`0.1.7-rc.2` 起才有。而那三代写进会话日志的 `schedule/change` 记录**没有** `title` 字段。

本仓两处 `decodeScheduleChangeCompat` 的失败分支是 `catch { continue; }`，于是：

> 升级内核后，用户打开一个旧会话，**旧的提醒从 dock 与定时面板上一起消失**。
> 提醒能建、能投递、sidecar 里也有，只是不进投影。

之前没暴露，是因为 dev 一直钉在 `0.2.1-rc.2` 而那代的 `foldScheduleEvents` 还在；升到 rc.2 后
该导出也没了，5 个测试文件在 **import 期**就挂，整个文件的用例一起变 0——这才把它照出来。

**修法不是 `try { } catch { }` 全兜住**，三层判据（`src/schedule-compat.ts` 的 `decodeRecordTolerant`）：

1. 只在「拒绝**结构上只关于 title**、且该值确实不合法」时才补；
2. 补完再问一次上游，**那一抛原样外传**——所以「缺 title + 缺 `scheduledAt`」这类记录
   补了 title 仍在键集上报错，照旧被拒；
3. 不替不校验 title 的旧代补（补了会让 `hasExactKeys` 多一个键，把合法旧记录判非法）。

护栏：`tests/schedule-title-backfill.test.mjs` 21 条，含 17 条「补了 title 也不该过」的坏数据
样本与「投影/投递两处同口径」。**变异验证**：把兜底改成「catch 全兜 + 无条件补」时，
21 条掉到 6 条（15 条变红）——护栏有牙，不是永真。

`tests/` 里缺 `title` 的 fixture **故意保留**：它们现在就是「0.1.5 旧记录」的活样本，
补上等于把这次回归的样本删掉。

升级后实测：

| 面 | 结果 |
|---|---|
| `npm test` | **928 pass / 0 fail**（89 文件；基线 907 + 新增 21） |
| `npm run typecheck` | 两个项目 0 错误 |
| `verify:kernels`（12 代全量） | 绿 12 / 红 0 / 未判定 0 |
| `verify:ui`（rc.2 + rc.1） | 两代 按钮=Y dock=1 面板=Y badge=1 错误=0 警告=0 |

另两条同一轮修掉的独立失败：`tests/upstream-compat.test.mjs` 的 dev 代次常量；
`tests/error-code-superset.test.mjs` 的解析器（rc.2 把 `ScheduleInputError.code` 从内联联合改成
别名链 `→ Exclude → 分散在 8 个接口`，改为按形状递归解析并兼容两代，认不出时 `assert.fail`）。

### 仍未做的

> ⚠️ **下面两条已在后续一轮补齐**，原文保留以便追溯，结论以本节末尾「补齐的两个缺口」为准。

- ~~**rc.2 上第 2 档判据只在脚本与假宿主里验过**~~，没有「真 GUI 里挂一个带 `delegationDepth > 0`
  的 fork 会话」这一面的端到端证据。`resume` 出来重新成为 root 的反例也属此类：出处是宿主文档
  文本，本轮没有构造真实样本复现。（后者后来**决定不做**，理由见本节末尾「已评估、决定不做」。）
- ~~**UI 面只补跑了 rc.2 与 rc.1 两代，不是 12 代全验过**~~：

  ```sh
  PLAYWRIGHT_MODULE=<playwright 目录> npm run verify:ui -- \
    --versions 0.2.2-rc.2,0.2.2-rc.1 --out .verify/ui-roots-fix
  ```

  | 代次 | 结果 |
  |---|---|
  | `0.2.2-rc.2` | 按钮=Y · dock=1 · 面板=Y · badge=1 · 错误=0 · 警告=0 → 通过 |
  | `0.2.2-rc.1` | 按钮=Y · dock=1 · 面板=Y · badge=1 · 错误=0 · 警告=0 → 通过 |
  | 汇总 | 通过 2 / 不通过 0（矩阵 `.verify/ui-roots-fix/matrix.html`） |

  选这两代是因为它们正是判据链的两档：rc.1 走 `roots()`，rc.2 走深度补位。**其余 10 个代次的
  UI 面本轮没有重跑**，仍是各自那一轮的历史结论——本节的 UI 面证据只覆盖这 2 代。
  ⚠️ 命令输出里的 `HTTP 401` 是实例端口轮询的「服务已应答」标记（`instance.mjs` 把 200/401
  都当作活着），**不是失败**，不要记成错误。

  另需分清：上表属 `verify:ui` 面；rc.2 入表依据的是跨内核四面（mount / function / type / gate）。

### 补齐的两个缺口（2026-11-12 后续一轮）

#### 12 代 UI 面全量

```sh
PLAYWRIGHT_MODULE=<playwright 目录> npm run verify:ui -- \
  --versions 0.1.2-rc.1,0.1.5-rc.3,0.1.7-rc.1,0.1.7-rc.2,0.2.0-rc.2,0.2.1-rc.2,\
0.2.1-rc.3,0.2.1-rc.4,0.2.2-alpha.2,0.2.2-alpha.3,0.2.2-rc.1,0.2.2-rc.2 \
  --out .verify/ui-all12
```

**12/12 通过**（每代 按钮=Y · dock=1 · 面板=Y · badge=1 · 错误=0 · 警告=0），48 张截图落
`.verify/ui-all12/`。

⚠️ **但逐张看图时发现了一个判据没覆盖到的真缺陷**——这正好印证「`panelOpened === true` 是绿
不等于面板长得对」：

| 代次 | 修复前 | 根因 |
|---|---|---|
| `0.1.2-rc.1` / `0.1.5-rc.3` / `0.1.7-rc.1` | 面板**全透明**，底下 dock 文字透上来与面板内容重叠 | `--dsw-menu-surface-fill` 这三种代次的宿主 css 里**没有**（逐代扫 `dist/assets/*.css` 实测，从 `0.1.7-rc.2` 起才有）；`background: var(未定义)` 是**整条声明失效**，不是取到透明 |

修法是三级兜底 `var(新 token, var(--dsw-alias-bg-layer-2, #fff))`。`backdrop-filter` 的分界
不同（从 `0.1.7-rc.1` 起才有），兜 `none`。
真 GUI 复拍这三代，面板已不透明（`.verify/ui-token-fix/`）。

#### 子会话判据与它的方向

`scripts/verify-across-kernels.mjs` 新增「子会话」一维：用
`ctx.agents.create({ meta: { delegationDepth: 1 } })` 建会话（已核实 rc.2 的 `dsh-session`
会把 `meta.delegationDepth` 落进 header，且校验必须是非负安全整数），给它建一条 2 秒提醒，
按**该会话自己的日志**数 `inbox/spliced`——不合并全局计数，否则别的会话投成功会替它打掩护。

⚠️ **这一维的方向随代次变，第一版写死「不该投」时在 11 个代次上一齐报了红**：rc.1 的
`roots()` 是 `store.values().filter(e => e.owner === undefined)`——判的是**运行期所有权**，
不是会话谱系；而脚本用 `ctx.agents.create()` 建的 agent 走 `enter(agent, undefined)`，
**没有 owner**，所以在 ≤`0.2.2-rc.1` 上它**本来就是 root**，插件投它完全正确。
（rc.1 的 d.ts 自己也写着 *"durable session lineage does not affect this runtime relation,
so a resumed fork may still be a root"*。）

所以判据按代次取方向：**rc.2 及以后断言「不该投」，更早断言「该投」**。方向来自声明
（该代有没有 `roots()`），不是今天的实测结果。

| 面 | 结果 |
|---|---|
| 12 代全量 | 绿 12 / 红 0 / 未判定 0；11 代 `该投=Y`、rc.2 `不该投=Y` |
| 变异 1：把 `isRootAgentShape` 的深度判据关掉 | rc.2 立刻 `不该投=N（投了 1 次）` 判红 |
| 变异 2：把方向阈值写成 `0.2.2-rc.1` | rc.1 立刻判红 |

两条变异都还原后复跑全绿。这说明这一维钉在「代次边界」这个事实上，不是永真。

#### 已评估、决定不做：`resume` 出来重新成为 root 的反例

**结论：不补实验。** 出处是 `dsh-agent@0.2.2-rc.1` 的 `roots()` 文档注释原文——
*"durable session lineage does not affect this runtime relation, so a resumed fork may still be a root"*
（`lib/types/index.d.ts:372-378`）——本轮没有构造真实样本，是**主动的决定**，不是欠账。

理由：**这个反例不会改变任何代码。** 它要证明的是「第 1 档不该叠加本地深度判据」，而我们的
实现本来就没叠加——rc.1 上直接透传宿主 `roots()`，`tests/roots-compat.test.mjs` 已断言
`list` 调用数为 0。所以补出来无论成立与否，代码都一行不改：

- 反例成立 ⇒ 我们当初判断对了；
- 反例不成立 ⇒ 那句文档注释不准，而第 1 档本来就该以宿主 `roots()` 为准。

它唯一保护的是「将来有人把两档合并成一个统一深度判据」——那个约束**已经写在**
`src/upstream-compat.ts` 的 `isRootAgent` 注释里，旁边就附了文档原文。再加一次真实验证属于
重复保险，而这类实验**很容易看着成功、实际没测到**（本 skill 反复警告的失败类型）。

若将来要合并两档判据，这里就是那块必须补的实验的挂点。
