/**
 * 客户端微文案字典 —— Russian（机器初翻，**未经母语审校**）。
 *
 * ⚠️ 状态声明：本文件由机器翻译产出，只做过「占位符逐字保留、专有名词不译、无零宽字符」
 * 三项机械校验，**没有**经过俄语母语者审校。措辞、语感、术语取舍都可能有误。
 * 修正请直接改本文件对应取值，不要为了「看起来一致」去改别的语言的文案。
 *
 * 键集由 `ui.ts` 的 `zh` 定义，本文件用 `{ [K in keyof typeof zh]: string }` 强制一致：
 * 漏一个键是 tsc 报错，而不是上线后静默掉进宿主的回退链（缺失语言 → en → key 本身）。
 *
 * 不翻译的：`/later` 这类 slash 命令名、`after` / `at` / `every` 这类 kind 名、
 * 宿主 API 字段名、以及 DSH / RFC 3339 / IANA 等专有名词。
 *
 * @module dsh-later/client/locales/ui.ru
 */
import type { zh } from './ui.js';

const dict: { [K in keyof typeof zh]: string } = {
  buttonSchedule: 'Отложенная отправка',
  panelTitle: 'Запланированные напоминания',
  close: 'Закрыть',
  quick10m: 'Через 10 минут',
  quick1h: 'Через 1 час',
  quickSmart: 'Рабочие часы',
  quickCustom: 'Другое…',
  dateLabel: 'Дата',
  timeLabel: 'Время',
  today: 'Сегодня',
  tomorrow: 'Завтра',
  taskListTitle: 'Запланировано',
  emptyTasks: 'Запланированных напоминаний нет',
  deleteTask: 'Удалить напоминание',
  editTask: 'Изменить напоминание',
  editSave: 'Сохранить',
  editCancel: 'Отмена',
  editErrEmpty: 'Содержимое не может быть пустым',
  editErrFailed: 'Не удалось изменить: {message}',
  editErrNotAccepted: 'Команда не была принята',
  editErrCommandFailed: 'Команда завершилась ошибкой',
  steerTask: 'Отправить сейчас',
  steerAlreadySent: 'Отправлено',
  steerFailed: 'Не удалось отправить: {message}',
  steerUnsupportedKind: 'Повторяющиеся напоминания нельзя отправить немедленно',
  steerUnconfirmed: 'Доставка не подтверждена — напоминание сохранено, можно повторить попытку',
  steerRetry: 'Повторить',
  pauseTask: 'Приостановить напоминание',
  resumeTask: 'Возобновить напоминание',
  pausedLabel: 'Приостановлено',
  pauseFailed: 'Не удалось приостановить: {message}',
  resumeFailed: 'Не удалось возобновить: {message}',
  pauseUnsupportedKind: 'Приостанавливать можно только напоминания вида «через N минут» (after)',
  panelCount: 'Запланированных напоминаний: {n}',
  countdownLeft: 'осталось',
  dueAnyMoment: 'Скоро отправка',
  sending: 'Отправка…',
  statusUnconfirmed: 'Не подтверждено: {n}',
  confirmAdd: 'Добавить · отправить в {time}',
  confirmAddNoTime: 'Выберите время отправки',
  promptFromDraft: 'Содержимое поля ввода будет использовано как текст напоминания',
  errPromptEmpty: 'Сначала введите текст в поле ввода',
  errPromptTooLong: 'Текст напоминания не может превышать {maxChars} символов',
  errTimePast: 'Выберите время в будущем',
  errCreateFailed: 'Не удалось создать: {message}',
  errDeleteFailed: 'Не удалось удалить: {message}',
  errNoSession: 'Нет активной сессии',
  errNotAcceptedStashed: 'Команда не была принята; сохранено локально',
  presenceBadgeAria: 'Запланированных напоминаний: {n}, следующее в {time}',
  presenceOverdueAria: 'Просрочено запланированных напоминаний: {n}, ожидают отправки',
  presenceTooltip: 'Следующее в {time} · задач: {n}',
  presenceOverdueTooltip: 'Просрочено · задач: {n} (отправка при простое сессии)',
  presencePausedAria: 'Приостановленных напоминаний: {n}',
  presencePausedTooltip: 'Приостановлено · задач: {n}',
  hoverScheduleStatus: 'Запланированных напоминаний: {n}, следующее в {time}',
  hoverScheduleOverdue: 'Просрочено запланированных напоминаний: {n}, ожидают отправки',
  hoverSchedulePaused: 'Приостановленных напоминаний: {n}',
  facetScheduled: 'Запланировано',
  relMinutes: 'через {m} мин',
  relHours: 'через {h} ч',
  relTomorrow: 'Завтра в {time}',
  relDate: '{date} {time}',
  relClock: '{time}',
  attachmentImage: 'Изображение напоминания',
  attachmentFile: 'Файл напоминания {name}',
  attachmentPendingSend: 'Доступно после отправки',
  attachmentUnavailable: 'Изображение недоступно',
  attachmentMore: 'Ещё вложений: {n} (не показаны)',
  bubbleMarkerLabel: 'Отметка запланированного сообщения',
  bubbleMarkerHint: 'Добавляет отметку с часами к сообщениям, отправленным через /later. left показывает её рядом с пузырём, meta добавляет небольшую строку над пузырём, hover показывается только при наведении на строку; если выключено, отрисовка остаётся официальной. Работает только на ядре 0.2.1 и новее.',
  bubbleMarkerOption_off: 'Выключено',
  bubbleMarkerOption_left: 'Слева от пузыря',
  bubbleMarkerOption_meta: 'Над пузырём',
  bubbleMarkerOption_hover: 'При наведении',
  laterMarkerAria: 'Запланированное сообщение, доставлено {time}',
  laterMarkerTooltip: 'Запланировано · доставлено {time}',
  laterMarkerTooltipBatch: 'Запланировано · доставлено {time} · объединено: {count}',
  laterMarkerMeta: 'Запланировано · {time}',
  actionCopy: 'Копировать',
  actionCopied: 'Скопировано',
  clockMd: '{d}.{m}',
  clockYmd: '{d}.{m}.{y}',
  relPhraseOverdue: 'просрочено',
  relPhraseSoon: 'скоро отправка',
  relPhraseMinutes: 'через ~{m} мин',
  relPhraseHours: 'через ~{h} ч',
  relPhraseHoursMinutes: 'через ~{h} ч {m} мин',
  relPhraseDays: 'через ~{d} дн.',
};

export default dict;
