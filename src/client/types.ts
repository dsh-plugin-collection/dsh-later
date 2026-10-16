/**
 * 客户端共享类型：投影输出（snake_case，与 user_schedule_list 一致）。
 * @module dsh-later/client/types
 */

/**
 * 一条提醒携带的附件（Gitea #37 的 wire 契约，#38 消费）。
 *
 * ⚠️ 字段名与宿主侧投影**逐字共享**：只带不透明 `attachment_id` + 元数据，
 * 不带字节、不带路径（`ownership-store.ts` 的设计注释就是这个理由）。
 * `name` 只有 file 块有，`media_type`/`width`/`height` 只有 image 块有，
 * 全部可选——元数据缺失时 UI 要能退化，而不是报错。
 */
export interface ClientAttachment {
  readonly kind: 'image' | 'file';
  readonly attachment_id: string;
  readonly name?: string;
  readonly bytes?: number;
  readonly media_type?: string;
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
   * 携带的附件（#38）。**无附件时这个键不出现**（不是 `[]`）——与宿主侧
   * `sanitizeAttachments` 返回 `undefined` 的语义一致，dock 据此决定整带渲不渲染。
   */
  readonly attachments?: readonly ClientAttachment[];
  /** 附件总数；大于 `attachments.length` 时行尾给「+N」（#37 的每任务上限是 8）。 */
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
