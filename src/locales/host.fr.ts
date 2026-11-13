/**
 * 宿主侧微文案 —— French（机器初翻，**未经母语审校**）。
 *
 * ⚠️ 状态声明：本文件由机器翻译产出，只做过「占位符逐字保留、专有名词不译、无零宽字符」
 * 三项机械校验，**没有**经过法语母语者审校。
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
 * @module dsh-later/locales/host.fr
 */
import type { zh } from './host.js';

const dict: { [K in keyof typeof zh]: string } = {
  toolCreateDesc: 'Crée un rappel programmé dans la session courante. Il faut fournir un prompt non vide et exactement un sélecteur : after_seconds (délai en secondes, entier positif), at (heure à décalage explicite ou heure locale {date,time,time_zone}), ou every_seconds (intervalle fixe en secondes, ≥300). time_zone est facultatif ; par défaut, le fuseau détecté de la session est utilisé. La source est marquée comme outil utilisateur et le panneau graphique l’affichera. every_seconds est un intervalle fixe **sans condition de fin** (il se répète indéfiniment jusqu’à ce que l’utilisateur le supprime) ; si l’utilisateur indique un nombre maximal de fois (par ex. « rappelle-moi toutes les heures 3 fois »), n’utilise PAS every_seconds : **appelle cet outil N fois séparément**, chacune avec at indiquant l’heure absolue correspondante (t+1h, t+2h, t+3h).',
  toolListDesc: 'Liste les rappels programmés actifs créés par l’utilisateur dans la session courante (id, cible UTC, état scheduled/overdue, mode de livraison).',
  toolDeleteDesc: 'Supprime un rappel actif à partir de l’id exact renvoyé par user_schedule_create / user_schedule_list ; un id inconnu ou déjà terminé renvoie deleted:false.',
  paramPromptDesc: 'Contenu du rappel (non vide après trim). La limite dépend du réglage « autoriser les prompts longs » : 1000 caractères par défaut, extensible dans les réglages ; un appel hors limite renvoie invalid_prompt et le message indique la longueur autorisée à cet instant.',
  paramAfterSecondsDesc: 'Délai en secondes, entier positif.',
  paramEverySecondsDesc: 'Intervalle fixe en secondes, au minimum 300 ; sans condition de fin (pour un nombre de fois limité, créez plusieurs éléments avec at).',
  paramAtDesc: 'Cible absolue : une chaîne RFC 3339 avec fuseau explicite (terminée par Z ou ±HH:mm), ou un objet de calendrier local {date, time, time_zone}. L’heure locale accepte HH:mm et HH:mm:ss (1 à 3 chiffres de millisecondes autorisés) ; l’extension la complète au HH:mm:ss exigé par l’amont. Une chaîne sans aucune information de fuseau est rejetée plutôt que devinée.',
  paramTimeZoneDesc: 'Fuseau horaire IANA (par ex. Asia/Shanghai) ; facultatif, par défaut le fuseau détecté de la session.',
  paramIdDesc: 'Id exact du schedule dans la session.',
  presentCreate: 'Créer un rappel programmé',
  presentList: 'Lister les rappels programmés',
  presentDelete: 'Supprimer le rappel programmé',
  cmdLaterDesc: 'Crée un rappel programmé dans la session (canal interne de l’interface).',
  cmdScheduleDesc: 'Crée un rappel programmé dans la session (canal interne de l’interface).',
  cmdListDesc: 'Liste les rappels programmés créés par l’utilisateur dans la session courante (canal interne de l’interface).',
  cmdDeleteDesc: 'Supprime un rappel programmé dans la session (canal interne de l’interface).',
  cmdEditDesc: 'Modifie le contenu d’un rappel programmé dans la session (l’heure d’origine est conservée ; canal interne de l’interface).',
  cmdPauseDesc: 'Met en pause un rappel programmé de type after (canal interne de l’interface uniquement ; impossible s’il est déjà échu).',
  cmdResumeDesc: 'Reprend un rappel de type after mis en pause (canal interne de l’interface uniquement).',
  cmdSteerDesc: 'Envoyer maintenant : transmet immédiatement à l’agent le rappel dont l’id est indiqué (one-shot uniquement ; canal interne de l’interface).',
  errEmptyPrompt: 'Le contenu du rappel ne peut pas être vide.',
  errInvalidSelector: 'Il faut fournir l’un de after_seconds, at ou every_seconds.',
  errMultipleSelectors: 'Un seul de after_seconds, at ou every_seconds peut être fourni.',
  errNotFuture: 'L’heure doit être dans le futur.',
  errTimeOutOfRange: 'L’heure est hors de la plage autorisée.',
  errFrequencyTooHigh: 'La fréquence est trop élevée.',
  errInvalidRule: 'La règle est invalide.',
  errSubagentSession: 'Cette session appartient à une délégation de sous-agent, qui ne recevra jamais de livraison de rappel.',
  errScheduleNotFound: 'Le rappel n’existe pas.',
  errAlreadyOverdue: 'Le rappel est déjà échu.',
  errQuotaExceeded: 'Limite de tâches atteinte ({max} éléments).',
  errPersistenceUncertain: 'Persistance incertaine.',
  errUnsupportedKind: 'Type d’opération non pris en charge.',
  errNotPaused: 'Le rappel n’est pas en pause.',
  errInternalError: 'L’opération a échoué.',
  warnSchedulerNotArmed: 'Attention : aucun planificateur n’est monté dans cette session, ce rappel ne se déclenchera donc PAS. Redémarrez le processus hôte ou ouvrez une nouvelle session et recréez-le (les sessions qui existaient avant un rechargement à chaud de l’extension peuvent ne pas se remonter).',

  // ─── 工具错误回执（task-7，src/user-tools.ts）— machine-translated block ──
  // 与 zh 侧同名区块一一对应；占位符 {maxChars} / {date} / {time} / {timeZone} /
  // {maxSchedules} / {id} / {uid} 逐字保留，位置按本语言语序调整。
  errToolPromptEmpty: 'Le contenu du rappel ne peut pas être vide.',
  errToolPromptTooLong: 'Le contenu du rappel ne peut pas dépasser {maxChars} caractères.',
  errToolCreateNotObject: 'L\'argument de create doit être un objet.',
  errToolSelectorExactlyOne: 'Un seul parmi after_seconds / at / every_seconds doit être fourni.',
  errToolTimeZoneInvalid: 'time_zone doit être un fuseau horaire IANA valide.',
  errToolAtNeedsZone: 'La chaîne at doit porter un fuseau explicite : RFC 3339 terminée par Z ou ±HH:mm (par ex. 2026-10-26T09:00:00+08:00). Si le fuseau est inconnu, passez le triplet {date, time, time_zone}.',
  errToolAtObjectMissing: 'L\'objet at doit contenir date / time / time_zone.',
  errToolAtBadDate: 'at.date doit être au format YYYY-MM-DD (deux chiffres pour le mois et le jour) et correspondre à un jour qui existe réellement.',
  errToolAtBadTime: 'at.time doit être HH:mm ou HH:mm:ss (1 à 3 chiffres fractionnaires acceptés), par ex. 09:00, 9:30:15.5.',
  errToolAtTimeZoneInvalid: 'at.time_zone doit être un fuseau horaire IANA valide.',
  errToolAtLocalGap: '{date} {time} n\'est pas une heure valide dans {timeZone} (cet intervalle peut être ignoré par l\'heure d\'été ce jour-là).',
  errToolAtShape: 'at doit être une chaîne ou un objet {date, time, time_zone}.',
  errToolInternalFailed: 'L\'opération sur la tâche planifiée a échoué. Veuillez réessayer.',
  errToolPersistenceUnconfirmed: 'La persistance de la tâche n\'est pas confirmée. Utilisez user_schedule_list pour vérifier avant de vous fier à ce résultat.',
  errToolLogUnreadable: 'Impossible de lire le journal de planification de la session.',
  errToolQuotaFull: 'Cette session est limitée à {maxSchedules} tâches planifiées. Supprimez d\'abord certaines tâches.',
  errToolScheduleIdInvalid: 'schedule id doit être une chaîne non vide, sans espaces en début ni en fin.',
  errToolUidInvalid: 'uid doit être une chaîne non vide, sans espaces en début ni en fin.',
  errToolScheduleNotFoundById: 'La tâche planifiée {id} est introuvable.',
  errToolEditOverdue: 'La tâche planifiée {id} a dépassé son heure cible, son contenu ne peut donc pas être modifié ; supprimez-la et recréez-la.',
  errToolPauseNotFoundById: 'Aucune tâche planifiée pausable {id} n\'a été trouvée.',
  errToolPauseUnsupportedKind: 'Seuls les rappels du type « dans N minutes » (after) peuvent être mis en pause.',
  errToolPauseOverdue: 'La tâche a déjà atteint son échéance et ne peut pas être mise en pause ; supprimez-la ou attendez l\'envoi.',
  errToolResumeNotFound: 'Aucune tâche en pause {uid} n\'a été trouvée.',

  // ─── Surface des commandes (task-8, src/commands.ts) — machine-translated block ──
  // Correspondance 1:1 avec les clés zh. Les jetons {count} / {times} / {created} /
  // {total} / {failure} / {content} / {max} / {minSeconds} / {gapSeconds} / {date} /
  // {hhmm} / {timeZone} / {detail} sont conservés à l'identique.
  // ⚠️ Ne sont pas traduits : les noms de commande /schedule, /later, /user-schedule-edit,
  // les champs id / prompt / uid, ni les exemples de saisie (+1h*3, 1532, 15:32, 30分钟后,
  // 明天9点…) — l'utilisateur les tape tels quels dans le champ de saisie ; traduits,
  // l'analyseur ne les accepterait plus.
  cmdCreateHint: 'Charge JSON, par ex. {"prompt":"vérifier le résultat du build","after_seconds":300} ; la forme {"prompt":"…","at":{"date":"2026-08-21","time":"15:32","time_zone":"Asia/Shanghai"}} est aussi acceptée',
  cmdListHint: 'Aucune charge requise. Appuyez une fois sur Entrée pour prendre la commande, puis encore une fois pour l’exécuter (c’est le fonctionnement de toutes les commandes du noyau avec input)',
  cmdIdHint: 'Charge JSON, par ex. {"id":"schedule-…"} ; un id seul fonctionne aussi : schedule-…',
  cmdEditHint: 'Charge JSON, par ex. {"id":"schedule-…","prompt":"le nouveau texte du rappel"}',
  cmdResumeHint: 'Charge JSON, par ex. {"id":"schedule-…"} ({"uid":"…"} fonctionne aussi) ; ou un id seul : schedule-…',
  quickScheduleDesc: 'Commande rapide de rappels : /schedule <heure> <texte>. Analyse tolérante de l’heure : +30m, +1h30m, 30分钟后, 1532, 15:32, 9点半, 明天9点, 后天 10:00, 8月21日 15:32, 0821-1532, 2026-08-21 15:32. Formes multiples : +1h*3 (3 fois à intervalle régulier) et +1h+1h+0.5h (séquence enchaînée, heures cumulées), chacune développée en tâches distinctes, 10 au maximum et au moins 60 s entre deux répétitions.',
  quickScheduleHint: '<heure> <texte>, par ex. 1532 vérifier le résultat du build ; aussi +30m, 明天9点, +1h*3, +1h+30m',
  quickLaterDesc: 'Envoi différé : /later <heure> <texte> envoie ce texte en votre nom à l’heure dite (ce n’est pas un rappel, c’est un envoi programmé) ; images/fichiers possibles, envoyés avec le texte. Mêmes formats d’heure que /schedule, y compris les formes multiples : +1h*3 (N fois à intervalle régulier), +1h+1h+0.5h (séquence relative), 15:32+16:32 / 9:00+1d (séquence ancrée sur l’horloge) sont développées en plusieurs envois programmés (même texte et mêmes pièces jointes à chaque fois). Les formes multiples sont expérimentales et peuvent être désactivées dans le réglage « Syntaxe avancée » du greffon.',
  quickLaterHint: '<heure> <texte>, par ex. 1532 vérifier le résultat du build ; images/fichiers possibles ; plusieurs avec +1h*3 ou +1h+30m ; envoyé en votre nom à l’heure dite',
  replyMissingPayload: 'Charge JSON manquante.',
  replyPayloadNotObject: 'La charge JSON doit être un objet.',
  replyPayloadInvalid: 'Échec de l’analyse de la charge JSON.',
  replyCreateFailed: 'Échec de la création.',
  replySteerNotInjected: 'Le gestionnaire d’interruption n’est pas injecté.',
  replySteerIdRequired: 'invalid_rule : schedule id est obligatoire.',
  replyEditMissingPrompt: 'Nouveau texte manquant : la charge de /user-schedule-edit doit fournir id et prompt, par ex. {"id":"schedule-…","prompt":"le nouveau texte du rappel"}.',
  replyVerbWill: 'Envoi prévu le',
  replyVerbSet: 'Rappel programmé : ',
  replyHintLaterOneShot: ' (envoyé en votre nom à l’heure dite)',
  replyHintReminderOneShot: ' (annulable à tout moment depuis la barre bleue des envois en attente au-dessus du champ de saisie)',
  replyHintLaterMulti: ' (envoyé en votre nom un par un à l’heure dite ; annulables séparément depuis la barre des envois en attente)',
  replyHintReminderMulti: ' (chacun annulable séparément depuis la barre des envois en attente au-dessus du champ de saisie)',
  replyExpanded: 'Développé en {count} tâches : {times}',
  replyWithAttachments: ' (avec {count} pièces jointes)',
  replyPartial: ' | Attention : seules {created}/{total} ont été créées, {failure}',
  replyPartsJoined: ' | ',
  replyQuoted: '«{content}»',
  parseUsage: 'Utilisation : /schedule <heure> <texte>, par ex. /schedule 1532 vérifier le résultat du build',
  parseUnrecognized: 'Format d’heure non reconnu. Acceptés : +30m, 1532, 15:32, 30分钟后, 明天9点, 2026-08-21 15:32 ; répétition +1h*3 ; séquence +1h+1h+0.5h.',
  parseUnrecognizedSpec: 'Format d’heure non reconnu. Acceptés : +30m, 1532, 15:32, 30分钟后, 明天9点, etc.',
  parseDanglingSuffix: 'L’expression d’heure est suivie d’une durée ou d’un nombre de répétitions qui n’a pas été appliqué. Pour plusieurs heures, écrivez +1h*3 (3 fois à intervalle régulier) ou 15:32+16:32, 9:00+1d (séquence séparée par +) ; laissez une espace après le nombre. Si cette partie est votre texte, reformulez-la.',
  parseSpecMultiOnly: 'Les formes multiples/séquence se développent en plusieurs tâches et ne sont prises en charge que par /schedule et /later ; pour un seul élément, n’écrivez qu’une heure comme +1h.',
  parseSpecChainOnly: 'Une séquence ancrée se développe en plusieurs tâches et n’est prise en charge que par /schedule et /later ; pour un seul élément, n’écrivez qu’une seule heure.',
  parseAdvancedDisabled: 'Les formes multiples (+1h*3, +1h+1h+0.5h, 15:32+16:32) sont une fonction expérimentale (« Syntaxe avancée ») actuellement désactivée dans les réglages. Pour l’activer : Réglages → Greffons → Rappels programmés → Syntaxe avancée.',
  parseInternalUnhandled: 'Erreur interne : la forme multiple n’a pas été développée.',
  parseInvalidField: 'Valeur de date ou d’heure invalide.',
  parseDateNotExist: 'Cette date n’existe pas.',
  parseTimePassed: 'L’heure cible est déjà passée.',
  parseTimePassedToday: 'Cette heure est déjà passée aujourd’hui ; utilisez « demain » ou une date précise.',
  parseTimeUnresolvable: 'Impossible de déterminer l’heure cible.',
  parseAnchorNotAbsolute: 'L’ancre doit être une heure absolue.',
  parseDstSkipped: 'Le {date} à {hhmm} n’existe pas en {timeZone} (le changement d’heure a sauté ce moment) ; choisissez une autre heure ou un autre fuseau.',
  parseChainStepInvalid: 'Heure invalide dans la séquence.',
  parseOccurrencesTooMany: '{max} au maximum à la fois (les formes multiples se développent en autant de tâches ponctuelles et consomment le quota de la session).',
  parseOccurrencesTooTight: 'Les formes multiples nécessitent au moins {minSeconds} secondes entre deux éléments ; pour un seul, vous pouvez omettre le nombre.',
  parseRepeatNotPositive: 'Le nombre de répétitions doit être un entier positif, par ex. +1h*3, +30m×2.',
  parseRepeatTooMany: 'Trop de répétitions ({count}). {detail}',
  parseSegmentsTooMany: 'Séquence d’heures trop longue ({count} segments). {detail}',
  parseChainTooMany: 'Séquence d’heures trop longue ({count} heures). La limite est {max}.',
  parseGapTooTight: 'Deux heures voisines sont séparées de {gapSeconds} secondes ; les formes multiples exigent au moins {minSeconds} secondes entre elles.',
  parseContentEmpty: 'Le texte du rappel ne peut pas être vide.',
  parseContentTooLong: 'Le texte du rappel ne peut pas dépasser {chars} caractères.',
  relOverdue: 'en retard',
  relSoon: 'envoi imminent',
  relMinutes: 'dans ~{m} min',
  relHours: 'dans ~{h} h',
  relHoursMinutes: 'dans ~{h} h {m} min',
  relDays: 'dans ~{d} jours',
  errRtStopping: 'Le planificateur est arrêté.',
  errRtScheduleNotFound: 'Ce rappel n’existe pas ou a déjà été envoyé.',
  errRtSteerUnsupportedKind: 'L’insertion dans les rappels récurrents (every) n’est pas encore prise en charge.',
  errRtLogUnreadable: 'Impossible de lire le journal des planifications de la session.',
  errRtSteerFailed: 'L’exécution de l’insertion a échoué.',
  errRtDeliveryLost: 'La remise n’a pas été confirmée et le réarmement a aussi échoué — vérifiez dans le panneau si ce rappel existe toujours.',
  errRtDeliveryRetryable: 'La remise n’a pas été confirmée ; le rappel a été conservé et peut être réessayé.',
  errToolAgentMismatch: 'L’opération a échoué.',
  errToolNoRuntime: 'Cette session n’a pas encore de planificateur utilisateur monté.',
};

export default dict;
