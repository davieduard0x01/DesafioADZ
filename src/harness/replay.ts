/**
 * Modo replay determinístico — o avaliador sem chave vê um turno inteiro.
 *
 * Não é roteiro gravado: é o MESMO grafo, com as MESMAS tools lendo os MESMOS
 * datasets, apenas sem o LLM (o harness cai no cérebro determinístico) e com um
 * relógio de passo fixo. Trace, artefatos e números são reais; só a redação é do
 * harness em vez do modelo, e o turno diz isso na própria resposta.
 *
 * O único ajuste é `durationMs`: tempo de parede não é determinístico, então no
 * replay ele é substituído por um valor fixo. Está declarado aqui de propósito.
 */
import { runTurn, resumeTurn } from './graph';
import { deterministicClock } from './state';
import type { HarnessState, Id, PermissionDecision, StreamFrame } from './types';

/** Os 4 prompts de aceite. Os dois primeiros são os do critério do desafio. */
export const PROMPTS_ACEITE: readonly string[] = [
  'Pause os criativos com CTA ruim e proponha 3 variações.',
  'Por que caíram as vendas da Ômega 3 essa semana?',
  'Monta a pauta da reunião de amanhã com a Housewhey.',
  'Cruza gasto do Meta com leads do CRM por utm_content e me diz o que está caro.',
];

const DURACAO_FIXA = 40;

/**
 * Zera o tempo de parede em qualquer profundidade do frame (o `turn_end` carrega
 * o estado inteiro, com o trace dentro). Frames são JSON por contrato, então o
 * round-trip é seguro.
 */
function normalizar(frame: StreamFrame): StreamFrame {
  return JSON.parse(JSON.stringify(frame, (chave, valor) => (chave === 'durationMs' ? DURACAO_FIXA : valor))) as StreamFrame;
}

export interface ReplayArgs {
  readonly sessionId: Id;
  readonly texto: string;
  readonly onFrame?: (f: StreamFrame) => void;
}

export async function runReplayTurn(args: ReplayArgs): Promise<HarnessState> {
  return runTurn({
    sessionId: args.sessionId,
    texto: args.texto,
    model: 'replay',
    llm: null,
    replay: true,
    clock: deterministicClock(),
    onFrame: (f) => args.onFrame?.(normalizar(f)),
  });
}

export async function resumeReplayTurn(args: { sessionId: Id; decision: PermissionDecision; onFrame?: (f: StreamFrame) => void }): Promise<HarnessState | null> {
  return resumeTurn({
    sessionId: args.sessionId,
    decision: args.decision,
    model: 'replay',
    llm: null,
    clock: deterministicClock('2026-08-26T14:05:00.000Z'),
    onFrame: (f) => args.onFrame?.(normalizar(f)),
  });
}

/** Coleta os frames do turno inteiro — usado pelos testes e pela rota. */
export async function replayFrames(sessionId: Id, texto: string): Promise<StreamFrame[]> {
  const frames: StreamFrame[] = [];
  await runReplayTurn({ sessionId, texto, onFrame: (f) => frames.push(f) });
  return frames;
}
