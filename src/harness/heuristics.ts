/**
 * Cérebro determinístico — o caminho SEM LLM.
 *
 * Por que existe: o avaliador pode rodar sem chave, o replay precisa ser
 * byte-a-byte igual e os testes não podem depender de rede. Quando há chave, o
 * loop ReAct de `fetch`/`reason` é conduzido pelo modelo de verdade (é o que o
 * paper defende); quando não há — ou quando o modelo falha —, o harness degrada
 * para estas regras e DIZ que degradou, em vez de quebrar.
 *
 * Isto não é o agente: é o plano B declarado. A diferença aparece no trace.
 */
import { supercerebro } from './datasets';
import type { Json, PlanStep, ResolvedEntity, TimeWindow, ToolName } from './types';
import { SEMANA_ANTERIOR, SEMANA_ATUAL, SEMANAS } from './tools/aggregate';

export type Intent = 'pausar_ctas_fracos' | 'diagnostico_queda_vendas' | 'pauta_reuniao' | 'cruzamento_utm' | 'pergunta_generica';

export interface Passo {
  readonly pensamento: string;
  readonly tool: ToolName;
  readonly args: Json;
  readonly chavePayload?: string;
}

const sem = (t: string): string => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Termos de suplemento que NÃO existem no supercérebro — geram ambiguidade honesta. */
const PRODUTOS_DESCONHECIDOS = ['colageno', 'bcaa', 'glutamina', 'pre-treino', 'pre treino', 'magnesio', 'vitamina c', 'termogenico'];

export function classifyIntent(texto: string): Intent {
  const t = sem(texto);
  if (/(pausa|pause|pausar)/.test(t) && /(cta|criativo|anuncio)/.test(t)) return 'pausar_ctas_fracos';
  if (/(por que|porque|pq)/.test(t) && /(caiu|cairam|queda|vendas|cpa)/.test(t)) return 'diagnostico_queda_vendas';
  if (/(pauta|reuniao|agenda)/.test(t)) return 'pauta_reuniao';
  if (/(cruz|utm_content|utm|esta caro|ta caro|mais caro)/.test(t)) return 'cruzamento_utm';
  if (/(caiu|queda|diagnostic)/.test(t)) return 'diagnostico_queda_vendas';
  return 'pergunta_generica';
}

export function resolveEntities(texto: string, novoId: (p: string) => string): ResolvedEntity[] {
  const t = sem(texto);
  const nodes = supercerebro().nodes;
  const achados: ResolvedEntity[] = [];

  for (const n of nodes) {
    if (!['cliente', 'produto', 'campanha', 'pessoa', 'criativo'].includes(n.type)) continue;
    const rotulo = sem(n.label);
    const alvo = rotulo.replace(/^hw \| /, '').split(' | ')[0];
    if (alvo.length >= 4 && t.includes(alvo)) {
      achados.push({
        id: n.id,
        kind: n.type === 'cliente' ? 'conta' : (n.type as ResolvedEntity['kind']),
        label: n.label,
        mention: n.label,
        confidence: 0.95,
      });
    }
  }

  const desconhecido = PRODUTOS_DESCONHECIDOS.find((p) => t.includes(p));
  if (desconhecido) {
    achados.push({
      id: novoId('ent'),
      kind: 'produto',
      label: desconhecido,
      mention: desconhecido,
      confidence: 0.3,
      alternatives: nodes.filter((n) => n.type === 'produto').map((n) => ({ id: n.id, label: n.label })),
    });
  }

  if (!achados.some((e) => e.kind === 'conta')) {
    const conta = nodes.find((n) => n.type === 'cliente');
    if (conta) {
      achados.unshift({
        id: conta.id,
        kind: 'conta',
        label: conta.label,
        mention: t.includes(sem(conta.label)) ? conta.label : 'a conta ativa',
        confidence: t.includes(sem(conta.label)) ? 0.95 : 0.8,
      });
    }
  }
  return achados;
}

export function resolveWindow(texto: string): TimeWindow {
  const t = sem(texto);
  if (/semana passada|semana anterior/.test(t)) {
    return { from: SEMANA_ANTERIOR.from, to: SEMANA_ANTERIOR.to, mention: 'semana passada', comparedTo: { from: SEMANAS[1].from, to: SEMANAS[1].to } };
  }
  if (/mes|ultimos 30|30 dias/.test(t)) {
    return { from: SEMANAS[0].from, to: SEMANA_ATUAL.to, mention: 'últimas 4 semanas' };
  }
  const mention = /essa semana|esta semana|semana/.test(t) ? 'essa semana' : 'últimos 7 dias com dado fechado';
  return { from: SEMANA_ATUAL.from, to: SEMANA_ATUAL.to, mention, comparedTo: { from: SEMANA_ANTERIOR.from, to: SEMANA_ANTERIOR.to } };
}

export function planFor(intent: Intent, janela: TimeWindow, novoId: (p: string) => string): PlanStep[] {
  const passo = (description: string, expectedTools: ToolName[]): PlanStep => ({ id: novoId('step'), description, expectedTools, status: 'pendente' });
  switch (intent) {
    case 'pausar_ctas_fracos':
      return [
        passo('Listar os criativos ativos com copy, CTA e link de destino.', ['list_criativos']),
        passo(`Puxar gasto, CTR e conversões por anúncio de ${janela.from} a ${janela.to}.`, ['meta_ads_insights']),
        passo('Conferir no CRM quantos leads cada anúncio gerou, incluindo os que chegaram sem utm_content.', ['crm_leads']),
        passo('Propor 3 variações de CTA por criativo fraco, com a hipótese que cada uma testa.', ['propose_ctas']),
      ];
    case 'diagnostico_queda_vendas':
      return [
        passo(`Comparar conversões do Meta em ${janela.from}..${janela.to} com a janela anterior.`, ['meta_ads_insights']),
        passo('Puxar os leads do CRM na janela, INCLUINDO os que chegaram sem utm_content.', ['crm_leads']),
        passo('Ver no GA4 se o tráfego migrou de paid_social para direct.', ['ga_report']),
        passo('Checar o link de destino dos criativos de Ômega 3 (encurtador derruba UTM).', ['list_criativos']),
        passo('Procurar na linha do tempo alterações de campanha no período.', ['timeline_query']),
        passo('Rodar o app de diagnóstico e testar/descartar hipóteses.', ['app_diagnostico']),
      ];
    case 'pauta_reuniao':
      return [
        passo('Levantar os eventos recentes da conta: reuniões, cobranças, aprovações e alterações.', ['timeline_query']),
        passo('Levantar as tarefas abertas no supercérebro (aprovações travadas, investigação, verba).', ['graph_query']),
        passo('Puxar o número da semana para sustentar cada item da pauta.', ['meta_ads_insights']),
      ];
    case 'cruzamento_utm':
      return [
        passo(`Puxar gasto por anúncio no Meta de ${janela.from} a ${janela.to}.`, ['meta_ads_insights']),
        passo('Puxar gasto do Google Ads na mesma janela.', ['google_ads_insights']),
        passo('Puxar os leads do CRM por utm_content, incluindo os sem origem.', ['crm_leads']),
      ];
    default:
      return [passo('Levantar o contexto da conta no supercérebro e o número da semana.', ['graph_query', 'meta_ads_insights'])];
  }
}

/** Roteiro de leitura do nó `fetch` para cada intenção. */
export function fetchSteps(intent: Intent, janela: TimeWindow): Passo[] {
  const conta = 'housewhey';
  const j = { from: janela.from, to: janela.to };
  switch (intent) {
    case 'pausar_ctas_fracos':
      return [
        { pensamento: '"CTA ruim" não nomeia criativo. Preciso ver o copy e o CTA de cada anúncio ativo antes de decidir quem é fraco.', tool: 'list_criativos', args: { conta, status: ['ativo'] } },
        { pensamento: 'CTA fraco sem número é opinião. Puxo gasto, CTR e conversões por anúncio na janela.', tool: 'meta_ads_insights', args: { conta, ...j, breakdown: 'ad' } },
        { pensamento: 'Antes de propor pausa, confiro o CRM incluindo leads sem utm_content — anúncio com rastreio quebrado parece ruim e não é.', tool: 'crm_leads', args: { conta, ...j, incluirSemUtm: true } },
      ];
    case 'diagnostico_queda_vendas':
      return [
        { pensamento: 'Começo pelo que o cliente vê: as conversões do Meta na semana contra a anterior.', tool: 'meta_ads_insights', args: { conta, ...j, breakdown: 'ad', comparar: true } },
        { pensamento: 'Agora o outro lado: o CRM. Peço explicitamente os leads sem utm_content.', tool: 'crm_leads', args: { conta, ...j, incluirSemUtm: true } },
        { pensamento: 'O Meta reporta mais conversão do que o CRM atribui. Se for rastreio, o GA4 mostra tráfego migrando para direct.', tool: 'ga_report', args: { propriedade: 'housewhey', ...j, dimensoes: ['canal'], metricas: ['sessions', 'conversoes'] } },
        { pensamento: 'Migração para direct aponta perda de parâmetro na URL. Vou olhar o link de destino de cada criativo.', tool: 'list_criativos', args: { conta, status: ['ativo'] } },
        { pensamento: 'Achei um link encurtado. Preciso da data da troca e de quem trocou — isso está na linha do tempo.', tool: 'timeline_query', args: { tipos: ['alteracao_campanha', 'whatsapp', 'alerta'], from: '2026-08-01', to: '2026-08-26' } },
      ];
    case 'pauta_reuniao':
      return [
        { pensamento: 'Pauta é memória, não métrica. Começo pela linha do tempo das últimas semanas.', tool: 'timeline_query', args: { from: '2026-08-01', to: '2026-08-27', limite: 20 } },
        { pensamento: 'Agora o que está travado: tarefas abertas no supercérebro.', tool: 'graph_query', args: { tipo: 'tarefa' } },
        { pensamento: 'Cada item da pauta precisa de um número que o sustente.', tool: 'meta_ads_insights', args: { conta, ...j, breakdown: 'ad' } },
        { pensamento: 'E o CRM para saber se a queda de vendas atribuídas é real.', tool: 'crm_leads', args: { conta, ...j, incluirSemUtm: true } },
      ];
    case 'cruzamento_utm':
      return [
        { pensamento: 'O join é por utm_content. Puxo o gasto por anúncio no Meta na janela.', tool: 'meta_ads_insights', args: { conta, ...j, breakdown: 'ad' } },
        { pensamento: 'O cruzamento não pode ser mono-canal: puxo o Google Ads também.', tool: 'google_ads_insights', args: { conta, ...j, breakdown: 'campaign' } },
        { pensamento: 'Agora os leads do CRM por utm_content, incluindo os que chegaram sem — eles precisam aparecer como nota de rodapé.', tool: 'crm_leads', args: { conta, ...j, incluirSemUtm: true } },
      ];
    default:
      return [
        { pensamento: 'Pedido genérico: levanto o contexto da conta e o número da semana.', tool: 'graph_query', args: { tipo: 'conta' } },
        { pensamento: 'E o desempenho da janela para ancorar a resposta.', tool: 'meta_ads_insights', args: { conta, ...j, breakdown: 'campaign' } },
      ];
  }
}

/** Roteiro de análise do nó `reason` (só Apps e supercérebro). */
export function reasonSteps(intent: Intent, janela: TimeWindow, alvos: string[]): Passo[] {
  switch (intent) {
    case 'pausar_ctas_fracos':
      return [{ pensamento: 'Tenho os fracos identificados por CTA e por número. Peço as variações ao app de criativos.', tool: 'propose_ctas', args: { criativoIds: alvos, quantidade: 3 } }];
    case 'diagnostico_queda_vendas':
      return [
        { pensamento: 'Tenho as duas pontas e a data da troca de link. Rodo o app de diagnóstico para fechar causa-raiz e descartar hipóteses.', tool: 'app_diagnostico', args: { conta: 'housewhey', pergunta: 'Por que caíram as vendas atribuídas da Ômega 3 essa semana?', janela: { from: janela.from, to: janela.to } } },
      ];
    default:
      return [];
  }
}

/** Ação com efeito real proposta pela análise. `null` = turno sem write. */
export function proposedAction(intent: Intent, alvos: { nome: string; motivo: string }[]): { tool: ToolName; args: Json } | null {
  if (intent !== 'pausar_ctas_fracos' || !alvos.length) return null;
  return {
    tool: 'pause_ads',
    args: {
      adIds: alvos.map((a) => a.nome),
      motivo: 'CTA genérico com CTR e CPA fora do padrão da conta na semana atual.',
    },
  };
}
