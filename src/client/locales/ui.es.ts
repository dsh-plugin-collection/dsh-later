/**
 * 客户端微文案字典 —— Spanish（机器初翻，**未经母语审校**）。
 *
 * ⚠️ 状态声明：本文件由机器翻译产出，只做过「占位符逐字保留、专有名词不译、无零宽字符」
 * 三项机械校验，**没有**经过西班牙语母语者审校。措辞、语感、术语取舍都可能有误。
 * 修正请直接改本文件对应取值，不要为了「看起来一致」去改别的语言的文案。
 *
 * 键集由 `ui.ts` 的 `zh` 定义，本文件用 `{ [K in keyof typeof zh]: string }` 强制一致：
 * 漏一个键是 tsc 报错，而不是上线后静默掉进宿主的回退链（缺失语言 → en → key 本身）。
 *
 * 不翻译的：`/later` 这类 slash 命令名、`after` / `at` / `every` 这类 kind 名、
 * 宿主 API 字段名、以及 DSH / RFC 3339 / IANA 等专有名词。
 *
 * @module dsh-later/client/locales/ui.es
 */
import type { zh } from './ui.js';

const dict: { [K in keyof typeof zh]: string } = {
  buttonSchedule: 'Programar envío',
  panelTitle: 'Recordatorios programados',
  close: 'Cerrar',
  quick10m: 'En 10 minutos',
  quick1h: 'En 1 hora',
  quickSmart: 'Horario laboral',
  quickCustom: 'Personalizado…',
  dateLabel: 'Fecha',
  timeLabel: 'Hora',
  today: 'Hoy',
  tomorrow: 'Mañana',
  taskListTitle: 'Programados',
  emptyTasks: 'No hay recordatorios programados',
  deleteTask: 'Eliminar recordatorio',
  editTask: 'Editar recordatorio',
  editSave: 'Guardar',
  editCancel: 'Cancelar',
  editErrEmpty: 'El contenido no puede estar vacío',
  editErrFailed: 'Error al editar: {message}',
  editErrNotAccepted: 'El comando no fue aceptado',
  editErrCommandFailed: 'El comando falló',
  steerTask: 'Enviar ahora',
  steerAlreadySent: 'Enviado',
  steerFailed: 'Error al enviar: {message}',
  steerUnsupportedKind: 'Los recordatorios recurrentes no se pueden enviar ahora',
  steerUnconfirmed: 'Entrega sin confirmar; el recordatorio se conserva, puedes reintentarlo',
  steerRetry: 'Reintentar',
  pauseTask: 'Pausar recordatorio',
  resumeTask: 'Reanudar recordatorio',
  pausedLabel: 'En pausa',
  pauseFailed: 'Error al pausar: {message}',
  resumeFailed: 'Error al reanudar: {message}',
  pauseUnsupportedKind: 'Solo se pueden pausar los recordatorios del tipo «esperar N minutos» (after)',
  panelCount: '{n} recordatorios programados',
  countdownLeft: 'quedan',
  dueAnyMoment: 'Envío inminente',
  sending: 'Enviando…',
  statusUnconfirmed: '{n} sin confirmar',
  confirmAdd: 'Añadir · enviar a las {time}',
  confirmAddNoTime: 'Elige una hora de envío',
  promptFromDraft: 'Se usará el borrador del cuadro de texto como contenido del recordatorio',
  errPromptEmpty: 'Primero escribe algo en el cuadro de texto',
  errPromptTooLong: 'El contenido del recordatorio no puede superar {maxChars} caracteres',
  errTimePast: 'Elige una hora futura',
  errCreateFailed: 'Error al crear: {message}',
  errDeleteFailed: 'Error al eliminar: {message}',
  errNoSession: 'No hay ninguna sesión activa',
  errNotAcceptedStashed: 'El comando no fue aceptado; se guardó localmente',
  presenceBadgeAria: '{n} recordatorio(s) programado(s), siguiente a las {time}',
  presenceOverdueAria: '{n} recordatorio(s) programado(s) vencido(s), esperando para enviarse',
  presenceTooltip: 'Siguiente a las {time} · {n} tarea(s)',
  presenceOverdueTooltip: 'Vencido · {n} tarea(s) (se envía cuando la sesión esté inactiva)',
  presencePausedAria: '{n} recordatorio(s) en pausa',
  presencePausedTooltip: 'En pausa · {n} tarea(s)',
  hoverScheduleStatus: '{n} recordatorio(s) programado(s), siguiente a las {time}',
  hoverScheduleOverdue: '{n} recordatorio(s) programado(s) vencido(s), esperando para enviarse',
  hoverSchedulePaused: '{n} recordatorio(s) en pausa',
  facetScheduled: 'Programados',
  relMinutes: 'en {m} min',
  relHours: 'en {h} h',
  relTomorrow: 'Mañana {time}',
  relDate: '{date} {time}',
  relClock: '{time}',
  attachmentImage: 'Imagen del recordatorio',
  attachmentFile: 'Archivo del recordatorio {name}',
  attachmentPendingSend: 'Disponible tras el envío',
  attachmentUnavailable: 'Imagen no disponible',
  attachmentMore: '{n} adjunto(s) más sin mostrar',
  bubbleMarkerLabel: 'Marca de mensaje programado',
  bubbleMarkerHint: 'Añade una marca de reloj a los mensajes enviados por /later. left la muestra junto a la burbuja, meta añade una línea pequeña encima y hover solo aparece al pasar el cursor sobre la fila; desactivada no altera el renderizado oficial. Solo está disponible en el kernel 0.2.1 o posterior.',
  bubbleMarkerOption_off: 'Desactivada',
  bubbleMarkerOption_left: 'Junto a la burbuja',
  bubbleMarkerOption_meta: 'Encima de la burbuja',
  bubbleMarkerOption_hover: 'Al pasar el cursor',
  laterMarkerAria: 'Mensaje programado, entregado {time}',
  laterMarkerTooltip: 'Programado · entregado {time}',
  laterMarkerTooltipBatch: 'Programado · entregado {time} · {count} combinados',
  laterMarkerMeta: 'Programado · {time}',
  actionCopy: 'Copiar',
  actionCopied: 'Copiado',
  clockMd: '{d}/{m}',
  clockYmd: '{d}/{m}/{y}',
  relPhraseOverdue: 'vencido',
  relPhraseSoon: 'se enviará pronto',
  relPhraseMinutes: 'en ~{m} min',
  relPhraseHours: 'en ~{h} h',
  relPhraseHoursMinutes: 'en ~{h} h {m} min',
  relPhraseDays: 'en ~{d} días',
};

export default dict;
