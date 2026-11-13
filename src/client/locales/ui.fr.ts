/**
 * 客户端微文案字典 —— French（机器初翻，**未经母语审校**）。
 *
 * ⚠️ 状态声明：本文件由机器翻译产出，只做过「占位符逐字保留、专有名词不译、无零宽字符」
 * 三项机械校验，**没有**经过法语母语者审校。措辞、语感、术语取舍都可能有误。
 * 修正请直接改本文件对应取值，不要为了「看起来一致」去改别的语言的文案。
 *
 * 键集由 `ui.ts` 的 `zh` 定义，本文件用 `{ [K in keyof typeof zh]: string }` 强制一致：
 * 漏一个键是 tsc 报错，而不是上线后静默掉进宿主的回退链（缺失语言 → en → key 本身）。
 *
 * 不翻译的：`/later` 这类 slash 命令名、`after` / `at` / `every` 这类 kind 名、
 * 宿主 API 字段名、以及 DSH / RFC 3339 / IANA 等专有名词。
 *
 * @module dsh-later/client/locales/ui.fr
 */
import type { zh } from './ui.js';

const dict: { [K in keyof typeof zh]: string } = {
  buttonSchedule: 'Programmer l’envoi',
  panelTitle: 'Rappels programmés',
  close: 'Fermer',
  quick10m: 'Dans 10 minutes',
  quick1h: 'Dans 1 heure',
  quickSmart: 'Heures de travail',
  quickCustom: 'Personnalisé…',
  dateLabel: 'Date',
  timeLabel: 'Heure',
  today: 'Aujourd’hui',
  tomorrow: 'Demain',
  taskListTitle: 'Programmés',
  emptyTasks: 'Aucun rappel programmé',
  deleteTask: 'Supprimer le rappel',
  editTask: 'Modifier le rappel',
  editSave: 'Enregistrer',
  editCancel: 'Annuler',
  editErrEmpty: 'Le contenu ne peut pas être vide',
  editErrFailed: 'Échec de la modification : {message}',
  editErrNotAccepted: 'La commande n’a pas été acceptée',
  editErrCommandFailed: 'La commande a échoué',
  steerTask: 'Envoyer maintenant',
  steerAlreadySent: 'Envoyé',
  steerFailed: 'Échec de l’envoi : {message}',
  steerUnsupportedKind: 'Les rappels récurrents ne peuvent pas être envoyés maintenant',
  steerUnconfirmed: 'Livraison non confirmée — le rappel est conservé, vous pouvez réessayer',
  steerRetry: 'Réessayer',
  pauseTask: 'Mettre le rappel en pause',
  resumeTask: 'Reprendre le rappel',
  pausedLabel: 'En pause',
  pauseFailed: 'Échec de la mise en pause : {message}',
  resumeFailed: 'Échec de la reprise : {message}',
  pauseUnsupportedKind: 'Seuls les rappels de type « attendre N minutes » (after) peuvent être mis en pause',
  panelCount: '{n} rappels programmés',
  countdownLeft: 'reste',
  dueAnyMoment: 'Envoi imminent',
  sending: 'Envoi…',
  statusUnconfirmed: '{n} non confirmé(s)',
  confirmAdd: 'Ajouter · envoi à {time}',
  confirmAddNoTime: 'Choisir une heure d’envoi',
  promptFromDraft: 'Le brouillon du champ de saisie servira de contenu au rappel',
  errPromptEmpty: 'Saisissez d’abord quelque chose dans le champ',
  errPromptTooLong: 'Le contenu du rappel ne peut pas dépasser {maxChars} caractères',
  errTimePast: 'Choisissez une heure future',
  errCreateFailed: 'Échec de la création : {message}',
  errDeleteFailed: 'Échec de la suppression : {message}',
  errNoSession: 'Aucune session active',
  errNotAcceptedStashed: 'La commande n’a pas été acceptée ; enregistrée localement',
  presenceBadgeAria: '{n} rappel(s) programmé(s), prochain à {time}',
  presenceOverdueAria: '{n} rappel(s) programmé(s) échu(s), en attente d’envoi',
  presenceTooltip: 'Prochain à {time} · {n} tâche(s)',
  presenceOverdueTooltip: 'Échu · {n} tâche(s) (envoi dès que la session est inactive)',
  presencePausedAria: '{n} rappel(s) en pause',
  presencePausedTooltip: 'En pause · {n} tâche(s)',
  hoverScheduleStatus: '{n} rappel(s) programmé(s), prochain à {time}',
  hoverScheduleOverdue: '{n} rappel(s) programmé(s) échu(s), en attente d’envoi',
  hoverSchedulePaused: '{n} rappel(s) en pause',
  facetScheduled: 'Programmés',
  relMinutes: 'dans {m} min',
  relHours: 'dans {h} h',
  relTomorrow: 'Demain {time}',
  relDate: '{date} {time}',
  relClock: '{time}',
  attachmentImage: 'Image du rappel',
  attachmentFile: 'Fichier du rappel {name}',
  attachmentPendingSend: 'Disponible après l’envoi',
  attachmentUnavailable: 'Image indisponible',
  attachmentMore: '{n} pièce(s) jointe(s) de plus non affichée(s)',
  bubbleMarkerLabel: 'Marqueur de message programmé',
  bubbleMarkerHint: 'Ajoute un marqueur horloge aux messages envoyés par /later. left l’affiche à côté de la bulle, meta ajoute une petite ligne au-dessus, hover ne l’affiche qu’au survol de la ligne ; désactivé, le rendu officiel reste inchangé. Disponible uniquement à partir du noyau 0.2.1.',
  bubbleMarkerOption_off: 'Désactivé',
  bubbleMarkerOption_left: 'À côté de la bulle',
  bubbleMarkerOption_meta: 'Au-dessus de la bulle',
  bubbleMarkerOption_hover: 'Au survol',
  laterMarkerAria: 'Message programmé, livré à {time}',
  laterMarkerTooltip: 'Programmé · livré à {time}',
  laterMarkerTooltipBatch: 'Programmé · livré à {time} · {count} regroupés',
  laterMarkerMeta: 'Programmé · {time}',
  actionCopy: 'Copier',
  actionCopied: 'Copié',
  clockMd: '{d}/{m}',
  clockYmd: '{d}/{m}/{y}',
  relPhraseOverdue: 'en retard',
  relPhraseSoon: 'envoi imminent',
  relPhraseMinutes: 'dans ~{m} min',
  relPhraseHours: 'dans ~{h} h',
  relPhraseHoursMinutes: 'dans ~{h} h {m} min',
  relPhraseDays: 'dans ~{d} jours',
};

export default dict;
