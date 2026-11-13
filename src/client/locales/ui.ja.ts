/**
 * 客户端微文案字典 —— ja（机器初翻，**未经母语审校**）。
 *
 * ⚠️ 状态声明：本文件由机器翻译产出，只做过「占位符逐字保留、专有名词不译、无零宽字符」
 * 三项机械校验，**没有**经过日语母语者审校。措辞、语感、术语取舍都可能有误。
 * 修正请直接改本文件对应取值，不要为了「看起来一致」去改别的语言的文案。
 *
 * 键集由 `ui.ts` 的 `zh` 定义，本文件用 `{ [K in keyof typeof zh]: string }` 强制一致：
 * 漏一个键是 tsc 报错，而不是上线后静默掉进宿主的回退链（缺失语言 → en → key 本身）。
 *
 * 不翻译的：`/later` 这类 slash 命令名、`after` / `at` / `every` 这类 kind 名、
 * 宿主 API 字段名、以及 DSH / RFC 3339 / IANA 等专有名词。
 *
 * @module dsh-later/client/locales/ui.ja
 */
import type { zh } from './ui.js';

const dict: { [K in keyof typeof zh]: string } = {
  buttonSchedule: '予約送信',
  panelTitle: '予約リマインダー',
  close: '閉じる',
  quick10m: '10 分後',
  quick1h: '1 時間後',
  quickSmart: '勤務時間',
  quickCustom: 'カスタム…',
  dateLabel: '日付',
  timeLabel: '時刻',
  today: '今日',
  tomorrow: '明日',
  taskListTitle: '設定済み',
  emptyTasks: '予約リマインダーはありません',
  deleteTask: 'リマインダーを削除',
  editTask: 'リマインダーを編集',
  editSave: '保存',
  editCancel: 'キャンセル',
  editErrEmpty: '内容を空にはできません',
  editErrFailed: '変更に失敗しました：{message}',
  editErrNotAccepted: 'コマンドが受け付けられませんでした',
  editErrCommandFailed: 'コマンドが失敗しました',
  steerTask: '割り込み送信',
  steerAlreadySent: '割り込み済み',
  steerFailed: '割り込みに失敗しました：{message}',
  steerUnsupportedKind: '繰り返しリマインダーは割り込み送信に対応していません',
  steerUnconfirmed: '配信を確認できませんでした。リマインダーは保持されているので再試行できます',
  steerRetry: '再試行',
  pauseTask: 'リマインダーを一時停止',
  resumeTask: 'リマインダーを再開',
  pausedLabel: '一時停止中',
  pauseFailed: '一時停止に失敗しました：{message}',
  resumeFailed: '再開に失敗しました：{message}',
  pauseUnsupportedKind: '一時停止できるのは「N 分後」型（after）のリマインダーだけです',
  panelCount: '予約リマインダー {n} 件',
  countdownLeft: '残り',
  dueAnyMoment: 'まもなく送信',
  sending: '送信中…',
  statusUnconfirmed: '未確認 {n} 件',
  confirmAdd: '追加 · {time} に送信',
  confirmAddNoTime: '送信時刻を選択',
  promptFromDraft: '入力欄の内容をリマインダーの本文として使います',
  errPromptEmpty: '先に入力欄へ内容を入力してください',
  errPromptTooLong: 'リマインダーの内容は {maxChars} 文字を超えられません',
  errTimePast: '未来の時刻を選んでください',
  errCreateFailed: '作成に失敗しました：{message}',
  errDeleteFailed: '削除に失敗しました：{message}',
  errNoSession: '有効なセッションがありません',
  errNotAcceptedStashed: 'コマンドが受け付けられませんでした。ローカルに保存しました',
  presenceBadgeAria: '予約リマインダー {n} 件、次回 {time}',
  presenceOverdueAria: '予約リマインダー {n} 件が期限を過ぎ、送信待ちです',
  presenceTooltip: '次回 {time} · タスク {n} 件',
  presenceOverdueTooltip: '期限超過 · タスク {n} 件（セッションが空くのを待って送信）',
  presencePausedAria: '予約リマインダー {n} 件が一時停止中',
  presencePausedTooltip: '一時停止中 · タスク {n} 件',
  hoverScheduleStatus: '予約リマインダー {n} 件、次回 {time}',
  hoverScheduleOverdue: '予約リマインダー {n} 件が期限を過ぎ、送信待ちです',
  hoverSchedulePaused: '予約リマインダー {n} 件が一時停止中',
  facetScheduled: '予約タスク',
  relMinutes: '{m} 分後',
  relHours: '{h} 時間後',
  relTomorrow: '明日 {time}',
  relDate: '{date} {time}',
  relClock: '{time}',
  attachmentImage: 'リマインダーの画像',
  attachmentFile: 'リマインダーのファイル {name}',
  attachmentPendingSend: '送信後に表示',
  attachmentUnavailable: '画像を表示できません',
  attachmentMore: 'ほかに {n} 件の添付があります（未表示）',
  bubbleMarkerLabel: '予約メッセージのマーカー',
  bubbleMarkerHint: '/later から届くメッセージに時計マーカーを付けます。left はバブルの左に常時表示、meta はバブルの上に小さく一行、hover は行にポインタを乗せたときだけ表示します。オフにすると描画を引き継がず、公式の見た目のままです。マーカーはカーネル 0.2.1 以降でのみ有効です。',
  bubbleMarkerOption_off: 'オフ',
  bubbleMarkerOption_left: 'バブルの左',
  bubbleMarkerOption_meta: 'バブルの上',
  bubbleMarkerOption_hover: 'ホバー時',
  laterMarkerAria: '予約送信されたメッセージ、{time} に配信',
  laterMarkerTooltip: '予約送信 · {time} に配信',
  laterMarkerTooltipBatch: '予約送信 · {time} に配信 · {count} 件をまとめて',
  laterMarkerMeta: '予約送信 · {time}',
  actionCopy: 'コピー',
  actionCopied: 'コピーしました',
  clockMd: '{m}月{d}日',
  clockYmd: '{y}年{m}月{d}日',
  relPhraseOverdue: '期限切れ',
  relPhraseSoon: 'まもなく送信',
  relPhraseMinutes: '約 {m} 分後',
  relPhraseHours: '約 {h} 時間後',
  relPhraseHoursMinutes: '約 {h} 時間 {m} 分後',
  relPhraseDays: '約 {d} 日後',
};

export default dict;
