/**
 * Nó `compact` — resume observações quando o orçamento do nó estoura.
 *
 * A compactação é DETERMINÍSTICA de propósito: pedir para o modelo resumir é
 * exatamente onde números se perdem ou mudam de valor. Aqui as observações
 * antigas viram uma linha cada, mantendo o resumo de uma linha da tool e a
 * `source` citável; o payload cru é que sai do contexto.
 */
import type { Ctx, NodeResult } from '../state';
import { approxTokens, merge, observationTokens } from '../state';
import type { HarnessState, Observation } from '../types';
import { pensar } from './shared';

/** Quantas observações recentes ficam intactas. */
const MANTER = 2;

export async function compact(estado: HarnessState, ctx: Ctx): Promise<NodeResult> {
  const antes = observationTokens(estado.observations);
  const antigas = estado.observations.slice(0, Math.max(0, estado.observations.length - MANTER));
  const recentes = estado.observations.slice(antigas.length);

  if (!antigas.length) {
    pensar(ctx, 'compact', 1, 'Nada a compactar: só há observações recentes.');
    return { estado, edge: 'contexto_compactado' };
  }

  // a primeira linha de uma observação é o `summary` da tool (curto); o corte
  // existe para o caso de um payload sem quebra de linha.
  const LIMITE_LINHA = 400;
  const linhas = antigas.map((o) => {
    const primeira = o.text.split('\n')[0];
    return `• [${o.source}] ${primeira.length > LIMITE_LINHA ? `${primeira.slice(0, LIMITE_LINHA)}…` : primeira}`;
  });
  const texto = `Resumo de ${antigas.length} observação(ões) anteriores (números e fontes preservados):\n${linhas.join('\n')}`;
  const resumo: Observation = {
    id: ctx.clock.id('obs'),
    node: 'compact',
    tool: antigas[antigas.length - 1].tool,
    text: texto,
    source: [...new Set(antigas.map((o) => o.source))].join(' + '),
    createdAt: ctx.clock.now(),
    approxTokens: approxTokens(texto),
    compacted: true,
  };

  const observations = [resumo, ...recentes];
  const depois = observationTokens(observations);
  ctx.emit({
    kind: 'compaction',
    node: 'compact',
    tokensBefore: antes,
    tokensAfter: depois,
    collapsedObservationIds: antigas.map((o) => o.id),
    summary: `${antigas.length} observações viraram 1 resumo: ~${antes} → ~${depois} tokens.`,
  });

  return { estado: merge(estado, { observations }, ctx.clock.now()), edge: 'contexto_compactado' };
}
