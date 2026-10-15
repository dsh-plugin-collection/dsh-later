# 技术架构总览

---

## 1. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        DSH Host                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              @deepseek-ai/dsh-schedule                 │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ │   │
│  │  │ schedule_   │  │ schedule_   │  │ schedule_    │ │   │
│  │  │ create      │  │ list        │  │ delete       │ │   │
│  │  └─────────────┘  └─────────────┘  └──────────────┘ │   │
│  │         │                 │                │          │   │
│  │         ▼                 ▼                ▼          │   │
│  │  ┌─────────────────────────────────────────────────┐  │   │
│  │  │         Session Event Log (JSONL)                │  │   │
│  │  │   schedule/change events (source: 'model-tool')  │  │   │
│  │  └─────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                │
│                            │ peer dependency                 │
│                            ▼                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │            dsh-later (本插件)              │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ │   │
│  │  │ user_       │  │ user_       │  │ user_        │ │   │
│  │  │ schedule_   │  │ schedule_   │  │ schedule_    │ │   │
│  │  │ create      │  │ list        │  │ delete       │ │   │
│  │  └─────────────┘  └─────────────┘  └──────────────┘ │   │
│  │         │                 │                │          │   │
│  │         └─────────────────┼────────────────┘          │   │
│  │                           ▼                           │   │
│  │  ┌─────────────────────────────────────────────────┐  │   │
│  │  │         Session Event Log (JSONL)                │  │   │
│  │  │   schedule/change events (source: 'user-tool')  │  │   │
│  │  └─────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket / HTTP
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      DSH Web Client                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  Client Bundle                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ │   │
│  │  │ SchedButton │  │ SchedPanel  │  │ TaskList     │ │   │
│  │  └─────────────┘  └─────────────┘  └──────────────┘ │   │
│  │         │                 │                │          │   │
│  │         └─────────────────┼────────────────┘          │   │
│  │                           ▼                           │   │
│  │  ┌─────────────────────────────────────────────────┐  │   │
│  │  │              React State + Hooks                 │  │   │
│  │  │   useSchedules / useCountdown / useTimeZone     │  │   │
│  │  └─────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 包结构

```
dsh-later/
├── src/                          # 源码（Host + 浏览器两侧）
│   ├── index.ts                  # Host 入口：用户工具 / 命令 / 投影 / 调度器装配
│   ├── domain.ts                 # 事件与投影类型 + SessionEventMap/ProjectionMap/StateMap 扩展
│   ├── user-tools.ts             # user_schedule_create / list / delete / edit + 投递 fold
│   ├── commands.ts               # 客户端↔宿主变更通道（slash command）
│   ├── projection.ts             # userSchedules 投影 fold（fork 隔离 + wire 契约）
│   ├── runtime.ts                # 用户提醒调度器（武装 timer / 到期 dispatch / followup / 投递分流）
│   ├── delivery.ts               # 投递方式分流（followup vs steer）
│   ├── presence.ts               # Host 侧会话状态摘要（供侧栏状态点）
│   ├── schedule-summary.ts       # 跨插件公共 API 的摘要形状
│   ├── schedule-summary-store.ts # 摘要 store（sessions.list 基线 + 周期扫描）
│   ├── ownership-store.ts        # 所有权 sidecar（暂停项留档）
│   ├── smart-window.ts           # 智能时段计算（纯函数，两侧共享）
│   ├── time-utils.ts             # 时间格式化与相对时间（两侧共享）
│   ├── bar-geometry.ts           # dock 进度条窗口/比例（两侧共享）
│   ├── strings.ts                # Host 侧用户可见文案（zh/en）
│   ├── command-outcome.ts        # 命令受理语义（只回 matched）
│   ├── owned-event-registration.ts / schedule-compat.ts / upstream-compat.ts  # 加载与跨代兼容
│   └── client/
│       ├── index.tsx             # 浏览器入口：conversation.input.right / input.dock 两个插槽注册 + 命令通道
│       ├── styles.ts             # 单一注入的 ss- 命名空间样式串（走宿主 --dsw-* / --dsh-composer-* 变量）
│       ├── strings.ts            # 浏览器侧双语微文案字典 + format 占位符
│       ├── useSchedT.ts          # 跟随宿主 locale 的文案 hook
│       ├── useCountdown.ts       # 1s tick
│       ├── useScheduleSummary.ts # 摘要订阅
│       ├── session-presence.ts   # 侧栏会话行状态点
│       ├── local-store.ts        # localStorage 暂存（面板草稿兜底）
│       ├── primitives-compat.ts  # primitives 能力探测（旧宿主回退）
│       ├── types.ts / runtime-augment.d.ts
│       ├── hooks/                # useSchedules.ts · useSchedulerSettings.ts
│       └── components/           # SchedButton · SchedPanel · ScheduleDock · TaskList · SchedulerSettingsCard
│
├── lib/                          # 构建产物（tsc + esbuild），不要手改、也不是源码目录
├── tests/                        # node:test，*.test.mjs 平铺 + tests/helpers
├── docs/                         # 本文档树
├── build.mjs / build-client.mjs / build-host.mjs / watch.mjs
├── cordis.patch.yml              # Cordis bundle patch
└── package.json
```

> 本节早期版本描述的是设计稿结构（`index.js` + `client.js` 双入口、`lib/*.js` 当源码、`CountdownChip.tsx`、`DateTimePicker.tsx`、`client/styles/*.css`、`tests/unit|integration` 分层）——这些在现仓库里都不存在：源码统一在 `src/` 下，样式是 `src/client/styles.ts` 的一个注入串，测试平铺为 `tests/*.test.mjs`，倒计时芯片已被 dock 取代。

---

## 3. 依赖关系

```json
{
  "name": "dsh-later",
  "version": "1.0.0",
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-schedule": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-tools": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-session": "^0.1.0-rc.7"
  },
  "dependencies": {
    "js-yaml": "^4.1.0"
  }
}
```

---

## 4. 加载顺序

```
1. ctx.sessions         ← Session 管理
2. ctx.agents           ← Agent 管理
3. ctx.tools            ← 工具注册
4. ctx.sessionPersistence ← 持久化
5. dsh-schedule         ← 底层引擎（先加载）
6. dsh-later ← 本插件（后加载，依赖 dsh-schedule）
```

---

## 5. 关键实现

### 5.1 Host 侧工具注册

```javascript
// index.js
import { defineTool } from '@deepseek-ai/dsh-tools';
import { 
  userScheduleCreate, 
  userScheduleList, 
  userScheduleDelete 
} from './lib/user-tools.js';

export const name = 'dsh-later';
export const inject = ['schedule'];  // 依赖 dsh-schedule

export function apply(ctx) {
  // 注册用户工具
  ctx.tools.register(defineTool({
    name: 'user_schedule_create',
    description: 'Create a scheduled reminder in the current session',
    parameters: { /* JSON Schema */ },
    execute: (args) => userScheduleCreate(args, ctx)
  }));
  
  ctx.tools.register(defineTool({
    name: 'user_schedule_list',
    description: 'List all active scheduled reminders',
    parameters: { /* JSON Schema */ },
    execute: () => userScheduleList(ctx)
  }));
  
  ctx.tools.register(defineTool({
    name: 'user_schedule_delete',
    description: 'Delete a scheduled reminder',
    parameters: { /* JSON Schema */ },
    execute: (args) => userScheduleDelete(args, ctx)
  }));
}
```

### 5.2 用户工具实现

```javascript
// lib/user-tools.js
export async function userScheduleCreate(input, ctx) {
  // 1. 输入验证（复用 dsh-schedule 的验证函数）
  const validated = validateCreateInput(input);
  if (!validated.ok) return validated.error;

  // 2. 获取 session 和事件日志
  const session = ctx.sessions.current();
  const events = await session.getEvents();
  
  // 3. 分配 ID（复用 dsh-schedule 的 ID 分配器）
  const folded = foldScheduleEvents(events);
  const id = allocateScheduleId(folded);

  // 4. 构造记录（source 标记为 'user-tool'）
  const record = createScheduleRecord(id, validated, Date.now());

  // 5. 追加到 session 事件日志
  await session.append({
    type: 'schedule/change',
    data: {
      version: 1,
      operation: 'create',
      source: 'user-tool',  // ← 关键：标记为用户创建
      schedule: record
    }
  });

  // 6. 等待持久化 barrier
  await session.flush();

  return { id, state: 'scheduled', ...record };
}
```

### 5.3 Client 侧：插槽条目 + 宿主投影 + 命令通道

> 本节此前是一段设计稿代码（`ctx.sessions.subscribe` / `foldScheduleReducer` / `Popover`+`Tabs`+`DateTimePicker`）。这些标识符在仓库里**都不存在**（`grep -rn "foldScheduleReducer" src/` = 0，`grep -rn "sessions.subscribe" src/client/` 只命中摘要/locale 的订阅，不是会话事件订阅），现按实现改写。

浏览器侧不订阅会话事件日志、也不自己 fold 事件——**状态一律读宿主投影**：

| 关注点 | 实现位置（按标识符找，别按行号） |
|---|---|
| 两个插槽条目 | `src/client/index.tsx`：`conversation.input.right`（`id: 'later'`, `order: 50`）挂 `SchedButton`；`conversation.input.dock`（`id: 'later-dock'`, `order: 30`）挂 `ScheduleDock`，即排在宿主排队消息条之后 |
| 读任务列表 | 宿主渲染器绑定的标准 hook：`useProjection('userSchedules')`（`ScheduleDock.tsx` 与 `hooks/useSchedules.ts` 各调一次）。投影单元由 Host 侧 `src/index.ts` 经 `sessionProjections.register(userSchedulesProjectionUnit)` 注册，`src/projection.ts` 负责 fold |
| 写（创建/删除/改/暂停/恢复/插话） | `callCommand(sessionId, line)` → `sessions.scope(sessionId)` → `sessions.sessionOf(actx)` → `face.command(line)`；创建行由 `hooks/useSchedules.ts` 的 `createLine()` 拼成 `/user-schedule-create {json}`。命令通道**只回 `{matched}`**（受理语义，见 `src/command-outcome.ts`），业务结果一律以投影为准 |
| 面板浮层 | `SchedPanel.tsx` 用 `createPortal` 挂到 `document.body`；锚定走 `primitives-compat.ts` 的 `hasOfficialAnchoredPosition` 探测 + `usePanelAnchorPosition`（旧宿主回退分支不调 hook，保证 hook 调用序列恒定） |
| dock 行内容 | 「`HH:MM` · 倒计时 · 正文」一行 + 进度条一行；动作为 编辑 / 暂停·恢复 / 删除 / 插话发送（`kind === 'every'` 不渲染插话） |
| 倒计时与进度条 | `useCountdown.ts` 的 1s tick；条形的窗口/比例数学在 `src/bar-geometry.ts`（两侧共享），推进交给 CSS 动画，参数以 `--ss-bar-duration` / `--ss-bar-delay` 内联注入 |

呈现层与宿主 QueueDock 的对齐边界（可复用面 / 不可顶替的原因 / 逐项漂移）见 [设计决策 §8](../design-decisions.md) 与 [notes/dock-alignment.md](../notes/dock-alignment.md)。

---

## 6. 性能预算

| 指标 | 目标 | 测试方法 |
|---|---|---|
| 面板打开时间 | < 100ms | Chrome DevTools Performance |
| 任务创建响应 | < 200ms | 自动化测试 |
| 触发精度 | ±1 秒 | 自动化测试 |
| 内存占用（100 任务） | < 5MB | Chrome DevTools Memory |
| 首次加载增加 | < 50KB | Bundle Analyzer |

---

## 参考链接

- dsh-schedule 架构: [本地文件](/home/wujue/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-schedule/README.zh.md)
- Cordis 框架: https://www.npmjs.com/package/@deepseek-ai/cordis
- DSH 插件开发指南: https://deepseek-harness.github.io/deepseek-harness/develop/basic/
