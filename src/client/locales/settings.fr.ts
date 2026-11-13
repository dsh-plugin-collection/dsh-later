/**
 * 设置卡微文案 —— French（机器初翻，**未经母语审校**）。
 *
 * ⚠️ 状态声明：本文件由机器翻译产出，只做过「占位符逐字保留、专有名词不译、无零宽字符」
 * 三项机械校验，**没有**经过法语母语者审校。修正请直接改这里的取值。
 *
 * 键集由 `settings.ts` 的 `zh` 定义，本文件用 `{ [K in keyof typeof zh]: string }`
 * 强制一致；漏一个键是 tsc 报错。
 *
 * 不翻译的：`/later`、`/schedule`、`HH:mm`、`+1h*3`、`9:00+1d` 这类命令名与写法示例，
 * `dsh-group-status` 这类包名，以及 `left` / `meta` / `hover` / `after` 这类取值名
 * （它们在设置卡上是**选项档位的 id**，界面文案另有一套）。
 *
 * @module dsh-later/client/locales/settings.fr
 */
import type { zh } from './settings.js';

const dict: { [K in keyof typeof zh]: string } = {
  title: 'Rappels programmés',
  description: 'Configurez les paramètres des rappels programmés dans la session.',
  pendingBadge: 'Non enregistré',
  expand: 'Afficher les réglages',
  collapse: 'Masquer les réglages',
  readOnly: 'Les réglages de ce déploiement sont en lecture seule.',
  sectionDisplay: 'Affichage',
  sectionTime: 'Plages horaires',
  sectionDelivery: 'Livraison',
  sectionAdvanced: 'Syntaxe avancée',
  betaBadge: 'Bêta',
  betaBadgeAria: 'Fonction bêta ; le comportement peut changer d’une version à l’autre',
  advancedSyntaxLabel: 'Activer la syntaxe multiple (+1h*3 / 15:32+16:32)',
  advancedSyntaxHint: 'Permet à /later et /schedule de créer plusieurs tâches d’un coup : +1h*3 (même intervalle N fois), +1h+1h+0.5h (chaîne relative), 15:32+16:32 et 9:00+1d (ancrées sur une horloge murale : l’heure est conservée lors du changement d’heure). Chaque occurrence est une tâche indépendante, annulable ou modifiable séparément ; jusqu’à 10 par commande. Marqué Bêta : le rendu déplié et la limite de 10 tâches demandent encore une observation en usage réel.',
  showButtonLabel: 'Afficher le bouton de programmation',
  showButtonHint: 'Masque le bouton horloge de la barre de saisie. Les rappels existants continuent de se déclencher et restent visibles dans la liste sous le champ de saisie.',
  showInGroupBadgeLabel: 'Afficher les programmés dans le badge de groupe',
  showInGroupBadgeHint: 'Cesse d’enregistrer la case « Programmés » dans le badge de groupe replié de dsh-group-status, dont le compteur disparaît alors. Les rappels continuent de se déclencher et restent visibles dans la liste sous le champ de saisie et dans la barre latérale ; cette ligne n’a aucun effet visible si dsh-group-status n’est pas installé.',
  maxSchedulesLabel: 'Nombre maximal de tâches par session',
  maxSchedulesHint: 'Nombre maximal de rappels programmés autorisé par session.',
  allowLongPromptsLabel: 'Autoriser les rappels longs',
  allowLongPromptsHint: 'Lève la limite par défaut de 1000 caractères. Une fois activé, « Nombre maximal de caractères » permet de fixer un plafond personnalisé ; désactivé, ce plafond ne s’applique pas et reste à 1000.',
  maxPromptCharsLabel: 'Nombre maximal de caractères',
  maxPromptCharsHint: 'Nombre maximal de caractères par rappel (effectif uniquement quand « Autoriser les rappels longs » est activé).',
  maxPromptCharsLockedHint: 'Réglable après avoir activé « Autoriser les rappels longs ».',
  smartWindowHint: 'Utilisé par la puce « Heures de travail » et la programmation automatique du mode intelligent.',
  smartWindowOrderHint: 'Les cinq plages doivent croître dans cet ordre : début du travail < début de la pause déjeuner < fin de la pause déjeuner < fin du travail < début du silence nocturne.',
  workStartLabel: 'Début de la journée de travail',
  workEndLabel: 'Fin de la journée de travail (début de soirée)',
  lunchStartLabel: 'Début de la pause déjeuner',
  lunchEndLabel: 'Fin de la pause déjeuner',
  eveningEndLabel: 'Début du silence nocturne',
  steerDeliveryLabel: 'Livraison de l’envoi immédiat',
  steerDeliveryHint: 'File dans laquelle entre le contenu du rappel quand vous cliquez sur « Envoyer maintenant ».',
  steerDeliveryOption_followup: 'Tour distinct (recommandé)',
  steerDeliveryOption_steer: 'Tour en cours (plus rapide)',
  confirmDeliveryLabel: 'Confirmer la livraison',
  confirmDeliveryHint: 'Après l’envoi, vérifie le journal de la session pour confirmer que le message est bien entré dans une requête. Désactivé, la vérification est ignorée et la livraison n’est plus garantie.',
  onUnconfirmedLabel: 'Si non confirmée',
  onUnconfirmedHint: 'Que faire lorsque la livraison ne peut pas être confirmée.',
  onUnconfirmedOption_keep: 'Conserver pour réessayer (recommandé)',
  onUnconfirmedOption_discard: 'Jeter',
  clockIconStyleLabel: 'Style de l’icône horloge',
  clockIconStyleHint: 'Style d’affichage de l’icône d’état de programmation dans les lignes de la barre latérale.',
  clockIconStyleOption_auto: 'Automatique (recommandé)',
  clockIconStyleOption_modern: 'Style trait moderne',
  clockIconStyleOption_classic: 'Style matrice de points classique',
  steerRiskGuarded: '⚠ Peut être avalé en cas de collision avec le début d’un tour ; la confirmation de livraison est active, donc un rappel non livré est conservé et peut être réessayé.',
  steerRiskUnguarded: '⚠ Peut être avalé en cas de collision avec le début d’un tour, et le rappel ne sera PAS conservé (confirmation de livraison désactivée).',
  discardRisk: '⚠ Les rappels non confirmés sont retirés de la liste — la perte silencieuse redevient possible.',
  overriddenLabel: 'Remplacé',
  resetLabel: 'Réinitialiser',
  invalidLabel: 'Saisissez un nombre valide.',
  invalidTimeLabel: 'Utilisez le format 24 heures HH:mm.',
  save: 'Enregistrer',
  saving: 'Enregistrement…',
  discard: 'Abandonner les modifications',
  saveFailed: 'Échec de l’enregistrement, veuillez réessayer.',
  loading: 'Chargement…',
  unavailable: 'Réglages indisponibles.',
  sectionDisplayToggle: 'Entrée des réglages',
  showInSettings: 'Afficher dans les réglages',
  showInSettingsHint: 'Affiche la page de réglages de cette extension dans la boîte de dialogue des réglages (actualisez la page pour que cela prenne effet)',
};

export default dict;
