/**
 * 客户端微文案字典 —— German（机器初翻，**未经母语审校**）。
 *
 * ⚠️ 状态声明：本文件由机器翻译产出，只做过「占位符逐字保留、专有名词不译、无零宽字符」
 * 三项机械校验，**没有**经过德语母语者审校。措辞、语感、术语取舍都可能有误。
 * 修正请直接改本文件对应取值，不要为了「看起来一致」去改别的语言的文案。
 *
 * 键集由 `ui.ts` 的 `zh` 定义，本文件用 `{ [K in keyof typeof zh]: string }` 强制一致：
 * 漏一个键是 tsc 报错，而不是上线后静默掉进宿主的回退链（缺失语言 → en → key 本身）。
 *
 * 不翻译的：`/later` 这类 slash 命令名、`after` / `at` / `every` 这类 kind 名、
 * 宿主 API 字段名、以及 DSH / RFC 3339 / IANA 等专有名词。
 *
 * @module dsh-later/client/locales/ui.de
 */
import type { zh } from './ui.js';

const dict: { [K in keyof typeof zh]: string } = {
  buttonSchedule: 'Senden planen',
  panelTitle: 'Geplante Erinnerungen',
  close: 'Schließen',
  quick10m: 'In 10 Minuten',
  quick1h: 'In 1 Stunde',
  quickSmart: 'Arbeitszeit',
  quickCustom: 'Benutzerdefiniert…',
  dateLabel: 'Datum',
  timeLabel: 'Uhrzeit',
  today: 'Heute',
  tomorrow: 'Morgen',
  taskListTitle: 'Geplant',
  emptyTasks: 'Keine geplanten Erinnerungen',
  deleteTask: 'Erinnerung löschen',
  editTask: 'Erinnerung bearbeiten',
  editSave: 'Speichern',
  editCancel: 'Abbrechen',
  editErrEmpty: 'Der Inhalt darf nicht leer sein',
  editErrFailed: 'Bearbeiten fehlgeschlagen: {message}',
  editErrNotAccepted: 'Befehl wurde nicht angenommen',
  editErrCommandFailed: 'Befehl fehlgeschlagen',
  steerTask: 'Jetzt senden',
  steerAlreadySent: 'Gesendet',
  steerFailed: 'Senden fehlgeschlagen: {message}',
  steerUnsupportedKind: 'Wiederkehrende Erinnerungen können nicht sofort gesendet werden',
  steerUnconfirmed: 'Zustellung unbestätigt — Erinnerung bleibt erhalten, du kannst es erneut versuchen',
  steerRetry: 'Wiederholen',
  pauseTask: 'Erinnerung pausieren',
  resumeTask: 'Erinnerung fortsetzen',
  pausedLabel: 'Pausiert',
  pauseFailed: 'Pausieren fehlgeschlagen: {message}',
  resumeFailed: 'Fortsetzen fehlgeschlagen: {message}',
  pauseUnsupportedKind: 'Pausieren ist nur bei Erinnerungen vom Typ „in N Minuten“ (after) möglich',
  panelCount: '{n} geplante Erinnerungen',
  countdownLeft: 'noch',
  dueAnyMoment: 'Wird gleich gesendet',
  sending: 'Wird gesendet…',
  statusUnconfirmed: '{n} unbestätigt',
  confirmAdd: 'Hinzufügen · senden um {time}',
  confirmAddNoTime: 'Sendezeit wählen',
  promptFromDraft: 'Der Inhalt des Eingabefelds wird als Erinnerungstext verwendet',
  errPromptEmpty: 'Bitte zuerst etwas in das Eingabefeld schreiben',
  errPromptTooLong: 'Der Erinnerungstext darf höchstens {maxChars} Zeichen lang sein',
  errTimePast: 'Bitte eine zukünftige Zeit wählen',
  errCreateFailed: 'Erstellen fehlgeschlagen: {message}',
  errDeleteFailed: 'Löschen fehlgeschlagen: {message}',
  errNoSession: 'Keine aktive Sitzung',
  errNotAcceptedStashed: 'Befehl wurde nicht angenommen; lokal gespeichert',
  presenceBadgeAria: '{n} geplante Erinnerung(en), nächste um {time}',
  presenceOverdueAria: '{n} geplante Erinnerung(en) überfällig, warten auf Zustellung',
  presenceTooltip: 'Nächste um {time} · {n} Aufgabe(n)',
  presenceOverdueTooltip: 'Überfällig · {n} Aufgabe(n) (wird gesendet, wenn die Sitzung inaktiv ist)',
  presencePausedAria: '{n} pausierte Erinnerung(en)',
  presencePausedTooltip: 'Pausiert · {n} Aufgabe(n)',
  hoverScheduleStatus: '{n} geplante Erinnerung(en), nächste um {time}',
  hoverScheduleOverdue: '{n} geplante Erinnerung(en) überfällig, warten auf Zustellung',
  hoverSchedulePaused: '{n} pausierte Erinnerung(en)',
  facetScheduled: 'Geplant',
  relMinutes: 'in {m} Min.',
  relHours: 'in {h} Std.',
  relTomorrow: 'Morgen {time}',
  relDate: '{date} {time}',
  relClock: '{time}',
  attachmentImage: 'Bild der Erinnerung',
  attachmentFile: 'Datei der Erinnerung {name}',
  attachmentPendingSend: 'Nach dem Senden verfügbar',
  attachmentUnavailable: 'Bild nicht verfügbar',
  attachmentMore: '{n} weitere Anhänge nicht aufgeführt',
  bubbleMarkerLabel: 'Markierung für geplante Nachrichten',
  bubbleMarkerHint: 'Setzt eine Uhr-Markierung an Nachrichten, die /later zustellt. left zeigt sie neben der Blase, meta fügt eine kleine Zeile darüber hinzu, hover erscheint nur beim Überfahren der Zeile; aus bleibt die offizielle Darstellung unverändert. Nur mit Kernel 0.2.1 und neuer verfügbar.',
  bubbleMarkerOption_off: 'Aus',
  bubbleMarkerOption_left: 'Neben der Blase',
  bubbleMarkerOption_meta: 'Über der Blase',
  bubbleMarkerOption_hover: 'Beim Überfahren',
  laterMarkerAria: 'Geplante Nachricht, zugestellt um {time}',
  laterMarkerTooltip: 'Geplant · zugestellt um {time}',
  laterMarkerTooltipBatch: 'Geplant · zugestellt um {time} · {count} zusammengefasst',
  laterMarkerMeta: 'Geplant · {time}',
  actionCopy: 'Kopieren',
  actionCopied: 'Kopiert',
  clockMd: '{d}.{m}.',
  clockYmd: '{d}.{m}.{y}',
  relPhraseOverdue: 'überfällig',
  relPhraseSoon: 'wird gleich gesendet',
  relPhraseMinutes: 'in ~{m} Min.',
  relPhraseHours: 'in ~{h} Std.',
  relPhraseHoursMinutes: 'in ~{h} Std. {m} Min.',
  relPhraseDays: 'in ~{d} Tagen',
};

export default dict;
