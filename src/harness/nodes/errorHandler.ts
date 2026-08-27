/**
 * Nó `errorHandler` — retry com teto ou degradação explícita.
 *
 * Degradar aqui significa seguir para `respond` e DIZER o que não foi possível
 * verificar. O que não pode acontecer é o turno morrer em silêncio ou a resposta
 * preencher o buraco com plausibilidade.
 */
import type { Ctx, NodeResult } from '../state';
import { MAX_ATTEMPTS, bumpStep } from '../state';
import type { HarnessState, ToolError } from '../types';
import { pensar } from './shared';

function ultimoErro(ctx: Ctx): ToolError | null {
  for (let i = ctx.events.length - 1; i >= 0; i--) {
    const e = ctx.events[i];
    if (e.kind === 'tool_call' && !e.ok && e.error) return e.error;
  }
  return null;
}

export async function errorHandler(estado: HarnessState, ctx: Ctx): Promise<NodeResult> {
  const novo = bumpStep(estado, 'errorHandler');
  const attempt = novo.stepCount.errorHandler;
  const erro = ultimoErro(ctx) ?? { code: 'upstream' as const, message: 'Falha não identificada em uma tool.', retryable: false };
  const vaiTentarDeNovo = erro.retryable && attempt < MAX_ATTEMPTS;

  ctx.emit({ kind: 'error', node: 'errorHandler', error: erro, attempt, willRetry: vaiTentarDeNovo });
  pensar(
    ctx,
    'errorHandler',
    attempt,
    vaiTentarDeNovo
      ? `Falha "${erro.code}" na tentativa ${attempt}. É retryable: tento de novo.`
      : `Falha "${erro.code}" na tentativa ${attempt}. Não insisto: sigo para a resposta declarando o que não deu para verificar.`,
  );

  return { estado: novo, edge: vaiTentarDeNovo ? 'retry' : 'degradar' };
}
