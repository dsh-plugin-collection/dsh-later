/**
 * 宿主侧微文案 —— Portuguese（机器初翻，**未经母语审校**）。
 *
 * ⚠️ 状态声明：本文件由机器翻译产出，只做过「占位符逐字保留、专有名词不译、无零宽字符」
 * 三项机械校验，**没有**经过葡萄牙语母语者审校。
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
 * @module dsh-later/locales/host.pt
 */
import type { zh } from './host.js';

const dict: { [K in keyof typeof zh]: string } = {
  toolCreateDesc: 'Cria um lembrete agendado na sessão atual. É obrigatório fornecer um prompt não vazio e exatamente um seletor: after_seconds (atraso em segundos, inteiro positivo), at (hora com deslocamento explícito ou hora local {date,time,time_zone}) ou every_seconds (intervalo fixo em segundos, ≥300). time_zone é opcional; por padrão usa o fuso detectado da sessão. A origem é marcada como ferramenta do usuário e o painel da GUI vai exibi-la. every_seconds é um intervalo fixo **sem condição de término** (repete indefinidamente até o usuário excluí-lo); se o usuário informar um número máximo de vezes (por ex. «me lembre a cada hora, 3 vezes»), NÃO use every_seconds: **chame esta ferramenta N vezes separadamente**, cada uma com at indicando a hora absoluta correspondente (t+1h, t+2h, t+3h).',
  toolListDesc: 'Lista os lembretes agendados ativos criados pelo usuário na sessão atual (inclui id, alvo em UTC, estado scheduled/overdue e modo de entrega).',
  toolDeleteDesc: 'Exclui um lembrete ativo pelo id exato devolvido por user_schedule_create / user_schedule_list; id desconhecido ou já encerrado devolve deleted:false.',
  paramPromptDesc: 'Conteúdo do lembrete (não vazio após trim). O limite segue a configuração do plugin “permitir prompts longos”: 1000 caracteres por padrão, ampliável nas configurações; uma chamada acima do limite devolve invalid_prompt e a mensagem informa a quantidade realmente permitida naquele momento.',
  paramAfterSecondsDesc: 'Atraso em segundos, inteiro positivo.',
  paramEverySecondsDesc: 'Intervalo fixo em segundos, no mínimo 300; sem condição de término (para um número limitado de vezes, crie vários itens com at).',
  paramAtDesc: 'Alvo absoluto: uma string RFC 3339 com fuso explícito (terminada em Z ou ±HH:mm), ou um objeto de calendário local {date, time, time_zone}. A hora local aceita HH:mm e HH:mm:ss (1 a 3 dígitos de milissegundos são permitidos); o plugin completa para o HH:mm:ss exigido pelo upstream. Uma string sem qualquer informação de fuso é recusada em vez de adivinhada.',
  paramTimeZoneDesc: 'Fuso horário IANA (por ex. Asia/Shanghai); opcional, por padrão o fuso detectado da sessão.',
  paramIdDesc: 'Id exato do schedule dentro da sessão.',
  presentCreate: 'Criar lembrete agendado',
  presentList: 'Listar lembretes agendados',
  presentDelete: 'Excluir lembrete agendado',
  cmdLaterDesc: 'Cria um lembrete agendado dentro da sessão (canal interno da GUI).',
  cmdScheduleDesc: 'Cria um lembrete agendado dentro da sessão (canal interno da GUI).',
  cmdListDesc: 'Lista os lembretes agendados criados pelo usuário na sessão atual (canal interno da GUI).',
  cmdDeleteDesc: 'Exclui um lembrete agendado dentro da sessão (canal interno da GUI).',
  cmdEditDesc: 'Altera o conteúdo de um lembrete agendado dentro da sessão (mantém a hora original; canal interno da GUI).',
  cmdPauseDesc: 'Pausa um lembrete agendado do tipo after (somente canal interno da GUI; não é possível pausar se já venceu).',
  cmdResumeDesc: 'Retoma um lembrete do tipo after pausado (somente canal interno da GUI).',
  cmdSteerDesc: 'Enviar agora: entrega imediatamente ao agent o lembrete com o id indicado (somente one-shot; canal interno da GUI).',
  errEmptyPrompt: 'O conteúdo do lembrete não pode ficar vazio.',
  errInvalidSelector: 'É preciso fornecer um de after_seconds, at ou every_seconds.',
  errMultipleSelectors: 'Só é possível fornecer um de after_seconds, at ou every_seconds.',
  errNotFuture: 'A hora precisa estar no futuro.',
  errTimeOutOfRange: 'A hora está fora do intervalo permitido.',
  errFrequencyTooHigh: 'A frequência é alta demais.',
  errInvalidRule: 'A regra é inválida.',
  errSubagentSession: 'Esta sessão pertence a uma delegação de subagente e nunca receberá entrega de lembretes.',
  errScheduleNotFound: 'O lembrete não existe.',
  errAlreadyOverdue: 'O lembrete já venceu.',
  errQuotaExceeded: 'Limite de tarefas atingido ({max} itens).',
  errPersistenceUncertain: 'Persistência incerta.',
  errUnsupportedKind: 'Tipo de operação não suportado.',
  errNotPaused: 'O lembrete não está pausado.',
  errInternalError: 'A operação falhou.',
  warnSchedulerNotArmed: 'Atenção: esta sessão não tem o agendador montado, então este lembrete NÃO vai disparar. Reinicie o processo do host ou abra uma sessão nova e recrie-o (sessões que existiam antes de um recarregamento a quente do plugin podem não ser remontadas).',

  // ─── 工具错误回执（task-7，src/user-tools.ts）— machine-translated block ──
  // 与 zh 侧同名区块一一对应；占位符 {maxChars} / {date} / {time} / {timeZone} /
  // {maxSchedules} / {id} / {uid} 逐字保留，位置按本语言语序调整。
  errToolPromptEmpty: 'O conteúdo do lembrete não pode ficar vazio.',
  errToolPromptTooLong: 'O conteúdo do lembrete não pode ultrapassar {maxChars} caracteres.',
  errToolCreateNotObject: 'O argumento de create deve ser um objeto.',
  errToolSelectorExactlyOne: 'Deve ser fornecido exatamente um entre after_seconds / at / every_seconds.',
  errToolTimeZoneInvalid: 'time_zone deve ser um fuso horário IANA válido.',
  errToolAtNeedsZone: 'A string at deve conter um fuso explícito: RFC 3339 terminada em Z ou ±HH:mm (por exemplo, 2026-10-26T09:00:00+08:00). Se o fuso for desconhecido, passe a tripla {date, time, time_zone}.',
  errToolAtObjectMissing: 'O objeto at deve conter date / time / time_zone.',
  errToolAtBadDate: 'at.date deve ser YYYY-MM-DD (mês e dia com dois dígitos) e um dia que realmente exista.',
  errToolAtBadTime: 'at.time deve ser HH:mm ou HH:mm:ss (são permitidos 1–3 dígitos fracionários), por exemplo 09:00, 9:30:15.5.',
  errToolAtTimeZoneInvalid: 'at.time_zone deve ser um fuso horário IANA válido.',
  errToolAtLocalGap: '{date} {time} não é um horário válido em {timeZone} (esse intervalo pode ser pulado pelo horário de verão nesse dia).',
  errToolAtShape: 'at deve ser uma string ou um objeto {date, time, time_zone}.',
  errToolInternalFailed: 'A operação da tarefa agendada falhou. Tente novamente.',
  errToolPersistenceUnconfirmed: 'A persistência da tarefa não foi confirmada. Use user_schedule_list para verificar antes de confiar neste resultado.',
  errToolLogUnreadable: 'Falha ao ler o registro de agendamento da sessão.',
  errToolQuotaFull: 'Esta sessão tem no máximo {maxSchedules} tarefas agendadas. Exclua algumas tarefas primeiro.',
  errToolScheduleIdInvalid: 'schedule id deve ser uma string não vazia, sem espaços no início ou no fim.',
  errToolUidInvalid: 'uid deve ser uma string não vazia, sem espaços no início ou no fim.',
  errToolScheduleNotFoundById: 'A tarefa agendada {id} não foi encontrada.',
  errToolEditOverdue: 'A tarefa agendada {id} já passou do horário-alvo, portanto o conteúdo não pode ser editado; exclua-a e crie uma nova.',
  errToolPauseNotFoundById: 'Não foi encontrada uma tarefa agendada pausável {id}.',
  errToolPauseUnsupportedKind: 'Somente lembretes do tipo "em N minutos" (after) podem ser pausados.',
  errToolPauseOverdue: 'A tarefa já venceu e não pode ser pausada; exclua-a ou aguarde o envio.',
  errToolResumeNotFound: 'Não foi encontrada nenhuma tarefa em pausa {uid}.',

  // ─── Superfície de comandos (task-8, src/commands.ts) — machine-translated block ──
  // Correspondência 1:1 com as chaves zh. Os marcadores {count} / {times} / {created} /
  // {total} / {failure} / {content} / {max} / {minSeconds} / {gapSeconds} / {date} /
  // {hhmm} / {timeZone} / {detail} são mantidos à letra.
  // ⚠️ Não se traduzem: os nomes de comando /schedule, /later, /user-schedule-edit, os
  // campos id / prompt / uid nem os exemplos de entrada (+1h*3, 1532, 15:32, 30分钟后,
  // 明天9点…). O utilizador escreve-os tal e qual na caixa de entrada; traduzidos, o
  // analisador deixaria de os aceitar.
  cmdCreateHint: 'Carga JSON, por ex. {"prompt":"verificar o resultado da compilação","after_seconds":300}; também {"prompt":"…","at":{"date":"2026-08-21","time":"15:32","time_zone":"Asia/Shanghai"}}',
  cmdListHint: 'Não é precisa carga. Prima Enter uma vez para aceitar o comando e outra para o executar (é assim que funcionam todos os comandos do kernel com input)',
  cmdIdHint: 'Carga JSON, por ex. {"id":"schedule-…"}; também serve um id simples: schedule-…',
  cmdEditHint: 'Carga JSON, por ex. {"id":"schedule-…","prompt":"o novo texto do lembrete"}',
  cmdResumeHint: 'Carga JSON, por ex. {"id":"schedule-…"} ({"uid":"…"} também serve); ou um id simples: schedule-…',
  quickScheduleDesc: 'Comando rápido de lembretes: /schedule <hora> <texto>. Interpretação tolerante da hora: +30m, +1h30m, 30分钟后, 1532, 15:32, 9点半, 明天9点, 后天 10:00, 8月21日 15:32, 0821-1532, 2026-08-21 15:32. Formas múltiplas: +1h*3 (3 vezes a intervalo regular) e +1h+1h+0.5h (sequência encadeada, horas acumuladas), cada uma expandida em tarefas independentes, no máximo 10 e com pelo menos 60 s entre repetições.',
  quickScheduleHint: '<hora> <texto>, por ex. 1532 verificar o resultado da compilação; também +30m, 明天9点, +1h*3, +1h+30m',
  quickLaterDesc: 'Envio diferido: /later <hora> <texto> envia esse texto em seu nome na hora indicada (não é um lembrete, é um envio programado); aceita imagens/ficheiros, que saem junto com o texto. Os mesmos formatos de hora do /schedule, incluindo as formas múltiplas: +1h*3 (N vezes a intervalo regular), +1h+1h+0.5h (sequência relativa), 15:32+16:32 / 9:00+1d (sequência ancorada no relógio de parede) expandem-se em vários envios programados (o mesmo texto e anexos em cada um). As formas múltiplas são experimentais e podem ser desligadas na definição «Sintaxe avançada» do plugin.',
  quickLaterHint: '<hora> <texto>, por ex. 1532 verificar o resultado da compilação; aceita imagens/ficheiros; vários com +1h*3 ou +1h+30m; é enviado em seu nome na hora indicada',
  replyMissingPayload: 'Falta a carga JSON.',
  replyPayloadNotObject: 'A carga JSON tem de ser um objeto.',
  replyPayloadInvalid: 'Falhou a análise da carga JSON.',
  replyCreateFailed: 'Falhou a criação.',
  replySteerNotInjected: 'O processador de interrupção não está injetado.',
  replySteerIdRequired: 'invalid_rule: schedule id é obrigatório.',
  replyEditMissingPrompt: 'Falta o novo texto: a carga do /user-schedule-edit tem de indicar id e prompt, por ex. {"id":"schedule-…","prompt":"o novo texto do lembrete"}.',
  replyVerbWill: 'Envio previsto para',
  replyVerbSet: 'Lembrete definido:',
  replyHintLaterOneShot: ' (é enviado em seu nome na hora indicada)',
  replyHintReminderOneShot: ' (pode cancelar a qualquer momento na barra azul de pendentes acima da caixa de entrada)',
  replyHintLaterMulti: ' (é enviado em seu nome, um a um, na hora indicada; cancelável individualmente na barra de pendentes)',
  replyHintReminderMulti: ' (cada um pode ser cancelado individualmente na barra de pendentes acima da caixa de entrada)',
  replyExpanded: 'Expandido em {count} tarefas: {times}',
  replyWithAttachments: ' (com {count} anexos)',
  replyPartial: ' | Atenção: só foram criadas {created}/{total}, {failure}',
  replyPartsJoined: ' | ',
  replyQuoted: '«{content}»',
  parseUsage: 'Utilização: /schedule <hora> <texto>, por ex. /schedule 1532 verificar o resultado da compilação',
  parseUnrecognized: 'Formato de hora não reconhecido. Aceites: +30m, 1532, 15:32, 30分钟后, 明天9点, 2026-08-21 15:32; repetição +1h*3; sequência +1h+1h+0.5h.',
  parseUnrecognizedSpec: 'Formato de hora não reconhecido. Aceites: +30m, 1532, 15:32, 30分钟后, 明天9点, etc.',
  parseDanglingSuffix: 'Depois da expressão de hora vem outro troço de duração/contagem que não foi aplicado. Para várias horas escreva +1h*3 (3 vezes a intervalo regular) ou 15:32+16:32, 9:00+1d (sequência separada por +); deixe um espaço depois da contagem. Se essa parte for o seu texto, reformule-a.',
  parseSpecMultiOnly: 'As formas múltiplas/sequência expandem-se em várias tarefas e só são aceites por /schedule e /later; para um único item escreva uma só hora como +1h.',
  parseSpecChainOnly: 'Uma sequência ancorada expande-se em várias tarefas e só é aceite por /schedule e /later; para um único item escreva só uma hora.',
  parseAdvancedDisabled: 'As formas múltiplas (+1h*3, +1h+1h+0.5h, 15:32+16:32) são uma funcionalidade experimental («Sintaxe avançada») atualmente desligada nas definições. Para ativar: Definições → Plugins → Lembretes agendados → Sintaxe avançada.',
  parseInternalUnhandled: 'Erro interno: a forma múltipla não foi expandida.',
  parseInvalidField: 'Valor de data ou hora inválido.',
  parseDateNotExist: 'Essa data não existe.',
  parseTimePassed: 'A hora de destino já passou.',
  parseTimePassedToday: 'Essa hora já passou hoje; use «amanhã» ou uma data concreta.',
  parseTimeUnresolvable: 'Não é possível determinar a hora de destino.',
  parseAnchorNotAbsolute: 'A âncora tem de ser uma hora absoluta.',
  parseDstSkipped: '{date} {hhmm} não existe em {timeZone} (a mudança de hora saltou este momento); escolha outra hora ou fuso horário.',
  parseChainStepInvalid: 'Hora inválida na sequência.',
  parseOccurrencesTooMany: 'No máximo {max} de cada vez (as formas múltiplas expandem-se em igual número de tarefas pontuais e contam para a quota da sessão).',
  parseOccurrencesTooTight: 'As formas múltiplas exigem pelo menos {minSeconds} segundos entre itens; para um só pode omitir a contagem.',
  parseRepeatNotPositive: 'O número de repetições tem de ser um inteiro positivo, por ex. +1h*3, +30m×2.',
  parseRepeatTooMany: 'Demasiadas repetições ({count}). {detail}',
  parseSegmentsTooMany: 'Sequência de horas demasiado longa ({count} segmentos). {detail}',
  parseChainTooMany: 'Sequência de horas demasiado longa ({count} horas). O limite é {max}.',
  parseGapTooTight: 'Duas horas vizinhas distam {gapSeconds} segundos; as formas múltiplas exigem pelo menos {minSeconds} segundos entre elas.',
  parseContentEmpty: 'O texto do lembrete não pode estar vazio.',
  parseContentTooLong: 'O texto do lembrete não pode exceder {chars} caracteres.',
  relOverdue: 'atrasado',
  relSoon: 'envio em breve',
  relMinutes: 'em ~{m} min',
  relHours: 'em ~{h} h',
  relHoursMinutes: 'em ~{h} h {m} min',
  relDays: 'em ~{d} dias',
  errRtStopping: 'O agendador foi interrompido.',
  errRtScheduleNotFound: 'Esse lembrete não existe ou já foi enviado.',
  errRtSteerUnsupportedKind: 'A inserção em lembretes recorrentes (every) ainda não é suportada.',
  errRtLogUnreadable: 'Não foi possível ler o log de agendamentos da sessão.',
  errRtSteerFailed: 'Falha ao executar a inserção.',
  errRtDeliveryLost: 'A entrega não foi confirmada e o rearmazenamento também falhou — verifique no painel se este lembrete ainda existe.',
  errRtDeliveryRetryable: 'A entrega não foi confirmada; o lembrete foi mantido e pode ser tentado novamente.',
  errToolAgentMismatch: 'A operação falhou.',
  errToolNoRuntime: 'Esta sessão ainda não tem um agendador de usuário montado.',
};

export default dict;
