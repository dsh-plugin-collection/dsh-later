/**
 * 客户端共享类型：投影输出（snake_case，与 user_schedule_list 一致）。
 * @module dsh-later/client/types
 */

/**
 * 一条待发送提醒携带的附件引用（issue #37）。
 *
 * 只有不透明 `attachment_id` + 展示元数据：**没有字节、没有路径**。图片要显示时
 * 由客户端向宿主解析 URL（`uiConversation.imageUrl(sessionId, …)`）。
 *
 * ⚠️ 与 host 侧 `WireAttachment`（`src/domain.ts`）是**手写镜像**，成员名必须逐字
 * 一致，由 `tests/wire-type-parity.test.mjs` 锁住。两边不共用类型，是为了不让
 * 客户端反向依赖宿主模块（本仓 host↔client 一直是这个惯例）。
 */
export interface ClientAttachment {
  readonly kind: 'image' | 'file';
  readonly attachment_id: string;
  /** 仅 file。 */
  readonly name?: string;
  /** image/file 都有。 */
  readonly bytes?: number;
  /** 仅 image。 */
  readonly media_type?: string;
  /** 仅 image：intrinsic 尺寸，缩略图裁切用。 */
  readonly width?: number;
  readonly height?: number;
}

/** 一条用户任务（投影 wire 项）。 */
export interface ClientSchedule {
  readonly id: string;
  readonly kind: 'after' | 'at' | 'every';
  readonly prompt: string;
  readonly after_seconds?: number;
  readonly every_seconds?: number;
  readonly scheduled_at: string;
  readonly created_at?: string;
  readonly delivery_mode: 'session-local';
  readonly status?: 'active' | 'paused';
  /** 暂停冻结的剩余秒数（整数秒；倒计时文案用，进度条用 paused_at）。 */
  readonly remaining_seconds?: number;
  /** 暂停时刻（epoch ms 由客户端解析；进度条据此冻结，与活动期同一时间基准）。 */
  readonly paused_at?: string;
  readonly schedule_id?: string;
  /** 进度条总窗口（秒）。resume 后 after_seconds 只是剩余，此字段保留原间隔。 */
  readonly window_seconds?: number;
  /**
   * 随提醒一起代发的附件。**无附件时整个键不出现**（不是 `[]`），渲染时可用
   * 「键在不在」直接判断。活动项与暂停项走同一映射，规则不分叉。
   */
  readonly attachments?: readonly ClientAttachment[];
  /** 仅当附件被截断（>8）时出现：原始总数，用于显示「+N」。 */
  readonly attachments_total?: number;
}

/** `userSchedules` 投影值。 */
export interface ClientProjectionValue {
  readonly schedules: readonly ClientSchedule[];
}

/** `at` 对象（与 user_schedule_create 输入一致）。 */
export interface ClientAtInput {
  readonly date: string;
  readonly time: string;
  readonly time_zone: string;
}

/** 创建命令载荷（at 与 after_seconds 二选一）。 */
export interface CreateCommandPayload {
  readonly prompt: string;
  readonly at?: ClientAtInput;
  readonly after_seconds?: number;
}

/** 删除命令载荷。 */
export interface DeleteCommandPayload {
  readonly id: string;
}
