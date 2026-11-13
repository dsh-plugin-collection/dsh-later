/**
 * 设置卡微文案 —— ja（机器初翻，**未经母语审校**）。
 *
 * ⚠️ 状态声明：本文件由机器翻译产出，只做过「占位符逐字保留、专有名词不译、无零宽字符」
 * 三项机械校验，**没有**经过日语母语者审校。修正请直接改这里的取值。
 *
 * 键集由 `settings.ts` 的 `zh` 定义，本文件用 `{ [K in keyof typeof zh]: string }`
 * 强制一致；漏一个键是 tsc 报错。
 *
 * 不翻译的：`/later`、`/schedule`、`HH:mm`、`+1h*3`、`9:00+1d` 这类命令名与写法示例，
 * `dsh-group-status` 这类包名，以及 `left` / `meta` / `hover` / `after` 这类取值名
 * （它们在设置卡上是**选项档位的 id**，界面文案另有一套）。
 *
 * @module dsh-later/client/locales/settings.ja
 */
import type { zh } from './settings.js';

const dict: { [K in keyof typeof zh]: string } = {
  title: '予約リマインダー',
  description: 'セッション内の予約リマインダーの設定を変更します。',
  pendingBadge: '未保存',
  expand: '設定を開く',
  collapse: '設定を閉じる',
  readOnly: 'この配置の設定は読み取り専用です。',
  sectionDisplay: '表示設定',
  sectionTime: '時間設定',
  sectionDelivery: '配信設定',
  sectionAdvanced: '高度な書き方',
  betaBadge: '実験的',
  betaBadgeAria: '実験的機能です。挙動はバージョンによって変わる可能性があります',
  advancedSyntaxLabel: '複数回の書き方（+1h*3 / 15:32+16:32）を有効にする',
  advancedSyntaxHint: '/later と /schedule で一度に複数件を作れるようにします：+1h*3（同じ間隔で 3 回）、+1h+1h+0.5h（相対連続）、15:32+16:32 と 9:00+1d（時計時刻を基準に連続。夏時間をまたいでも壁時計の時刻を保ちます）。各件は独立したタスクで、個別に取り消し・編集できます。1 回の命令で最大 10 件です。実験的扱い：展開後の見え方と件数上限はまだ実利用での観察が必要です。',
  showButtonLabel: '予約ボタンを表示',
  showButtonHint: 'オフにすると入力欄の右側に時計ボタンが出なくなります。作成済みのリマインダーは通常どおり発火し、入力欄の下の送信待ちリストに表示されます。',
  showInGroupBadgeLabel: 'グループバッジに予約タスクを表示',
  showInGroupBadgeHint: 'オフにすると dsh-group-status の折りたたみグループのバッジに「予約タスク」の枠を登録しなくなり、予約タスクの件数がバッジに出なくなります。リマインダー自体は通常どおり発火し、入力欄の下の送信待ちリストとサイドバーの状態には影響しません。dsh-group-status が未導入の場合は見た目に変化はありません。',
  maxSchedulesLabel: 'セッションあたりのタスク上限',
  maxSchedulesHint: '1 つのセッションで作成できる予約タスクの最大数です。',
  allowLongPromptsLabel: '長い本文のリマインダーを許可',
  allowLongPromptsHint: '既定の 1000 文字の上限を解除します。オンにすると「本文の文字数上限」で任意の上限を指定できます。オフのときはこの上限は効かず、常に 1000 です。',
  maxPromptCharsLabel: '本文の文字数上限',
  maxPromptCharsHint: 'リマインダー本文の最大文字数です（「長い本文のリマインダーを許可」がオンのときだけ有効）。',
  maxPromptCharsLockedHint: '「長い本文のリマインダーを許可」をオンにすると調整できます。',
  smartWindowHint: '「勤務時間」チップとスマートモードの自動スケジュールに使います。',
  smartWindowOrderHint: '5 つの時間帯は次の順で増えていく必要があります：勤務開始 < 昼休み開始 < 昼休み終了 < 勤務終了 < 夜間の静寂開始。',
  workStartLabel: '勤務時間の開始',
  workEndLabel: '勤務時間の終了（夕方の開始）',
  lunchStartLabel: '昼休みの開始',
  lunchEndLabel: '昼休みの終了',
  eveningEndLabel: '夜間の静寂の開始',
  steerDeliveryLabel: '割り込み送信の配信方法',
  steerDeliveryHint: '「割り込み送信」でリマインダーの本文をセッションへ渡すときに使うキューです。',
  steerDeliveryOption_followup: '独立した 1 ターン（推奨）',
  steerDeliveryOption_steer: '現在のターンに挿入（速い）',
  confirmDeliveryLabel: '配信の確認',
  confirmDeliveryHint: '配信後にセッションのログを確認し、メッセージが本当にリクエストに入ったかを確かめます。オフにすると確認しなくなり、到達も保証しません。',
  onUnconfirmedLabel: '未確認のとき',
  onUnconfirmedHint: '配信を確認できなかったときの扱いです。',
  onUnconfirmedOption_keep: '項目を残して再試行（推奨）',
  onUnconfirmedOption_discard: '破棄',
  clockIconStyleLabel: '時計アイコンのスタイル',
  clockIconStyleHint: 'サイドバーのセッション行にある予約状態アイコンの表示スタイルです。',
  clockIconStyleOption_auto: '自動（推奨）',
  clockIconStyleOption_modern: '新しい線画スタイル',
  clockIconStyleOption_classic: '従来のドットマトリクス風',
  steerRiskGuarded: '⚠ ターン開始と重なると飲み込まれることがあります。配信確認はオンなので、届かなかった場合は項目が残り再試行できます。',
  steerRiskUnguarded: '⚠ ターン開始と重なると飲み込まれることがあり、項目も残りません（配信確認がオフです）。',
  discardRisk: '⚠ 未確認のリマインダーはリストから外されます — 気づかれないまま失なわれる可能性が戻ってきます。',
  overriddenLabel: '上書き済み',
  resetLabel: 'リセット',
  invalidLabel: '有効な数値を入力してください。',
  invalidTimeLabel: 'HH:mm の 24 時間表記で入力してください。',
  save: '保存',
  saving: '保存中…',
  discard: '変更を破棄',
  saveFailed: '保存に失敗しました。もう一度お試しください。',
  loading: '読み込み中…',
  unavailable: '設定は現在利用できません。',
  sectionDisplayToggle: '設定の入口',
  showInSettings: '設定に表示',
  showInSettingsHint: '設定ダイアログにこのプラグインの設定ページを表示します（ページを再読み込みすると反映されます）',
};

export default dict;
