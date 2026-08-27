/**
 * Nó `fetch` — loop ReAct de LEITURA (ADR-002). Teto: 6 passos.
 *
 * Com chave, quem escolhe a próxima tool é o modelo (é o ponto do ReAct: o passo
 * "olhar o link de destino do criativo" só aparece DEPOIS de observar que o Meta
 * reporta mais conversão do que o CRM atribui). Sem chave, o harness degrada para
 * o roteiro determinístico e diz isso no trace.
 *
 * A allowlist do nó é checada em `executeTool` — o modelo pode pedir `pause_ads`
 * daqui à vontade: volta `denied_by_policy` e o gestor vê a negativa no trace.
 */
import { fetchSteps, type Intent } from '../heuristics';
import { LlmError, type LlmMessage } from '../llm';
import type { Ctx, NodeResult } from '../state';
import { BUDGETS, lastUserText, merge, resolveWindowFallback } from '../state';
import type { HarnessState, PlanStep, ToolName } from '../types';
import { SISTEMA_BASE, callTool, pensar } from './shared';
import { toolDef } from '../tools/registry';

const ORCAMENTO = BUDGETS.fetch;

export async function fetchNode(estado: HarnessState, ctx: Ctx): Promise<NodeResult> {
  const intent = (estado.intent ?? 'pergunta_generica') as Intent;
  const janela = estado.timeWindow ?? resolveWindowFallback();
  let novo = estado;
  const usadas: ToolName[] = [];

  if (ctx.llm) {
    const tools = ORCAMENTO.allowlist.map(toolDef).filter((d): d is NonNullable<typeof d> => Boolean(d));
    const mensagens: LlmMessage[] = [
      {
        role: 'system',
        content: `${SISTEMA_BASE}\nVocê está no nó \`fetch\` de um grafo de estados: só COLETA dado, não conclui. Chame as tools necessárias, uma ou mais por vez. Quando tiver o suficiente para responder, responda em texto (sem tool) resumindo o que coletou.\nVocê tem no máximo ${ORCAMENTO.maxSteps} chamadas neste nó. Janela da análise: ${janela.from} a ${janela.to}. Conta: "housewhey".\nSe o CRM e a mídia discordarem, investigue a URL de destino dos criativos antes de concluir qualquer coisa.`,
      },
      {
        role: 'user',
        content: `Pedido: ${lastUserText(estado)}\nPlano: ${estado.plan.map((p, i) => `${i + 1}. ${p.description}`).join(' ')}${estado.observations.length ? `\nJá observado antes: ${estado.observations.map((o) => o.text.split('\n')[0]).join(' | ')}` : ''}`,
      },
    ];

    while (novo.stepCount.fetch < ORCAMENTO.maxSteps) {
      let resposta;
      try {
        resposta = await ctx.llm.complete({ messages: mensagens, tools });
      } catch (e) {
        pensar(ctx, 'fetch', novo.stepCount.fetch + 1, `${e instanceof LlmError ? e.message : 'Falha inesperada do modelo.'} Sigo a coleta pelo roteiro determinístico.`);
        ctx.llm = null;
        break;
      }
      if (resposta.text.trim()) pensar(ctx, 'fetch', novo.stepCount.fetch + 1, resposta.text.trim());
      if (!resposta.toolCalls.length) break;

      mensagens.push({ role: 'assistant', content: resposta.text, toolCalls: resposta.toolCalls });
      for (const chamada of resposta.toolCalls) {
        if (novo.stepCount.fetch >= ORCAMENTO.maxSteps) break;
        const r = callTool(ctx, novo, 'fetch', { tool: chamada.name, args: chamada.args });
        novo = r.estado;
        if (r.result.ok) {
          usadas.push(r.result.tool);
          mensagens.push({ role: 'tool', toolCallId: chamada.id, content: novo.observations[novo.observations.length - 1]?.text ?? r.result.summary });
        } else {
          if (r.result.error.retryable) return { estado: novo, edge: 'falha_de_tool' };
          mensagens.push({ role: 'tool', toolCallId: chamada.id, content: `ERRO (${r.result.error.code}): ${r.result.error.message}` });
        }
      }
    }
  }

  if (!ctx.llm) {
    for (const passo of fetchSteps(intent, janela)) {
      if (novo.stepCount.fetch >= ORCAMENTO.maxSteps) break;
      if (usadas.includes(passo.tool)) continue;
      pensar(ctx, 'fetch', novo.stepCount.fetch + 1, passo.pensamento);
      const r = callTool(ctx, novo, 'fetch', { tool: passo.tool, args: passo.args, chavePayload: passo.chavePayload });
      novo = r.estado;
      if (r.result.ok) usadas.push(r.result.tool);
      else if (r.result.error.retryable) return { estado: novo, edge: 'falha_de_tool' };
    }
  }

  const plano: PlanStep[] = estado.plan.map((p) => ({
    ...p,
    status: p.expectedTools.length && p.expectedTools.every((t) => usadas.includes(t)) ? 'concluido' : p.status,
  }));
  novo = merge(novo, { plan: plano }, ctx.clock.now());

  if (novo.stepCount.fetch >= ORCAMENTO.maxSteps) {
    pensar(ctx, 'fetch', ORCAMENTO.maxSteps, `Esgotei os ${ORCAMENTO.maxSteps} passos de coleta deste nó. Sigo para a análise com o que tenho e declaro a lacuna se ela existir.`);
  }
  return { estado: novo, edge: 'dados_coletados' };
}
