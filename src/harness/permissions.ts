/**
 * Permissões deny-first (ADR-003).
 *
 * Duas travas independentes decidem se uma tool pode rodar:
 *   1. `NodeBudget.allowlist` — o que ESTE nó pode chamar;
 *   2. `ToolDef.allowedNodes` — de onde ESTA tool aceita ser chamada.
 * Uma tool só executa se as duas permitirem. Assim um bug na configuração de um
 * nó não abre acesso a `pause_ads`.
 *
 * Terceira trava, específica de escrita: `effect: 'write'` só roda no nó `act` e
 * só quando o runtime marca a chamada como confirmada pelo humano no gate.
 *
 * Negação nunca vira exceção: vira `ToolError` com `code: 'denied_by_policy'`,
 * que entra no trace. O gestor precisa VER que algo foi barrado.
 */
import type { NodeBudget, NodeName, ToolDef, ToolError, ToolName } from './types';

export interface PermissionContext {
  readonly node: NodeName;
  readonly budget: NodeBudget;
  /** `true` só quando o gate registrou a decisão `aprovar` para esta ação. */
  readonly confirmedByHuman: boolean;
}

/** Devolve `null` quando a chamada é permitida; caso contrário o erro do trace. */
export function checkPermission(def: ToolDef, ctx: PermissionContext): ToolError | null {
  if (!ctx.budget.allowlist.includes(def.name)) {
    return deny(`A tool \`${def.name}\` não está na allowlist do nó \`${ctx.node}\`.`);
  }
  if (!def.allowedNodes.includes(ctx.node)) {
    return deny(`A tool \`${def.name}\` só pode ser chamada de: ${def.allowedNodes.join(', ')}. Chamada veio de \`${ctx.node}\`.`);
  }
  if (def.effect === 'write') {
    if (ctx.node !== 'act') {
      return deny(`\`${def.name}\` tem efeito real e só executa no nó \`act\`, depois da confirmação humana.`);
    }
    if (!ctx.confirmedByHuman) {
      return {
        code: 'awaiting_approval',
        message: `\`${def.name}\` tem efeito real e ainda não foi confirmada por um humano no gate.`,
        retryable: false,
      };
    }
  }
  return null;
}

function deny(message: string): ToolError {
  return { code: 'denied_by_policy', message, retryable: false };
}

/** Classificação de efeito usada pelo nó `gate` para decidir se interrompe o turno. */
export function hasRealEffect(tool: ToolName, defs: readonly ToolDef[]): boolean {
  return defs.find((d) => d.name === tool)?.effect === 'write';
}
