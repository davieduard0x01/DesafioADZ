/**
 * Contrato de fronteira do harness — DesafioADZ / AdzHub.
 *
 * Este arquivo é a ÚNICA superfície compartilhada entre:
 *   - o runtime do agente (`src/harness/**`, `src/app/api/chat/route.ts`)
 *   - a interface de chat (`src/app/page.tsx`, `src/components/**`)
 *
 * Regra do projeto: quem implementa o runtime não edita a UI e vice-versa.
 * Portanto tudo que atravessa essa fronteira precisa estar aqui, tipado, e
 * ser serializável em JSON (nada de Date, Map, Set, função ou classe).
 * Datas são strings ISO-8601 em UTC. Dinheiro é `number` em BRL.
 *
 * Arquitetura resumida (ver docs/arquitetura/diagrama.md):
 *   grafo de estados como espinha dorsal
 *   + loop ReAct DENTRO dos nós `fetch` e `reason`
 *   + gate de permissão deny-first antes de qualquer efeito real.
 */

// ---------------------------------------------------------------------------
// 0. Primitivos
// ---------------------------------------------------------------------------

/** Timestamp ISO-8601 em UTC, ex.: "2026-08-24T13:05:00.000Z". */
export type IsoDateTime = string;

/** Data sem hora, ex.: "2026-08-24". Usada em janelas de análise. */
export type IsoDate = string;

/** Identificador opaco gerado pelo runtime (uuid v4 ou nanoid). */
export type Id = string;

/** Valor livre vindo de tool — a UI nunca deve assumir formato. */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

// ---------------------------------------------------------------------------
// 1. Nós do grafo
// ---------------------------------------------------------------------------

/**
 * Nós do grafo de estados. A ordem canônica de um turno bem-sucedido é:
 *   interpret → plan → (fetch ⇄ reason)* → [gate] → act → respond
 * `compact` e `errorHandler` são nós de serviço, entram por edge condicional.
 */
export type NodeName =
  | 'interpret'      // resolve intenção + entidades no supercérebro
  | 'plan'           // decide quais dados/etapas o pedido exige
  | 'fetch'          // ReAct: chama tools de LEITURA e acumula observações
  | 'reason'         // ReAct: interpreta observações, decide se falta dado
  | 'compact'        // compacta observações quando o orçamento do nó estoura
  | 'gate'           // avalia permissão; interrompe o turno se houver efeito real
  | 'act'            // executa a ação já confirmada pelo humano
  | 'respond'        // redige a resposta e monta os artefatos do Palco
  | 'errorHandler';  // retry com backoff ou degradação explícita

/** Nomes de edge — usados no trace e na renderização do grafo pela UI. */
export type EdgeName =
  | 'entidades_resolvidas'
  | 'ambiguidade_de_entidade'
  | 'precisa_dados'
  | 'sem_dados_necessarios'
  | 'dados_coletados'
  | 'lacuna_de_dado'
  | 'orcamento_de_contexto_estourado'
  | 'contexto_compactado'
  | 'conclusao_sem_acao'
  | 'conclusao_pede_acao'
  | 'acao_confirmada'
  | 'acao_negada'
  | 'sem_efeito_real'
  | 'falha_de_tool'
  | 'retry'
  | 'degradar';

/** Orçamento por nó. Estourou o `maxSteps`, o nó sai à força pela edge de saída. */
export interface NodeBudget {
  readonly node: NodeName;
  /** Máximo de iterações do loop ReAct dentro do nó. */
  readonly maxSteps: number;
  /** Tools que ESTE nó pode chamar. Fora da lista = negado pelo runtime. */
  readonly allowlist: readonly ToolName[];
  /** Teto aproximado de tokens de observação antes de acionar `compact`. */
  readonly maxObservationTokens: number;
}

// ---------------------------------------------------------------------------
// 2. Tools
// ---------------------------------------------------------------------------

/**
 * `read`  — não altera nada fora do harness. Roda livre.
 * `write` — tem efeito real no mundo (pausa anúncio, manda WhatsApp).
 *           SEMPRE passa pelo gate. Nunca é executada no mesmo turno em que
 *           foi proposta, a menos que o humano confirme.
 */
export type ToolEffect = 'read' | 'write';

/** Camada de origem da tool — vira coluna na Table 1 do paper. */
export type ToolLayer = 'supercerebro' | 'app' | 'api';

export type ToolName =
  // supercérebro
  | 'graph_query'
  | 'timeline_query'
  // APIs
  | 'meta_ads_insights'
  | 'google_ads_insights'
  | 'ga_report'
  | 'crm_leads'
  | 'list_criativos'
  | 'get_metrics'
  // Apps de metodologia
  | 'app_diagnostico'
  | 'propose_ctas'
  // ações (efeito real)
  | 'pause_ads'
  | 'send_whatsapp';

/** Descrição estática de uma tool. O runtime usa para montar o schema do LLM. */
export interface ToolDef<A = Json> {
  readonly name: ToolName;
  readonly layer: ToolLayer;
  readonly effect: ToolEffect;
  /** Descrição em PT-BR enviada ao modelo. */
  readonly description: string;
  /** JSON Schema dos argumentos (subset draft-07). */
  readonly parameters: Json;
  /** Nós autorizados a chamar. Redundante com NodeBudget de propósito: dupla trava. */
  readonly allowedNodes: readonly NodeName[];
  /**
   * Só para `effect: 'write'`: gera o preview em PT-BR mostrado ao humano.
   * A UI NÃO chama isso — ela recebe o `ActionPreview` já pronto no estado.
   */
  readonly buildPreview?: (args: A) => ActionPreview;
}

/** Resultado de uma execução de tool. Nunca lança — erro vira `ok: false`. */
export type ToolResult<T = Json> =
  | {
      readonly ok: true;
      readonly tool: ToolName;
      /** Payload cru, consumido pelo modelo e pelos artefatos. */
      readonly data: T;
      /** Resumo de 1 linha em PT-BR para o trace e para a UI. */
      readonly summary: string;
      readonly durationMs: number;
      /** Ex.: "meta_ads.json@2026-08-24" — origem do dado, para citar na resposta. */
      readonly source: string;
    }
  | {
      readonly ok: false;
      readonly tool: ToolName;
      readonly error: ToolError;
      readonly durationMs: number;
    };

export interface ToolError {
  /**
   * `denied_by_policy`  — tool fora da allowlist do nó, ou write sem confirmação.
   * `awaiting_approval` — write legítima, mas o gate interrompeu o turno.
   * `not_found`         — entidade inexistente no dataset.
   * `bad_args`          — argumentos inválidos (o modelo alucinou um campo).
   * `upstream`          — falha da API/mock. Elegível a retry.
   * `timeout`           — estourou o tempo. Elegível a retry.
   */
  readonly code: 'denied_by_policy' | 'awaiting_approval' | 'not_found' | 'bad_args' | 'upstream' | 'timeout';
  /** Mensagem em PT-BR — pode ser mostrada ao usuário sem reescrita. */
  readonly message: string;
  readonly retryable: boolean;
}

// ---------------------------------------------------------------------------
// 3. Supercérebro — entidades resolvidas
// ---------------------------------------------------------------------------

export type EntityKind = 'conta' | 'pessoa' | 'campanha' | 'criativo' | 'canal' | 'produto' | 'tarefa' | 'reuniao';

/**
 * Resultado da resolução de entidade feita no nó `interpret`.
 * O gestor escreve "a Ômega 3"; o harness precisa saber QUAL nó do grafo é.
 * `confidence < 0.6` deve virar pergunta de esclarecimento, não chute.
 */
export interface ResolvedEntity {
  readonly id: Id;
  readonly kind: EntityKind;
  /** Nome canônico no supercérebro, ex.: "Housewhey — Ômega 3 Prospecção". */
  readonly label: string;
  /** Trecho literal do pedido do gestor que gerou esta resolução. */
  readonly mention: string;
  /** 0..1. Abaixo de 0.6 o `interpret` sai pela edge `ambiguidade_de_entidade`. */
  readonly confidence: number;
  /** Outros candidatos, para a UI oferecer "você quis dizer...". */
  readonly alternatives?: readonly { readonly id: Id; readonly label: string }[];
}

/** Janela temporal da análise, resolvida a partir de "essa semana", "ontem" etc. */
export interface TimeWindow {
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** Expressão original do gestor, para a resposta ecoar o que entendeu. */
  readonly mention: string;
  /** Janela equivalente anterior, quando a análise é comparativa. */
  readonly comparedTo?: { readonly from: IsoDate; readonly to: IsoDate };
}

// ---------------------------------------------------------------------------
// 4. Estado que atravessa o grafo
// ---------------------------------------------------------------------------

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  readonly id: Id;
  readonly role: ChatRole;
  readonly content: string;
  readonly createdAt: IsoDateTime;
  /** Artefatos do Palco produzidos por esta mensagem (só em `assistant`). */
  readonly artifactIds?: readonly Id[];
}

/** Uma observação acumulada pelo loop ReAct — o que sobrou de uma tool call. */
export interface Observation {
  readonly id: Id;
  readonly node: NodeName;
  readonly tool: ToolName;
  /** Texto que efetivamente entra no prompt do próximo passo. */
  readonly text: string;
  readonly source: string;
  readonly createdAt: IsoDateTime;
  /** Tamanho estimado em tokens — usado para decidir `compact`. */
  readonly approxTokens: number;
  /** `true` depois que `compact` substituiu o conteúdo original por um resumo. */
  readonly compacted?: boolean;
}

/** Um passo do plano montado no nó `plan`. Vira checklist na UI. */
export interface PlanStep {
  readonly id: Id;
  readonly description: string;
  /** Tools que o `plan` acredita que este passo vai precisar. Não é vinculante. */
  readonly expectedTools: readonly ToolName[];
  readonly status: 'pendente' | 'em_andamento' | 'concluido' | 'falhou' | 'pulado';
}

/** Motivo pelo qual o turno parou. `awaiting_confirmation` é o gate. */
export type HaltReason =
  | 'done'
  | 'awaiting_confirmation'
  | 'needs_clarification'
  | 'budget_exhausted'
  | 'fatal_error';

/**
 * Estado único que atravessa todos os nós. Imutável por convenção:
 * cada nó devolve um `Partial<HarnessState>` que o runtime funde.
 * É serializado inteiro no checkpoint de cada nó (permite retry e replay).
 */
export interface HarnessState {
  readonly turnId: Id;
  readonly sessionId: Id;

  /** Histórico do chat, incluindo a mensagem que abriu este turno. */
  readonly messages: readonly ChatMessage[];

  /** Nó atual e trilha percorrida (a UI desenha os chips de nó a partir daqui). */
  readonly currentNode: NodeName;
  readonly visited: readonly NodeName[];

  // --- saída do `interpret` ---
  /** Intenção classificada, ex.: "diagnostico_queda_vendas". */
  readonly intent?: string;
  readonly entities: readonly ResolvedEntity[];
  readonly timeWindow?: TimeWindow;

  // --- saída do `plan` ---
  readonly plan: readonly PlanStep[];

  // --- loop ReAct ---
  readonly observations: readonly Observation[];
  /** Contador de passos POR NÓ. Chave é `NodeName`. Zera ao (re)entrar no nó. */
  readonly stepCount: Readonly<Record<NodeName, number>>;
  /** Quantas vezes o par fetch⇄reason já ciclou neste turno. Teto: 3. */
  readonly reactCycles: number;

  // --- gate ---
  /** Preenchido quando o turno para esperando o humano. `null` = nada pendente. */
  readonly pendingAction: PendingAction | null;
  /** Ações já confirmadas e executadas neste turno. */
  readonly executedActions: readonly ExecutedAction[];

  // --- saída ---
  /** Artefatos renderizados no Palco (coluna esquerda da UI). */
  readonly artifacts: readonly StageArtifact[];
  /** Trace completo, append-only. É a fonte da timeline visual. */
  readonly trace: readonly TraceEvent[];

  readonly halt: HaltReason | null;
  readonly startedAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// 5. Permissões (deny-first)
// ---------------------------------------------------------------------------

/**
 * Preview do efeito real, em PT-BR, mostrado ANTES de qualquer write.
 * Escrito para o gestor de marketing, não para o dev: nada de id cru sem rótulo.
 */
export interface ActionPreview {
  /** Ex.: "Pausar 2 anúncios no Meta Ads". */
  readonly titulo: string;
  /** Itens concretos afetados. Uma linha por objeto do mundo real. */
  readonly itens: readonly {
    readonly label: string;   // "Criativo 'Ômega 3 — Frete Grátis' (adset Prospecção)"
    readonly detalhe?: string; // "gasto R$ 1.240 nos últimos 7 dias, 0 leads atribuídos"
  }[];
  /** Consequência em uma frase, ex.: "Os anúncios param de entregar imediatamente." */
  readonly impacto: string;
  readonly reversivel: boolean;
  /** Só se `reversivel`. Ex.: "Reativar pelo gerenciador ou pedir aqui no chat." */
  readonly comoDesfazer?: string;
  /** O que o agente faz se o gestor negar. Nunca "não faz nada" sem explicar. */
  readonly seNegada: string;
}

/** Ação parada no gate, aguardando decisão humana. */
export interface PendingAction {
  readonly id: Id;
  readonly tool: ToolName;
  /** Argumentos EXATOS que serão passados à tool se confirmada. Nada é re-inferido. */
  readonly args: Json;
  readonly preview: ActionPreview;
  /** Evento do trace que originou o pedido — a UI usa para ancorar o diálogo. */
  readonly originTraceEventId: Id;
  readonly requestedAt: IsoDateTime;
}

export interface ExecutedAction {
  readonly pendingActionId: Id;
  readonly tool: ToolName;
  readonly args: Json;
  readonly result: ToolResult;
  readonly decidedBy: 'usuario';
  readonly executedAt: IsoDateTime;
}

/** Decisão do humano, enviada de volta pela UI no próximo POST /api/chat. */
export interface PermissionDecision {
  readonly pendingActionId: Id;
  readonly decision: 'aprovar' | 'negar';
  /** Justificativa opcional digitada pelo gestor; entra no contexto do `respond`. */
  readonly comment?: string;
}

// ---------------------------------------------------------------------------
// 6. Artefatos do Palco
// ---------------------------------------------------------------------------

/** Campos comuns a todo artefato. `id` é estável — republicar substitui em vez de duplicar. */
interface StageArtifactBase {
  readonly id: Id;
  readonly title: string;
  readonly createdAt: IsoDateTime;
  /** Ids de eventos do trace que sustentam este artefato (clicar → pular no trace). */
  readonly evidence?: readonly Id[];
}

export type ColumnFormat = 'texto' | 'inteiro' | 'moeda_brl' | 'percentual' | 'decimal_2';
export type ColumnAlign = 'left' | 'right';

export interface MetricsColumn {
  readonly key: string;
  readonly label: string;
  readonly format: ColumnFormat;
  readonly align: ColumnAlign;
  /** `true` = coluna que sustenta a conclusão; a UI destaca. */
  readonly highlight?: boolean;
}

/** Tabela de métricas — usada no relatório de gasto × leads e no cruzamento por utm. */
export interface MetricsTableArtifact extends StageArtifactBase {
  readonly kind: 'metrics_table';
  readonly columns: readonly MetricsColumn[];
  /** Cada linha é um objeto chaveado por `MetricsColumn.key`. `null` = sem dado. */
  readonly rows: readonly Readonly<Record<string, string | number | null>>[];
  /** Linhas (por índice) que a análise apontou como problema. */
  readonly flaggedRows?: readonly number[];
  /** Ex.: "12 leads chegaram sem utm_content e não entram na tabela." */
  readonly footnote?: string;
}

export type CreativeStatus = 'ativo' | 'pausado' | 'em_aprovacao' | 'proposto' | 'reprovado';
export type BadgeTone = 'neutro' | 'ok' | 'atencao' | 'critico';

export interface CreativeItem {
  readonly id: Id;
  readonly nome: string;
  readonly campanha: string;
  readonly copy: string;
  readonly cta: string;
  readonly status: CreativeStatus;
  /** Badges já resolvidos pelo runtime — a UI só pinta, não decide. */
  readonly badges: readonly { readonly label: string; readonly tone: BadgeTone }[];
  readonly metricas: readonly { readonly label: string; readonly valor: string }[];
  /** Por que este criativo está na lista. Ex.: "CTR 0,4% e CPA 3x acima da média." */
  readonly motivo?: string;
}

export interface CreativeListArtifact extends StageArtifactBase {
  readonly kind: 'creative_list';
  readonly items: readonly CreativeItem[];
}

export interface AgendaItem {
  readonly texto: string;
  /** De onde saiu, ex.: "WhatsApp 22/08 — Carolina" ou "Meta Ads 18–24/08". */
  readonly origem: string;
  readonly prioridade: 'alta' | 'media' | 'baixa';
  /** Pessoa responsável, quando o supercérebro souber. */
  readonly responsavel?: string;
}

export interface AgendaArtifact extends StageArtifactBase {
  readonly kind: 'agenda';
  readonly cliente: string;
  readonly quando: IsoDateTime;
  readonly participantes: readonly string[];
  readonly blocos: readonly { readonly titulo: string; readonly itens: readonly AgendaItem[] }[];
  /** Decisões pendentes vindas da linha do tempo — o que trava a conta. */
  readonly pendencias?: readonly AgendaItem[];
}

export interface CtaProposal {
  readonly texto: string;
  /** Hipótese que a variação testa. Ex.: "objeção de preço vs. objeção de prazo". */
  readonly hipotese: string;
  /** Por que o agente propôs isso, ancorado no dado. */
  readonly justificativa: string;
}

/** Diff de CTA: o que está no ar × o que o agente propõe. */
export interface CtaDiffArtifact extends StageArtifactBase {
  readonly kind: 'cta_diff';
  readonly criativoId: Id;
  readonly criativoNome: string;
  readonly ctaAtual: string;
  readonly copyAtual: string;
  readonly propostas: readonly CtaProposal[];
}

export interface DiagnosticFinding {
  readonly afirmacao: string;
  /** Números que sustentam. Ex.: "Meta: 84 conversões · CRM: 61 leads atribuídos". */
  readonly evidencia: string;
  readonly fonte: string;
}

/** Diagnóstico: veredito + causa-raiz + hipóteses descartadas + próximos passos. */
export interface DiagnosticArtifact extends StageArtifactBase {
  readonly kind: 'diagnostic';
  readonly pergunta: string;
  /** Uma frase. Ex.: "As vendas não caíram; a atribuição quebrou." */
  readonly veredito: string;
  readonly confianca: 'alta' | 'media' | 'baixa';
  readonly causaRaiz: readonly DiagnosticFinding[];
  /** Hipóteses testadas e eliminadas — é isso que separa diagnóstico de chute. */
  readonly descartadas: readonly { readonly hipotese: string; readonly porque: string }[];
  readonly proximosPassos: readonly { readonly acao: string; readonly dono?: string; readonly exigeConfirmacao: boolean }[];
}

export type StageArtifact =
  | MetricsTableArtifact
  | CreativeListArtifact
  | AgendaArtifact
  | CtaDiffArtifact
  | DiagnosticArtifact;

// ---------------------------------------------------------------------------
// 7. Trace — união discriminada por `kind`
// ---------------------------------------------------------------------------

/**
 * Todo evento é serializável e carrega `at` + `seq`. A UI ordena por `seq`
 * (monotônico dentro do turno) e renderiza a legenda:
 *   pedido do usuário → raciocínio → tool (ler dados) → observação → ação → resposta
 * Mapeamento legenda → kind:
 *   pedido do usuário = user_message
 *   raciocínio        = thought
 *   tool (ler dados)  = tool_call com effect 'read'
 *   observação        = observation
 *   ação              = action_executed (precedida de permission_request/decision)
 *   resposta          = assistant_message
 */
interface TraceEventBase {
  readonly id: Id;
  readonly turnId: Id;
  readonly seq: number;
  readonly at: IsoDateTime;
}

export interface UserMessageEvent extends TraceEventBase {
  readonly kind: 'user_message';
  readonly text: string;
}

export interface NodeEnterEvent extends TraceEventBase {
  readonly kind: 'node_enter';
  readonly node: NodeName;
  /** Edge que trouxe até aqui. `null` no primeiro nó do turno. */
  readonly viaEdge: EdgeName | null;
  readonly budget: NodeBudget;
}

export interface NodeExitEvent extends TraceEventBase {
  readonly kind: 'node_exit';
  readonly node: NodeName;
  /** Edge escolhida na saída. `null` quando o turno para aqui (gate/erro fatal). */
  readonly viaEdge: EdgeName | null;
  readonly stepsUsed: number;
  readonly durationMs: number;
}

export interface ThoughtEvent extends TraceEventBase {
  readonly kind: 'thought';
  readonly node: NodeName;
  /** Passo do loop ReAct dentro do nó (1-based). */
  readonly step: number;
  readonly text: string;
}

export interface ToolCallEvent extends TraceEventBase {
  readonly kind: 'tool_call';
  readonly node: NodeName;
  readonly step: number;
  readonly tool: ToolName;
  readonly layer: ToolLayer;
  readonly effect: ToolEffect;
  readonly args: Json;
  /** Resumo em 1 linha do que voltou. `null` se a chamada falhou. */
  readonly resultSummary: string | null;
  readonly ok: boolean;
  readonly durationMs: number;
  /** Preenchido quando `ok: false`. */
  readonly error?: ToolError;
}

export interface ObservationEvent extends TraceEventBase {
  readonly kind: 'observation';
  readonly node: NodeName;
  readonly step: number;
  readonly observationId: Id;
  readonly text: string;
  readonly source: string;
}

export interface PermissionRequestEvent extends TraceEventBase {
  readonly kind: 'permission_request';
  readonly node: 'gate';
  readonly pendingAction: PendingAction;
}

export interface PermissionDecisionEvent extends TraceEventBase {
  readonly kind: 'permission_decision';
  readonly node: 'gate';
  readonly pendingActionId: Id;
  readonly decision: 'aprovar' | 'negar';
  readonly comment?: string;
}

export interface ActionExecutedEvent extends TraceEventBase {
  readonly kind: 'action_executed';
  readonly node: 'act';
  readonly tool: ToolName;
  readonly args: Json;
  readonly ok: boolean;
  /** Ex.: "2 anúncios pausados no Meta Ads." */
  readonly resultSummary: string;
  readonly durationMs: number;
}

export interface CompactionEvent extends TraceEventBase {
  readonly kind: 'compaction';
  readonly node: NodeName;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  /** Ids das observações substituídas pelo resumo. */
  readonly collapsedObservationIds: readonly Id[];
  readonly summary: string;
}

export interface ErrorEvent extends TraceEventBase {
  readonly kind: 'error';
  readonly node: NodeName;
  readonly error: ToolError;
  /** Tentativa atual (1-based). O runtime para em 2. */
  readonly attempt: number;
  readonly willRetry: boolean;
}

export interface AssistantMessageEvent extends TraceEventBase {
  readonly kind: 'assistant_message';
  readonly node: 'respond';
  readonly text: string;
  readonly artifactIds: readonly Id[];
}

export type TraceEvent =
  | UserMessageEvent
  | NodeEnterEvent
  | NodeExitEvent
  | ThoughtEvent
  | ToolCallEvent
  | ObservationEvent
  | PermissionRequestEvent
  | PermissionDecisionEvent
  | ActionExecutedEvent
  | CompactionEvent
  | ErrorEvent
  | AssistantMessageEvent;

// ---------------------------------------------------------------------------
// 8. Rota POST /api/chat
// ---------------------------------------------------------------------------

/**
 * Header onde a UI envia a chave do OpenRouter.
 * Regra de segurança do desafio: a chave vive em `sessionStorage` no browser,
 * viaja neste header por request, NUNCA é lida de env no servidor, NUNCA é
 * persistida e NUNCA aparece em log ou no trace.
 */
export const OPENROUTER_KEY_HEADER = 'x-openrouter-key' as const;

/** Modelos oferecidos no seletor. Strings de slug do OpenRouter. */
export type ModelSlug = string;

export interface ChatRequest {
  /** Mantém a sessão entre turnos. A UI gera no primeiro turno e reusa. */
  readonly sessionId: Id;
  /** Mensagem nova do gestor. Ausente quando o turno é só uma decisão de permissão. */
  readonly message?: string;
  /** Resposta ao gate. Retoma o turno interrompido. */
  readonly decision?: PermissionDecision;
  /** Slug do modelo escolhido no seletor. */
  readonly model: ModelSlug;
  /**
   * `true` = modo replay determinístico (roteiro gravado, sem LLM e sem chave).
   * A UI oferece isso para o avaliador que não colou chave.
   */
  readonly replay?: boolean;
}

/**
 * Resposta não-streaming (usada no modo replay e como fallback).
 * O turno pode terminar em `halt: 'awaiting_confirmation'` — nesse caso
 * `state.pendingAction` está preenchido e a UI abre o diálogo.
 */
export interface ChatResponse {
  readonly turnId: Id;
  readonly sessionId: Id;
  /** Estado final do turno. A UI só precisa de `trace`, `artifacts`, `pendingAction`, `halt`. */
  readonly state: HarnessState;
  /** Texto da resposta. Vazio quando o turno parou no gate. */
  readonly reply: string;
}

/**
 * Streaming: NDJSON (`application/x-ndjson`), um `StreamFrame` por linha,
 * cada linha terminada em `\n`. A UI faz append incremental.
 */
export type StreamFrame =
  /** Primeiro frame do turno. */
  | { readonly type: 'turn_start'; readonly turnId: Id; readonly sessionId: Id }
  /** Um evento novo do trace. A UI apenda na timeline. */
  | { readonly type: 'trace'; readonly event: TraceEvent }
  /** Artefato pronto para o Palco. Mesmo `id` = substituir. */
  | { readonly type: 'artifact'; readonly artifact: StageArtifact }
  /** Pedaço do texto da resposta final (token streaming). */
  | { readonly type: 'reply_delta'; readonly text: string }
  /** O gate interrompeu: a UI abre o diálogo de confirmação e para de esperar. */
  | { readonly type: 'awaiting_confirmation'; readonly pendingAction: PendingAction }
  /** Fim do turno. `state` completo para a UI reconciliar. */
  | { readonly type: 'turn_end'; readonly halt: HaltReason; readonly state: HarnessState }
  /** Falha fatal fora de tool (ex.: chave inválida). Mensagem já em PT-BR. */
  | { readonly type: 'fatal'; readonly message: string };

export interface ChatErrorBody {
  readonly error: string;
  /** `missing_key` = a UI deve focar o campo de chave. */
  readonly code: 'missing_key' | 'invalid_key' | 'bad_request' | 'upstream' | 'internal';
}

// ---------------------------------------------------------------------------
// 9. Exemplo literal de um turno completo
//    A UI pode ser construída contra isto antes do runtime existir.
//    Caso: "Pause os criativos com CTA ruim e proponha 3 variações."
// ---------------------------------------------------------------------------

export const EXEMPLO_TRACE: readonly TraceEvent[] = [
  {
    kind: 'user_message',
    id: 'ev-01', turnId: 't-1', seq: 1, at: '2026-08-26T14:00:00.000Z',
    text: 'Pause os criativos com CTA ruim e proponha 3 variações.',
  },
  {
    kind: 'node_enter',
    id: 'ev-02', turnId: 't-1', seq: 2, at: '2026-08-26T14:00:00.100Z',
    node: 'interpret', viaEdge: null,
    budget: { node: 'interpret', maxSteps: 3, allowlist: ['graph_query', 'timeline_query'], maxObservationTokens: 2000 },
  },
  {
    kind: 'thought',
    id: 'ev-03', turnId: 't-1', seq: 3, at: '2026-08-26T14:00:00.300Z',
    node: 'interpret', step: 1,
    text: '"criativos com CTA ruim" não nomeia campanha. Preciso descobrir a conta ativa e quais criativos estão no ar.',
  },
  {
    kind: 'tool_call',
    id: 'ev-04', turnId: 't-1', seq: 4, at: '2026-08-26T14:00:00.400Z',
    node: 'interpret', step: 1, tool: 'graph_query', layer: 'supercerebro', effect: 'read',
    args: { tipo: 'conta', filtro: { ativa: true } },
    resultSummary: 'Conta Housewhey; 2 campanhas ativas; linha de produto Ômega 3.',
    ok: true, durationMs: 42,
  },
  {
    kind: 'observation',
    id: 'ev-05', turnId: 't-1', seq: 5, at: '2026-08-26T14:00:00.450Z',
    node: 'interpret', step: 1, observationId: 'obs-01',
    text: 'Housewhey (e-commerce de suplementos). Campanhas ativas: Ômega 3 Prospecção, Ômega 3 Remarketing.',
    source: 'supercerebro.json',
  },
  {
    kind: 'node_exit',
    id: 'ev-06', turnId: 't-1', seq: 6, at: '2026-08-26T14:00:00.500Z',
    node: 'interpret', viaEdge: 'entidades_resolvidas', stepsUsed: 1, durationMs: 400,
  },
  {
    kind: 'node_enter',
    id: 'ev-07', turnId: 't-1', seq: 7, at: '2026-08-26T14:00:00.510Z',
    node: 'plan', viaEdge: 'entidades_resolvidas',
    budget: { node: 'plan', maxSteps: 1, allowlist: [], maxObservationTokens: 0 },
  },
  {
    kind: 'node_exit',
    id: 'ev-08', turnId: 't-1', seq: 8, at: '2026-08-26T14:00:00.900Z',
    node: 'plan', viaEdge: 'precisa_dados', stepsUsed: 1, durationMs: 390,
  },
  {
    kind: 'node_enter',
    id: 'ev-09', turnId: 't-1', seq: 9, at: '2026-08-26T14:00:00.910Z',
    node: 'fetch', viaEdge: 'precisa_dados',
    budget: {
      node: 'fetch', maxSteps: 6,
      allowlist: ['list_criativos', 'meta_ads_insights', 'get_metrics', 'crm_leads', 'ga_report', 'google_ads_insights', 'graph_query', 'timeline_query'],
      maxObservationTokens: 6000,
    },
  },
  {
    kind: 'tool_call',
    id: 'ev-10', turnId: 't-1', seq: 10, at: '2026-08-26T14:00:01.000Z',
    node: 'fetch', step: 1, tool: 'list_criativos', layer: 'api', effect: 'read',
    args: { conta: 'housewhey', status: 'ativo' },
    resultSummary: '7 criativos ativos com copy, CTA e status.',
    ok: true, durationMs: 61,
  },
  {
    kind: 'tool_call',
    id: 'ev-11', turnId: 't-1', seq: 11, at: '2026-08-26T14:00:01.100Z',
    node: 'fetch', step: 2, tool: 'meta_ads_insights', layer: 'api', effect: 'read',
    args: { conta: 'housewhey', from: '2026-08-19', to: '2026-08-25', breakdown: 'ad' },
    resultSummary: 'Gasto, CTR e conversões por anúncio nos últimos 7 dias.',
    ok: true, durationMs: 118,
  },
  {
    kind: 'observation',
    id: 'ev-12', turnId: 't-1', seq: 12, at: '2026-08-26T14:00:01.150Z',
    node: 'fetch', step: 2, observationId: 'obs-02',
    text: '2 criativos com CTR abaixo de 0,5% e CPA acima de R$ 180: "Ômega 3 — Frete Grátis" e "Ômega 3 — Compre Agora".',
    source: 'meta_ads.json@2026-08-19..25',
  },
  {
    kind: 'node_exit',
    id: 'ev-13', turnId: 't-1', seq: 13, at: '2026-08-26T14:00:01.200Z',
    node: 'fetch', viaEdge: 'dados_coletados', stepsUsed: 2, durationMs: 290,
  },
  {
    kind: 'node_enter',
    id: 'ev-14', turnId: 't-1', seq: 14, at: '2026-08-26T14:00:01.210Z',
    node: 'reason', viaEdge: 'dados_coletados',
    budget: { node: 'reason', maxSteps: 4, allowlist: ['app_diagnostico', 'propose_ctas', 'graph_query', 'timeline_query'], maxObservationTokens: 6000 },
  },
  {
    kind: 'tool_call',
    id: 'ev-15', turnId: 't-1', seq: 15, at: '2026-08-26T14:00:01.300Z',
    node: 'reason', step: 1, tool: 'propose_ctas', layer: 'app', effect: 'read',
    args: { criativoIds: ['cr-004', 'cr-007'], quantidade: 3 },
    resultSummary: '3 variações de CTA por criativo, com hipótese declarada.',
    ok: true, durationMs: 820,
  },
  {
    kind: 'node_exit',
    id: 'ev-16', turnId: 't-1', seq: 16, at: '2026-08-26T14:00:02.100Z',
    node: 'reason', viaEdge: 'conclusao_pede_acao', stepsUsed: 1, durationMs: 890,
  },
  {
    kind: 'node_enter',
    id: 'ev-17', turnId: 't-1', seq: 17, at: '2026-08-26T14:00:02.110Z',
    node: 'gate', viaEdge: 'conclusao_pede_acao',
    budget: { node: 'gate', maxSteps: 1, allowlist: [], maxObservationTokens: 0 },
  },
  {
    kind: 'permission_request',
    id: 'ev-18', turnId: 't-1', seq: 18, at: '2026-08-26T14:00:02.150Z',
    node: 'gate',
    pendingAction: {
      id: 'pa-01',
      tool: 'pause_ads',
      args: { adIds: ['cr-004', 'cr-007'] },
      originTraceEventId: 'ev-16',
      requestedAt: '2026-08-26T14:00:02.150Z',
      preview: {
        titulo: 'Pausar 2 anúncios no Meta Ads',
        itens: [
          { label: 'Ômega 3 — Frete Grátis (Prospecção)', detalhe: 'R$ 1.240 em 7 dias · CTR 0,41% · 0 leads atribuídos' },
          { label: 'Ômega 3 — Compre Agora (Remarketing)', detalhe: 'R$ 830 em 7 dias · CTR 0,47% · 2 leads' },
        ],
        impacto: 'Os dois anúncios param de entregar imediatamente e o orçamento realoca para os demais do adset.',
        reversivel: true,
        comoDesfazer: 'Reativar pelo gerenciador do Meta ou pedir aqui no chat.',
        seNegada: 'Nada é pausado. Eu sigo e entrego só as 3 variações de CTA para você decidir depois.',
      },
    },
  },
  {
    kind: 'node_exit',
    id: 'ev-19', turnId: 't-1', seq: 19, at: '2026-08-26T14:00:02.160Z',
    node: 'gate', viaEdge: null, stepsUsed: 1, durationMs: 50,
  },
  // --- turno interrompido aqui; retoma quando a UI enviar `decision` ---
  {
    kind: 'permission_decision',
    id: 'ev-20', turnId: 't-1', seq: 20, at: '2026-08-26T14:00:31.000Z',
    node: 'gate', pendingActionId: 'pa-01', decision: 'aprovar',
  },
  {
    kind: 'node_enter',
    id: 'ev-21', turnId: 't-1', seq: 21, at: '2026-08-26T14:00:31.010Z',
    node: 'act', viaEdge: 'acao_confirmada',
    budget: { node: 'act', maxSteps: 2, allowlist: ['pause_ads', 'send_whatsapp'], maxObservationTokens: 1000 },
  },
  {
    kind: 'action_executed',
    id: 'ev-22', turnId: 't-1', seq: 22, at: '2026-08-26T14:00:31.400Z',
    node: 'act', tool: 'pause_ads', args: { adIds: ['cr-004', 'cr-007'] },
    ok: true, resultSummary: '2 anúncios pausados no Meta Ads.', durationMs: 380,
  },
  {
    kind: 'node_exit',
    id: 'ev-23', turnId: 't-1', seq: 23, at: '2026-08-26T14:00:31.420Z',
    node: 'act', viaEdge: 'sem_efeito_real', stepsUsed: 1, durationMs: 410,
  },
  {
    kind: 'assistant_message',
    id: 'ev-24', turnId: 't-1', seq: 24, at: '2026-08-26T14:00:32.500Z',
    node: 'respond',
    text: 'Pausei 2 anúncios com CTR abaixo de 0,5% e CPA acima de R$ 180. As 3 variações de CTA de cada um estão no Palco, com a hipótese que cada uma testa.',
    artifactIds: ['art-01', 'art-02'],
  },
];

/** Exemplo de artefato do Palco correspondente ao turno acima. */
export const EXEMPLO_ARTEFATO_CTA: CtaDiffArtifact = {
  kind: 'cta_diff',
  id: 'art-02',
  title: 'Variações de CTA — Ômega 3 Frete Grátis',
  createdAt: '2026-08-26T14:00:32.000Z',
  evidence: ['ev-11', 'ev-15'],
  criativoId: 'cr-004',
  criativoNome: 'Ômega 3 — Frete Grátis',
  ctaAtual: 'Compre agora',
  copyAtual: 'Ômega 3 com frete grátis para todo o Brasil.',
  propostas: [
    {
      texto: 'Ver preço com frete incluso',
      hipotese: 'A objeção é preço final, não o produto.',
      justificativa: 'CTR 0,41% com alto alcance sugere que a promessa não é lida como oferta concreta.',
    },
    {
      texto: 'Quero começar hoje',
      hipotese: 'A objeção é prazo de entrega.',
      justificativa: 'O criativo irmão que cita prazo tem CTR 1,2% no mesmo público.',
    },
    {
      texto: 'Comparar com o meu Ômega 3 atual',
      hipotese: 'O público já consome a categoria e decide por comparação.',
      justificativa: 'GA mostra 38% do tráfego deste anúncio indo direto para a página de comparação.',
    },
  ],
};

/** Exemplo do diagnóstico do prompt 2 — a causa-raiz é atribuição, não venda. */
export const EXEMPLO_ARTEFATO_DIAGNOSTICO: DiagnosticArtifact = {
  kind: 'diagnostic',
  id: 'art-03',
  title: 'Por que caíram as vendas da Ômega 3',
  createdAt: '2026-08-26T14:10:00.000Z',
  evidence: ['ev-11', 'ev-12'],
  pergunta: 'Por que caíram as vendas da Ômega 3 essa semana?',
  veredito: 'As vendas não caíram na mesma proporção: parte da queda é atribuição quebrada, não demanda.',
  confianca: 'alta',
  causaRaiz: [
    {
      afirmacao: 'Um criativo usa encurtador de link que derruba os parâmetros de UTM.',
      evidencia: 'Leads do CRM originados desse anúncio chegam com utm_content vazio.',
      fonte: 'crm.json + criativos.json',
    },
    {
      afirmacao: 'O CPA aparente sobe porque o gasto fica atribuído e a conversão não.',
      evidencia: 'Meta reporta mais conversões do que o CRM consegue atribuir no mesmo período.',
      fonte: 'meta_ads.json + crm.json',
    },
  ],
  descartadas: [
    { hipotese: 'Queda de investimento', porque: 'Gasto da semana está no mesmo patamar da anterior.' },
    { hipotese: 'Ruptura de estoque', porque: 'Não há evento de estoque na linha do tempo da conta.' },
  ],
  proximosPassos: [
    { acao: 'Trocar o link encurtado pelo link direto com UTM no criativo afetado', dono: 'Aline', exigeConfirmacao: true },
    { acao: 'Reprocessar os leads sem utm_content por horário de clique', exigeConfirmacao: false },
  ],
};
