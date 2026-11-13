/**
 * 宿主侧微文案 —— ja（机器初翻，**未经母语审校**）。
 *
 * ⚠️ 状态声明：本文件由机器翻译产出，只做过「占位符逐字保留、专有名词不译、无零宽字符」
 * 三项机械校验，**没有**经过日语母语者审校。
 *
 * 这里的文本会进**模型的 system-prompt**（工具描述与参数说明）。翻错比翻丑的代价大：
 * 它可能让模型把 `at` 写成不带时区的字符串、或者把 `every_seconds` 当成「有次数上限」。
 * 所以这几条措辞在审校时优先级最高。
 *
 * 不翻译的：`after_seconds` / `at` / `every_seconds` / `time_zone` / `prompt` / `id`
 * 这些**字段名**，`after` / `at` / `every` 这些 kind 名，`user_schedule_*` 工具名，
 * `{date, time, time_zone}` 与 `HH:mm` / `RFC 3339` / `IANA` / `UTC` / `GUI` / `DSH`，
 * 以及 `invalid_prompt` / `deleted:false` 这类回执取值。
 *
 * @module dsh-later/locales/host.ja
 */
import type { zh } from './host.js';

const dict: { [K in keyof typeof zh]: string } = {
  toolCreateDesc: '現在のセッションに予約リマインダーを作成します。空でないプロンプトと、ちょうど 1 つのセレクター（after_seconds：正の整数の秒数、at：明示的なオフセット時刻または {date,time,time_zone} のローカル時刻、every_seconds：300 以上の固定間隔の秒数）を指定する必要があります。time_zone は任意で、省略時はセッションから検出したタイムゾーンを使います。作成元はユーザーツールとして記録され、GUI パネルに表示されます。every_seconds は**終了条件のない**固定間隔です（ユーザーが削除するまで送り続けます）。ユーザーが回数の上限を述べた場合（例：「1 時間ごとに 3 回リマインドして」）は every_seconds を使わず、**このツールを N 回個別に呼び**、それぞれ at で対応する絶対時刻（t+1h、t+2h、t+3h）を指定してください。',
  toolListDesc: '現在のセッションでユーザーが作成した有効な予約リマインダーを一覧します（id、UTC の目標時刻、scheduled/overdue 状態、配信モードを含みます）。',
  toolDeleteDesc: 'user_schedule_create / user_schedule_list が返した正確な id で有効なリマインダーを1 件削除します。不明または終了済みの場合は deleted:false を返します。',
  paramPromptDesc: 'リマインダーの本文（trim 後に空でないこと）。長さの上限はプラグイン設定「長い本文を許可」で決まり、既定は 1000 文字で、設定で広げられます。超過すると invalid_prompt が返り、エラー文にその時点で実際に許される文字数を示します。',
  paramAfterSecondsDesc: '正の整数の秒数（遅延）。',
  paramEverySecondsDesc: '固定間隔の秒数で、最低 300。終了条件はありません（回数の上限がある場合は、at で 1 件ずつ作成してください）。',
  paramAtDesc: '絶対指定：明示的なタイムゾーンを持つ RFC 3339 文字列（Z または ±HH:mm で終わる）か、{date, time, time_zone} のローカル日時オブジェクト。ローカルの time は HH:mm と HH:mm:ss（1〜3 桁のミリ秒を含んでも可）を受け付け、本プラグインが上流の要求する HH:mm:ss に補完します。タイムゾーン情報を一切含まない文字列は拒否します — ユーザーの代わりに推測はしません。',
  paramTimeZoneDesc: 'IANA タイムゾーン（例：Asia/Shanghai）。任意で、省略時はセッションから検出したタイムゾーンを使います。',
  paramIdDesc: 'セッション内の正確な schedule id。',
  presentCreate: '予約リマインダーを作成',
  presentList: '予約リマインダーを一覧',
  presentDelete: '予約リマインダーを削除',
  cmdLaterDesc: 'セッション内に予約リマインダーを 1 件作成します（GUI 内部チャンネル）。',
  cmdScheduleDesc: 'セッション内に予約リマインダーを 1 件作成します（GUI 内部チャンネル）。',
  cmdListDesc: '現在のセッションでユーザーが作成した予約リマインダーを一覧します（GUI 内部チャンネル）。',
  cmdDeleteDesc: 'セッション内の予約リマインダーを 1 件削除します（GUI 内部チャンネル）。',
  cmdEditDesc: 'セッション内の予約リマインダーの本文を変更します（元の時刻は保ちます。GUI 内部チャンネル）。',
  cmdPauseDesc: 'after 型の予約リマインダーを一時停止します（GUI 内部チャンネルのみ。すでに時刻を過ぎたものは一時停止できません）。',
  cmdResumeDesc: '一時停止した after 型リマインダーを再開します（GUI 内部チャンネルのみ）。',
  cmdSteerDesc: '割り込み送信：指定した id のリマインダーを即座に agent へ渡します（one-shot のみ。GUI 内部チャンネル）。',
  errEmptyPrompt: 'リマインダーの本文は空にできません。',
  errInvalidSelector: 'after_seconds、at、every_seconds のいずれか 1 つを指定する必要があります。',
  errMultipleSelectors: 'after_seconds、at、every_seconds のうち指定できるのは 1 つだけです。',
  errNotFuture: '時刻は未来である必要があります。',
  errTimeOutOfRange: '時刻が許容範囲を超えています。',
  errFrequencyTooHigh: '頻度が高すぎます。',
  errInvalidRule: 'ルールが無効です。',
  errSubagentSession: 'このセッションはサブエージェントへの委譲に属しており、リマインダーが配信されることはありません。',
  errScheduleNotFound: 'リマインダーが存在しません。',
  errAlreadyOverdue: 'リマインダーはすでに期限を過ぎています。',
  errQuotaExceeded: 'タスクの上限（{max} 件）に達しました。',
  errPersistenceUncertain: '永続化が不確定です。',
  errUnsupportedKind: 'サポートされていない操作の種類です。',
  errNotPaused: 'リマインダーは一時停止していません。',
  errInternalError: '操作に失敗しました。',
  warnSchedulerNotArmed: '注意：このセッションにはスケジューラが取り付けられていないため、このリマインダーは時刻になっても発火しません。ホストプロセスを再起動するか、新しいセッションを開いて作り直してください（プラグインをホットリロードすると、リロード前から存在したセッションは再取り付けに失敗することがあります）。',

  // ─── 工具错误回执（task-7，src/user-tools.ts）— machine-translated block ──
  // 与 zh 侧同名区块一一对应；占位符 {maxChars} / {date} / {time} / {timeZone} /
  // {maxSchedules} / {id} / {uid} 逐字保留，位置按本语言语序调整。
  errToolPromptEmpty: 'リマインダーの本文は空にできません。',
  errToolPromptTooLong: 'リマインダーの本文は {maxChars} 文字を超えられません。',
  errToolCreateNotObject: 'create の引数はオブジェクトである必要があります。',
  errToolSelectorExactlyOne: 'after_seconds / at / every_seconds のうち、ちょうど 1 つだけを指定してください。',
  errToolTimeZoneInvalid: 'time_zone は有効な IANA タイムゾーンである必要があります。',
  errToolAtNeedsZone: 'at の文字列には明示的なタイムゾーンが必要です：Z または ±HH:mm で終わる RFC 3339（例：2026-10-26T09:00:00+08:00）。タイムゾーンが不明な場合は {date, time, time_zone} の組み合わせで渡してください。',
  errToolAtObjectMissing: 'at オブジェクトには date / time / time_zone が必要です。',
  errToolAtBadDate: 'at.date は YYYY-MM-DD（月・日は各 2 桁）で、実在する日付である必要があります。',
  errToolAtBadTime: 'at.time は HH:mm または HH:mm:ss（ミリ秒 1〜3 桁を含んでも可）で指定してください。例：09:00、9:30:15.5。',
  errToolAtTimeZoneInvalid: 'at.time_zone は有効な IANA タイムゾーンである必要があります。',
  errToolAtLocalGap: '{date} {time} は {timeZone} における有効な時刻ではありません（その日は夏時間によりこの時刻が存在しない可能性があります）。',
  errToolAtShape: 'at は文字列、または {date, time, time_zone} オブジェクトである必要があります。',
  errToolInternalFailed: '予約タスクの操作に失敗しました。もう一度お試しください。',
  errToolPersistenceUnconfirmed: 'タスクの永続化が確認できません。この結果を当てにする前に user_schedule_list で確認してください。',
  errToolLogUnreadable: 'セッションのスケジュールログを読み取れませんでした。',
  errToolQuotaFull: 'このセッションの予約タスクは最大 {maxSchedules} 件です。先に一部のタスクを削除してください。',
  errToolScheduleIdInvalid: 'schedule id は、前後の空白を除いて空でない文字列である必要があります。',
  errToolUidInvalid: 'uid は、前後の空白を除いて空でない文字列である必要があります。',
  errToolScheduleNotFoundById: '予約タスク {id} が見つかりません。',
  errToolEditOverdue: '予約タスク {id} は目標時刻を過ぎているため、内容を変更できません。削除してから作り直してください。',
  errToolPauseNotFoundById: '一時停止できる予約タスク {id} が見つかりません。',
  errToolPauseUnsupportedKind: '一時停止できるのは「あと N 分」タイプ（after）のリマインダーだけです。',
  errToolPauseOverdue: 'タスクはすでに時刻を過ぎているため一時停止できません。削除するか、配信を待ってください。',
  errToolResumeNotFound: '一時停止中のタスク {uid} が見つかりません。',

  // ─── コマンド面（task-8，src/commands.ts）— machine-translated block ──────
  // zh 側と同名のキーが 1:1 で対応します。プレースホルダー {count} / {times} / {created} /
  // {total} / {failure} / {content} / {max} / {minSeconds} / {gapSeconds} / {date} /
  // {hhmm} / {timeZone} / {detail} は字面どおり保持します。
  // ⚠️ コマンド名 /schedule・/later・/user-schedule-edit、フィールド名 id・prompt・uid、
  // 入力例（+1h*3、1532、15:32、30分钟后、明天9点 など）は翻訳しません。入力例は
  // ユーザーがそのまま入力欄に打ち込む文字列で、訳すと解析器が受け付けなくなります。
  cmdCreateHint: 'JSON ペイロード。例：{"prompt":"ビルド結果を確認","after_seconds":300}。{"prompt":"…","at":{"date":"2026-08-21","time":"15:32","time_zone":"Asia/Shanghai"}} の形も使えます。',
  cmdListHint: 'ペイロードは不要です。1 回目の Enter でコマンドを確定し、2 回目の Enter で実行します（input を持つカーネルコマンドはすべてこの動作です）。',
  cmdIdHint: 'JSON ペイロード。例：{"id":"schedule-…"}。裸の id も直接使えます：schedule-…',
  cmdEditHint: 'JSON ペイロード。例：{"id":"schedule-…","prompt":"新しいリマインダーの本文"}',
  cmdResumeHint: 'JSON ペイロード。例：{"id":"schedule-…"}（{"uid":"…"} も可）。または裸の id を直接：schedule-…',
  quickScheduleDesc: '予約リマインダーのショートカットコマンド：/schedule <時刻> <本文>。時刻は寛容に解釈します：+30m、+1h30m、30分钟后、1532、15:32、9点半、明天9点、后天 10:00、8月21日 15:32、0821-1532、2026-08-21 15:32。複数指定：+1h*3（等間隔で 3 回）と +1h+1h+0.5h（連鎖シーケンス、時刻を累積）はそれぞれ独立したタスクに展開され、最大 10 件、複数指定の間隔は 60 秒以上です。',
  quickScheduleHint: '<時刻> <本文>。例：1532 ビルド結果を確認。+30m、明天9点、+1h*3、+1h+30m も使えます。',
  quickLaterDesc: '遅延送信：/later <時刻> <本文> は、その時刻にあなたの身分で本文を送信します（リマインダーではなく代理送信）。画像/ファイルを添付でき、時刻になると本文と一緒に送信されます。時刻の書式は /schedule と同じで、複数指定（+1h*3：等間隔 N 回、+1h+1h+0.5h：相対シーケンス、15:32+16:32 / 9:00+1d：アンカーシーケンス）は複数の代理送信タスクに展開されます（同じ本文と添付を 1 件ずつ付けます）。複数指定は実験的機能で、プラグイン設定「高度な構文」でオフにできます。',
  quickLaterHint: '<時刻> <本文>。例：1532 ビルド結果を確認。画像/ファイルを添付できます。複数は +1h*3 または +1h+30m。時刻になるとあなたの身分で送信されます。',
  replyMissingPayload: 'JSON ペイロードがありません。',
  replyPayloadNotObject: 'JSON ペイロードはオブジェクトである必要があります。',
  replyPayloadInvalid: 'JSON ペイロードの解析に失敗しました。',
  replyCreateFailed: '作成に失敗しました。',
  replySteerNotInjected: '割り込みハンドラーが注入されていません。',
  replySteerIdRequired: 'invalid_rule: schedule id は必須です。',
  replyEditMissingPrompt: '変更後の本文がありません：/user-schedule-edit のペイロードには id と prompt の両方が必要です。例：{"id":"schedule-…","prompt":"新しいリマインダーの本文"}。',
  replyVerbWill: 'まもなく送信：',
  replyVerbSet: 'リマインダーを設定しました：',
  replyHintLaterOneShot: '（時刻になるとあなたの身分で送信されます）',
  replyHintReminderOneShot: '（入力欄の上にある青い保留バーでいつでも取り消せます）',
  replyHintLaterMulti: '（時刻になると 1 件ずつあなたの身分で送信されます。保留バーから個別に取り消せます）',
  replyHintReminderMulti: '（入力欄の上の保留バーから 1 件ずつ取り消せます）',
  replyExpanded: '{count} 件のタスクに展開しました：{times}',
  replyWithAttachments: '（添付 {count} 件を含む）',
  replyPartial: '｜注意：{created}/{total} 件しか作成できませんでした。{failure}',
  replyPartsJoined: '｜',
  replyQuoted: '「{content}」',
  parseUsage: '使い方：/schedule <時刻> <本文>。例：/schedule 1532 ビルド結果を確認',
  parseUnrecognized: '時刻の書式を認識できません。対応：+30m、1532、15:32、30分钟后、明天9点、2026-08-21 15:32。繰り返し +1h*3、シーケンス +1h+1h+0.5h。',
  parseUnrecognizedSpec: '時刻の書式を認識できません。対応：+30m、1532、15:32、30分钟后、明天9点 など。',
  parseDanglingSuffix: '時刻の指定の後ろに、反映されていない期間/回数が続いています。複数の時刻は +1h*3（等間隔で 3 回）または 15:32+16:32、9:00+1d（シーケンス、+ で区切る）と書いてください。回数の後ろには空白が必要です。その部分が本文なら、別の言い方にしてください。',
  parseSpecMultiOnly: '複数/シーケンスの書き方は複数のタスクに展開されるため、/schedule と /later だけが対応します。単件は +1h のような 1 つの時刻だけを書いてください。',
  parseSpecChainOnly: 'アンカーシーケンスは複数のタスクに展開されるため、/schedule と /later だけが対応します。単件は時刻を 1 つだけ書いてください。',
  parseAdvancedDisabled: '複数指定（+1h*3、+1h+1h+0.5h、15:32+16:32）は実験的機能「高度な構文」で、現在は設定でオフになっています。有効化：設定 → プラグイン → 予約リマインダー → 高度な構文。',
  parseInternalUnhandled: '内部エラー：複数指定が展開されていません。',
  parseInvalidField: '日付または時刻の値が無効です。',
  parseDateNotExist: 'その日付は存在しません。',
  parseTimePassed: '指定した時刻はすでに過ぎています。',
  parseTimePassedToday: 'その時刻は今日すでに過ぎています。「明日」か具体的な日付を使ってください。',
  parseTimeUnresolvable: '目標時刻を判定できません。',
  parseAnchorNotAbsolute: 'アンカーは絶対時刻である必要があります。',
  parseDstSkipped: '{date} の {hhmm} は {timeZone} に存在しません（夏時間の切り替えでこの時刻が飛ばされました）。別の時刻かタイムゾーンを指定してください。',
  parseChainStepInvalid: 'シーケンス内の時刻の書き方が無効です。',
  parseOccurrencesTooMany: '1 回につき最大 {max} 件です（複数指定は同じ件数の 1 回限りのタスクに展開され、セッションの総枠を消費します）。',
  parseOccurrencesTooTight: '複数指定の間隔は最低 {minSeconds} 秒です。1 件だけなら回数を省略できます。',
  parseRepeatNotPositive: '繰り返し回数は正の整数である必要があります。例：+1h*3、+30m×2。',
  parseRepeatTooMany: '繰り返し回数が多すぎます（{count} 回）。{detail}',
  parseSegmentsTooMany: '時刻シーケンスが長すぎます（{count} 区間）。{detail}',
  parseChainTooMany: '時刻シーケンスが長すぎます（{count} 個の時刻）。上限は {max} 個です。',
  parseGapTooTight: '隣り合う 2 つの時刻が {gapSeconds} 秒しか離れていません。複数指定は最低 {minSeconds} 秒空ける必要があります。',
  parseContentEmpty: 'リマインダーの本文は空にできません。',
  parseContentTooLong: 'リマインダーの本文は {chars} 文字を超えられません。',
  relOverdue: '期限切れ',
  relSoon: 'まもなく送信',
  relMinutes: '約 {m} 分後',
  relHours: '約 {h} 時間後',
  relHoursMinutes: '約 {h} 時間 {m} 分後',
  relDays: '約 {d} 日後',
  errRtStopping: 'スケジューラは停止しています。',
  errRtScheduleNotFound: 'そのリマインダーは存在しないか、すでに送信済みです。',
  errRtSteerUnsupportedKind: '繰り返し（every）リマインダーへの割り込みはまだ未対応です。',
  errRtLogUnreadable: 'セッションのスケジュールログを読み取れませんでした。',
  errRtSteerFailed: '割り込みの実行に失敗しました。',
  errRtDeliveryLost: '配信が確認できず、再登録にも失敗しました。パネルでこのリマインダーが残っているか確認してください。',
  errRtDeliveryRetryable: '配信は未確認ですが、リマインダーは保持されています。再試行できます。',
  errToolAgentMismatch: '操作に失敗しました。',
  errToolNoRuntime: 'このセッションにはユーザースケジューラがまだ取り付けられていません。',
};

export default dict;
