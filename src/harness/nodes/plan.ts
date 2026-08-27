/**
 * Nó `plan` — decide o roteiro e quais tools o pedido exige.
 *
 * É a única chamada de LLM puramente deliberativa: não chama tool nenhuma
 * (allowlist vazia) e não olha dado. Plano com ≥1 passo → `precisa_dados`.
 */
import { planFor, type Intent } from '../heuristics';
import { LlmError, extractJson } from '../llm';
import type { Ctx, NodeResult } from '../state';
import { bumpStep, lastUserText, merge, resolveWindowFallback } from '../state';
import type { HarnessState, PlanStep, ToolName } from '../types';
import { SISTEMA_BASE, pensar } from './shared';
import { isToolName } from '../tools/registry';

export async function plan(estado: HarnessState, ctx: Ctx): Promise<NodeResult> {
  const intent = (estado.intent ?? 'pergunta_generica') as Intent;
  const janela = estado.timeWindow ?? resolveWindowFallback();
  let passos: PlanStep[] = planFor(intent, janela, ctx.clock.id);

  if (ctx.llm) {
    try {
      const r = await ctx.llm.complete({
        json: true,
        messages: [
          {
            role: 'system',
            content: `${SISTEMA_BASE}\nVocê está no nó \`plan\` de um grafo de estados. Monte o roteiro do turno. Não chame tool nenhuma aqui.\nTools disponíveis depois: list_criativos, meta_ads_insights, google_ads_insights, ga_report, crm_leads, get_metrics, graph_query, timeline_query (leitura) e app_diagnostico, propose_ctas (análise).\nResponda SÓ com JSON: {"passos": [{"descricao": "...", "tools": ["nome_da_tool"]}]} com 2 a 6 passos.`,
          },
          {
            role: 'user',
            content: `Pedido: ${lastUserText(estado)}\nEntidades resolvidas: ${estado.entities.map((e) => `${e.label} (${e.kind})`).join(', ')}\nJanela: ${janela.from} a ${janela.to} (${janela.mention}).`,
          },
        ],
      });
      const j = extractJson(r.text);
      const brutos = j && Array.isArray(j['passos']) ? j['passos'] : [];
      const doModelo: PlanStep[] = brutos.flatMap((b) => {
        if (!b || typeof b !== 'object' || Array.isArray(b)) return [];
        const descricao = typeof b['descricao'] === 'string' ? b['descricao'] : '';
        if (!descricao) return [];
        const tools = (Array.isArray(b['tools']) ? b['tools'] : []).filter((t): t is ToolName => typeof t === 'string' && isToolName(t));
        return [{ id: ctx.clock.id('step'), description: descricao, expectedTools: tools, status: 'pendente' as const }];
      });
      if (doModelo.length) passos = doModelo;
    } catch (e) {
      pensar(ctx, 'plan', 1, `${e instanceof LlmError ? e.message : 'Falha inesperada do modelo.'} Sigo com o plano determinístico.`);
      ctx.llm = null;
    }
  }

  pensar(ctx, 'plan', 1, `Plano com ${passos.length} passo(s): ${passos.map((p) => p.description).join(' | ')}`);
  const novo = merge(bumpStep(estado, 'plan'), { plan: passos }, ctx.clock.now());

  const precisaDados = passos.some((p) => p.expectedTools.length > 0);
  return { estado: novo, edge: precisaDados ? 'precisa_dados' : 'sem_dados_necessarios' };
}
