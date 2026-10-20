# 更新日志

本文件记录面向使用者的重要变更。细粒度提交历史见 git log。

## 未发布

- **test** 把 #42 的管子接缝判据从**散文变成可执行**（issue #42 §2/§3/§4）。此前它的交付是
  4 张一次性 PNG —— 只能回答"10 月 19 号人眼看着没问题"，回答不了"下次宿主升级后接缝还在不在"。
  - 新增 `scripts/seam-check/png.mjs`：极简 8-bit 非隔行 PNG 解码（zlib 内置 + unfilter 40 行）。
    手写而不引 sharp/pngjs，是因为 CI 是 `node:22` 容器（无 PIL、无浏览器），而插件包运行时
    依赖为零（#19 特意维持）。不支持的特性一律抛错，**不静默给错像素** —— 判据建立在错数据上
    比没有判据更糟。解码结果与 PIL 独立算出的参照值逐字节核对。
  - 新增 `scripts/seam-check/criteria.mjs`：判据 1（接缝带内不得有横贯宽度的线）、判据 2
    （侧线连续无漂移）、判据 3（圆角唯一）、判据 4（solo 逐像素相同）。
    判据写成**相对中位亮度的偏离、方向无关**，而非"找 `border-l1` 那个色值"：截图里拿不到 CSS
    变量，而浅色主题下描边可能**比背景更暗**，写"更亮"会在浅色主题漏判（有专门合成用例钉住）。
  - 新增 `tests/seam-pixel-criteria.test.mjs`（9 条）：用仓库里**已采集的真实帧**验证区分力 ——
    `demo-scheme0-seam`（被否决方案）判 FAIL、最差跨度 **95.4%**；`demo-schemeB2-seam`（采纳）
    判 PASS、跨度 **0.9%**；真机 `tube-live-seam-4x` 判 PASS、跨度 2.1%。
  - **两个靠变异测试才暴露的问题**（都记进代码注释，免得重犯）：
    1. **一条测试原本是摆设**。"密集但零散的亮像素不得误判为线"最初只画了稀疏点（总偏离
       ~17%），于是把判据从"最长连续段"改成"偏离像素总数"后它**照样通过** —— 等于没测。
       改成"19 列亮 + 1 列暗"的周期（总偏离 95%、最长段 4.75%）才让两个量真正分道扬镳，
       变异随即被抓住。
    2. **一种会必然误报的定位方法**。用"扫描找最偏离的那一行"当 `seamY` 是循环论证：任何含
       文字或进度条的裁图都必然有一行高偏离。实测真机帧用这种猜法会把**进度条**（亮度 118、
       跨度 37%）当成缝线而误报 FAIL；给它几何算出的真实接缝行 31，跨度只有 2.1%，正确判
       PASS。所以 `seamY` 必须由几何提供，`detectSeamLine` 缺参数直接抛错，不兜默认值。
       （我自己最初也是靠肉眼看图以为"有缝"，被数据纠正。）
  - 新增 `scripts/seam-check/capture.mjs`：实机采集 + §3 要求的"与 demo 同一把尺"——
    `measureTube()` 逐条对应 `docs/dock-stacking-demo.html` 的 `measure()`（`overlap =
    hostPanel.bottom - ssBody.top`、`seam = composer.top - ssBody.bottom`、两面板圆角、
    `marginBottom`）。换一把尺，demo 里做过的对照就全废了。
    另加**安全闸**：拒绝连默认端口 3080、且必须显式 `--allow-state-write` —— 因为这个脚本
    要建真实待发提醒（`delivery: user`，到点以用户身份发言并起 agent 回合），本仓库开发期间
    已因此出过一次事故。四种调用路径实测均按预期拦截。
  - §4 补实一处**悬空声明**：`docs/design-decisions.md` 写着"宿主 rc 升级 checklist 因此追加
    一项"，但 runbook 与 verification.md 里根本查不到 `data-queue-dock` —— 声明没有落点等于没写。
    现在 `docs/notes/dock-alignment.md` §8 第 10 项给出两条**实际跑通**的 grep 检查与判据
    （A：hook 是否还在；B：`_panel` 是否仍是顶圆角底直角的 attach 式），并说明失配的后果是
    **静默退化**（不报错、不变红，只有肉眼可见），哈希前缀用后缀匹配别锁整串。
  - **仍未覆盖**：判据 2（侧线连续）与判据 4（solo 逐像素基线）需要整根管子范围与一份修复前
    基线裁图，接缝带裁图不够长；且浅色主题、展开/收起、DPR=2 那几格矩阵需要实机环境采集。
    脚本与安全闸已就位，缺的是"在隔离实例上跑一遍"这一步运维动作，不再是能力缺失。

- **fix** 重建 `lib/client.js`，让 issue #7（继续图标配色与其它操作图标统一）**真正生效**。
  - `7f6b5a5`（经 PR #8 并入 main）改了 `src/client/components/ScheduleDock.tsx` 与
    `src/client/styles.ts`，但**没有重建 `lib/client.js`**。本仓库把 `lib/` 作为跟踪的
    构建产物发布，所以 1.4.0 里跑的仍是旧 bundle：`ss-paused-active` 类与它的
    `--dsw-alias-state-success-primary` 绿色规则各残留一处，用户看到的「继续」图标
    依旧是绿色，而源码已要求它与其他操作图标同色。
  - 复现方式（可长期用作守卫）：干净检出 `main` → `node build.mjs` → 与提交的
    `lib/client.js` 比对，`ss-paused-active` 提交版 2 处 / 重建版 0 处。
  - 本 PR 只含重建产物，diff 严格限于那两行；不改任何 `src/`。
  - **流程教训**：改 `src/` 必须同 PR 重建 `lib/`。#47 之后 `npm run build` 不再自动
    外溢到 profile，但「提交里带不带产物」这件事反而更需要人自觉——建议后续加一条
    CI 守卫（干净检出后 build，`git diff --exit-code lib/` 非零即失败）。

- **fix** 提醒 dock 与宿主 QueueDock 同屏时接缝双缘重影（issue #41）：队列条底边是"直角 + 开口"
  的消缝设计，提醒面板的顶圆角 + 顶描边压进它被盖住的 3px，两种收口相撞。修法（B2，宿主零改动）：
  提醒条紧邻队列条时顶边直角化、去顶描边，两段连成一根无缝管子；-9px 重叠是消缝手法、刻意保留，
  没有队列条时规则不命中、单条 dock 观感零变化。详见 design-decisions §8.6。

- **fix** `npm run build` 不再静默部署到 `~/.dsh/profiles`（issue #46）。构建与部署拆开：
  `npm run build` 只写本地 `lib/`，要同步给运行中的 DSH 需显式 `npm run deploy`
  （或 `node build.mjs --deploy` / `DSH_LATER_RELINK=1`）。
  - 原先重链是 build 的**默认副作用**，两层代价：① 未合并、未评审的分支只要 build
    一次就进到运行中的 host；② 多个 worktree 经 profile **共享 inode**，彼此静默覆盖。
    后者已实际发生过：主 worktree 的一次 build 把未合并的修复写进了另一个会话的工作树
    （`wt-issue-36/lib/user-tools.js` 与主树同 inode、内容含 4 处 resolver 而它自己
    HEAD 只有 3 处，而那个会话自身一行未改）。
  - **`npm run watch` 是最严重的形态**：它每次文件变动都 `execSync('npm run build')`
    （`watch.mjs:45`），等于**持续自动部署**。现在 watch 复用同一策略，默认不再外溢；
    要保留旧行为用 `DSH_LATER_RELINK=1 npm run watch`（子进程继承环境变量）。
  - 跳过部署时**必须打印提示**并给出三条显式路径 —— 否则「build 完 GUI 没变化」会被
    当成构建失效去排查，而 #11 当初引入重链正是为了治这个。行为变了，噪音也得跟着变。
  - 决策抽成纯函数 `scripts/relink-policy.mjs`：`build.mjs` 是带副作用的顶层脚本
    （tsc/esbuild/linkSync），测试导入它会**真的改写 profiles**，所以「要不要重链」
    必须能在不执行构建的前提下被钉死。优先级 `--no-deploy` > `--deploy` > 环境变量 >
    **默认关**。
  - 测试：新增 9 条（`tests/build-no-silent-deploy.test.mjs`）—— 策略穷举（默认关、
    显式开、`--no-deploy` 最高优先、跳过提示含三条路径）、接线守卫（build 必经策略、
    watch 不得自建重链、package.json 有 deploy）、以及一条**端到端**：造假 `HOME`
    放哨兵产物，默认构建后哨兵必须原样在、`--deploy` 后才被替换。
    端到端做过**变异验证**：把把关改成恒不成立 → 结构守卫与端到端双双变红。
    （第一次变异写错了 —— `if (!gate) {提示} else if (true) {重链}` 里 else 根本不会
    执行，测试全绿是假阴性；这也说明「测试通过」本身不构成证据。）

- **fix** dock 行内编辑改文案静默失败（issue #44）：在待发列表里改一条提醒的文案并保存，
  宿主返回 `schedule_not_found`，用户以为已经改好了。
  - 根因是**一处漏改**：投影有意把 uid 当作 `id` 暴露给客户端
    （`src/projection.ts:179` `id: uid ?? record.id`），所以 dock 传 uid 是正确的，
    host 侧要用 `resolveActiveScheduleId()` 换算。`userScheduleDelete` 与
    `userSchedulePause` 都调了它，**唯独 `userScheduleEditPrompt` 没有** ——
    同一个 uid 删除能成功、改文案却失败，这个不对称本身就是最强证据。
  - 为什么 337 个测试全绿而 bug 长存：既有编辑用例传的是 `created.id`（真 schedule
    id）和字面量 `'schedule-past'`，**从没传过 uid**。补的正是这条从未走过的路径。
  - 修复有个坑必须避开：`getPaused(sessionId, uid)` 这张表**以 uid 为键**，所以只有
    「活动项查找」能用换算后的 id，暂停项查找**必须继续用原始 `id`**，否则把一个 bug
    换成另一个（暂停项反而改不了文案）。代码里就地写了警示注释，并有专门断言钉住。
  - 顺带改进报错：`未找到定时任务 ${scheduleId}` 改为回显**调用方传入的 id**。本次
    问题难查正是因为报错里的 id 与用户/dock 手里那个对不上号；传真 schedule id 时
    两者相同，无歧义。
  - 测试：新增 5 条（`tests/edit-uid-resolution.test.mjs`）—— uid 编辑成功、真
    schedule id 不回归、暂停项按 uid 仍可编辑、报错回显原始 id、以及一条**结构守卫**
    （编辑必须调 resolver；paused 查找必须用原始 id；删除/暂停/编辑三个操作现在都要
    经过 resolver，将来再漏一处会直接被拦）。**变异验证过**：把 resolver 退回原状 →
    行为测试与结构守卫双双变红。另验证 uid 跨编辑保留（否则 dock 行认不回该任务）。

- **feat** 折叠分组徽标上的「定时任务」改由本插件自己注册 facet（issue #36）。
  - 迁移前那一格由 dsh-group-status 的过渡适配器**代管**：它 `require('dsh-later/client')` 读我们的
    摘要 store，再按具名字段与色档反推画图。语义一直归本插件，实现却写在对方仓库里——任一方改
    口径，另一方既不报错也不报警，只静默显示成旧读数。现在按 group-status 的 facet 协议 v1 由本
    插件登记**同名**的 `dsh-later.schedule`：同 id 冲突由来源决胜（provider 恒胜 legacy），与两家
    apply 的先后无关，所以一注册适配器就自动让位，不需要协调发布顺序。
  - **基线逐字不变**：`count` 仍是「组内**有任务的会话数**」（不是任务数）、色档紫 / 橙 / 红、
    只有 urgent 与 overdue 才脉冲、文案 `N 定时任务` / `N Scheduled`、图标官方描边时钟 14px。
    `tests/group-status-facet.test.mjs` 把那份适配器算法**照抄成 oracle** 与实现对拍（zh / en 双语、
    跨层 merge、图标元素树比组件身份）；对方删掉 `legacy/` 之后，这份 oracle 仍留在本仓当回归线——
    以后想改显示口径必须先过它，改动不再能静默生效。
  - 分层：新增 `src/schedule-facet.ts`（零 React、零 DOM，fold / merge / label / 取色都在里面，
    `node --test` 直接跑）与 `src/client/group-status-facet.ts`（只做两件事：`require` 容错、画图标）。
    取色函数对**未知色档回落 info**——协议明文「新增 tone 取值不升版本」，直接下标取值会拿到
    `undefined`，于是徽标跟着主题变色且不报错，正是本 issue 要消灭的那类静默漂移。
  - 容错三态：未安装 / 未启用（`require` 抛）与「对端是旧版、还没有登记面」都**静默跳过**——这两
    种是正常部署形态，每次启动刷一条没人能处理的警告只会淹掉真问题；对端有登记面但协议版本对不上
    则留**一条 `console.warn`**，因为「我注册了为什么没显示」必须可诊断。三条路径都不影响本插件
    其余功能。
  - dsh-group-status **不进** `dsh.client.external`，也**不进** client 的模块级 `inject`：顶层 inject 是
    fiber 激活门控（issue #34 那次 P0 就是它踩的坑），列上这个可选搭档等于把整个定时功能押出去。
    这条不变式由单测锁住。
  - 顺带把 `STATE_RANK` 从 `schedule-summary.ts` 导出复用：分组聚合与 facet 的跨层合并认同一套
    「谁更紧急」，两处各写一遍就是徽标与行内读数漂移的起点。
  - 验证：两个 tsconfig 全过；`npm test` 337 通过（本 issue 新增 28 条）。本机 DSH（装了
    dsh-group-status 0.2.2）加载新产物后无新增 console 报错；折叠徽标本身需要「折叠分组内有会话
    挂着提醒」这个真实条件，本次**未**在线上目视比对，显示层的一致性由上述基线对拍承担。

- **fix** P0：插件 host 入口永久 pending，导致 `/later`、`/schedule`、`/user-schedule-*` 集体消失。
  - 根因：`src/index.ts` 的模块级 `inject` 里列了 `'locale'`。cordis 把顶层 `inject` 当
    **激活门控**——服务不来，整个入口就不启动，`ctx.commands.register` 一次都没执行。
    而 `locale` 是 client 侧服务（`@deepseek-ai/dsh-client-locale`），host 平面上永远不
    存在，于是这个门控永远不开。宿主日志形态：
    `later (dsh-later): pending (waiting for service: locale)`。
  - 引入方是 b7fc4b7（host 侧文案 i18n）。讽刺的是那三处消费点本来就写成
    `ctx.get('locale')?.` 可选链——作者预留了「拿不到就走默认语言」的容错，但入口从没
    运行过，容错永远执行不到。
  - 修法：从 host 顶层 `inject` 摘掉 `locale`。拿不到语言只是走默认值，而不是整个插件
    不加载。
  - 新增 `tests/host-entry-activation.test.mjs` 锁三条不变式，并做过变异验证（把
    `locale` 加回去，测试立刻变红）：host 顶层 inject 不得含 client 平面服务；locale
    消费点必须保持可选链；client 入口**可以**列 `locale`（那里它真实存在）——两代平面
    有意不对称，防止有人「统一两边」把它加回 host。
  - 顺带确认该列的服务仍在（`agents`/`sessions`/`tools`/`commands`/`settings`），避免
    「为修 bug 把依赖删光」让插件静默退化。

- **fix** 设置页补上「允许长文本提醒」与「提示字符上限」两行——此前 README 的指引不可达。
  - 根因：这两个字段一直**只有 host 侧管线**（`Config` 里有、`resolvePromptLimits` 会读、
    客户端 hook 也消费），但设置卡从未渲染过对应行。于是 README「在 DSH 设置 → 插件 →
    Session Scheduler 开启 `allowLongPrompts`」指向一个 UI 上不存在的开关，用户只能手改
    配置文件。属于「spec 有、实现无」：`docs/ui/01-component-specs.md` §6.2/§6.3 与
    `08-microcopy.md` §6.1/§6.2 早就把它们当卡片字段写。
  - 按 §6.3 实现联动：开关关闭时 `maxPromptChars` 输入框**禁用并灰显**，就地常驻说明
    「开启「允许长文本提醒」后可调」，并以 `aria-describedby` 关联给读屏。不用 tooltip——
    disabled 控件上的 `title` 在多数浏览器里不触发，等于没有提示。切换开关**不自动改动**
    已填数值。
  - 非法值（非数字 / <1 / 小数）即时校验并阻断保存，与 `maxSchedules` 同口径。
  - **顺带修掉一个会让新字段一上线就错的渲染缺陷**：布尔渲染原先写死「缺省即 `true`」
    （`v === false ? 'false' : 'true'`）。这对 `showButton`/`confirmDelivery`/`advancedSyntax`
    碰巧正确——它们恰好都默认开；而 `allowLongPrompts` 默认**关**，沿用会让开关显示「开」
    而宿主按「关」处理，用户看到上限已启用却仍被 1000 字符拒绝。改为按字段声明的
    `defaultValue` 判定（`displayValue` / `baselineValue` 两处）。
  - 锁住字段的非法草稿两个方向都拦：既**不**锁死保存按钮（否则用户关掉开关后发现整张卡
    保存不了，会误以为关不掉开关），也**不**写进配置（否则脏值落库）。
  - 测试：`upstream-compat` 那条「Config 每个可编辑字段都要有设置卡入口」的守卫，此前靠
    `KNOWN_UNRENDERED` 点名豁免这两个字段；补齐后**清空豁免名单**。守卫的反向断言在本次
    改动中如期报错、逼着删豁免，机制本身保留。另新增 11 条源码级契约测试
    （`tests/long-prompt-settings.test.mjs`），覆盖三处字段齐全、默认值与 host 同源、
    联动禁用、草稿双向拦截、双语文案，以及一条 TDZ 守卫（gate 常量必须声明在 `handleSave`
    /`invalidField` 之前，否则整张设置卡渲染时直接 ReferenceError 白屏——本次改动过程中
    就差点以这种写法引入，靠这条断言钉死）。
  - 文案纠错：README、两份设计文档与 `src/index.ts` 注释都把 1000 字符这个**上限**写成
    「下限」（英文原文一直是 "cap"），改为「上限」。`src/user-tools.ts` 里「注入防护的
    保守下限」语义正确，未动。
  - 实机核对（`127.0.0.1:3080`）：两行渲染在位；默认态开关关、输入框禁用、常驻提示可见；
    打开开关即时解禁且提示消失；填 `abc` 后输入框标红并提示「请输入有效的数字。」、保存
    按钮禁用；再关掉开关，保存按钮恢复可用（非法草稿被拦下、未写库）。

## 1.3.0 — 2026-10-10

- **feat** `/later` 附件支持：带图提交不再被拦截，附件写进 sidecar，到点按记录顺序拼在文本块之后代发。
- **feat** 多次写法（Beta，默认开启）：`+1h*3`（等间隔×N）、`+1h+1h+0.5h`（相对链式）、`15:32+16:32`（绝对锚点）展开成 N 条独立 one-shot 任务。上限 10 条、最小间隔 60 秒。
- **feat** 残片守卫：`+1h*3 x` 不再静默误解析成单条，一律显式报错。
- **fix** 时区墙钟修复：UTC 负偏移时区（如 `America/Los_Angeles`）整体错一天的问题。
- **refactor** UI 图标全部改用官方图标集 `@deepseek-ai/dsh-client-ui-primitives`（issue #19）：删掉 8 处手写内联 SVG 与 3 处文本符号，统一换 `<IconXxxRegular />`。dock 操作按钮改为 portal 化的 `DockTip` tooltip。
- **fix** 定时配置面板抬升面对齐官方风格（issue #24）：背景/描边/阴影/圆角/层级对齐官方 PickerPopover，面板 portal 到 document.body，定位改用官方 `useAnchoredPosition`。
- **docs** README 与微文案补上多次写法、附件与设置项说明。

## 1.2.0 — 2026-10-09

- **feat** 暴露跨插件「定时任务摘要」公共 API（issue #17）。
  - 新增 `src/schedule-summary.ts`（纯函数，宿主/浏览器/`node --test` 共用）：
    `buildScheduleSummary` 把 `sessions.list` 折叠成
    `Map<SessionId, { count, pausedCount, nextAt, state }>`；`summarizeScheduleGroup`
    按分组聚合（会话数/任务数/最早触发/最高优先级，`overdue > urgent > scheduled`）。
  - 新增 `src/schedule-summary-store.ts`：可订阅 store（`getSnapshot` / `subscribe` /
    `reload` / `dispose`）+ 全局登记表，**唯一数据权威**——内部负责 `sessions.list`
    订阅、30s 状态 tick 与 60s `session.list` 读 RPC（仅页面可见时）。
  - 新增 `src/client/useScheduleSummary.ts`：React 订阅 hook（`useSyncExternalStore`，
    store 迟到时自动重渲染）。
  - `lib/client.js` 导出 `getScheduleSummaryStore` / `subscribeScheduleSummaryStore` /
    `useScheduleSummary` / `buildScheduleSummary` / `schedulesOfProjection` /
    `summarizeScheduleGroup` / `createScheduleSummaryStore` 及类型；消费方（如
    dsh-group-status）声明 `dsh.client.external: ["dsh-later"]` 后
    `require('dsh-later/client')` 即可使用。契约见
    [API 参考 §7](./docs/technical/03-api-reference.md)。
  - **refactor** 侧栏 badge 不再自己读 `sessions.list` / 周期 `refresh()`，改为消费同一个
    store：外部插件读到的摘要与本插件行内 badge 必然同源，且 `session.list` 读 RPC
    不再被拉两次。
  - 新增 15 个单测：纯逻辑（数量/状态分档/暂停语义/分组聚合/判等）、store
    （列表变化、状态 tick、refresh 闸门、dispose、登记表）与构建产物契约
    （`lib/client.js` 导出面 + apply 登记/注销 store）。

- **feat** 侧栏 badge 进度环（方案 A：track + prog 双环）。
  - 新版时钟 glyph 从单环改为双环：`ss-clock-track` 恒定底环（总窗口参照），
    `ss-clock-prog` 进度弧从 12 点顺时针填充（`stroke-dashoffset` 驱动）。
  - 新增 `progressFrom` 字段（`PresenceSummary`）：窗口起点时刻（epoch ms），
    只跟随 `nextAt` 那条任务。
  - 新增 `windowStartOf` 推导逻辑，按优先级取窗口跨度：
    1. `window_seconds`（宿主/投影显式给）→ 最权威
    2. `after_seconds` / `every_seconds`（按 `kind` 推）
    3. `created_at`（`at` 类型回退）
    推不出则 `progressFrom` 缺省，视觉退回恒定整环（旧形状即退化态）。
  - `progressOf(entry, now)` 返回 0–1 比例；超时停满环（不绕出去）。
  - urgent 只脉冲底环（进度弧跟着闪会让比例不可读）。
  - 减少动效模式：进度弧位移过渡一并停。
  - 新增 11 个单测：after/every/at 窗口推导、window_seconds 优先、退化/非法值、
    多任务窗口跟随 nextAt、暂停项排除、camelCase 兼容、无窗口时形状不变。
  - `sameScheduleSummary` 补 `progressFrom` 比对（暂停→恢复窗口换了但 nextAt 未变时
    仍需通知订阅者刷新进度环）。

## 1.1.0 — 2026-10-09

- **feat** 设置页 UI 对齐官方 `SettingsForm`：从折叠卡片改为裸表单，字段直接平铺。
  - 移除 `ss-card` 容器、折叠头部、chevron、未保存徽章（`ss-card-pending`）。
  - 布尔字段改用官方 toggle switch（`role="switch"`），不再用 select + 开/关文案。
  - CSS 类名对齐官方（`ss-settings-form`、`ss-toggle-row`、`ss-toggle-switch`）。
  - 清理死代码：移除 `onKey`/`offKey` 字段声明及 `optionOn`/`optionOff`/`optionEnabled`/`optionDisabled` 字典键。

- **feat** 新增 `schedule-compat` 兼容层：统一处理不同 DSH 内核代次的 schedule 编解码差异。
  - 新增 `src/schedule-compat.ts`（226 行）及其编译产物 `lib/schedule-compat.js`。
  - 上游跨代兼容逻辑收敛到单点维护，新 rc 落地只需改矩阵 + 重跑 sync 脚本。

- **feat** 插件列表显示专属图标：新增包根 `icon.svg`，并在 `package.json` 声明
  顶层 `icon` 字段。
  - 图形沿用侧栏「定时状态」badge 的几何（圆环 + 上/右指针），配色改为
    官方插件图标的蓝色渐变区间（`#7AC2FF → #4A65E8`），使其与官方图标同属一个家族。
  - 配色决策依据：实测 4 个带图标的官方包，**全部硬编码十六进制，无一使用
    CSS 变量或 `currentColor`**（插件图标经 `dsh-app-boot` 的 `iconOf()` 读成
    base64 data URL 以 `<img>` 渲染，因此**不执行 CSS 动画、不继承页面颜色**）。
    统一感来自「取色区间 + 画法」而非令牌系统，故采用同区间色号。
  - 侧栏 badge 保留品牌紫 `#8b5cf6`：那是插件自身语境下的**状态色**
    （紫 / warn / error 三态区分），与插件列表的外部语境不冲突。
  - `icon.svg` 已加入 `files`，避免 `npm publish` 漏发导致图标丢失。

- **fix** 支持 DSH `0.2.0`（此前在 0.2.0 上**完全失效**）。
  - 现象：升级到 DSH `0.2.0-rc.2` 后插件整体不加载 —— 无按钮、无命令、无工具。
    宿主日志：`skipping profile bundle "dsh-later": Plugin dsh-later@1.0.0 is
    incompatible with dsh 0.2.0-rc.2 …`。
  - 根因：**不是代码失效，是 peer 声明缺口**。内核自 0.2.0 起把 peer 兼容校验
    **从警告升级为硬门槛**（`dsh-app-boot` 的 `evaluatePluginCompatibility`）：
    peer 范围不满足即**整插件跳过**。而 peer 枚举止于 `^0.1.7-rc.2`，
    8 个 kernel-scoped 包对 `0.2.0-rc.2` 全部不满足（预发布版必须显式枚举）。
  - 核对结论：**API 面全部保持，无需改动任何业务代码**。Session 形状未变；
    `dsh-schedule` 导出面完整（`renderRecurringReminderBatchFraming` 仍在，
    0.1.7 的桥接照旧命中）；`dsh-llm` 的 `createUserMessage` /
    `boundContextSummary` 在，`schedule` message source 仍有效；
    `dsh-agent` 的 `followup` / `steer` 语义未变；`defineTool` 在。
  - 实证：devDependencies 固定到 `0.2.0-rc.2` 后，host + client `tsc --noEmit`
    **双端 0 错误**，`npm run build` 走 tsc 原生路径（无 esbuild 降级），测试全绿。
  - 处置：`KERNEL_GENERATIONS` 追加 `0.2.0-rc.2` → 重跑 `sync-peer-matrix.mjs`
    重写 8 个 peer 范围 → dev 推进到 `0.2.0-rc.2`。历史代次仍全部支持，
    未核对的 `0.3.0-rc.1` 仍被正确拒绝。
- **fix** 多条合并提醒的 framing 措辞对齐上游（`0.2.0` 的第二处差异）。
  - `dsh-schedule` 在 0.2.0 把 one-shot 与 recurring 的防护句统一收敛为
    `This is a scheduled message from the user`（旧句为
    `Present reminder_prompt_json … not new user instructions.`）。
  - 单条路径直接调上游函数，自动跟随；但**多条到期一次性合并**（P1-5）是上游
    不提供的形态，由插件自渲染，其来源行是上游文案的**本地副本**，需手工对齐，
    否则同一会话里单条与合并提醒的措辞会不一致。
  - 新增护栏：从上游 `renderReminderFraming` **实时取**来源行比对本地副本，
    不硬编码任何一版文案（故支持任意多代）。反向验证：改回旧长句即失败。
  - 注：该问题被 peer 缺口**掩盖**——插件不加载时 framing 根本不会执行，
    修完 peer 后测试才暴露出来。

- **fix** 本地开发依赖代次与运行时代次对齐（`0.1.2-rc.1` → `0.1.5-rc.1`）。
  - 起因：`devDependencies` 原先写的是**完整 peer 范围串**，包管理器因此解析到
    「满足范围的最老可用版本」= `0.1.2-rc.1`，而真实运行环境是 `0.1.5-rc.3` ——
    **测试与类型检查落后运行环境整整一代**，API 漂移在本地无从暴露。
    上一个 peer 缺口正是这样漏掉的（本地怎么测都发现不了）。
  - 处置：`devDependencies` 改为**固定到最新已验证代次**（全部 kernel-scoped 包同代次）；
    `peerDependencies` 仍为完整范围串，两者意图不同、不再混同。
  - `scripts/sync-peer-matrix.mjs` 同步改造：peer 写范围、dev 写固定代次；且只在 dev
    已是范围串或缺失时才改写，避免把有意固定的版本冲掉（保持幂等）。
  - 结果：`npm run typecheck` 通过且无新增错误；`npm test` 183 通过 / 0 失败。
  - 新增守卫：dev 必须是具体代次而非范围串、必须落在已验证列表内、全部包同代次、
    且等于最新已验证代次；另有显式登记当前 dev 代次的断言，使代次变更在 diff 中可见。
- **fix** 补 `0.1.5` 内核代次的 peer 声明：此前只声明 `^0.1.1-rc.2 || ^0.1.2-rc.1`，
  而实际运行的宿主早已是 `0.1.5-rc.3` —— 在真实 `npm install` 下**不满足声明范围**
  （`semver.satisfies` 默认预发布语义为 false）。本地经 profile symlink 加载，
  peer 不参与解析，所以一直没暴露。
  - 实测确认 `0.1.5-rc.1/rc.2/rc.3` 可支持：隔离安装后 15/15 host 模块导入通过，
    且 `apply()` 以最小假 ctx 实例化成功；与原有 `0.1.2-rc.1` 的注册顺序逐项相同。
  - **未跟进 `0.1.7`**：该代有破坏性变更，实测 15 个模块中 4 个因缺符号失败 ——
    `allocateScheduleId` 导出被删（插件 5 处调用）、`renderEveryReminderBatchFraming`
    改名为 `renderRecurringReminderBatchFraming`、`createAfterScheduleRecord` 等
    新增必填 `title` 参数。适配是独立工作项，不能靠加一行 peer 蒙混过去。
  - 代次守卫测试改为数据驱动（原先硬编码两代），并加强：`peerRange` 下界必须恰为该
    代次本身（不借用更早下界），代次表严格递增。

- **fix** 「插话发送」会**静默丢失**：提醒从列表消失，消息却没送达模型。
  - 根因：`agent.steer()` 入 `next-step`，语义是「下一个 step 边界消费」。
    若插话恰好撞上 `turn/start`，核心 `inbox.claim('next-step', …)` 会把**整批**
    取走交给一个**请求上下文已定**的 step —— 消息落进 surface，却不进实际请求。
  - 实测时序（会话日志，毫秒级）：
    ```
    t+0ms   agent/inbox/spliced  → 插入 next-step
    t+1ms   turn/start           → turn 17 开始（同一毫秒）
    t+1ms   agent/inbox/spliced  → removedCount:1, inserted:[]  ← 被 claim 吞掉
    t+17ms  request/header       → 请求已按旧上下文构造
    ```
    该轮模型回复与提醒内容无关，确认它从未读到这条消息。
  - **并有第二个独立缺陷**：旧实现在 `steer()` 之后**无条件**写 `dispatch`，
    把提醒移出 active。投递失败 = 提醒永久消失且**不可重试** ——
    虚假的成功信号掩盖了真实的投递失败。
  - 修复一（默认投递方式 `followup`）：入 `next-turn`，与 `next-step` 是两条独立
    队列，`claim('next-step', …)` 不触碰它，**竞态在结构上不存在**；语义等价于
    「正常发送」（独立成轮）。可在设置里改回 `steer`。
  - 修复二（投递确认，默认开）：投递后**读会话日志**核对 message id 是否真的落盘。
    未确认且「未确认时 = 保留条目」时**不写 dispatch**，提醒留在列表中可重试，
    并在行内明确提示 —— 不再静默。
  - 未确认处理可选「丢弃」（恢复旧语义）；选择时 UI 明示「静默丢失将重新变得可能」。
  - 确认机制**只依赖已持久化的日志格式**，不监听 `inbox/claimed` / `request/header`
    等核心运行时事件，避免与核心内部时序隐性耦合。
  - 设置 UI：新增「插话投递」三项目；选 `steer` 时常驻显示风险提示，且文案随
    「投递确认」开关切换口径（关确认时明说不会保留条目）。
- **fix** 「插话发送」对普通（非暂停）提醒报 `schedule_not_found`。
  - 根因：GUI 传的是**投影里的 id**，而它「稳定 uid 优先」
    （`wireItemOf`：`id: uid ?? record.id`）；日志记录却用 `schedule-N`。
    `steerById` 直接 `ScheduleId(id)` 后按 `r.id === scheduleId` 比对，
    **没有做 uid → 日志 id 的换算**，因此所有由用户工具创建的提醒插话都失败。
  - 实测：uid `f0fc0c90…` vs 日志 id `schedule-1`，必然不相等。
  - 删除 / 暂停路径早已用 `resolveActiveScheduleId` 做了这层换算，插话是漏网的。
  - 修复：插话先按 uid 查当前活动的日志 id（`findScheduleIdByUid`），
    找不到再当作日志 id 原样使用（兼容无 uid 的旧数据与直接传 `schedule-N`）。
    dispatch 事件仍写**日志 id**，不是 uid。
- **fix** 进度条「速度不均衡 / 每秒一跳」：相位参数被逐秒重算导致双倍计数。
  - 根因：CSS 动画挂上后会**自行推进**；而 `useNow(1000)` 每秒触发重渲染，
    每次都把 `delay = -(now - start)` 重算一遍，浏览器便把播放头又前移 1 秒
    —— 这一秒动画本已走过，于是**每秒多跳一次**。
  - 实测证据：`--ss-bar-delay` 每约 1s 精确变化 **-1000ms**；宽度增量出现
    `0.0153 → 0.3485`（约 23 倍）的周期尖刺，周期与 tick 一致。
  - 修复：把「挂载时刻」用 ref 冻结（`phaseAtRef`），delay 只由它计算。这样
    重渲染（含每秒 tick）不改变参数；重新挂载（切会话回来）时 ref 重取当前时刻，
    相位仍按绝对时间对齐。
  - 修复后实测：`--ss-bar-delay` 恒定（`delayStable: true`），增量极差
    0.3336 → **0.0061**（缩小 55 倍），周期尖刺消失。
  - 暂停 → 恢复仍正确重新锚定（10.33% → 10.72% 从冻结处继续，不归零）。
- **feat** 暂停态改为「原条 + 静止」（P1 定稿）：**移除**原有的灰色斜纹填充。
  - P1 原文（docs/ui/16）：暂停 = 原条 + 静止，**不加任何纹理、不变色**。
    状态由「动 / 静」对比表达：进行中进度条在推进，暂停时停住。
  - 实现：暂停态只有 `animation: none`；进行中仅有推进动画
    （`ss-dock-bar-progress`）。**不额外叠加流动/斜纹/冰封**——真机实测两条
    的背景与底色完全一致（`background-image: none`、同为 `rgb(249,250,251)`），
    只差动画在不在跑。
  - 修正记录：先前实现误把「进行中加流光斜纹」当作 P1 的一部分（源于
    设计探索阶段 G1 方案），但那不在 P1 定义内，已移除。教训：把**独立**的
    设计决定捆进一个已拍板的方案里，会让"已确认"的范围被悄悄放大。
  - 推进动画的参数仍由 JS 注入 `--ss-bar-duration / --ss-bar-delay`
    （duration 固定为完整窗口、delay 为负的已过去量），CSS 负责声明动画，
    JS 不写 `animationName` 简写以免覆盖。
- **feat** 暂停项支持「编辑文案」与「插话发送」（此前两者都被禁用，属实现缺口）。
  - **编辑**：暂停项不在日志里（pause 时已 delete），旧实现必然 `schedule_not_found`，
    客户端只好禁用按钮。现改为直接改写 sidecar 的 `PausedEntry.prompt`——不动时刻、
    不动剩余秒数、不动 uid、不写会话事件，因此冻结进度与恢复后的窗口都不受影响。
  - **插话发送**：语义是「不等倒计时立即推送」，对暂停项恰恰最需要。现从 sidecar 留档
    取材构造消息（`user` 代发 / `context` 注入两形态与常规路径一致），投递成功后清掉留档
    （提醒已送达、应出列）。
  - 客户端：两处按钮解除 `disabled`；因宿主**不写会话事件**、投影不会立刻刷新，
    补了本地文案覆盖（`promptOverrides`）与本地摘除复用（`dismissedPaused`），
    待投影对账后自然失效。
- **fix** 暂停 / 恢复后进度条长度会变（**两处根因**）：
  - **窗口缩水（宿主）**：resume 用 `after_seconds = remaining` 重建日志记录，原窗口
    另存 `ownership.windowSeconds`；而 pause 却从日志的 `afterSeconds` 取窗口，
    于是每「恢复→再暂停」一轮窗口就缩水一次（2 分钟任务 → 暂停(120) → 恢复(85)
    → 再暂停(窗被记成 85)…）。进度条比例随之失真，实测塌缩到 2.3%。
    修复：pause 优先取 `ownership.windowSeconds`，仅首次暂停回退日志值。
  - **冻结帧基准（客户端）**：冻结比过去用 `scheduled_at` 反推，而暂停后该字段会
    换成 `originalScheduledAt`，窗口基准整体跳变。改为纯算术
    `(窗口 − 剩余) / 窗口`，并抽出 `src/bar-geometry.ts` 供两侧共用 + 单测覆盖。
  - **教训**：中途曾用「客户端墙钟」做冻结上界，导致上界随时间前进、条越缩越短
    （29% → 2.9%）；现上界仅在宿主 `paused_at` 晚于点击时补回往返耗时，
    且不影响主算式。`tests/bar-geometry.test.mjs` 锁死这两类回归。
- **fix** 删除暂停项后 dock 行不消失（**根因修复**）：投影 view 改为**以 sidecar 为准**重读 `paused`，不再信任可能陈旧的 `state.paused` 镜像。
  - 根因：删除暂停项只清 sidecar、不写会话事件——**也不能写**：该 id 在 pause 时已被
    `dsh-schedule` 删除，补写 `delete` 会抛 `schedule delete targets inactive id`，让整份
    日志读失败。
  - 而投影 cell 只在事件到达时由 `apply` 推进，且会持久化进 projection cache；客户端又按
    seq「更高者胜」消费控制帧 → 没有新事件就没有修正帧。宿主那份 `paused[]` 快照因此永久
    陈旧，**刷新页面也会被缓存恢复**（此前表现为「删不掉、且刷新后复活」）。
  - 修复：`viewUserScheduleProjection` 在 `sessionId` 可用时从 sidecar（留档的权威存储）
    重读，`readFresh` 按 mtime/size 失效，删除即刻可见。旧快照不再可能让已删行复活。
  - 客户端摘除相应收敛为「粘性直到投影变化」：仅当同 uid 以 active 复现（resume）才解除，
    不再按时间过期——过期只会让陈旧投影里的已删行复活。
- **fix** resume 先清 sidecar `paused` 再 append `create`，消除「已暂停 + 新活动」双行。
- **fix** delete 支持 wire `uid`：活动任务先映射 scheduleId；暂停项直接清 sidecar（此前 `deleted:false`）。
- **feat** 移除右下角 ⏰ 到达 toast；到点以对话消息为准。
- **feat** 暂停 / 恢复（仅 `after` + 类提醒）：dock 原地斜纹冻结，不拆分区。
  - `/user-schedule-pause` / `/user-schedule-resume`；sidecar v2 存 `uid` + `paused` 草稿。
  - 暂停 = 日志 `delete` + sidecar 留档；恢复 = `after_seconds=remaining` 重建（日志 id 会变，uid 不变）。
  - 投影 `stateVersion: 4`，wire 带 `status` / `remaining_seconds`；非 after / 已到点不显示暂停。
  - 进度条定稿 hatch（斜纹停放）。
- **chore** 上游跨代兼容收敛到 `src/upstream-compat.ts`：Session API 双轨探测
  （`ownEvents` / `events` + `seedLength`）与 peer 代次矩阵（`KERNEL_GENERATIONS`）
  单点维护。新 rc 落地：改矩阵 → `node scripts/sync-peer-matrix.mjs` → `npm test`。
  - **fix** 0.1.1 路径补上 `header.seedLength` 回退（此前恒传 `inheritedEventCount=0`，
    fork 子会话可能把继承前缀误算进用户任务）。
  - 护栏：`tests/upstream-compat.test.mjs` 锁两代形状 + package.json peer 同步。
- **fix** 悬浮卡片现在反映定时状态（修复 #4）。此前侧栏行内 badge 显示
  「有提醒」，而同一行悬浮卡片的状态区只说「空闲」，两者自相矛盾：卡片正文
  由宿主的 `sessionStatuses` 硬编码状态链生成，不认识本插件的定时任务，且
  宿主未暴露任何 hover 卡片插槽。
  - 实现方式（纯插件，零宿主改动）：在宿主已有卡片的状态区**追加**一行
    与宿主 `.hoverStatus` 同构的状态行，内容为「N 条定时提醒 + 下次触发
    时间」（到期走「等待发送」文案）。
  - 关联方式：卡片是 `body` 级 portal，与会话行无 DOM 祖先关系，改用与行内
    badge 同源的 React fiber 反查（`memoizedProps.node.id`）关联会话。
  - **纯追加**语义：不改写、不替换、不重排宿主既有状态行，`pendingInteraction`
    / `running` 等状态优先级不变；无活动定时任务的会话卡片行为完全不变。
  - 抗重渲染：卡片每次悬浮由 React 重建，依赖既有的 MutationObserver 重扫
    重插，与 badge 同一机制。
  - 探测不到宿主结构时安静跳过（绝不误标）；不依赖任何构建期 hash 类名。

## 2026-09-12

- **chore!** 插件改名 `dsh-session-scheduler` → **`dsh-later`**：消除与核心
  引擎 `dsh-schedule` 的命名撞车，贴合 `/later` 用户心智。变更范围：
  包名、cordis 条目 id（`later`）、settings 命名空间（`dsh-later`）、
  sidecar 目录（`plugin-state/later/`）、client 端 localStorage key。
  - sidecar 自动迁移：首次启动把旧目录 `plugin-state/session-scheduler/`
    的所有权文件搬到新目录（rename 优先，失败逐文件复制，幂等），
    已设定提醒不丢失。
  - 升级前已暂存在浏览器 localStorage 的离线任务不再读取（量级通常为
    0；如需找回，手动把 key `dsh-session-scheduler:pending` 改名为
    `dsh-later:pending`）。
  - 历史会话日志中的 `session-scheduler/user-schedule` 事件键与环境变量
    `DSH_SESSION_SCHEDULER_STATE_DIR` 保持读兼容（后者仍被识别，新名为
    `DSH_LATER_STATE_DIR`）。
  - 已装旧版的机器需先 `dsh plugin remove` 旧插件再 add 新版（包名已变）。

## 2026-09-10

- **fix!** 用户任务所有权移出会话日志，改存插件 sidecar 文件
  （`~/.dsh/plugin-state/session-scheduler/<sessionId>.json`），根治「宿主
  持久化静默丢行 → 历史 seq 缺口 → 整份会话拒读」事故。`/later` 的代发
  形态、GUI 面板归属、fork 隔离语义不变。
  ⚠️ 降级单向门：本版本后新建的任务无伴生事件行，回退旧版插件时这些任务
  在面板不显示（引擎触发不受影响）。整机备份请包含
  `plugin-state/session-scheduler/` 目录。
- **chore!** 仓库结构对齐项目布局：插件包移入 `dsh-session-scheduler/`
  子目录，设计工作区（PRD / 设计文档 / 源码分析）入库。
- docs: 根 README 恢复为插件版；项目总览留档 `docs/project-overview.md`
  （仓库根）。

## 2026-09-09

- docs+tooling: README 媒体刷新，新增截图采集流水线（`scripts/capture/`）。

## 2026-09-08

- feat: 会话状态图标添加动画效果。
- docs: README 全面改版为用户向介绍/展示/使用，技术内容移入 docs/。

## 2026-09 及更早（v1.0.0）

- 用户工具 `user_schedule_create/list/delete/edit` + `/later`、`/schedule`
  slash 命令；`userSchedules` 会话投影（GUI 面板 + dock + 输入框按钮）。
- 独立调度器（`runtime.ts`）：用户创建的提醒到点 dispatch + followup 注入，
  与 dsh-schedule 共用日志互不双触发。
- 智能时段排期（工作时间/午休/晚间静默）、时区处理、注入防护 framing。
