/**
 * Utilidades comuns aos nós: chamada de tool instrumentada e prompt do sistema.
 *
 * Toda chamada de tool passa por `callTool`, que emite `tool_call` e — quando dá
 * certo — a `observation` correspondente com `source` preenchido. É essa dupla
 * que torna cada número da resposta rastreável até uma linha do trace.
 */
import { BUDGETS, addObservation, bumpStep, type Ctx } from '../state';
import { executeTool } from '../tools';
import type { HarnessState, Json, NodeName, ToolName, ToolResult } from '../types';
import { toolDef } from '../tools/registry';

export const LIMITE_OBSERVACAO = 1400;

export interface ChamadaResultado {
  readonly estado: HarnessState;
  readonly result: ToolResult;
}

/** Texto que efetivamente entra no prompt do próximo passo. */
function textoDaObservacao(summary: string, data: Json): string {
  const bruto = JSON.stringify(data);
  const corpo = bruto.length > LIMITE_OBSERVACAO ? `${bruto.slice(0, LIMITE_OBSERVACAO)}…(payload truncado)` : bruto;
  return `${summary}\nDados: ${corpo}`;
}

export function callTool(
  ctx: Ctx,
  estado: HarnessState,
  node: NodeName,
  args: { tool: string; args: Json; confirmedByHuman?: boolean; chavePayload?: string },
): ChamadaResultado {
  const passo = estado.stepCount[node] + 1;
  let novo = bumpStep(estado, node);

  const { result } = executeTool(args.tool, args.args, {
    node,
    budget: BUDGETS[node],
    confirmedByHuman: args.confirmedByHuman ?? false,
  });

  const def = toolDef(result.tool);
  ctx.emit({
    kind: 'tool_call',
    node,
    step: passo,
    tool: result.tool,
    layer: def?.layer ?? 'api',
    effect: def?.effect ?? 'read',
    args: args.args,
    resultSummary: result.ok ? result.summary : null,
    ok: result.ok,
    durationMs: result.durationMs,
    ...(result.ok ? {} : { error: result.error }),
  });

  if (result.ok) {
    const observationId = ctx.clock.id('obs');
    const texto = textoDaObservacao(result.summary, result.data);
    novo = addObservation(novo, {
      id: observationId,
      node,
      tool: result.tool,
      text: texto,
      source: result.source,
      createdAt: ctx.clock.now(),
    });
    ctx.emit({ kind: 'observation', node, step: passo, observationId, text: result.summary, source: result.source });
    ctx.payloads[args.chavePayload ?? result.tool] = result.data;
  }

  return { estado: novo, result };
}

export function pensar(ctx: Ctx, node: NodeName, step: number, texto: string): void {
  ctx.emit({ kind: 'thought', node, step, text: texto });
}

/** Tools que o nó pode oferecer ao modelo — já filtradas pela allowlist. */
export function toolsDoNo(node: NodeName): ReturnType<typeof toolDef>[] {
  return BUDGETS[node].allowlist.map((n: ToolName) => toolDef(n));
}

export const SISTEMA_BASE = [
  'Você é o motor de um harness agêntico que atende gestores de tráfego da agência SPOT na conta Housewhey (e-commerce de suplementos).',
  'Responda SEMPRE em português do Brasil, para um gestor de marketing — nada de jargão de dev nem de id cru sem rótulo.',
  'Regra dura: todo número que você citar tem que ter vindo de uma tool desta conversa. Não estime, não arredonde para um número "bonito", não invente.',
  'Se um dado ficou de fora do agrupamento (por exemplo leads sem utm_content), declare quantos ficaram — nunca some com eles em silêncio.',
  'Hoje é 26/08/2026. Os dados de mídia vão até 23/08/2026.',
].join(' ');
