/**
 * Nó `act` — executa EXATAMENTE os argumentos que estavam no preview.
 *
 * Nada é re-inferido depois da aprovação: o gestor aprova o que vai acontecer.
 * A tool de escrita só passa pela dupla trava aqui porque este nó marca a
 * chamada como confirmada por humano (`confirmedByHuman`), e isso só é verdade
 * quando existe uma `PendingAction` aprovada no estado.
 */
import type { Ctx, NodeResult } from '../state';
import { merge } from '../state';
import type { ExecutedAction, HarnessState } from '../types';
import { callTool, pensar } from './shared';

export async function act(estado: HarnessState, ctx: Ctx): Promise<NodeResult> {
  const pendente = estado.pendingAction;
  if (!pendente) {
    pensar(ctx, 'act', 1, 'Não há ação confirmada no estado. Nada a executar.');
    return { estado, edge: 'degradar' };
  }

  const inicio = Date.now();
  const r = callTool(ctx, estado, 'act', { tool: pendente.tool, args: pendente.args, confirmedByHuman: true });
  let novo = r.estado;

  ctx.emit({
    kind: 'action_executed',
    node: 'act',
    tool: pendente.tool,
    args: pendente.args,
    ok: r.result.ok,
    resultSummary: r.result.ok ? r.result.summary : r.result.error.message,
    durationMs: Date.now() - inicio,
  });

  if (!r.result.ok && r.result.error.retryable && novo.stepCount.act < 2) {
    return { estado: novo, edge: 'falha_de_tool' };
  }

  const executada: ExecutedAction = {
    pendingActionId: pendente.id,
    tool: pendente.tool,
    args: pendente.args,
    result: r.result,
    decidedBy: 'usuario',
    executedAt: ctx.clock.now(),
  };
  // a ação sai de `pendingAction` para `executedActions`: retomar o estado de
  // novo não reexecuta nada, porque não há mais nada pendente.
  novo = merge(novo, { pendingAction: null, executedActions: [...novo.executedActions, executada] }, ctx.clock.now());
  return { estado: novo, edge: 'acao_confirmada' };
}
