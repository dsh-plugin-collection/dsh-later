# API 参考

---

## 1. 用户工具

### 1.1 `user_schedule_create`

**描述**：在当前会话中创建定时提醒。

**参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | ✅ | 提醒内容（trim 后非空，≤1000 字符） |
| `after_seconds` | positive int | ❌* | 延时秒数 |
| `at` | string \| LocalAtInput | ❌* | 绝对时间 |
| `every_seconds` | positive int (≥300) | ❌* | 固定间隔秒数 |
| `time_zone` | string | ✅ | IANA 时区 |
| `smart_window` | SmartWindowInput | ❌ | 智能时段配置 |

> *`after_seconds`/`at`/`every_seconds` 有且只有一项。

**请求示例**：

```json
{
  "prompt": "检查构建结果",
  "after_seconds": 600,
  "time_zone": "Asia/Shanghai"
}
```

**响应**：

```json
{
  "ok": true,
  "id": "schedule-1",
  "kind": "after",
  "scheduled_at": "2026-08-19T06:00:00Z",
  "state": "scheduled",
  "delivery_mode": "session-local"
}
```

**错误响应**：

```json
{
  "ok": false,
  "code": "invalid_prompt",
  "message": "提醒内容不能为空"
}
```

---

### 1.2 `user_schedule_list`

**描述**：列出当前会话的所有活动提醒。

**参数**：无

**响应**：

```json
{
  "ok": true,
  "schedules": [
    {
      "id": "schedule-1",
      "kind": "after",
      "prompt": "检查构建结果",
      "after_seconds": 600,
      "scheduled_at": "2026-08-19T06:00:00Z",
      "state": "scheduled",
      "delivery_mode": "session-local",
      "source": "user-tool"
    },
    {
      "id": "schedule-2",
      "kind": "every",
      "prompt": "检查服务状态",
      "every_seconds": 300,
      "scheduled_at": "2026-08-19T06:05:00Z",
      "state": "overdue",
      "delivery_mode": "session-local",
      "source": "user-tool"
    }
  ]
}
```

---

### 1.3 `user_schedule_delete`

**描述**：删除指定的活动提醒。

**参数**：

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | string | ✅ |

**请求示例**：

```json
{
  "id": "schedule-1"
}
```

**响应**：

```json
{
  "ok": true,
  "id": "schedule-1",
  "deleted": true
}
```

**错误响应**：

```json
{
  "ok": false,
  "id": "schedule-999",
  "deleted": false,
  "code": "schedule_not_found"
}
```

---

## 2. 内部函数

### 2.1 `userScheduleCreate`

```typescript
async function userScheduleCreate(
  input: UserScheduleCreateInput,
  ctx: Context
): Promise<ScheduleCreateResult | ScheduleToolError>
```

**流程**：
1. 输入验证（`validateCreateInput`）
2. 获取 session 和事件日志
3. 分配 ID（`allocateScheduleId`）
4. 构造记录（`createScheduleRecord`）
5. 追加到 session 事件日志
6. 等待持久化 barrier

---

### 2.2 `userScheduleList`

```typescript
async function userScheduleList(
  ctx: Context
): Promise<ScheduleListView>
```

**流程**：
1. 获取当前 session
2. 读取事件日志
3. 过滤 `source: 'user-tool'`
4. fold 出活动记录
5. 返回管理视图

---

### 2.3 `userScheduleDelete`

```typescript
async function userScheduleDelete(
  input: { id: ScheduleId },
  ctx: Context
): Promise<ScheduleDeleteResult>
```

**流程**：
1. 验证 ID 格式
2. 检查 ID 是否存在且活动
3. 追加 delete 事件到日志
4. 等待持久化 barrier

---

## 3. 验证函数

### 3.1 `validateCreateInput`

```typescript
function validateCreateInput(input: unknown): 
  | { ok: true; value: ValidatedCreateInput }
  | { ok: false; code: ScheduleErrorCode; message: string }
```

**验证规则**：
- prompt 非空且 ≤1000 字符
- after_seconds/at/every_seconds 有且只有一项
- time_zone 是有效 IANA 时区
- 计算出的目标时间在未来

---

### 3.2 `validateId`

```typescript
function validateId(value: unknown): ScheduleId | ScheduleToolError
```

**规则**：
- 非空字符串
- 无前后空白
- 格式 `schedule-N`

---

## 4. 时间工具

### 4.1 `nextSmartTarget`

```typescript
function nextSmartTarget(
  now: number,
  window: SmartWindowConfig
): number
```

**说明**：计算下一个智能时段的目标时间。

---

### 4.2 `nextCustomTarget`

```typescript
function nextCustomTarget(
  now: number,
  dateStr: string | null,
  hhmm: string
): number
```

**说明**：计算自定义时间的目标时间。

---

### 4.3 `toUtcString`

```typescript
function toUtcString(localTime: string, tz: string): string
```

**说明**：将本地时间转换为 UTC RFC 3339 字符串。

---

## 5. 错误码

| 错误码 | HTTP 状态 | 触发条件 |
|---|---|---|
| `invalid_prompt` | 400 | prompt 为空或过长 |
| `invalid_selector` | 400 | selector 多选/缺选 |
| `invalid_time_zone` | 400 | 非 IANA 时区 |
| `not_future` | 400 | 目标时间不在未来 |
| `time_out_of_range` | 400 | 超出 4 位年份表示范围 |
| `frequency_too_high` | 400 | every_seconds < 300 |
| `schedule_not_found` | 404 | 删除时 ID 不存在 |
| `persistence_uncertain` | 503 | 持久化路径不可用 |
| `internal_error` | 500 | 未知内部错误 |

---

## 6. 类型定义

### 6.1 UserScheduleCreateInput

```typescript
interface UserScheduleCreateInput {
  prompt: string;
  time_zone: string;
  smart_window?: SmartWindowConfig;
  
  // 三选一
  after_seconds?: number;
  At?: AtInput;
  every_seconds?: number;
}
```

### 6.2 AtInput

```typescript
type AtInput = string | LocalAtInput;

interface LocalAtInput {
  date: string;       // YYYY-MM-DD
  time: string;       // HH:mm:ss[.S|.SS|.SSS]
  time_zone: string;  // IANA
}
```

### 6.3 SmartWindowConfig

```typescript
interface SmartWindowConfig {
  work_start: string;   // "09:00"
  work_end: string;     // "18:00"
  lunch_start: string;  // "12:00"
  lunch_end: string;    // "14:00"
  evening_end: string;  // "22:00"
}
```

---

## 7. 插件间契约（client 侧）

### 7.1 模块导出面（`dsh-later/client`）

dsh-later 的浏览器产物 `lib/client.js` 在注册 `apply` 之外，额外导出一组**跨插件公共
API**（[issue #17](http://192.168.4.77:3000/dsh-plugins/dsh-later/issues/17)）。消费方在
`package.json` 的 `dsh.client.external` 里声明 `"dsh-later"`（构建图会把它排在本包之前），
然后在客户端 factory 里 `require('dsh-later/client')`。

| 导出 | 类型 | 说明 |
|---|---|---|
| `getScheduleSummaryStore()` | `() => ScheduleSummaryStore \| undefined` | 当前生效的摘要 store；dsh-later 未 apply 时为 `undefined` |
| `subscribeScheduleSummaryStore(fn)` | `(fn) => () => void` | 订阅 store 登记变化（store 迟到时仍能重渲染） |
| `useScheduleSummary(store?)` | React hook | 订阅摘要；返回 `ScheduleSummaryMap`（引用稳定） |
| `buildScheduleSummary(source, now)` | 纯函数 | 由 `sessions.list` 快照直接算出摘要 |
| `schedulesOfProjection(projectionValues)` | 纯函数 | 从投影值取出任务数组（容错） |
| `summarizeScheduleGroup(map, sessionIds)` | 纯函数 | 按分组聚合（会话数/任务数/最早触发/最高优先级） |
| `createScheduleSummaryStore(sessions, options?)` | 工厂 | 自建 store（高级用法/单测） |

### 7.2 数据结构

```typescript
/** 会话 id → 该会话的定时摘要（仅含有任务的会话）。 */
type ScheduleSummaryMap = ReadonlyMap<string, ScheduleSummaryEntry>

interface ScheduleSummaryEntry {
  count: number          // 任务数（含暂停项）
  pausedCount: number    // 暂停项数量（计入 count，不参与 nextAt）
  nextAt?: number        // 最早触发时刻（epoch ms）；全部暂停时缺省
  state: 'scheduled' | 'urgent' | 'overdue'  // 按快照时刻判定（urgent = ≤5min）
}

interface GroupScheduleSummary {
  sessions: number       // 组内有任务的会话数
  count: number          // 组内任务总数
  pausedCount: number
  nextAt?: number        // 组内最早触发时刻
  state?: 'scheduled' | 'urgent' | 'overdue'  // 组内最高优先级；无任务时缺省
}
```

### 7.3 store 契约

```typescript
interface ScheduleSummaryStore {
  getSnapshot(): ScheduleSummaryMap       // 引用稳定：内容变化时才换新对象
  subscribe(listener: () => void): () => void
  reload(): void                          // 立即按最新快照重算（内容变化才通知）
  dispose(): void                         // 释放订阅与定时器
}
```

语义保证：

- **唯一数据权威**：dsh-later 自己的侧栏 badge（`session-presence`）与外部消费者读同一份
  摘要，两边不会漂移。
- 内部负责 `sessions.list` 订阅、30s 状态 tick（`scheduled → urgent → overdue`）与 60s
  `session.list` 读 RPC（仅页面可见时）；消费方不需要自己刷新。
- `dispose()` 后不再通知、不再发 RPC；dsh-later 卸载时自动注销登记表。
- 消费方必须容忍 `getScheduleSummaryStore()` 返回 `undefined`。

### 7.4 消费示例

```js
// package.json: "dsh": { "client": { "platform": "web", "external": ["dsh-later"] } }
const { getScheduleSummaryStore, summarizeScheduleGroup } = require('dsh-later/client')

const store = getScheduleSummaryStore()
if (store !== undefined) {
  const off = store.subscribe(() => {
    const group = summarizeScheduleGroup(store.getSnapshot(), groupSessionIds)
    render(group) // 例如：分组徽标加时钟/紫色点 + 数字
  })
  // 卸载时 off()
}
```

---

## 参考链接

- dsh-schedule 工具 schema: [本地文件](/home/wujue/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-schedule/lib/types/types.d.ts)
- JSON Schema 规范: https://json-schema.org/
- OpenAPI 规范: https://spec.openapis.org/oas/v3.1.0
