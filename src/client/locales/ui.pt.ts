/**
 * 客户端微文案字典 —— Portuguese（机器初翻，**未经母语审校**）。
 *
 * ⚠️ 状态声明：本文件由机器翻译产出，只做过「占位符逐字保留、专有名词不译、无零宽字符」
 * 三项机械校验，**没有**经过葡萄牙语母语者审校。措辞、语感、术语取舍都可能有误。
 * 修正请直接改本文件对应取值，不要为了「看起来一致」去改别的语言的文案。
 *
 * 键集由 `ui.ts` 的 `zh` 定义，本文件用 `{ [K in keyof typeof zh]: string }` 强制一致：
 * 漏一个键是 tsc 报错，而不是上线后静默掉进宿主的回退链（缺失语言 → en → key 本身）。
 *
 * 不翻译的：`/later` 这类 slash 命令名、`after` / `at` / `every` 这类 kind 名、
 * 宿主 API 字段名、以及 DSH / RFC 3339 / IANA 等专有名词。
 *
 * @module dsh-later/client/locales/ui.pt
 */
import type { zh } from './ui.js';

const dict: { [K in keyof typeof zh]: string } = {
  buttonSchedule: 'Programar envio',
  panelTitle: 'Lembretes agendados',
  close: 'Fechar',
  quick10m: 'Em 10 minutos',
  quick1h: 'Em 1 hora',
  quickSmart: 'Horário de trabalho',
  quickCustom: 'Personalizado…',
  dateLabel: 'Data',
  timeLabel: 'Hora',
  today: 'Hoje',
  tomorrow: 'Amanhã',
  taskListTitle: 'Agendados',
  emptyTasks: 'Nenhum lembrete agendado',
  deleteTask: 'Excluir lembrete',
  editTask: 'Editar lembrete',
  editSave: 'Salvar',
  editCancel: 'Cancelar',
  editErrEmpty: 'O conteúdo não pode ficar vazio',
  editErrFailed: 'Falha ao editar: {message}',
  editErrNotAccepted: 'O comando não foi aceito',
  editErrCommandFailed: 'O comando falhou',
  steerTask: 'Enviar agora',
  steerAlreadySent: 'Enviado',
  steerFailed: 'Falha ao enviar: {message}',
  steerUnsupportedKind: 'Lembretes recorrentes não podem ser enviados agora',
  steerUnconfirmed: 'Entrega não confirmada — o lembrete foi mantido, você pode tentar de novo',
  steerRetry: 'Tentar de novo',
  pauseTask: 'Pausar lembrete',
  resumeTask: 'Retomar lembrete',
  pausedLabel: 'Pausado',
  pauseFailed: 'Falha ao pausar: {message}',
  resumeFailed: 'Falha ao retomar: {message}',
  pauseUnsupportedKind: 'Só lembrete do tipo “esperar N minutos” (after) pode ser pausado',
  panelCount: '{n} lembretes agendados',
  countdownLeft: 'faltam',
  dueAnyMoment: 'Enviando em breve',
  sending: 'Enviando…',
  statusUnconfirmed: '{n} não confirmado(s)',
  confirmAdd: 'Adicionar · enviar às {time}',
  confirmAddNoTime: 'Escolha um horário de envio',
  promptFromDraft: 'O rascunho do campo de texto será usado como conteúdo do lembrete',
  errPromptEmpty: 'Digite algo no campo de texto primeiro',
  errPromptTooLong: 'O conteúdo do lembrete não pode passar de {maxChars} caracteres',
  errTimePast: 'Escolha um horário futuro',
  errCreateFailed: 'Falha ao criar: {message}',
  errDeleteFailed: 'Falha ao excluir: {message}',
  errNoSession: 'Nenhuma sessão ativa',
  errNotAcceptedStashed: 'O comando não foi aceito; salvo localmente',
  presenceBadgeAria: '{n} lembrete(s) agendado(s), próximo às {time}',
  presenceOverdueAria: '{n} lembrete(s) agendado(s) vencido(s), aguardando envio',
  presenceTooltip: 'Próximo às {time} · {n} tarefa(s)',
  presenceOverdueTooltip: 'Vencido · {n} tarefa(s) (envia quando a sessão fica ociosa)',
  presencePausedAria: '{n} lembrete(s) pausado(s)',
  presencePausedTooltip: 'Pausado · {n} tarefa(s)',
  hoverScheduleStatus: '{n} lembrete(s) agendado(s), próximo às {time}',
  hoverScheduleOverdue: '{n} lembrete(s) agendado(s) vencido(s), aguardando envio',
  hoverSchedulePaused: '{n} lembrete(s) pausado(s)',
  facetScheduled: 'Agendados',
  relMinutes: 'em {m} min',
  relHours: 'em {h} h',
  relTomorrow: 'Amanhã {time}',
  relDate: '{date} {time}',
  relClock: '{time}',
  attachmentImage: 'Imagem do lembrete',
  attachmentFile: 'Arquivo do lembrete {name}',
  attachmentPendingSend: 'Disponível após o envio',
  attachmentUnavailable: 'Imagem indisponível',
  attachmentMore: 'Mais {n} anexo(s) não listado(s)',
  bubbleMarkerLabel: 'Marcador de mensagem agendada',
  bubbleMarkerHint: 'Adiciona um marcador de relógio às mensagens entregues por /later. left o mostra ao lado do balão, meta acrescenta uma linha pequena acima e hover só aparece ao passar o cursor na linha; desligado, a renderização oficial fica intacta. Disponível apenas no kernel 0.2.1 ou mais recente.',
  bubbleMarkerOption_off: 'Desligado',
  bubbleMarkerOption_left: 'Ao lado do balão',
  bubbleMarkerOption_meta: 'Acima do balão',
  bubbleMarkerOption_hover: 'Ao passar o cursor',
  laterMarkerAria: 'Mensagem agendada, entregue às {time}',
  laterMarkerTooltip: 'Agendada · entregue às {time}',
  laterMarkerTooltipBatch: 'Agendada · entregue às {time} · {count} agrupadas',
  laterMarkerMeta: 'Agendada · {time}',
  actionCopy: 'Copiar',
  actionCopied: 'Copiado',
  clockMd: '{d}/{m}',
  clockYmd: '{d}/{m}/{y}',
  relPhraseOverdue: 'atrasado',
  relPhraseSoon: 'envio em breve',
  relPhraseMinutes: 'em ~{m} min',
  relPhraseHours: 'em ~{h} h',
  relPhraseHoursMinutes: 'em ~{h} h {m} min',
  relPhraseDays: 'em ~{d} dias',
};

export default dict;
