/**
 * Catálogo das 12 tools — espelho fiel de docs/arquitetura/tools.md.
 *
 * `allowedNodes` é a segunda trava da allowlist (a primeira é `NodeBudget`).
 * `parameters` é o JSON Schema enviado ao modelo no tool-calling.
 */
import type { ToolDef, ToolName } from '../types';
import { asArgs, previewPauseAds, previewSendWhatsapp } from './write';

const janela = {
  from: { type: 'string', description: 'Início da janela, ISO YYYY-MM-DD.' },
  to: { type: 'string', description: 'Fim da janela, ISO YYYY-MM-DD.' },
};

export const TOOLS: readonly ToolDef[] = [
  {
    name: 'graph_query',
    layer: 'supercerebro',
    effect: 'read',
    description: 'Consulta o grafo de memória da operação (clientes, pessoas, campanhas, criativos, canais, tarefas) e suas relações. Use para transformar o apelido do gestor ("a Ômega 3") no id da entidade antes de qualquer API.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['conta', 'pessoa', 'campanha', 'criativo', 'canal', 'produto', 'tarefa', 'cliente'] },
        id: { type: 'string' },
        texto: { type: 'string', description: 'Busca por rótulo ou atributo.' },
        relacionadoA: { type: 'string', description: 'Id da entidade âncora; devolve a vizinhança.' },
        profundidade: { type: 'number', enum: [1, 2] },
      },
    },
    allowedNodes: ['interpret', 'fetch', 'reason'],
  },
  {
    name: 'timeline_query',
    layer: 'supercerebro',
    effect: 'read',
    description: 'Eventos datados da conta em ordem cronológica: reuniões, mensagens de WhatsApp, aprovações, alterações de campanha, alertas e briefings. É o que dá precisão a "essa semana" e o que alimenta pauta de reunião.',
    parameters: {
      type: 'object',
      properties: {
        entidadeId: { type: 'string' },
        ...janela,
        tipos: { type: 'array', items: { type: 'string', enum: ['reuniao', 'whatsapp', 'aprovacao', 'alteracao_campanha', 'briefing', 'alerta', 'onboarding'] } },
        limite: { type: 'number' },
      },
    },
    allowedNodes: ['interpret', 'fetch', 'reason'],
  },
  {
    name: 'meta_ads_insights',
    layer: 'api',
    effect: 'read',
    description: 'Insights do Meta Ads agregados por campanha, conjunto ou anúncio: gasto, impressões, cliques, CTR, frequência, conversões e utm_content associado. Também devolve o gasto que NÃO carregou utm_content no período.',
    parameters: {
      type: 'object',
      properties: {
        conta: { type: 'string' },
        ...janela,
        breakdown: { type: 'string', enum: ['campaign', 'adset', 'ad'] },
        campos: { type: 'array', items: { type: 'string' } },
        comparar: { type: 'boolean', description: 'Traz também a janela anterior equivalente.' },
      },
      required: ['conta', 'from', 'to', 'breakdown'],
    },
    allowedNodes: ['fetch'],
  },
  {
    name: 'google_ads_insights',
    layer: 'api',
    effect: 'read',
    description: 'Gasto, cliques e conversões do Google Ads por campanha no período. Existe para o cruzamento não ser mono-canal.',
    parameters: {
      type: 'object',
      properties: { conta: { type: 'string' }, ...janela, breakdown: { type: 'string', enum: ['campaign', 'ad_group', 'ad'] } },
      required: ['conta', 'from', 'to'],
    },
    allowedNodes: ['fetch'],
  },
  {
    name: 'ga_report',
    layer: 'api',
    effect: 'read',
    description: 'Relatório do GA4 por canal (paid_social, paid_search, direct, organic…) ou por landing page. É aqui que aparece o tráfego que chegou sem parâmetro de campanha.',
    parameters: {
      type: 'object',
      properties: {
        propriedade: { type: 'string' },
        ...janela,
        dimensoes: { type: 'array', items: { type: 'string', enum: ['source', 'medium', 'campaign', 'landingPage', 'canal'] } },
        metricas: { type: 'array', items: { type: 'string' } },
      },
      required: ['propriedade', 'from', 'to', 'dimensoes'],
    },
    allowedNodes: ['fetch'],
  },
  {
    name: 'crm_leads',
    layer: 'api',
    effect: 'read',
    description: 'Leads do CRM na janela, agregados por utm_content, com receita ganha. `incluirSemUtm: true` traz também os leads que chegaram SEM origem — é o que expõe ruptura de atribuição.',
    parameters: {
      type: 'object',
      properties: {
        conta: { type: 'string' },
        ...janela,
        estagio: { type: 'string', enum: ['novo', 'contato', 'agendado', 'ganho', 'perdido'] },
        utmContent: { type: ['string', 'null'] },
        incluirSemUtm: { type: 'boolean' },
      },
      required: ['conta', 'from', 'to'],
    },
    allowedNodes: ['fetch'],
  },
  {
    name: 'list_criativos',
    layer: 'api',
    effect: 'read',
    description: 'Criativos da conta com copy, CTA, status, métricas por semana e linkDestino (mais linkOriginal quando o link foi trocado). O linkDestino é o campo que revela encurtador.',
    parameters: {
      type: 'object',
      properties: {
        conta: { type: 'string' },
        campanhaId: { type: 'string' },
        status: { type: 'array', items: { type: 'string', enum: ['ativo', 'pausado', 'em_aprovacao', 'proposto', 'reprovado'] } },
      },
      required: ['conta'],
    },
    allowedNodes: ['fetch'],
  },
  {
    name: 'get_metrics',
    layer: 'api',
    effect: 'read',
    description: 'Série temporal por entidade e métrica (dia ou semana). Use para responder "caiu comparado a quando?" sem puxar o insight inteiro de novo.',
    parameters: {
      type: 'object',
      properties: {
        entidadeIds: { type: 'array', items: { type: 'string' } },
        metricas: { type: 'array', items: { type: 'string', enum: ['spend', 'conversions', 'clicks', 'impressions', 'ctr', 'cpa'] } },
        ...janela,
        granularidade: { type: 'string', enum: ['dia', 'semana'] },
      },
      required: ['entidadeIds', 'metricas', 'from', 'to'],
    },
    allowedNodes: ['fetch'],
  },
  {
    name: 'app_diagnostico',
    layer: 'app',
    effect: 'read',
    description: 'App de metodologia: cruza mídia, CRM, GA e linha do tempo e devolve diagnóstico ESTRUTURADO (veredito, causa-raiz com evidência e fonte, hipóteses descartadas, próximos passos). Entrega estrutura, não parágrafo.',
    parameters: {
      type: 'object',
      properties: {
        conta: { type: 'string' },
        pergunta: { type: 'string' },
        janela: { type: 'object', properties: janela },
        observacoesIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['conta', 'pergunta'],
    },
    allowedNodes: ['reason'],
  },
  {
    name: 'propose_ctas',
    layer: 'app',
    effect: 'read',
    description: 'App de metodologia: propõe variações de CTA por criativo, cada uma com a hipótese que testa e a justificativa ancorada no dado. Propor NÃO é publicar — nada vai ao ar por aqui.',
    parameters: {
      type: 'object',
      properties: {
        criativoIds: { type: 'array', items: { type: 'string' } },
        quantidade: { type: 'number' },
        restricoesDeMarca: { type: 'array', items: { type: 'string' } },
      },
      required: ['criativoIds', 'quantidade'],
    },
    allowedNodes: ['reason'],
  },
  {
    name: 'pause_ads',
    layer: 'api',
    effect: 'write',
    description: 'EFEITO REAL: pausa anúncios no Meta Ads. Só executa no nó act, depois de confirmação humana no gate.',
    parameters: {
      type: 'object',
      properties: {
        adIds: { type: 'array', items: { type: 'string' }, description: 'Ids ou nomes dos anúncios.' },
        motivo: { type: 'string' },
      },
      required: ['adIds', 'motivo'],
    },
    allowedNodes: ['act'],
    buildPreview: (args) => previewPauseAds(asArgs(args)),
  },
  {
    name: 'send_whatsapp',
    layer: 'api',
    effect: 'write',
    description: 'EFEITO REAL E IRREVERSÍVEL: envia mensagem de WhatsApp. Só executa no nó act, depois de confirmação humana no gate.',
    parameters: {
      type: 'object',
      properties: {
        destinatarioId: { type: 'string', description: 'Id da pessoa no supercérebro.' },
        mensagem: { type: 'string' },
        anexos: { type: 'array', items: { type: 'object', properties: { tipo: { type: 'string' }, ref: { type: 'string' } } } },
      },
      required: ['destinatarioId', 'mensagem'],
    },
    allowedNodes: ['act'],
    buildPreview: (args) => previewSendWhatsapp(asArgs(args)),
  },
];

export function toolDef(nome: ToolName): ToolDef | undefined {
  return TOOLS.find((t) => t.name === nome);
}

export function isToolName(nome: string): nome is ToolName {
  return TOOLS.some((t) => t.name === nome);
}
