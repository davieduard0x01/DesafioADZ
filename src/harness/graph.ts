/**
 * Executor do grafo de estados (ADR-001).
 *
 * Responsabilidades:
 *   - roteamento por edge NOMEADA (nada de "próximo nó" implícito);
 *   - contadores de passo por nó, zerados a cada (re)entrada;
 *   - emissão do par `node_enter`/`node_exit` para TODO nó, inclusive `respond`;
 *   - checkpoint do estado quando o gate interrompe, e retomada sem reexecutar
 *     o que já rodou.
 *
 * Divergência declarada do `EXEMPLO_TRACE` de types.ts: `act → respond` sai pela
 * edge `acao_confirmada` (o `EdgeName` do contrato não tem um nome próprio para
 * essa transição, e `sem_efeito_real` é edge do `gate`).
 */
import { act, compact, errorHandler, fetchNode, gate, interpret, plan, reason, respond } from './nodes';
import {
  BUDGETS,
  type Checkpoint,
  type Clock,
  type Ctx,
  clearCheckpoint,
  createCtx,
  createState,
  loadCheckpoint,
  merge,
  realClock,
  saveCheckpoint,
} from './state';
import type { EdgeName, HaltReason, HarnessState, Id, NodeName, PermissionDecision, StreamFrame } from './types';
import type { LlmPort } from './llm';

const NODES: Readonly<Record<NodeName, (estado: HarnessState, ctx: Ctx, viaEdge: EdgeName | null) => Promise<{ estado: HarnessState; edge: EdgeName | null }>>> = {
  interpret,
  plan,
  fetch: fetchNode,
  reason,
  compact,
  gate,
  act,
  respond,
  errorHandler,
};

type Destino = NodeName | 'HALT' | 'END';

/** A tabela de edges do diagrama, em código. Edge desconhecida = erro fatal explícito. */
export function route(node: NodeName, edge: EdgeName | null): Destino {
  switch (node) {
    case 'interpret':
      return edge === 'ambiguidade_de_entidade' ? 'respond' : 'plan';
    case 'plan':
      return edge === 'sem_dados_necessarios' ? 'respond' : 'fetch';
    case 'fetch':
      return edge === 'falha_de_tool' ? 'errorHandler' : 'reason';
    case 'reason':
      if (edge === 'lacuna_de_dado') return 'fetch';
      if (edge === 'orcamento_de_contexto_estourado') return 'compact';
      if (edge === 'conclusao_pede_acao') return 'gate';
      return 'respond';
    case 'compact':
      return 'reason';
    case 'gate':
      return edge === 'sem_efeito_real' ? 'respond' : 'HALT';
    case 'act':
      return edge === 'falha_de_tool' ? 'errorHandler' : 'respond';
    case 'errorHandler':
      return edge === 'retry' ? 'fetch' : 'respond';
    case 'respond':
      return 'END';
  }
}

/** Trava contra ciclo mal-especificado: nenhum turno percorre 40 nós. */
const MAX_TRANSICOES = 40;

export async function runGraph(estado: HarnessState, ctx: Ctx, inicio: NodeName, edgeDeEntrada: EdgeName | null): Promise<HarnessState> {
  let atual: Destino = inicio;
  let viaEdge = edgeDeEntrada;
  let corrente = estado;

  for (let i = 0; i < MAX_TRANSICOES; i++) {
    if (atual === 'END' || atual === 'HALT') break;
    const node: NodeName = atual;

    ctx.emit({ kind: 'node_enter', node, viaEdge, budget: BUDGETS[node] });
    // o contador zera ao (re)entrar no nó — é o contrato do HarnessState
    corrente = merge(corrente, { currentNode: node, visited: [...corrente.visited, node], stepCount: { ...corrente.stepCount, [node]: 0 } }, ctx.clock.now());

    const t0 = Date.now();
    const resultado = await NODES[node](corrente, ctx, viaEdge);
    corrente = merge(resultado.estado, { trace: [...ctx.events] }, ctx.clock.now());

    ctx.emit({ kind: 'node_exit', node, viaEdge: resultado.edge, stepsUsed: corrente.stepCount[node], durationMs: Date.now() - t0 });
    corrente = merge(corrente, { trace: [...ctx.events] }, ctx.clock.now());

    atual = route(node, resultado.edge);
    viaEdge = resultado.edge;
  }

  if (atual !== 'END' && atual !== 'HALT') {
    corrente = merge(corrente, { halt: 'budget_exhausted' }, ctx.clock.now());
  }
  return merge(corrente, { trace: [...ctx.events] }, ctx.clock.now());
}

// ---------------------------------------------------------------------------
// Turno completo
// ---------------------------------------------------------------------------

export interface TurnoArgs {
  readonly sessionId: Id;
  readonly texto: string;
  readonly model: string;
  readonly llm: LlmPort | null;
  readonly replay?: boolean;
  readonly clock?: Clock;
  readonly onFrame?: (f: StreamFrame) => void;
}

export async function runTurn(args: TurnoArgs): Promise<HarnessState> {
  const clock = args.clock ?? realClock();
  const turnId = clock.id('turn');
  const ctx = createCtx({
    turnId,
    sessionId: args.sessionId,
    clock,
    llm: args.llm,
    model: args.model,
    replay: args.replay ?? false,
    onFrame: args.onFrame,
  });

  ctx.frame({ type: 'turn_start', turnId, sessionId: args.sessionId });
  const inicial = createState({ turnId, sessionId: args.sessionId, userText: args.texto, clock });
  ctx.emit({ kind: 'user_message', text: args.texto });

  const final = await runGraph(inicial, ctx, 'interpret', null);
  return encerrar(final, ctx);
}

export interface RetomadaArgs {
  readonly sessionId: Id;
  readonly decision: PermissionDecision;
  readonly model: string;
  readonly llm: LlmPort | null;
  readonly clock?: Clock;
  readonly onFrame?: (f: StreamFrame) => void;
}

/**
 * Retomada pós-gate: precisa funcionar SÓ com `sessionId` + decisão. O que já
 * rodou não roda de novo — o turno recomeça no `act` (ou direto no `respond`,
 * se negado), com o estado restaurado do checkpoint.
 */
export async function resumeTurn(args: RetomadaArgs): Promise<HarnessState | null> {
  const cp = loadCheckpoint(args.sessionId);
  if (!cp) return null;

  const clock = args.clock ?? realClock();
  const ctx = createCtx({
    turnId: cp.estado.turnId,
    sessionId: args.sessionId,
    clock,
    llm: args.llm,
    model: args.model,
    replay: false,
    events: [...cp.events],
    payloads: { ...cp.payloads },
    onFrame: args.onFrame,
  });

  ctx.frame({ type: 'turn_start', turnId: cp.estado.turnId, sessionId: args.sessionId });

  const pendente = cp.estado.pendingAction;
  // Trava de idempotência: sem pendência (ou com id trocado) nada é executado.
  if (!pendente || pendente.id !== args.decision.pendingActionId) {
    clearCheckpoint(args.sessionId);
    ctx.frame({ type: 'fatal', message: 'Essa confirmação não corresponde a nenhuma ação pendente desta sessão. Nada foi executado.' });
    return cp.estado;
  }
  clearCheckpoint(args.sessionId);

  ctx.emit({
    kind: 'permission_decision',
    node: 'gate',
    pendingActionId: args.decision.pendingActionId,
    decision: args.decision.decision,
    ...(args.decision.comment ? { comment: args.decision.comment } : {}),
  });

  const aprovado = args.decision.decision === 'aprovar';
  const base = merge(cp.estado, { halt: null, trace: [...ctx.events] }, clock.now());
  const final = await runGraph(base, ctx, aprovado ? 'act' : 'respond', aprovado ? 'acao_confirmada' : 'acao_negada');
  return encerrar(final, ctx);
}

function encerrar(estado: HarnessState, ctx: Ctx): HarnessState {
  const halt: HaltReason = estado.halt ?? 'done';
  const final = merge(estado, { halt, trace: [...ctx.events] }, ctx.clock.now());

  if (halt === 'awaiting_confirmation' && final.pendingAction) {
    const cp: Checkpoint = { estado: final, payloads: { ...ctx.payloads }, events: [...ctx.events], halt, savedAt: ctx.clock.now() };
    saveCheckpoint(final.sessionId, cp);
    ctx.frame({ type: 'awaiting_confirmation', pendingAction: final.pendingAction });
  }
  ctx.frame({ type: 'turn_end', halt, state: final });
  return final;
}
