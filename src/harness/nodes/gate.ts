/**
 * Nó `gate` — trava de permissão deny-first (ADR-003).
 *
 * O gate PROPÕE; quem executa é o `act`, num request seguinte. Os dois são nós
 * separados e o turno fecha entre eles de propósito: um nó que aprovasse e
 * disparasse executaria o efeito duas vezes ao retomar um turno interrompido.
 *
 * Aqui não se chama tool (allowlist vazia): só se monta o `ActionPreview` em
 * PT-BR e se para o turno com `halt: 'awaiting_confirmation'`.
 */
import { buildArtifacts } from '../artifacts';
import type { Intent } from '../heuristics';
import type { Ctx, NodeResult } from '../state';
import { bumpStep, lastUserText, merge } from '../state';
import type { HarnessState, PendingAction } from '../types';
import { toolDef } from '../tools/registry';
import { pensar } from './shared';

export async function gate(estado: HarnessState, ctx: Ctx): Promise<NodeResult> {
  const proposta = ctx.proposta;
  const def = proposta ? toolDef(proposta.tool) : undefined;
  let novo = bumpStep(estado, 'gate');

  if (!proposta || !def || def.effect !== 'write') {
    pensar(ctx, 'gate', 1, 'A conclusão não pede nada com efeito real. Sigo direto para a resposta.');
    return { estado: novo, edge: 'sem_efeito_real' };
  }

  const preview = def.buildPreview ? def.buildPreview(proposta.args) : { titulo: `Executar ${def.name}`, itens: [], impacto: 'Efeito real na conta.', reversivel: false, seNegada: 'Nada é executado.' };
  const origem = [...ctx.events].reverse().find((e) => e.kind === 'thought' || e.kind === 'tool_call');
  const pendente: PendingAction = {
    id: ctx.clock.id('pa'),
    tool: def.name,
    args: proposta.args,
    preview,
    originTraceEventId: origem?.id ?? ctx.events[ctx.events.length - 1]?.id ?? '',
    requestedAt: ctx.clock.now(),
  };

  // O gestor decide olhando o que sustenta a proposta: os artefatos vão para o
  // Palco ANTES da confirmação. `id` é estável, então o `respond` substitui em
  // vez de duplicar.
  const artefatos = buildArtifacts((estado.intent ?? 'pergunta_generica') as Intent, ctx, lastUserText(estado));
  for (const a of artefatos) ctx.frame({ type: 'artifact', artifact: a });
  novo = merge(novo, { artifacts: artefatos }, ctx.clock.now());

  pensar(ctx, 'gate', 1, `\`${def.name}\` tem efeito real${preview.reversivel ? '' : ' e é IRREVERSÍVEL'}. Paro o turno e peço confirmação antes de qualquer coisa.`);
  ctx.emit({ kind: 'permission_request', node: 'gate', pendingAction: pendente });

  novo = merge(novo, { pendingAction: pendente, halt: 'awaiting_confirmation' }, ctx.clock.now());
  return { estado: novo, edge: null };
}
