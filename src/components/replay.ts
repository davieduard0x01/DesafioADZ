/**
 * Modo replay determinístico da UI.
 *
 * Existe por dois motivos:
 *  1. o avaliador que não colar chave do OpenRouter precisa ver um turno inteiro;
 *  2. a interface pôde ser construída antes do runtime existir.
 *
 * O roteiro do prompt 1 é literalmente o `EXEMPLO_TRACE` de `src/harness/types.ts`
 * (contrato de fronteira, não editado aqui). Os outros três prompts são roteiros
 * escritos com os mesmos tipos, coerentes com os datasets em `data/`.
 *
 * Nada aqui chama LLM. Nada aqui tem efeito real.
 */
import {
  EXEMPLO_ARTEFATO_CTA,
  EXEMPLO_ARTEFATO_DIAGNOSTICO,
  EXEMPLO_TRACE,
  type AgendaArtifact,
  type CreativeListArtifact,
  type EdgeName,
  type HaltReason,
  type HarnessState,
  type Json,
  type MetricsTableArtifact,
  type NodeBudget,
  type NodeName,
  type PendingAction,
  type StageArtifact,
  type StreamFrame,
  type ToolEffect,
  type ToolError,
  type ToolLayer,
  type ToolName,
  type TraceEvent,
} from '@/harness/types';

// ---------------------------------------------------------------------------
// Tabelas estáticas (espelham docs/arquitetura/tools.md e o contrato dos nós)
// ---------------------------------------------------------------------------

export const TOOL_LAYER: Record<ToolName, ToolLayer> = {
  graph_query: 'supercerebro',
  timeline_query: 'supercerebro',
  meta_ads_insights: 'api',
  google_ads_insights: 'api',
  ga_report: 'api',
  crm_leads: 'api',
  list_criativos: 'api',
  get_metrics: 'api',
  app_diagnostico: 'app',
  propose_ctas: 'app',
  pause_ads: 'api',
  send_whatsapp: 'api',
};

export const TOOL_EFFECT: Record<ToolName, ToolEffect> = {
  graph_query: 'read',
  timeline_query: 'read',
  meta_ads_insights: 'read',
  google_ads_insights: 'read',
  ga_report: 'read',
  crm_leads: 'read',
  list_criativos: 'read',
  get_metrics: 'read',
  app_diagnostico: 'read',
  propose_ctas: 'read',
  pause_ads: 'write',
  send_whatsapp: 'write',
};

const LEITURA: ToolName[] = [
  'graph_query',
  'timeline_query',
  'meta_ads_insights',
  'google_ads_insights',
  'ga_report',
  'crm_leads',
  'list_criativos',
  'get_metrics',
];

export const BUDGETS: Record<NodeName, NodeBudget> = {
  interpret: { node: 'interpret', maxSteps: 3, allowlist: ['graph_query', 'timeline_query'], maxObservationTokens: 2000 },
  plan: { node: 'plan', maxSteps: 1, allowlist: [], maxObservationTokens: 0 },
  fetch: { node: 'fetch', maxSteps: 6, allowlist: LEITURA, maxObservationTokens: 6000 },
  reason: {
    node: 'reason',
    maxSteps: 4,
    allowlist: ['app_diagnostico', 'propose_ctas', 'graph_query', 'timeline_query'],
    maxObservationTokens: 6000,
  },
  compact: { node: 'compact', maxSteps: 1, allowlist: [], maxObservationTokens: 0 },
  gate: { node: 'gate', maxSteps: 1, allowlist: [], maxObservationTokens: 0 },
  act: { node: 'act', maxSteps: 2, allowlist: ['pause_ads', 'send_whatsapp'], maxObservationTokens: 1000 },
  respond: { node: 'respond', maxSteps: 1, allowlist: [], maxObservationTokens: 0 },
  errorHandler: { node: 'errorHandler', maxSteps: 1, allowlist: [], maxObservationTokens: 0 },
};

/** Descrição de uma linha para o chip de nó no trace. */
export const NODE_DESC: Record<NodeName, string> = {
  interpret: 'resolve intenção e entidades no supercérebro',
  plan: 'decide quais dados o pedido exige',
  fetch: 'loop ReAct de leitura',
  reason: 'loop ReAct de análise',
  compact: 'resume observações para caber no orçamento',
  gate: 'avalia permissão e interrompe o turno',
  act: 'executa a ação já confirmada',
  respond: 'redige a resposta e monta os artefatos',
  errorHandler: 'retry com backoff ou degradação explícita',
};

// ---------------------------------------------------------------------------
// Construtor de eventos de trace
// ---------------------------------------------------------------------------

function builder(turnId: string, t0: number) {
  let seq = 0;
  const head = () => {
    seq += 1;
    return { id: `${turnId}-e${String(seq).padStart(2, '0')}`, turnId, seq, at: new Date(t0 + seq * 340).toISOString() };
  };
  return {
    user: (text: string): TraceEvent => ({ ...head(), kind: 'user_message', text }),
    enter: (node: NodeName, viaEdge: EdgeName | null): TraceEvent => ({
      ...head(),
      kind: 'node_enter',
      node,
      viaEdge,
      budget: BUDGETS[node],
    }),
    exit: (node: NodeName, viaEdge: EdgeName | null, stepsUsed: number, durationMs: number): TraceEvent => ({
      ...head(),
      kind: 'node_exit',
      node,
      viaEdge,
      stepsUsed,
      durationMs,
    }),
    thought: (node: NodeName, step: number, text: string): TraceEvent => ({ ...head(), kind: 'thought', node, step, text }),
    tool: (
      node: NodeName,
      step: number,
      tool: ToolName,
      args: Json,
      resultSummary: string | null,
      durationMs: number,
      error?: ToolError,
    ): TraceEvent => ({
      ...head(),
      kind: 'tool_call',
      node,
      step,
      tool,
      layer: TOOL_LAYER[tool],
      effect: TOOL_EFFECT[tool],
      args,
      resultSummary,
      ok: !error,
      durationMs,
      ...(error ? { error } : {}),
    }),
    obs: (node: NodeName, step: number, observationId: string, text: string, source: string): TraceEvent => ({
      ...head(),
      kind: 'observation',
      node,
      step,
      observationId,
      text,
      source,
    }),
    erro: (node: NodeName, error: ToolError, attempt: number, willRetry: boolean): TraceEvent => ({
      ...head(),
      kind: 'error',
      node,
      error,
      attempt,
      willRetry,
    }),
    compacta: (
      node: NodeName,
      tokensBefore: number,
      tokensAfter: number,
      collapsedObservationIds: string[],
      summary: string,
    ): TraceEvent => ({ ...head(), kind: 'compaction', node, tokensBefore, tokensAfter, collapsedObservationIds, summary }),
    resposta: (text: string, artifactIds: string[]): TraceEvent => ({
      ...head(),
      kind: 'assistant_message',
      node: 'respond',
      text,
      artifactIds,
    }),
  };
}

// ---------------------------------------------------------------------------
// Artefatos do Palco usados no replay
// ---------------------------------------------------------------------------

/** art-01 no caminho "aprovado": os dois criativos aparecem já pausados. */
const ART_CRIATIVOS_PAUSADOS: CreativeListArtifact = {
  kind: 'creative_list',
  id: 'art-01',
  title: 'Criativos com CTA fraco — Housewhey',
  createdAt: '2026-08-26T14:00:32.000Z',
  evidence: ['ev-10', 'ev-11'],
  items: [
    {
      id: 'cr-004',
      nome: 'Ômega 3 — Frete Grátis',
      campanha: 'Ômega 3 Prospecção',
      copy: 'Ômega 3 com frete grátis para todo o Brasil.',
      cta: 'Compre agora',
      status: 'pausado',
      badges: [
        { label: 'pausado agora', tone: 'critico' },
        { label: 'CTR 0,41%', tone: 'atencao' },
      ],
      metricas: [
        { label: 'Gasto 7d', valor: 'R$ 1.240' },
        { label: 'CTR', valor: '0,41%' },
        { label: 'Leads', valor: '0' },
      ],
      motivo: 'CTR abaixo de 0,5% e nenhum lead atribuído em 7 dias.',
    },
    {
      id: 'cr-007',
      nome: 'Ômega 3 — Compre Agora',
      campanha: 'Ômega 3 Remarketing',
      copy: 'Seu Ômega 3 acabou? Reponha hoje.',
      cta: 'Compre agora',
      status: 'pausado',
      badges: [
        { label: 'pausado agora', tone: 'critico' },
        { label: 'CPA R$ 415', tone: 'atencao' },
      ],
      metricas: [
        { label: 'Gasto 7d', valor: 'R$ 830' },
        { label: 'CTR', valor: '0,47%' },
        { label: 'Leads', valor: '2' },
      ],
      motivo: 'CPA 3x acima da média do adset.',
    },
    {
      id: 'cr-002',
      nome: 'Ômega 3 — Prova social',
      campanha: 'Ômega 3 Prospecção',
      copy: 'Mais de 12 mil clientes recompraram no último ano.',
      cta: 'Ver depoimentos',
      status: 'ativo',
      badges: [{ label: 'referência', tone: 'ok' }],
      metricas: [
        { label: 'Gasto 7d', valor: 'R$ 960' },
        { label: 'CTR', valor: '1,20%' },
        { label: 'Leads', valor: '19' },
      ],
      motivo: 'Mantido: é o criativo que sustenta a média do adset.',
    },
  ],
};

/** art-01 no caminho "negado": nada foi pausado, as variações seguem como proposta. */
const ART_CRIATIVOS_MANTIDOS: CreativeListArtifact = {
  ...ART_CRIATIVOS_PAUSADOS,
  title: 'Criativos com CTA fraco — nenhum pausado',
  items: ART_CRIATIVOS_PAUSADOS.items.map((item) =>
    item.status === 'pausado'
      ? {
          ...item,
          status: 'ativo' as const,
          badges: [{ label: 'segue no ar', tone: 'atencao' as const }, item.badges[1]],
        }
      : item,
  ),
};

const ART_AGENDA: AgendaArtifact = {
  kind: 'agenda',
  id: 'art-04',
  title: 'Pauta — reunião semanal Housewhey',
  createdAt: '2026-08-26T14:20:00.000Z',
  evidence: ['t-3-e08', 't-3-e10'],
  cliente: 'Housewhey',
  quando: '2026-08-27T14:00:00.000Z',
  participantes: ['Aline (AdzHub)', 'Carolina (Housewhey)', 'Luiza (AdzHub)'],
  blocos: [
    {
      titulo: 'Resultado da semana',
      itens: [
        {
          texto: 'Gasto estável em R$ 6.180 com queda de 18% nas conversões reportadas pelo Meta.',
          origem: 'Meta Ads 19–25/08',
          prioridade: 'alta',
        },
        {
          texto: 'CRM registrou 61 leads contra 84 conversões reportadas — a diferença tem causa conhecida.',
          origem: 'CRM 19–25/08',
          prioridade: 'alta',
          responsavel: 'Luiza',
        },
      ],
    },
    {
      titulo: 'Criativos',
      itens: [
        {
          texto: 'Dois criativos de Ômega 3 com CTR abaixo de 0,5% — proposta de pausa e 3 variações de CTA prontas.',
          origem: 'Meta Ads + app propose_ctas',
          prioridade: 'media',
          responsavel: 'Aline',
        },
        {
          texto: 'Lote de criativos de setembro aguarda aprovação da Carolina desde 22/08.',
          origem: 'WhatsApp 22/08 — Carolina',
          prioridade: 'alta',
          responsavel: 'Carolina',
        },
      ],
    },
  ],
  pendencias: [
    {
      texto: 'Definir se o encurtador de link continua sendo usado nos criativos.',
      origem: 'Diagnóstico de atribuição 26/08',
      prioridade: 'alta',
      responsavel: 'Carolina',
    },
    {
      texto: 'Aprovar o orçamento incremental de setembro (pedido em aberto na linha do tempo).',
      origem: 'Briefing 12/08',
      prioridade: 'media',
    },
  ],
};

const ART_CRUZAMENTO: MetricsTableArtifact = {
  kind: 'metrics_table',
  id: 'art-05',
  title: 'Gasto do Meta × leads do CRM por utm_content',
  createdAt: '2026-08-26T14:30:00.000Z',
  evidence: ['t-4-e08', 't-4-e09'],
  columns: [
    { key: 'utm', label: 'utm_content', format: 'texto', align: 'left' },
    { key: 'criativo', label: 'Criativo', format: 'texto', align: 'left' },
    { key: 'gasto', label: 'Gasto', format: 'moeda_brl', align: 'right', highlight: true },
    { key: 'leads', label: 'Leads no CRM', format: 'inteiro', align: 'right' },
    { key: 'cpl', label: 'Custo por lead', format: 'moeda_brl', align: 'right', highlight: true },
    { key: 'ctr', label: 'CTR', format: 'percentual', align: 'right' },
  ],
  rows: [
    { utm: 'omega3-frete-gratis', criativo: 'Ômega 3 — Frete Grátis', gasto: 1240, leads: 0, cpl: null, ctr: 0.41 },
    { utm: 'omega3-compre-agora', criativo: 'Ômega 3 — Compre Agora', gasto: 830, leads: 2, cpl: 415, ctr: 0.47 },
    { utm: 'omega3-prova-social', criativo: 'Ômega 3 — Prova social', gasto: 960, leads: 19, cpl: 50.53, ctr: 1.2 },
    { utm: 'omega3-recompra-30d', criativo: 'Ômega 3 — Recompra 30 dias', gasto: 1490, leads: 8, cpl: 186.25, ctr: 0.62 },
    { utm: 'whey-combo-inverno', criativo: 'Combo inverno', gasto: 1660, leads: 32, cpl: 51.88, ctr: 1.04 },
  ],
  flaggedRows: [0, 1, 3],
  footnote:
    'Faltam 12 leads: chegaram no CRM sem utm_content e por isso não entram em nenhuma linha desta tabela. O gasto deles está contabilizado, o resultado não — é essa lacuna que infla o custo por lead das linhas marcadas.',
};

// ---------------------------------------------------------------------------
// Estado mínimo devolvido no frame `turn_end`
// ---------------------------------------------------------------------------

const ZERO_STEPS: Record<NodeName, number> = {
  interpret: 0,
  plan: 0,
  fetch: 0,
  reason: 0,
  compact: 0,
  gate: 0,
  act: 0,
  respond: 0,
  errorHandler: 0,
};

function fimDoTurno(
  turnId: string,
  halt: HaltReason,
  trace: readonly TraceEvent[],
  artifacts: readonly StageArtifact[],
): StreamFrame {
  const state: HarnessState = {
    turnId,
    sessionId: 'replay',
    messages: [],
    currentNode: 'respond',
    visited: [],
    entities: [],
    plan: [],
    observations: [],
    stepCount: ZERO_STEPS,
    reactCycles: 1,
    pendingAction: null,
    executedActions: [],
    artifacts,
    trace,
    halt,
    startedAt: trace[0]?.at ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return { type: 'turn_end', halt, state };
}

// ---------------------------------------------------------------------------
// Roteiros
// ---------------------------------------------------------------------------

export interface ReplayScript {
  /** Frames até o fim do turno, ou até o gate interromper. */
  readonly frames: readonly StreamFrame[];
  /** Continuação quando o humano aprova a ação pendente. */
  readonly aprovar?: readonly StreamFrame[];
  /** Continuação quando o humano nega. Negar é caminho normal do grafo. */
  readonly negar?: readonly StreamFrame[];
}

function frames(events: readonly TraceEvent[]): StreamFrame[] {
  return events.map((event) => ({ type: 'trace', event }) as StreamFrame);
}

// --- Prompt 1: vem inteiro do contrato (EXEMPLO_TRACE) ---------------------

const EXEMPLO_ATE_O_GATE = EXEMPLO_TRACE.slice(0, 19); // ev-01 .. ev-19
const EXEMPLO_DEPOIS_DO_GATE = EXEMPLO_TRACE.slice(19); // ev-20 .. ev-24
const PEDIDO_PENDENTE: PendingAction = (() => {
  const ev = EXEMPLO_TRACE.find((e) => e.kind === 'permission_request');
  if (!ev || ev.kind !== 'permission_request') throw new Error('EXEMPLO_TRACE sem permission_request');
  return ev.pendingAction;
})();

const NEGADO: TraceEvent[] = [
  {
    kind: 'permission_decision',
    id: 'ev-20n',
    turnId: 't-1',
    seq: 20,
    at: '2026-08-26T14:00:31.000Z',
    node: 'gate',
    pendingActionId: 'pa-01',
    decision: 'negar',
  },
  {
    kind: 'assistant_message',
    id: 'ev-21n',
    turnId: 't-1',
    seq: 21,
    at: '2026-08-26T14:00:31.600Z',
    node: 'respond',
    text:
      'Não pausei nada. Os dois anúncios seguem entregando como estão. As 3 variações de CTA de cada um estão no Palco com a hipótese que testam — quando quiser, é só pedir a pausa de novo.',
    artifactIds: ['art-01', 'art-02'],
  },
];

const ROTEIRO_1: ReplayScript = {
  frames: [
    { type: 'turn_start', turnId: 't-1', sessionId: 'replay' },
    ...frames(EXEMPLO_ATE_O_GATE),
    { type: 'awaiting_confirmation', pendingAction: PEDIDO_PENDENTE },
  ],
  aprovar: [
    ...frames(EXEMPLO_DEPOIS_DO_GATE),
    { type: 'artifact', artifact: ART_CRIATIVOS_PAUSADOS },
    { type: 'artifact', artifact: EXEMPLO_ARTEFATO_CTA },
    fimDoTurno('t-1', 'done', EXEMPLO_TRACE, [ART_CRIATIVOS_PAUSADOS, EXEMPLO_ARTEFATO_CTA]),
  ],
  negar: [
    ...frames(NEGADO),
    { type: 'artifact', artifact: ART_CRIATIVOS_MANTIDOS },
    { type: 'artifact', artifact: EXEMPLO_ARTEFATO_CTA },
    fimDoTurno('t-1', 'done', [...EXEMPLO_ATE_O_GATE, ...NEGADO], [ART_CRIATIVOS_MANTIDOS, EXEMPLO_ARTEFATO_CTA]),
  ],
};

// --- Prompt 2: diagnóstico (mostra erro + retry e compactação) -------------

const ROTEIRO_2: ReplayScript = (() => {
  const b = builder('t-2', Date.parse('2026-08-26T14:10:00.000Z'));
  const t: TraceEvent[] = [
    b.user('Por que caíram as vendas da Ômega 3 essa semana?'),
    b.enter('interpret', null),
    b.thought('interpret', 1, '"Ômega 3" é linha de produto e nome de duas campanhas. "essa semana" precisa virar uma janela com semana anterior para comparar.'),
    b.tool('interpret', 1, 'graph_query', { texto: 'Ômega 3', tipo: 'produto', profundidade: 2 }, 'Produto Ômega 3 ligado a 2 campanhas e 7 criativos da conta Housewhey.', 48),
    b.obs('interpret', 1, 'obs-11', 'Janela resolvida: 19/08 a 25/08, comparada com 12/08 a 18/08. Conta Housewhey.', 'supercerebro.json'),
    b.exit('interpret', 'entidades_resolvidas', 1, 420),
    b.enter('plan', 'entidades_resolvidas'),
    b.exit('plan', 'precisa_dados', 1, 360),
    b.enter('fetch', 'precisa_dados'),
    b.tool('fetch', 1, 'meta_ads_insights', { conta: 'housewhey', from: '2026-08-19', to: '2026-08-25', breakdown: 'ad', comparar: true }, 'Gasto estável (R$ 6.180) e conversões reportadas 18% abaixo da semana anterior.', 130),
    b.tool('fetch', 2, 'crm_leads', { conta: 'housewhey', from: '2026-08-19', to: '2026-08-25' }, null, 2400, {
      code: 'timeout',
      message: 'O CRM não respondeu em 2s.',
      retryable: true,
    }),
    b.erro('fetch', { code: 'timeout', message: 'O CRM não respondeu em 2s.', retryable: true }, 1, true),
    b.tool('fetch', 3, 'crm_leads', { conta: 'housewhey', from: '2026-08-19', to: '2026-08-25', incluirSemUtm: true }, '61 leads no período; 12 deles sem utm_content.', 190),
    b.obs('fetch', 3, 'obs-12', 'Meta reporta 84 conversões; CRM registra 61 leads atribuídos e 12 sem utm_content.', 'meta_ads.json + crm.json'),
    b.tool('fetch', 4, 'list_criativos', { conta: 'housewhey', status: ['ativo'] }, '7 criativos ativos; 1 usa link encurtado no destino.', 70),
    b.obs('fetch', 4, 'obs-13', 'Criativo "Ômega 3 — Recompra 30 dias" aponta para link encurtado, sem parâmetros de UTM no destino.', 'criativos.json'),
    b.exit('fetch', 'dados_coletados', 4, 2980),
    b.enter('reason', 'dados_coletados'),
    b.compacta('reason', 6420, 1180, ['obs-12', 'obs-13'], 'Observações antigas resumidas preservando números e fontes citadas.'),
    b.thought('reason', 1, 'Gasto estável e queda de conversão só no canal que passa pelo link encurtado. Antes de acusar demanda, preciso descartar investimento e estoque.'),
    b.tool('reason', 2, 'app_diagnostico', { conta: 'housewhey', pergunta: 'queda de vendas Ômega 3', janela: { from: '2026-08-19', to: '2026-08-25' }, observacoesIds: ['obs-11', 'obs-12', 'obs-13'] }, 'Veredito: atribuição quebrada. 2 causas-raiz, 2 hipóteses descartadas.', 910),
    b.exit('reason', 'conclusao_sem_acao', 2, 1500),
    b.resposta(
      'As vendas não caíram na proporção que o relatório sugere: parte da queda é atribuição quebrada. Um criativo usa encurtador que derruba o utm_content, então 12 leads chegam no CRM órfãos. O diagnóstico completo, com o que testei e descartei, está no Palco.',
      ['art-03'],
    ),
  ];
  return {
    frames: [
      { type: 'turn_start', turnId: 't-2', sessionId: 'replay' },
      ...frames(t),
      { type: 'artifact', artifact: EXEMPLO_ARTEFATO_DIAGNOSTICO },
      fimDoTurno('t-2', 'done', t, [EXEMPLO_ARTEFATO_DIAGNOSTICO]),
    ],
  };
})();

// --- Prompt 3: pauta de reunião -------------------------------------------

const ROTEIRO_3: ReplayScript = (() => {
  const b = builder('t-3', Date.parse('2026-08-26T14:20:00.000Z'));
  const t: TraceEvent[] = [
    b.user('Monta a pauta da reunião de amanhã com a Housewhey.'),
    b.enter('interpret', null),
    b.tool('interpret', 1, 'graph_query', { tipo: 'reuniao', relacionadoA: 'housewhey' }, 'Reunião semanal 27/08 14h; participantes Aline, Carolina e Luiza.', 38),
    b.exit('interpret', 'entidades_resolvidas', 1, 300),
    b.enter('plan', 'entidades_resolvidas'),
    b.exit('plan', 'precisa_dados', 1, 340),
    b.enter('fetch', 'precisa_dados'),
    b.tool('fetch', 1, 'timeline_query', { entidadeId: 'conta-housewhey', from: '2026-08-19', to: '2026-08-26', limite: 40 }, '14 eventos: 1 briefing, 6 mensagens de WhatsApp, 2 aprovações pendentes.', 88),
    b.obs('fetch', 1, 'obs-21', 'Aprovação do lote de criativos de setembro parada desde 22/08 com a Carolina.', 'timeline.json'),
    b.tool('fetch', 2, 'meta_ads_insights', { conta: 'housewhey', from: '2026-08-19', to: '2026-08-25', breakdown: 'campaign', comparar: true }, 'Gasto R$ 6.180, conversões 18% abaixo da semana anterior.', 120),
    b.obs('fetch', 2, 'obs-22', 'Resultado da semana pronto para abrir a reunião, com comparação contra a janela anterior.', 'meta_ads.json@2026-08-19..25'),
    b.exit('fetch', 'dados_coletados', 2, 900),
    b.enter('reason', 'dados_coletados'),
    b.thought('reason', 1, 'A pauta útil é a que separa o que é informe do que precisa de decisão. Duas pendências travam a conta e viram bloco próprio.'),
    b.exit('reason', 'conclusao_sem_acao', 1, 640),
    b.resposta(
      'Pauta montada com o que aconteceu na semana e, separado, o que depende de decisão da Carolina. As duas pendências que travam a conta estão destacadas no fim.',
      ['art-04'],
    ),
  ];
  return {
    frames: [
      { type: 'turn_start', turnId: 't-3', sessionId: 'replay' },
      ...frames(t),
      { type: 'artifact', artifact: ART_AGENDA },
      fimDoTurno('t-3', 'done', t, [ART_AGENDA]),
    ],
  };
})();

// --- Prompt 4: cruzamento gasto × leads ------------------------------------

const ROTEIRO_4: ReplayScript = (() => {
  const b = builder('t-4', Date.parse('2026-08-26T14:30:00.000Z'));
  const t: TraceEvent[] = [
    b.user('Cruza gasto do Meta com leads do CRM por utm_content e me diz o que está caro.'),
    b.enter('interpret', null),
    b.tool('interpret', 1, 'graph_query', { tipo: 'conta', filtro: { ativa: true } }, 'Conta Housewhey; janela padrão dos últimos 7 dias.', 40),
    b.exit('interpret', 'entidades_resolvidas', 1, 300),
    b.enter('plan', 'entidades_resolvidas'),
    b.exit('plan', 'precisa_dados', 1, 320),
    b.enter('fetch', 'precisa_dados'),
    b.tool('fetch', 1, 'meta_ads_insights', { conta: 'housewhey', from: '2026-08-19', to: '2026-08-25', breakdown: 'ad', campos: ['gasto', 'ctr', 'utm_content'] }, 'Gasto e CTR por anúncio, com utm_content associado.', 124),
    b.tool('fetch', 2, 'crm_leads', { conta: 'housewhey', from: '2026-08-19', to: '2026-08-25', incluirSemUtm: true }, '61 leads; 49 com utm_content, 12 sem.', 150),
    b.obs('fetch', 2, 'obs-31', 'Join por utm_content cobre 49 dos 61 leads. Os 12 restantes não têm chave de junção.', 'meta_ads.json + crm.json'),
    b.exit('fetch', 'dados_coletados', 2, 980),
    b.enter('reason', 'dados_coletados'),
    b.thought('reason', 1, 'Custo por lead só é comparável onde a chave de junção existe. Vou marcar as linhas caras e declarar os 12 leads que ficaram de fora em vez de diluí-los na média.'),
    b.exit('reason', 'conclusao_sem_acao', 1, 700),
    b.resposta(
      'Três linhas estão caras: Frete Grátis (R$ 1.240 sem nenhum lead), Compre Agora (R$ 415 por lead) e Recompra 30 dias (R$ 186). A tabela está no Palco — e o rodapé diz o que ficou de fora dela.',
      ['art-05'],
    ),
  ];
  return {
    frames: [
      { type: 'turn_start', turnId: 't-4', sessionId: 'replay' },
      ...frames(t),
      { type: 'artifact', artifact: ART_CRUZAMENTO },
      fimDoTurno('t-4', 'done', t, [ART_CRUZAMENTO]),
    ],
  };
})();

// --- Fora do roteiro -------------------------------------------------------

function roteiroDesconhecido(texto: string): ReplayScript {
  const b = builder('t-x', Date.now());
  const t: TraceEvent[] = [
    b.user(texto),
    b.enter('interpret', null),
    b.thought('interpret', 1, 'Sem chave do OpenRouter o harness roda em replay determinístico, e o roteiro gravado cobre só os 4 pedidos de aceite.'),
    b.exit('interpret', 'ambiguidade_de_entidade', 1, 200),
    b.resposta(
      'Estou em modo replay: sem chave do OpenRouter eu só reproduzo os 4 pedidos gravados, listados aqui embaixo. Cole uma chave no campo do topo para rodar este pedido de verdade contra o modelo.',
      [],
    ),
  ];
  return { frames: [{ type: 'turn_start', turnId: 't-x', sessionId: 'replay' }, ...frames(t), fimDoTurno('t-x', 'done', t, [])] };
}

export interface PromptSugerido {
  readonly texto: string;
  readonly nota: string;
}

/** Os 4 pedidos de aceite do desafio, na ordem do enunciado. */
export const PROMPTS: readonly PromptSugerido[] = [
  { texto: 'Pause os criativos com CTA ruim e proponha 3 variações.', nota: 'passa pelo gate de permissão' },
  { texto: 'Por que caíram as vendas da Ômega 3 essa semana?', nota: 'diagnóstico com hipóteses descartadas' },
  { texto: 'Monta a pauta da reunião de amanhã com a Housewhey.', nota: 'usa a linha do tempo do supercérebro' },
  { texto: 'Cruza gasto do Meta com leads do CRM por utm_content e me diz o que está caro.', nota: 'cruzamento entre duas fontes' },
];

export function scriptFor(texto: string): ReplayScript {
  const t = texto.toLowerCase();
  if (/(paus|cta ruim|varia)/.test(t)) return ROTEIRO_1;
  if (/(por que|caíram|cairam|queda|vendas)/.test(t)) return ROTEIRO_2;
  if (/(pauta|reuni)/.test(t)) return ROTEIRO_3;
  if (/(cruza|utm|caro|gasto)/.test(t)) return ROTEIRO_4;
  return roteiroDesconhecido(texto);
}
