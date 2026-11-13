/**
 * 设置卡微文案 —— German（机器初翻，**未经母语审校**）。
 *
 * ⚠️ 状态声明：本文件由机器翻译产出，只做过「占位符逐字保留、专有名词不译、无零宽字符」
 * 三项机械校验，**没有**经过德语母语者审校。修正请直接改这里的取值。
 *
 * 键集由 `settings.ts` 的 `zh` 定义，本文件用 `{ [K in keyof typeof zh]: string }`
 * 强制一致；漏一个键是 tsc 报错。
 *
 * 不翻译的：`/later`、`/schedule`、`HH:mm`、`+1h*3`、`9:00+1d` 这类命令名与写法示例，
 * `dsh-group-status` 这类包名，以及 `left` / `meta` / `hover` / `after` 这类取值名
 * （它们在设置卡上是**选项档位的 id**，界面文案另有一套）。
 *
 * @module dsh-later/client/locales/settings.de
 */
import type { zh } from './settings.js';

const dict: { [K in keyof typeof zh]: string } = {
  title: 'Geplante Erinnerungen',
  description: 'Einstellungen für geplante Erinnerungen innerhalb der Sitzung.',
  pendingBadge: 'Nicht gespeichert',
  expand: 'Einstellungen anzeigen',
  collapse: 'Einstellungen ausblenden',
  readOnly: 'Die Einstellungen dieser Installation sind schreibgeschützt.',
  sectionDisplay: 'Anzeige',
  sectionTime: 'Zeitfenster',
  sectionDelivery: 'Zustellung',
  sectionAdvanced: 'Erweiterte Syntax',
  betaBadge: 'Beta',
  betaBadgeAria: 'Beta-Funktion; das Verhalten kann sich zwischen Versionen ändern',
  advancedSyntaxLabel: 'Mehrfach-Syntax aktivieren (+1h*3 / 15:32+16:32)',
  advancedSyntaxHint: 'Erlaubt /later und /schedule, mehrere Aufgaben auf einmal anzulegen: +1h*3 (gleiches Intervall N Mal), +1h+1h+0.5h (relative Kette), 15:32+16:32 und 9:00+1d (an einer Wanduhr verankert: die Uhrzeit bleibt über die Zeitumstellung hinweg erhalten). Jedes Vorkommen ist eine eigene Aufgabe, die du einzeln abbrechen oder bearbeiten kannst; bis zu 10 pro Befehl. Als Beta markiert: das aufgeklappte Ergebnis und die Grenze von 10 Aufgaben brauchen noch Beobachtung im Alltag.',
  showButtonLabel: 'Planen-Schaltfläche anzeigen',
  showButtonHint: 'Blendet die Uhr-Schaltfläche in der Eingabeleiste aus. Bereits angelegte Erinnerungen werden weiter ausgelöst und bleiben in der Liste unter dem Eingabefeld sichtbar.',
  showInGroupBadgeLabel: 'Geplante im Gruppen-Badge anzeigen',
  showInGroupBadgeHint: 'Registriert das Feld „Geplant“ nicht mehr im Badge eingeklappter Gruppen von dsh-group-status, dessen Zähler dadurch verschwindet. Erinnerungen werden weiter ausgelöst und bleiben in der Liste unter dem Eingabefeld und in der Seitenleiste sichtbar; diese Zeile hat keine sichtbare Wirkung, wenn dsh-group-status nicht installiert ist.',
  maxSchedulesLabel: 'Maximale Aufgaben pro Sitzung',
  maxSchedulesHint: 'Maximale Anzahl geplanter Erinnerungen pro Sitzung.',
  allowLongPromptsLabel: 'Lange Erinnerungen erlauben',
  allowLongPromptsHint: 'Hebt die Vorgabe von 1000 Zeichen auf. Aktiviert lässt sich mit „Maximale Zeichenzahl“ eine eigene Obergrenze festlegen; deaktiviert bleibt sie wirkungslos und beträgt 1000.',
  maxPromptCharsLabel: 'Maximale Zeichenzahl',
  maxPromptCharsHint: 'Maximale Zeichenzahl pro Erinnerung (greift nur, wenn „Lange Erinnerungen erlauben“ aktiv ist).',
  maxPromptCharsLockedHint: 'Einstellbar, nachdem „Lange Erinnerungen erlauben“ aktiviert wurde.',
  smartWindowHint: 'Wird vom Chip „Arbeitszeit“ und der automatischen Planung im intelligenten Modus verwendet.',
  smartWindowOrderHint: 'Die fünf Zeitfenster müssen aufsteigend sein: Arbeitsbeginn < Mittagspause Beginn < Mittagspause Ende < Arbeitsende < Beginn der Nachtruhe.',
  workStartLabel: 'Arbeitsbeginn',
  workEndLabel: 'Arbeitsende (Abendbeginn)',
  lunchStartLabel: 'Mittagspause Beginn',
  lunchEndLabel: 'Mittagspause Ende',
  eveningEndLabel: 'Beginn der Nachtruhe',
  steerDeliveryLabel: 'Zustellung beim Dazwischenwerfen',
  steerDeliveryHint: 'In welche Warteschlange der Erinnerungstext gelangt, wenn du „Jetzt senden“ drückst.',
  steerDeliveryOption_followup: 'Eigener Zug (empfohlen)',
  steerDeliveryOption_steer: 'Aktueller Zug (schneller)',
  confirmDeliveryLabel: 'Zustellung bestätigen',
  confirmDeliveryHint: 'Prüft nach dem Senden das Sitzungsprotokoll, ob die Nachricht wirklich in eine Anfrage eingegangen ist. Deaktiviert entfällt die Prüfung und die Zustellung ist nicht mehr garantiert.',
  onUnconfirmedLabel: 'Wenn unbestätigt',
  onUnconfirmedHint: 'Was geschieht, wenn die Zustellung nicht bestätigt werden kann.',
  onUnconfirmedOption_keep: 'Behalten und erneut versuchen (empfohlen)',
  onUnconfirmedOption_discard: 'Verwerfen',
  clockIconStyleLabel: 'Uhrsymbol-Stil',
  clockIconStyleHint: 'Darstellung des Planungsstatussymbols in den Zeilen der Seitenleiste.',
  clockIconStyleOption_auto: 'Automatisch (empfohlen)',
  clockIconStyleOption_modern: 'Moderner Strichstil',
  clockIconStyleOption_classic: 'Klassischer Punktmatrix-Stil',
  steerRiskGuarded: '⚠ Kann beim Zusammenstoß mit einem Zugbeginn verschluckt werden; die Zustellbestätigung ist an, eine nicht zugestellte Erinnerung bleibt erhalten und kann erneut versucht werden.',
  steerRiskUnguarded: '⚠ Kann beim Zusammenstoß mit einem Zugbeginn verschluckt werden, und die Erinnerung wird NICHT behalten (Zustellbestätigung ist aus).',
  discardRisk: '⚠ Unbestätigte Erinnerungen werden aus der Liste entfernt — stiller Verlust wird wieder möglich.',
  overriddenLabel: 'Überschrieben',
  resetLabel: 'Zurücksetzen',
  invalidLabel: 'Bitte eine gültige Zahl eingeben.',
  invalidTimeLabel: 'Bitte 24-Stunden-Format HH:mm verwenden.',
  save: 'Speichern',
  saving: 'Speichern…',
  discard: 'Änderungen verwerfen',
  saveFailed: 'Speichern fehlgeschlagen, bitte erneut versuchen.',
  loading: 'Lädt…',
  unavailable: 'Einstellungen nicht verfügbar.',
  sectionDisplayToggle: 'Einstellungseintrag',
  showInSettings: 'In den Einstellungen anzeigen',
  showInSettingsHint: 'Zeigt die Einstellungsseite dieses Plugins im Einstellungsdialog an (Seite neu laden, damit es wirkt)',
};

export default dict;
