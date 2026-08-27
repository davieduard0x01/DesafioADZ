/**
 * Estado do turno, orçamentos por nó, relógio e checkpoint.
 *
 * O `HarnessState` do contrato é imutável por convenção: cada nó devolve um
 * estado novo. O trace vive num buffer append-only no `Ctx` e é copiado para o
 * estado a cada saída de nó — assim o streaming e o estado final nunca divergem.
 */
import type {
  EdgeName,
  HaltReason,
  HarnessState,
  Id,
  IsoDateTime,
  Json,
  NodeBudget,
  NodeName,
  Observation,
  StreamFrame,
  ToolName,
  TraceEvent,
} from './types';
import type { LlmPort } from './llm';

// --- orçamentos (docs/arquitetura/diagrama.md, "Contrato de cada nó") -------

export const BUDGETS: Readonly<Record<NodeName, NodeBudget>> = {
  interpret: { node: 'interpret', maxSteps: 3, allowlist: ['graph_query', 'timeline_query'], maxObservationTokens: 2000 },
  plan: { node: 'plan', maxSteps: 1, allowlist: [], maxObservationTokens: 0 },
  fetch: {
    node: 'fetch',
    maxSteps: 6,
    allowlist: ['graph_query', 'timeline_query', 'meta_ads_insights', 'google_ads_insights', 'ga_report', 'crm_leads', 'list_criativos', 'get_metrics'],
    maxObservationTokens: 6000,
  },
  reason: { node: 'reason', maxSteps: 4, allowlist: ['app_diagnostico', 'propose_ctas', 'graph_query', 'timeline_query'], maxObservationTokens: 6000 },
  compact: { node: 'compact', maxSteps: 1, allowlist: [], maxObservationTokens: 0 },
  gate: { node: 'gate', maxSteps: 1, allowlist: [], maxObservationTokens: 0 },
  act: { node: 'act', maxSteps: 2, allowlist: ['pause_ads', 'send_whatsapp'], maxObservationTokens: 1000 },
  respond: { node: 'respond', maxSteps: 1, allowlist: [], maxObservationTokens: 0 },
  errorHandler: { node: 'errorHandler', maxSteps: 1, allowlist: [], maxObservationTokens: 0 },
};

/** Teto de ciclos do par fetch ⇄ reason por turno (ADR-002). */
export const MAX_REACT_CYCLES = 3;
/** Tentativas do errorHandler por turno. A 2ª falha degrada. */
export const MAX_ATTEMPTS = 2;

const ZERO_STEPS: Readonly<Record<NodeName, number>> = {
  interpret: 0, plan: 0, fetch: 0, reason: 0, compact: 0, gate: 0, act: 0, respond: 0, errorHandler: 0,
};

/** Estimativa grosseira de tokens. ~4 caracteres por token em PT-BR. */
export function approxTokens(texto: string): number {
  return Math.ceil(texto.length / 4);
}

export function observationTokens(observations: readonly Observation[]): number {
  return observations.reduce((soma, o) => soma + o.approxTokens, 0);
}

// --- relógio e ids ----------------------------------------------------------

/**
 * Em execução normal usa o relógio real; em replay avança um passo fixo por
 * evento, para que dois replays do mesmo prompt gerem bytes idênticos.
 */
export interface Clock {
  now(): IsoDateTime;
  id(prefixo: string): Id;
}

export function realClock(seed = ''): Clock {
  let n = 0;
  return {
    now: () => new Date().toISOString(),
    id: (p) => `${p}-${seed || Date.now().toString(36)}-${(++n).toString(36)}`,
  };
}

export function deterministicClock(inicio = '2026-08-26T14:00:00.000Z', passoMs = 100): Clock {
  const base = Date.parse(inicio);
  let tick = 0;
  let n = 0;
  return {
    now: () => new Date(base + passoMs * tick++).toISOString(),
    id: (p) => `${p}-${(++n).toString(36).padStart(3, '0')}`,
  };
}

// --- contexto de execução ---------------------------------------------------

/** Distribui o Omit pela união do TraceEvent — o nó emite sem se preocupar com id/seq. */
type SemMetadados<T> = T extends unknown ? Omit<T, 'id' | 'turnId' | 'seq' | 'at'> : never;
export type TraceInput = SemMetadados<TraceEvent>;

export interface Ctx {
  readonly turnId: Id;
  readonly sessionId: Id;
  readonly clock: Clock;
  /** Mutável: vira `null` se o modelo degradar no meio do turno (ver llm.ts). */
  llm: LlmPort | null;
  readonly model: string;
  readonly replay: boolean;
  /** Trace append-only do turno (inclui os eventos do request anterior na retomada). */
  readonly events: TraceEvent[];
  /**
   * Payloads crus das tools, por chave `tool` ou `tool:variante`.
   * Não cabe no `HarnessState` (o contrato só guarda o texto da observação), e é
   * o que permite agregar em código no `respond`. Vai junto no checkpoint.
   */
  readonly payloads: Record<string, Json>;
  /**
   * Ação com efeito real proposta pelo `reason` e ainda não avaliada pelo `gate`.
   * Não existe campo para isso no `HarnessState` do contrato (só `pendingAction`,
   * que já é pós-gate), então trafega aqui e vai junto no checkpoint.
   */
  proposta: { tool: ToolName; args: Json } | null;
  emit(evento: TraceInput): TraceEvent;
  frame(f: StreamFrame): void;
}

export function createCtx(args: {
  turnId: Id;
  sessionId: Id;
  clock: Clock;
  llm: LlmPort | null;
  model: string;
  replay: boolean;
  events?: TraceEvent[];
  payloads?: Record<string, Json>;
  proposta?: { tool: ToolName; args: Json } | null;
  onFrame?: (f: StreamFrame) => void;
}): Ctx {
  const events = args.events ?? [];
  const ctx: Ctx = {
    turnId: args.turnId,
    sessionId: args.sessionId,
    clock: args.clock,
    llm: args.llm,
    model: args.model,
    replay: args.replay,
    events,
    payloads: args.payloads ?? {},
    proposta: args.proposta ?? null,
    emit(evento) {
      const completo = {
        ...evento,
        id: args.clock.id('ev'),
        turnId: args.turnId,
        seq: events.length + 1,
        at: args.clock.now(),
      } as TraceEvent;
      events.push(completo);
      ctx.frame({ type: 'trace', event: completo });
      return completo;
    },
    frame(f) {
      args.onFrame?.(f);
    },
  };
  return ctx;
}

// --- estado -----------------------------------------------------------------

export function createState(args: { turnId: Id; sessionId: Id; userText: string; clock: Clock }): HarnessState {
  const agora = args.clock.now();
  return {
    turnId: args.turnId,
    sessionId: args.sessionId,
    messages: [{ id: args.clock.id('msg'), role: 'user', content: args.userText, createdAt: agora }],
    currentNode: 'interpret',
    visited: [],
    entities: [],
    plan: [],
    observations: [],
    stepCount: { ...ZERO_STEPS },
    reactCycles: 0,
    pendingAction: null,
    executedActions: [],
    artifacts: [],
    trace: [],
    halt: null,
    startedAt: agora,
    updatedAt: agora,
  };
}

export function merge(estado: HarnessState, patch: Partial<HarnessState>, agora: IsoDateTime): HarnessState {
  return { ...estado, ...patch, updatedAt: agora };
}

export function bumpStep(estado: HarnessState, node: NodeName): HarnessState {
  return { ...estado, stepCount: { ...estado.stepCount, [node]: estado.stepCount[node] + 1 } };
}

export function addObservation(
  estado: HarnessState,
  obs: { id: Id; node: NodeName; tool: ToolName; text: string; source: string; createdAt: IsoDateTime },
): HarnessState {
  const nova: Observation = { ...obs, approxTokens: approxTokens(obs.text) };
  return { ...estado, observations: [...estado.observations, nova] };
}

/** Janela padrão quando o `interpret` não pôde resolver uma. */
export function resolveWindowFallback(): { from: string; to: string; mention: string } {
  return { from: '2026-08-17', to: '2026-08-23', mention: 'últimos 7 dias com dado fechado' };
}

export function lastUserText(estado: HarnessState): string {
  for (let i = estado.messages.length - 1; i >= 0; i--) {
    if (estado.messages[i].role === 'user') return estado.messages[i].content;
  }
  return '';
}

// --- checkpoint (retomada pós-gate) ----------------------------------------

export interface Checkpoint {
  readonly estado: HarnessState;
  readonly payloads: Record<string, Json>;
  readonly events: TraceEvent[];
  readonly halt: HaltReason | null;
  readonly savedAt: IsoDateTime;
}

/**
 * ponytail: store em memória de processo — some no restart e não atravessa
 * instâncias. Trocar por Redis/KV quando existir mais de um worker.
 */
const checkpoints = new Map<Id, Checkpoint>();

export function saveCheckpoint(sessionId: Id, cp: Checkpoint): void {
  checkpoints.set(sessionId, cp);
}
export function loadCheckpoint(sessionId: Id): Checkpoint | undefined {
  return checkpoints.get(sessionId);
}
export function clearCheckpoint(sessionId: Id): void {
  checkpoints.delete(sessionId);
}

/** Resultado devolvido por um nó ao executor do grafo. */
export interface NodeResult {
  readonly estado: HarnessState;
  /** Edge tomada na saída. `null` = o turno para aqui (gate ou erro fatal). */
  readonly edge: EdgeName | null;
}
