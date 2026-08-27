/**
 * Porta de entrada única das tools: dupla trava de permissão + execução + tempo.
 *
 * Nenhuma tool é chamada direto pelos nós. Tudo passa por `executeTool`, que:
 *   1. resolve a `ToolDef`;
 *   2. checa `NodeBudget.allowlist` E `ToolDef.allowedNodes` (permissions.ts);
 *   3. executa, capturando `ToolFailure` como `ToolResult.ok: false`.
 * Negação nunca vira exceção: vira evento de trace com `denied_by_policy`.
 */
import { checkPermission, type PermissionContext } from '../permissions';
import type { Json, ToolName, ToolResult } from '../types';
import * as read from './read';
import { ToolFailure } from './read';
import * as write from './write';
import { TOOLS, isToolName, toolDef } from './registry';

export { TOOLS, toolDef, isToolName };
export { ToolFailure };
export type { ToolPayload } from './read';

type Impl = (args: Record<string, Json>) => read.ToolPayload;

const IMPLS: Readonly<Record<ToolName, Impl>> = {
  graph_query: read.graph_query,
  timeline_query: read.timeline_query,
  meta_ads_insights: read.meta_ads_insights,
  google_ads_insights: read.google_ads_insights,
  ga_report: read.ga_report,
  crm_leads: read.crm_leads,
  list_criativos: read.list_criativos,
  get_metrics: read.get_metrics,
  app_diagnostico: read.app_diagnostico,
  propose_ctas: read.propose_ctas,
  pause_ads: write.pause_ads,
  send_whatsapp: write.send_whatsapp,
};

export interface ExecutedTool {
  readonly result: ToolResult;
  /** Fonte citável, mesmo quando a chamada falha (aí vem vazia). */
  readonly source: string;
}

export function executeTool(nome: string, argsBrutos: Json, perm: PermissionContext): ExecutedTool {
  const inicio = Date.now();
  if (!isToolName(nome)) {
    // tool inventada pelo modelo — barrada pela mesma porta
    return {
      source: '',
      result: {
        ok: false,
        tool: 'graph_query',
        durationMs: Date.now() - inicio,
        error: { code: 'denied_by_policy', message: `A tool \`${nome}\` não existe neste harness.`, retryable: false },
      },
    };
  }
  const def = toolDef(nome);
  if (!def) throw new Error('inalcançável: tool sem definição');

  const negado = checkPermission(def, perm);
  if (negado) {
    return { source: '', result: { ok: false, tool: nome, error: negado, durationMs: Date.now() - inicio } };
  }

  const args = write.asArgs(argsBrutos);
  try {
    const payload = IMPLS[nome](args);
    return {
      source: payload.source,
      result: { ok: true, tool: nome, data: payload.data, summary: payload.summary, durationMs: Date.now() - inicio, source: payload.source },
    };
  } catch (e) {
    const erro =
      e instanceof ToolFailure
        ? { code: e.code, message: e.message, retryable: e.code === 'upstream' || e.code === 'timeout' }
        : { code: 'upstream' as const, message: `Falha inesperada na tool \`${nome}\`.`, retryable: true };
    return { source: '', result: { ok: false, tool: nome, error: erro, durationMs: Date.now() - inicio } };
  }
}
