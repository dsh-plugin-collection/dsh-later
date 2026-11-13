/**
 * 设置卡微文案 —— Spanish（机器初翻，**未经母语审校**）。
 *
 * ⚠️ 状态声明：本文件由机器翻译产出，只做过「占位符逐字保留、专有名词不译、无零宽字符」
 * 三项机械校验，**没有**经过西班牙语母语者审校。修正请直接改这里的取值。
 *
 * 键集由 `settings.ts` 的 `zh` 定义，本文件用 `{ [K in keyof typeof zh]: string }`
 * 强制一致；漏一个键是 tsc 报错。
 *
 * 不翻译的：`/later`、`/schedule`、`HH:mm`、`+1h*3`、`9:00+1d` 这类命令名与写法示例，
 * `dsh-group-status` 这类包名，以及 `left` / `meta` / `hover` / `after` 这类取值名
 * （它们在设置卡上是**选项档位的 id**，界面文案另有一套）。
 *
 * @module dsh-later/client/locales/settings.es
 */
import type { zh } from './settings.js';

const dict: { [K in keyof typeof zh]: string } = {
  title: 'Recordatorios programados',
  description: 'Configura los parámetros de los recordatorios programados dentro de la sesión.',
  pendingBadge: 'Sin guardar',
  expand: 'Mostrar ajustes',
  collapse: 'Ocultar ajustes',
  readOnly: 'Los ajustes de esta instalación son de solo lectura.',
  sectionDisplay: 'Visualización',
  sectionTime: 'Franjas horarias',
  sectionDelivery: 'Entrega',
  sectionAdvanced: 'Sintaxis avanzada',
  betaBadge: 'Beta',
  betaBadgeAria: 'Función beta; el comportamiento puede cambiar entre versiones',
  advancedSyntaxLabel: 'Activar la sintaxis de varios elementos (+1h*3 / 15:32+16:32)',
  advancedSyntaxHint: 'Permite que /later y /schedule creen varias tareas a la vez: +1h*3 (el mismo intervalo N veces), +1h+1h+0.5h (cadena relativa), 15:32+16:32 y 9:00+1d (ancladas a un reloj de pared: conservan la hora a través del cambio de hora). Cada aparición es una tarea independiente que puedes cancelar o editar por separado; hasta 10 por comando. Marcado como Beta: el resultado al expandir y el límite de 10 tareas aún necesitan observación en uso real.',
  showButtonLabel: 'Mostrar el botón de programación',
  showButtonHint: 'Oculta el botón de reloj en la barra de entrada. Los recordatorios existentes se siguen enviando y permanecen visibles en la lista inferior del cuadro de texto.',
  showInGroupBadgeLabel: 'Mostrar los programados en la insignia de grupo',
  showInGroupBadgeHint: 'Deja de registrar la celda «Programados» en la insignia de grupo plegado de dsh-group-status, así que su recuento desaparece. Los recordatorios se siguen enviando y permanecen visibles en la lista inferior y en la barra lateral; esta fila no tiene efecto visible si dsh-group-status no está instalado.',
  maxSchedulesLabel: 'Máximo de tareas por sesión',
  maxSchedulesHint: 'Número máximo de recordatorios programados permitidos por sesión.',
  allowLongPromptsLabel: 'Permitir recordatorios largos',
  allowLongPromptsHint: 'Quita el límite predeterminado de 1000 caracteres. Una vez activado, «Máximo de caracteres» permite fijar un tope propio; mientras esté desactivado ese tope no se aplica y se queda en 1000.',
  maxPromptCharsLabel: 'Máximo de caracteres',
  maxPromptCharsHint: 'Número máximo de caracteres por recordatorio (solo se aplica con «Permitir recordatorios largos» activado).',
  maxPromptCharsLockedHint: 'Ajustable tras activar «Permitir recordatorios largos».',
  smartWindowHint: 'Lo usan el chip «Horario laboral» y la programación automática del modo inteligente.',
  smartWindowOrderHint: 'Las cinco franjas deben aumentar en orden: inicio de trabajo < inicio de la comida < fin de la comida < fin de trabajo < inicio del silencio nocturno.',
  workStartLabel: 'Inicio de la jornada',
  workEndLabel: 'Fin de la jornada (inicio de la tarde)',
  lunchStartLabel: 'Inicio de la comida',
  lunchEndLabel: 'Fin de la comida',
  eveningEndLabel: 'Inicio del silencio nocturno',
  steerDeliveryLabel: 'Entrega al interrumpir',
  steerDeliveryHint: 'Cola en la que entra el contenido del recordatorio al pulsar «Enviar ahora».',
  steerDeliveryOption_followup: 'Turno propio (recomendado)',
  steerDeliveryOption_steer: 'Turno actual (más rápido)',
  confirmDeliveryLabel: 'Confirmar entrega',
  confirmDeliveryHint: 'Tras enviar, revisa el registro de la sesión para confirmar que el mensaje entró realmente en una petición. Si lo desactivas se omite la comprobación y ya no se garantiza la entrega.',
  onUnconfirmedLabel: 'Si no se confirma',
  onUnconfirmedHint: 'Qué hacer cuando no se puede confirmar la entrega.',
  onUnconfirmedOption_keep: 'Conservar para reintentar (recomendado)',
  onUnconfirmedOption_discard: 'Descartar',
  clockIconStyleLabel: 'Estilo del icono de reloj',
  clockIconStyleHint: 'Estilo del icono de estado de programación en las filas de la barra lateral.',
  clockIconStyleOption_auto: 'Automático (recomendado)',
  clockIconStyleOption_modern: 'Estilo de trazo moderno',
  clockIconStyleOption_classic: 'Estilo de matriz de puntos clásico',
  steerRiskGuarded: '⚠ Puede perderse si coincide con el inicio de un turno; la confirmación de entrega está activada, así que un recordatorio no entregado se conserva y se puede reintentar.',
  steerRiskUnguarded: '⚠ Puede perderse si coincide con el inicio de un turno, y el recordatorio NO se conservará (la confirmación de entrega está desactivada).',
  discardRisk: '⚠ Los recordatorios no confirmados se quitan de la lista — la pérdida silenciosa vuelve a ser posible.',
  overriddenLabel: 'Anulado',
  resetLabel: 'Restablecer',
  invalidLabel: 'Introduce un número válido.',
  invalidTimeLabel: 'Usa el formato de 24 horas HH:mm.',
  save: 'Guardar',
  saving: 'Guardando…',
  discard: 'Descartar cambios',
  saveFailed: 'No se pudo guardar; inténtalo de nuevo.',
  loading: 'Cargando…',
  unavailable: 'Ajustes no disponibles.',
  sectionDisplayToggle: 'Entrada de ajustes',
  showInSettings: 'Mostrar en ajustes',
  showInSettingsHint: 'Muestra la página de ajustes de este plugin en el diálogo de ajustes (recarga la página para que surta efecto)',
};

export default dict;
