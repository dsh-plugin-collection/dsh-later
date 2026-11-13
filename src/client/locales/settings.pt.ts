/**
 * 设置卡微文案 —— Portuguese（机器初翻，**未经母语审校**）。
 *
 * ⚠️ 状态声明：本文件由机器翻译产出，只做过「占位符逐字保留、专有名词不译、无零宽字符」
 * 三项机械校验，**没有**经过葡萄牙语母语者审校。修正请直接改这里的取值。
 *
 * 键集由 `settings.ts` 的 `zh` 定义，本文件用 `{ [K in keyof typeof zh]: string }`
 * 强制一致；漏一个键是 tsc 报错。
 *
 * 不翻译的：`/later`、`/schedule`、`HH:mm`、`+1h*3`、`9:00+1d` 这类命令名与写法示例，
 * `dsh-group-status` 这类包名，以及 `left` / `meta` / `hover` / `after` 这类取值名
 * （它们在设置卡上是**选项档位的 id**，界面文案另有一套）。
 *
 * @module dsh-later/client/locales/settings.pt
 */
import type { zh } from './settings.js';

const dict: { [K in keyof typeof zh]: string } = {
  title: 'Lembretes agendados',
  description: 'Configure os parâmetros dos lembretes agendados dentro da sessão.',
  pendingBadge: 'Não salvo',
  expand: 'Mostrar configurações',
  collapse: 'Ocultar configurações',
  readOnly: 'As configurações desta instalação são somente leitura.',
  sectionDisplay: 'Exibição',
  sectionTime: 'Janelas de horário',
  sectionDelivery: 'Entrega',
  sectionAdvanced: 'Sintaxe avançada',
  betaBadge: 'Beta',
  betaBadgeAria: 'Recurso beta; o comportamento pode mudar entre versões',
  advancedSyntaxLabel: 'Ativar a sintaxe de vários itens (+1h*3 / 15:32+16:32)',
  advancedSyntaxHint: 'Permite que /later e /schedule criem várias tarefas de uma vez: +1h*3 (o mesmo intervalo N vezes), +1h+1h+0.5h (cadeia relativa), 15:32+16:32 e 9:00+1d (ancoradas no relógio de parede: a hora é mantida na mudança de horário de verão). Cada ocorrência é uma tarefa independente que você pode cancelar ou editar separadamente; até 10 por comando. Marcado como Beta: o resultado expandido e o limite de 10 tarefas ainda precisam de observação no uso real.',
  showButtonLabel: 'Mostrar o botão de agendamento',
  showButtonHint: 'Oculta o botão de relógio na barra de entrada. Os lembretes existentes continuam disparando e permanecem visíveis na lista abaixo do campo de texto.',
  showInGroupBadgeLabel: 'Mostrar os agendados no selo de grupo',
  showInGroupBadgeHint: 'Deixa de registrar a célula “Agendados” no selo de grupo recolhido do dsh-group-status, então a contagem desaparece. Os lembretes continuam disparando e permanecem visíveis na lista abaixo do campo de texto e na barra lateral; esta linha não tem efeito visível se o dsh-group-status não estiver instalado.',
  maxSchedulesLabel: 'Máximo de tarefas por sessão',
  maxSchedulesHint: 'Número máximo de lembretes agendados permitido por sessão.',
  allowLongPromptsLabel: 'Permitir lembretes longos',
  allowLongPromptsHint: 'Remove o limite padrão de 1000 caracteres. Uma vez ativado, “Máximo de caracteres” permite definir um teto próprio; enquanto desativado esse teto não vale e fica em 1000.',
  maxPromptCharsLabel: 'Máximo de caracteres',
  maxPromptCharsHint: 'Número máximo de caracteres por lembrete (só vale quando “Permitir lembretes longos” está ativado).',
  maxPromptCharsLockedHint: 'Ajustável após ativar “Permitir lembretes longos”.',
  smartWindowHint: 'Usado pelo chip “Horário de trabalho” e pelo agendamento automático do modo inteligente.',
  smartWindowOrderHint: 'As cinco janelas devem crescer nesta ordem: início do trabalho < início do almoço < fim do almoço < fim do trabalho < início do silêncio noturno.',
  workStartLabel: 'Início do expediente',
  workEndLabel: 'Fim do expediente (início da noite)',
  lunchStartLabel: 'Início do almoço',
  lunchEndLabel: 'Fim do almoço',
  eveningEndLabel: 'Início do silêncio noturno',
  steerDeliveryLabel: 'Entrega ao enviar agora',
  steerDeliveryHint: 'Em qual fila o conteúdo do lembrete entra ao clicar em “Enviar agora”.',
  steerDeliveryOption_followup: 'Turno próprio (recomendado)',
  steerDeliveryOption_steer: 'Turno atual (mais rápido)',
  confirmDeliveryLabel: 'Confirmar entrega',
  confirmDeliveryHint: 'Depois do envio, confere o log da sessão para confirmar que a mensagem realmente entrou numa requisição. Desativado, a verificação é ignorada e a entrega deixa de ser garantida.',
  onUnconfirmedLabel: 'Se não confirmada',
  onUnconfirmedHint: 'O que fazer quando não for possível confirmar a entrega.',
  onUnconfirmedOption_keep: 'Manter para tentar de novo (recomendado)',
  onUnconfirmedOption_discard: 'Descartar',
  clockIconStyleLabel: 'Estilo do ícone de relógio',
  clockIconStyleHint: 'Estilo do ícone de status de agendamento nas linhas da barra lateral.',
  clockIconStyleOption_auto: 'Automático (recomendado)',
  clockIconStyleOption_modern: 'Estilo de traço moderno',
  clockIconStyleOption_classic: 'Estilo de matriz de pontos clássico',
  steerRiskGuarded: '⚠ Pode ser engolido ao colidir com o início de um turno; a confirmação de entrega está ativada, então um lembrete não entregue é mantido e pode ser tentado de novo.',
  steerRiskUnguarded: '⚠ Pode ser engolido ao colidir com o início de um turno, e o lembrete NÃO será mantido (a confirmação de entrega está desativada).',
  discardRisk: '⚠ Lembretes não confirmados são removidos da lista — a perda silenciosa volta a ser possível.',
  overriddenLabel: 'Substituído',
  resetLabel: 'Redefinir',
  invalidLabel: 'Digite um número válido.',
  invalidTimeLabel: 'Use o formato de 24 horas HH:mm.',
  save: 'Salvar',
  saving: 'Salvando…',
  discard: 'Descartar alterações',
  saveFailed: 'Falha ao salvar; tente novamente.',
  loading: 'Carregando…',
  unavailable: 'Configurações indisponíveis.',
  sectionDisplayToggle: 'Entrada das configurações',
  showInSettings: 'Mostrar nas configurações',
  showInSettingsHint: 'Mostra a página de configurações deste plugin na janela de configurações (recarregue a página para aplicar)',
};

export default dict;
