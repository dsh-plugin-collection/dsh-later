<div align="center">

<img src="assets/icons/icon-presence-scheduled.svg?v=18" width="64" alt="scheduled"/>
<img src="assets/icons/icon-presence-urgent.svg?v=18" width="64" alt="urgent"/>
<img src="assets/icons/icon-presence-overdue.svg?v=18" width="64" alt="overdue"/>

# dsh-later — 会话内定时消息插件

**中文** | [English](./README.en.md)

</div>

> 在 DSH 里给自己设提醒：**用户自己设、当前对话收到、服务端驱动、跨设备**——到点准时送达，即使你关掉了网页。

**`/later` 延迟发送** —— 不开面板，在输入框敲一行就以你的身份稍后发出（演示：逐字输入 `/later +5s` / `+3m` / `+1h20m`，回车后进入倒计时；`+5s` 那条到点真实送达）：

<p align="center">
<img src="docs/media/docs-later-full.gif" width="760" alt="/later 命令演示：输入 /later +5s 检查部署结果 → 回车 → dock 倒计时 → 到点以你的身份送达"/>
</p>

---

## 使用方法

### 定时面板

点输入框右侧的 **「定时发送」** 打开面板。面板以**输入框内容**作为提醒内容，选好时间后点 **「加入 · HH:MM 发送」**（未选时间时该按钮不可点）即可；输入框上方随即出现倒计时条。

| 能力 | 说明 |
|---|---|
| 快捷芯片 | `10分钟后` / `1小时后` / `工作时间` 一键填充（智能时段可在设置里改） |
| 自定义时间 | 「自定义…」展开日期 + 时间输入框 |
| 任务列表 | 本会话已设定的任务，可逐条删除 |

暂停、恢复、改内容、立即发送都不在面板里，在 [待发送 dock](#待发送-dock) 上逐条操作。

### 时间格式

以下写法都认（`/schedule`、`/later` 与面板自定义时间共用；标了「仅 `/later` `/schedule`」的写法面板不收）：

| 类型 | 示例 |
|---|---|
| 相对时长 | `+30m` · `+1h30m` · `+90s` · `+1w` · `30分钟后` · `半小时后` |
| 当天时刻 | `15:32` · `9点` · `9点半` · `1532` |
| 相对日 + 时刻 | `明天9点` · `后天 10:00` |
| 日期 + 时刻 | `8月21日 15:32` · `2026-08-21 15:32` · `0821-1532` |
| **重复 · 等间隔**（仅 `/later` `/schedule`） | `+1h*3 喝水` · `+30m×2 看构建` · `两小时后×3次` |
| **重复 · 链式序列**（仅 `/later` `/schedule`） | `+1h+1h+0.5h 盯发布` · `+1h +30m 交周报` |
| **锚点序列**（仅 `/later` `/schedule`） | `15:32+16:32+17:32 三会` · `9:00+1d+1d 打卡` · `明天9点+1h` |

上表三行加粗的都属于 **[高级语法（实验性）](#配置)**，可在设置里一键关闭；其余写法不受开关影响。

只写时刻（如 `1532`）时，若今天已过会自动顺延到明天（最多 7 天）；写了 `明天`/`后天` 则按字面理解，该时刻已过会提示改用具体日期；只写月日（如 `8月21日`）时，今年已过则顺延到明年。

多次写法的规则（**首次落在第一个间隔之后**）：

| 写法 | 展开成 |
|---|---|
| `+1h*3` | t+1h、t+2h、t+3h |
| `+1h+1h+0.5h` | t+1h、t+2h、t+2.5h（链式累加，用来写「提前 2h→1h→30m」这类梯度催办） |
| `15:32+16:32+17:32` | 今天 15:32、16:32、17:32（三个挂钟时刻） |
| `23:00+01:00` | 今天 23:00、**次日** 01:00（后一个时刻更早则自动顺延，规则同单条） |
| `9:00+1d+1d` | 连续三天都是 9:00 |

一次最多 **10 条**，多次写法的间隔不低于 **60 秒**（单条不受此限，`/later +5s` 照旧）。`*` `×` `x` 都认，可跟中文量词（`*3次`），次数后面要留空格。每条都是**独立任务**：可单独取消、编辑、插话发送（暂停见下表）。

序列里只允许**「绝对时刻开头，往后累加」**这一个方向：`+1h+15:32` 会明确报错，不会猜。

**锚点序列与相对序列的一处差别**（有意为之，不是 bug）：

| 写法 | 落库类型 | 能暂停 | 跨夏令时 |
|---|---|---|---|
| `+1h*3` / `+1h+30m`（相对） | `after` | ✅ | —— |
| `15:32+16:32` / `9:00+1d`（锚点） | `at` | ❌（按钮置灰并说明原因） | ✅ 墙钟不变：`9:00+1d` 在回拨日相隔 **25 小时**仍是 9:00，按 86400 秒累加会漂成 8:00 |

`9:00+1d` 里的「一天」按**日历日**推进（不是 86400 秒），所以 `+1d*3` 与 `9:00+1d+1d` 在有夏令时的时区结果不同——前者按真实秒数、后者按墙钟。落到不存在的墙钟（前拨跳过的那一小时）会报错而不是悄悄挪时刻。绝对时刻（`15:32`、`明天9点`）不支持 `*次数`，会明确报错而不是悄悄变成一条。

### 命令

| 命令 | 作用 |
|---|---|
| `/schedule <时间> <内容>` | 创建一条定时提醒（到点出现在对话里） |
| `/later <时间> <内容>` | 延迟发送：到点以你的身份发出该内容 |
| `/later <时间>*<次数> <内容>` | 同上，展开成 N 条代发（`+1h*3`） |
| `/schedule <时间>+<时间> <内容>` | 同上，链式序列展开成 N 条提醒（`+1h+30m`） |
| `/later <时刻>+<时刻> <内容>` | 锚点序列：按挂钟时刻展开（`15:32+16:32`、`9:00+1d+1d`） |

```
/schedule 明天9点 提交周报
/later 1532 提醒团队同步进度
/later +1h*3 起来喝水
/later +2h+1h+30m 催我交周报
```

dock 上的按钮不是私有通道，它们就是 `/user-schedule-create` `-list` `-delete` `-edit` `-pause` `-resume` `-steer-now` 这几条命令（参数是一段 JSON），手动敲也能用；只是它们按"被点"设计，不面向手打。

### 带图片 / 文件

`/later` 可以带附件：先在输入框贴图或拖文件，再敲 `/later +10m 看下这张图` 回车。到点会**连同附件**以你的身份发出，消息形状和你手动发「文字 + 图」完全一致。

- **只有 `/later` 带附件**。`/schedule`、面板、以及模型调用工具创建的提醒都不带——这是一条安全边界：附件块只能经「你亲手输入」这条可信通道进入代发内容，模型在工具参数里夹带 `attachments` 一律无效。
- 多次写法（`+1h*3`）把**同一份**附件逐条带到每条任务上，各条仍可单独取消/编辑/插话。
- dock 行显示的是**真缩略图**。发出之前，宿主那条「按会话日志授权」的图片通道读不到它（附件还没进日志，这是预期状态），于是走宿主的本地文件路由 `GET /api/file` 出图；发出之后两条通道都通。若这台宿主的附件后端不落盘，缩略图退化成「发送后可见 + 大小」的标记——那**不代表附件丢了**，到点照样随消息发出。
- 每条任务在 dock 上最多渲染 8 个缩略图，超出显示 `+N`；非图片附件显示成「文件名 + 大小」的 chip。
- 内核 `0.1.2` 的内容块里没有 `file` 变体，非图片附件到点会退成一条 `[附件] 文件名` 文本（图片块各代次都原样透传）。见[支持的 DSH 内核](#支持的-dsh-内核)。

模型可以直接调用三个用户工具为你创建 / 查询 / 删除提醒（`user_schedule_create` / `user_schedule_list` / `user_schedule_delete`）。改内容、暂停、恢复、立即发送**不暴露给模型**，它们是 dock 行上的按钮（底层走 `/user-schedule-*` 命令，只由你亲手点）。**无限周期**提醒（每 1 小时一直发下去）只有模型这条路：让模型说「每小时提醒我喝水」，它会用 `every_seconds` 建一条周期任务；周期任务没有结束条件，需要你手动删。

模型还有一份随插件分发的 `SKILL.md`（技能名 `later-reminders`）。它常驻在模型的 skill catalog 里，管的是「什么时候该主动给你排一条提醒」和「与内核官方 `schedule_create` 怎么选」；工具参数规则不写在这里，避免与 schema 两处漂移。这个位点是可选的：宿主的装配里没有 skills 服务时它就不出现，插件其余功能照常。

### 待发送 dock

输入框上方的倒计时条，每行行尾四个按钮：**编辑提醒**（就地改内容）、**暂停 / 恢复提醒**、**删除提醒**（取消该条）、**插话发送**（立即推给 agent，不等倒计时；周期任务那一行没有这个按钮）。

暂停只对「再等 N 分钟」这一类（`after`）且还没到点的提醒开放：按挂钟时刻排的 `at` 与周期 `every` 会把按钮置灰，悬停说明原因（已到点的也只能删或发，不能再暂停）。暂停时倒计时与进度条冻结、附件留在条目上；恢复后按**剩余时长**从恢复那一刻重新排期，触发时刻随之顺延。

> ⚠️ 「插话发送」不是「确认」，点了会**马上**把提醒内容发给 agent 并唤醒模型；只想取消请点删除。

### 侧栏状态标识

有活动提醒的会话，行内会出现像素时钟（与「进行中」orb 并存）：

| 图标 | 含义 |
|---|---|
| <img src="assets/icons/icon-presence-scheduled.svg?v=18" width="28" alt="scheduled"/> | 紫 · 有定时中提醒 |
| <img src="assets/icons/icon-presence-urgent.svg?v=18" width="28" alt="urgent"/> | 琥珀 · 下次触发 ≤ 5 分钟 |
| <img src="assets/icons/icon-presence-overdue.svg?v=18" width="28" alt="overdue"/> | 红 · 已到期（等待会话空闲派发） |

鼠标悬停可见「下次 15:32 · 3 条任务」；已到期时显示「已到期 · 3 条任务（等待会话空闲发送）」；全部提醒都暂停时图标仍是紫色，悬停显示「已暂停 · 3 条任务」（暂停项没有排定时刻，所以不报「下次」）。

侧栏行的悬浮卡片里会**追加**一行状态（「有 3 条定时提醒，下次 15:32」），与宿主自己的 `空闲` / `进行中` 同构、不改写它们；已到期与已暂停各有一句对应文案。

---

## 界面展示

**定时面板** —— 快捷时段 / 自定义时间 / 已设定任务列表：

<img src="docs/media/screenshot-panel.png" width="340" alt="定时提醒面板"/>

**待发送 dock** —— 输入框上方倒计时条（行内编辑 / 取消；下方即输入框）：

<img src="docs/media/screenshot-dock.png" width="700" alt="待发送 dock 与输入框"/>

**到期真实触发** —— 到点后对话里出现「⏰ 定时提醒」消息（关网页也照常触发）：

<img src="docs/media/screenshot-fired.png" width="560" alt="到期提醒消息"/>

**动图演示**：

| 创建定时提醒（输入 → 面板 → 加入 → dock） | 到期触发（倒计时 → 收到消息） |
|---|---|
| <img src="docs/media/docs-scheduler-create.gif" width="380" alt="创建定时提醒演示"/> | <img src="docs/media/docs-scheduler-fired.gif" width="380" alt="到期触发演示"/> |

**`/later` 快捷命令** —— 不打面板，直接在输入框敲一行就以你的身份延迟发送：

<img src="docs/media/docs-later.gif" width="760" alt="/later 命令演示：输入 /later +60m 内容 → 回车 → dock 出现倒计时"/>

---

## 特性一览

- **输入框定时按钮**：一键打开定时面板，含智能时段 / 自定义时间 / 本会话已设定任务列表 / 倒计时。
- **待发送 dock**：输入框上方的提醒列表，每条可单独**取消**、**行内改内容**、**暂停与恢复**（`after` 类），或直接**插话发送**。
- **`/later` 延迟发送**：把「你现在打的这句话」稍后以你的身份发出去（和定时提醒的区别见[这里](#定时提醒和延迟发送有什么区别)）。
- **侧栏状态标识**：有活动提醒的会话，侧栏显示像素时钟（紫=定时中 · 琥珀=5 分钟内 · 红=已到期），悬停可见任务数与下次时间；全部暂停时改为「已暂停」。
- **跨内核代次可用**：从 `0.1.2-rc.1` 到 `0.2.1-rc.2` 六代逐代表过，含真 GUI 截图矩阵，见[支持的 DSH 内核](#支持的-dsh-内核)。
- **关网页也能触发**：提醒保存在服务端，关网页、换设备都会准时到达。
- **不会冒充你本人**：到点后显示为「定时提醒」消息，而不是假装是你自己发的。
- **模型会主动替你排**：随包分发的 `SKILL.md`（技能名 `later-reminders`）常驻模型的 skill catalog，用户没说「设个提醒」也会主动排程，并分清本插件与内核官方 `schedule_create` 的用途；宿主装配里没有 skills 服务时这一项自动缺席，不影响其余功能。
- **多语言**：跟随 DSH 界面语言（中文 / English），切换即时生效。
- **提醒不跨会话**：由当前会话派生出的子会话，不会带上父会话的提醒。

---

## 定时提醒和延迟发送，有什么区别？

| 动作 | 什么时候生效 | 谁发出 | 你看到 |
|---|---|---|---|
| 输入框 Enter 直接发 | 立即 | 你 | 普通用户气泡 |
| 定时面板 / `/schedule <时间> <内容>` | 到点 | 定时提醒 | `定时提醒 · HH:MM · 内容` 提醒行 |
| `/later <时间> <内容>` | 到点 | 以你的身份 | 普通用户气泡 |

> **`/schedule` 不是「延迟发送」**：输入框里那行 `/schedule …` 一按回车就会**立刻**发出去（作为一条用户消息），被推迟的只是**提醒本身**。如果你想要的是「把我现在打的这句话，过会儿当作我亲口发的」，请用 **`/later`**。

---

## 快速开始

### 支持的 DSH 内核

| 内核代次 | 状态 |
|---|---|
| `0.1.2-rc.1` | 支持 |
| `0.1.5-rc.3` | 支持 |
| `0.1.7-rc.1` / `0.1.7-rc.2` | 支持 |
| `0.2.0-rc.2` / `0.2.1-rc.2` | 支持 |

声明在 `package.json` 的 `engines.dsh`：`>=0.1.2-rc.1 <0.2.0-0 || >=0.2.0-rc.2 <0.3.0-0`；Node 需要 `^22.19 || >=24`。

两条边界说明白，免得被当成「漏支持」：

- **`0.1.1-rc.2` 不支持。** 不是代码跑不通，而是它那条依赖线在 registry 里装不出来（`@deepseek-ai/dsh-util-workspace-path@0.1.1-rc.2` 未发布），任何工具都给不出结论；上游补发之前谈不上支持。
- **`0.1.5` 按 `rc.3` 验证，不覆盖 `rc.1`。** `dsh@0.1.5-rc.1` 的内部依赖写的是 `^0.1.5-rc.1`，默认安装会把整条插件线解析到 `rc.3`，而「`rc.1` 启动器 + `rc.3` 组件」这种混装根本起不来（与本插件无关）。你实际拿到的就是统一的 `rc.3`。

六代逐代验过四个面（基线 `main@28ca1dc`，即 1.8.0，2026-10-26 实测）：装配（真内核冷启动挂上插件）、功能（到点真实投递的事件形状）、类型（整条 `@deepseek-ai/dsh*` 依赖线换成该代次后两个 tsconfig 零错误）、UI（真 GUI 里定时按钮 / dock / 面板逐代截图留档）。前三个面复跑 `npm run verify:kernels:all`，UI 面复跑 `npm run verify:ui`。实测口径、逐代结论与方法归 [docs/verification.md](./docs/verification.md) 和 [docs/notes/ui-matrix.md](./docs/notes/ui-matrix.md)，本表只报结论。

随包分发的 `SKILL.md` 那个曝光位不在这份基线里。它按**装配**而非代次决定有无（宿主装配里没有 skills 服务时静默缺席，见上文），跨代证据在 `tests/skill-provider.test.mjs`：真 `SkillRegistry` 的用例默认只跑 `0.2.1-rc.2`，其它代次要用 `DSH_LATER_SKILL_PKG` 指认该代的 `dsh-skill/lib/index.js`。

版本门禁在哪一侧生效也随代次不同：`0.2.0` 及更早的内核**不读** `engines.dsh`，只看 `@deepseek-ai/dsh-*` 的逐代 peer 枚举；`0.2.1` 起才由 `engines.dsh` 单独决定。所以「在这台老内核上被装进来了」不等于「这代内核认了你声明的范围」。

老内核上有四处可见降级：功能不丢，外观与措辞会变。

| 代次 | 表现 |
|---|---|
| `0.1.2` | 非图片附件到点退成 `[附件] 文件名` 文本块（该代 `ContentBlock` 没有 `file` 变体）；图片块各代次都原样透传 |
| `0.1.2` | 附件图标统一画回形针，文件大小文案由本插件本地计算（1024 进制、一位小数），不保证与宿主逐字一致 |
| `0.1.5` 及更早 | `Tooltip` 没有 `portal`，长提示可能被可滚动的祖先元素裁掉 |
| `0.1.5` 线 | 设置项会被持久化进 profile（那代 schemastery 没有 `Schema.volatile()`）；受影响的是布尔开关，写进去无害 |

### 安装到 DSH

**npm 安装（推荐，预构建产物，无需授权）：**

```sh
dsh plugin --profile web add dsh-later
# 重启 dsh web 后生效
```

或者从源码构建后装入 DSH Web profile：

```sh
cd dsh-later
pnpm install                # 仓库是 pnpm workspace（pnpm-lock.yaml + pnpm-workspace.yaml）
pnpm run build

dsh plugin --profile web add "file:/path/to/dsh-later"
# 重启 dsh web 后生效
```

> 开发提示：`npm run watch` 监听 `src/` 自动重建并跑形状回归测试。
>
> 注意它**不再自动改 GUI 里跑的那份**（issue #46：旧行为会把未合并代码静默部署到所有
> profile，多 worktree 并发时还会互相覆盖）。要在界面上看到效果，二选一：
>
> ```sh
> npm run deploy                     # 手动同步一次
> DSH_LATER_RELINK=1 npm run watch   # 恢复「每次改动即部署」的旧行为
> ```

### 第一条提醒

1. 打开任意会话，输入框右侧出现「定时」按钮；
2. 点击按钮 → 选一个智能时段，或填自定义时间与内容；
3. 点确认 → 按钮旁出现倒计时芯片，输入框上方 dock 显示待发条目；
4. 到点后对话里收到「定时提醒」消息——关掉网页也会触发。

---

## 长文本提醒

提醒内容默认上限 **1000 字符**。需要更长时，在 **DSH 设置 → 插件 → Session Scheduler** 开启 `allowLongPrompts` 并设置 `maxPromptChars`。

- **适合**：代码片段、会议纪要、长引文、跨设备日记/待办。
- **不建议**：提醒内容里包含可能被当成「指令」的话（内容越长风险越大）；多人共享同一台设备的公共 profile（任何人都能调大）。

---

## 配置

默认开箱即用。可在 **DSH 设置 → 插件 → Session Scheduler** 调整（保存即时生效，无需重启）：

| 字段 | 说明 | 默认 |
|---|---|---|
| 显示定时按钮 | 输入框右侧是否显示定时按钮（隐藏不影响已创建的提醒触发与 dock 显示） | 显示 |
| 在分组徽标中显示定时任务 | 折叠分组徽标（dsh-group-status）里是否出现「定时任务」这一格；关闭 = **不向对端登记 facet**，提醒本身照常触发 | 显示 |
| 单会话任务上限 | 一个会话内最多允许的提醒数 | 100 |
| 允许长文本 | 解除 1000 字符默认上限 | 关闭 |
| 自定义上限 | `allowLongPrompts` 开启时的字符上限 | 1000 |
| 工作时间 / 午休 / 晚间静默 | 智能时段 5 个 HH:mm 字段，决定快捷芯片与智能排期 | 见设置页 |
| 插话投递方式 | 「插话发送」进哪个队列：独立成一轮（默认，安全）/ 当前轮（更快，极端情况下会丢） | 独立成一轮 |
| 投递确认 / 未确认处理 | 是否核对提醒真的送达，以及未确认时保留还是丢弃 | 开 / 保留 |
| 时钟图标风格 | `auto`（按内核版本）/ `modern` / `classic` | auto |
| **高级语法** <span>实验性</span> | 多次写法总开关：`+1h*3`、`+1h+1h+0.5h`、`15:32+16:32`、`9:00+1d`。关闭后这些写法被明确拒绝并提示回设置开启 | **开启** |

> 「高级语法」标实验性的原因不是没测（文法与展开由 `tests/occurrences.test.mjs` 逐条覆盖，逐代实测见 [docs/verification.md](./docs/verification.md)），而是**展开后的观感仍需观察**：一次命令写 10 条会不会刷屏、60 秒地板与 10 条上限是否合适。
> 关闭它**不会**退回旧版的静默误解析（`+1h*3 x` 建成一条内容为 `*3 x` 的任务）——那是 bug，不在可回退的功能面里；残片守卫与本开关无关，始终生效。

> 进阶：也可以用 `cordis.patch.yml` 在启动期覆盖默认值（如 `maxSchedules`），见 `docs/` 与 schema。

---

## 给插件开发者：定时摘要 API（跨插件）

dsh-later 把「全会话定时任务摘要」作为公共数据面暴露出来
（issue #17），其它客户端插件
（如 dsh-group-status）据此在分组/侧栏聚合显示定时状态，**无需**自己解析
`userSchedules` 投影，也不会与行内 badge 漂移。

消费方先在 `package.json` 声明外部模块：

```json
{ "dsh": { "client": { "platform": "web", "external": ["dsh-later"] } } }
```

然后在客户端 factory 里 `require('dsh-later/client')`：

```js
const { getScheduleSummaryStore, summarizeScheduleGroup, useScheduleSummary } = require('dsh-later/client')

// 1) 直接读 store：会话 id → { count, pausedCount, nextAt, state }
const store = getScheduleSummaryStore() // dsh-later 未加载时为 undefined
const summary = store?.getSnapshot() ?? new Map()

// 2) 按分组聚合（折叠分组徽标直接用它）
const group = summarizeScheduleGroup(summary, groupSessionIds)
// → { sessions, count, pausedCount, nextAt?, state? }

// 3) React 组件内订阅（store 迟到也会自动重渲染）
const live = useScheduleSummary()
```

| 字段 | 含义 |
|---|---|
| `count` | 任务数（**含**暂停项） |
| `pausedCount` | 暂停项数量（暂停项计入 count，但**不参与** `nextAt`） |
| `nextAt` | 最早触发时刻（epoch ms）；全部暂停时为 `undefined` |
| `state` | `scheduled` / `urgent`（≤5 分钟）/ `overdue`（已到期未派发），按快照时刻判定 |

契约要点：

- 摘要**只包含有任务的会话**，无任务的会话不出现；消费方按自己的 `sessionIds` 查表即可。
- store 是**唯一数据权威**：dsh-later 侧栏 badge 也读它，因此两边必然同源；它内部负责
  `sessions.list` 订阅、30s 状态 tick 与 60s `session.list` 读 RPC（仅页面可见时）。
- 消费方必须容忍 `undefined`（dsh-later 未安装/未启用时静默降级）。

### 折叠分组徽标：由我们自己注册 facet（issue #36）

「组内有几个会话挂着定时任务」这一格，**语义与实现现在同侧**：本插件按 dsh-group-status 的
[facet 协议 v1](https://github.com/dsh-plugin-collection/dsh-group-status/blob/main/docs/facet-protocol.md)
在自己 client 的 `apply` 里登记 `dsh-later.schedule`，交出 fold / merge / label / renderIcon。
徽标数字的口径（组内**有任务的会话数**）、色档（scheduled 紫 / urgent 橙 / overdue 红）、
脉冲（只有 overdue 与 urgent 闪）、文案（`N 定时任务` / `N Scheduled`）与图标（官方描边时钟
14px）都由本插件判定，对方只认协议形状、不再逐家适配。

- **dsh-group-status 是可选搭档**：它未安装 / 未启用时 `require('dsh-group-status/client')` 会抛，
  本插件兜住并跳过登记。因此它**既不进** `dsh.client.external`，**也不进** client 的模块级 `inject`
  ——顶层 `inject` 是激活门控，写成硬依赖会让本插件在对方缺席时永不激活（issue #34 那次 P0）。
- 对端协议版本对不上时**可见地跳过**（一条 `console.warn`）：「我注册了为什么没显示」必须查得出原因。
- **显隐开关在本插件**（issue #83）：`showInGroupBadge`，默认开。对端 #37 把协议里的
  `settingKey` 废弃了（v1 仍接受，但不再读取），规则收敛成一条——**登记即显示，不注册即不显示**。
  于是「关掉定时任务提示」只能由本插件执行：关掉就是不登记。设置页保存即时生效，不必刷新页面
  （登记跟着订阅走）；未安装 dsh-group-status 时这一项没有可见效果。
- 数字 / 色档 / 脉冲 / 文案 / 图标与它此前的过渡适配器逐项一致，并由
  `tests/group-status-facet.test.mjs` 把那份适配器算法照抄成 oracle 做对拍——以后谁想改口径，
  得先过这条基线，改动不再能静默生效。

上面的摘要 API 仍然保留：侧栏行、悬浮卡片这类直接读数的消费方照旧用 `getScheduleSummaryStore()`
与 `summarizeScheduleGroup()`，两条路读同一份 store。

## 技术文档

以下内容面向开发者与维护者，已移出本 README：

- [架构与数据流](./docs/architecture.md) — 宿主/客户端分层、事件流、目录结构、调度器原理
- [关键设计决策](./docs/design-decisions.md) — source 字段、slash 通道、fork 隔离、注入防护等取舍
- [验证状态与验收对照](./docs/verification.md) — 测试、线上 E2E、跨内核代次兼容、AC 对照表
- [UI 面跨代次截图矩阵](./docs/notes/ui-matrix.md)（每代怎么起真 GUI、判什么、历次结论）

## 参考

- PRD 与设计文档：项目根目录 `prd.md`、`docs/`
- dsh-schedule 源码分析：`../references/dsh-schedule-analysis.md`
- dsh-sleep-send 源码分析：`../references/dsh-sleep-send-analysis.md`

## 许可

MIT

---

<div align="center">

<img src="assets/icons/icon-presence-scheduled.svg?v=18" width="48" alt="scheduled"/>
<img src="assets/icons/icon-presence-urgent.svg?v=18" width="48" alt="urgent"/>
<img src="assets/icons/icon-presence-overdue.svg?v=18" width="48" alt="overdue"/>

</div>
