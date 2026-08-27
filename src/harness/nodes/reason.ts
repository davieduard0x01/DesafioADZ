/**
 * Nó `reason` — loop ReAct de ANÁLISE. Teto: 4 passos.
 *
 * Aqui não se coleta dado de API: só Apps de metodologia e supercérebro. As
 * quatro saídas do nó são as do diagrama:
 *   - observações acima do orçamento → `orcamento_de_contexto_estourado` (compact)
 *   - falta um dado nomeado e ainda há ciclo → `lacuna_de_dado` (volta ao fetch)
 *   - conclusão que pede efeito real → `conclusao_pede_acao` (gate)
 *   - conclusão sem efeito real → `conclusao_sem_acao` (respond)
 * Não existe edge `reason → act`: é a garantia estrutural do gate.
 */
import { proposedAction, reasonSteps, type Intent } from '../heuristics';
import { LlmError, extractJson, type LlmMessage } from '../llm';
import type { Ctx, NodeResult } from '../state';
import { BUDGETS, MAX_REACT_CYCLES, lastUserText, merge, observationTokens, resolveWindowFallback } from '../state';
import type { HarnessState, Json, ToolName } from '../types';
import { SISTEMA_BASE, callTool, pensar } from './shared';
import { toolDef } from '../tools/registry';

const ORCAMENTO = BUDGETS.reason;

const REQUERIDOS: Readonly<Record<Intent, ToolName[]>> = {
  pausar_ctas_fracos: ['list_criativos', 'meta_ads_insights'],
  diagnostico_queda_vendas: ['meta_ads_insights', 'crm_leads', 'list_criativos'],
  pauta_reuniao: ['timeline_query', 'graph_query'],
  cruzamento_utm: ['meta_ads_insights', 'crm_leads'],
  pergunta_generica: [],
};

/** Criativos de CTA fraco, tirados do payload da tool (não do dataset direto). */
function alvosDePausa(ctx: Ctx): { nome: string; motivo: string }[] {
  const payload = ctx.payloads['list_criativos'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const criativos = payload['criativos'];
  if (!Array.isArray(criativos)) return [];
  return criativos.flatMap((bruto) => {
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return [];
    if (bruto['ctaFraco'] !== true || bruto['status'] !== 'ativo') return [];
    // o anúncio com link encurtado fica FORA: ele parece caro porque o rastreio quebrou
    if (bruto['linkEncurtado'] === true) return [];
    const nome = typeof bruto['nome'] === 'string' ? bruto['nome'] : '';
    const cta = typeof bruto['cta'] === 'string' ? bruto['cta'] : '';
    return nome ? [{ nome, motivo: `CTA "${cta}" genérico com CTR e CPA fora do padrão da conta.` }] : [];
  });
}

export async function reason(estado: HarnessState, ctx: Ctx): Promise<NodeResult> {
  const intent = (estado.intent ?? 'pergunta_generica') as Intent;
  const janela = estado.timeWindow ?? resolveWindowFallback();

  const tokens = observationTokens(estado.observations);
  if (tokens > ORCAMENTO.maxObservationTokens) {
    pensar(ctx, 'reason', 1, `As observações somam ~${tokens} tokens, acima do orçamento de ${ORCAMENTO.maxObservationTokens} deste nó. Compacto antes de analisar, preservando números e fontes.`);
    return { estado, edge: 'orcamento_de_contexto_estourado' };
  }

  const coletadas = new Set(estado.observations.map((o) => o.tool));
  const faltando = REQUERIDOS[intent].filter((t) => !coletadas.has(t));
  if (faltando.length && estado.reactCycles < MAX_REACT_CYCLES) {
    pensar(ctx, 'reason', 1, `Falta dado nomeado para concluir: ${faltando.join(', ')}. Volto ao fetch (ciclo ${estado.reactCycles + 1} de ${MAX_REACT_CYCLES}).`);
    return { estado: merge(estado, { reactCycles: estado.reactCycles + 1 }, ctx.clock.now()), edge: 'lacuna_de_dado' };
  }

  let novo = estado;
  const alvos = alvosDePausa(ctx);

  if (ctx.llm) {
    const tools = ORCAMENTO.allowlist.map(toolDef).filter((d): d is NonNullable<typeof d> => Boolean(d));
    const mensagens: LlmMessage[] = [
      {
        role: 'system',
        content: `${SISTEMA_BASE}\nVocê está no nó \`reason\`: cruze as observações, teste e DESCARTE hipóteses. Você pode chamar os apps de metodologia (app_diagnostico, propose_ctas) e o supercérebro. Você NÃO pode pausar anúncio nem mandar mensagem daqui — isso é decisão do gate, depois de um humano confirmar.\nMáximo de ${ORCAMENTO.maxSteps} chamadas. Janela: ${janela.from} a ${janela.to}.`,
      },
      {
        role: 'user',
        content: `Pedido: ${lastUserText(estado)}\nObservações coletadas:\n${estado.observations.map((o) => `- [${o.source}] ${o.text}`).join('\n')}`,
      },
    ];

    while (novo.stepCount.reason < ORCAMENTO.maxSteps) {
      let resposta;
      try {
        resposta = await ctx.llm.complete({ messages: mensagens, tools });
      } catch (e) {
        pensar(ctx, 'reason', novo.stepCount.reason + 1, `${e instanceof LlmError ? e.message : 'Falha inesperada do modelo.'} Concluo com o roteiro determinístico.`);
        ctx.llm = null;
        break;
      }
      if (resposta.text.trim()) pensar(ctx, 'reason', novo.stepCount.reason + 1, resposta.text.trim());
      if (!resposta.toolCalls.length) break;
      mensagens.push({ role: 'assistant', content: resposta.text, toolCalls: resposta.toolCalls });
      for (const chamada of resposta.toolCalls) {
        if (novo.stepCount.reason >= ORCAMENTO.maxSteps) break;
        const r = callTool(ctx, novo, 'reason', { tool: chamada.name, args: chamada.args });
        novo = r.estado;
        mensagens.push({
          role: 'tool',
          toolCallId: chamada.id,
          content: r.result.ok ? novo.observations[novo.observations.length - 1]?.text ?? r.result.summary : `ERRO (${r.result.error.code}): ${r.result.error.message}`,
        });
      }
    }

    if (ctx.llm) {
      try {
        const decisao = await ctx.llm.complete({
          json: true,
          messages: [
            ...mensagens,
            {
              role: 'user',
              content:
                'Feche a análise. Responda SÓ com JSON: {"conclusao":"1 parágrafo","precisaAcaoComEfeitoReal":true|false,"acao":{"tool":"pause_ads"|"send_whatsapp","args":{...}}|null,"lacuna":"o que não deu para verificar, ou vazio"}. Só proponha ação se o gestor pediu explicitamente algo que muda o mundo (pausar anúncio, enviar mensagem).',
            },
          ],
        });
        const j = extractJson(decisao.text);
        if (j) {
          if (typeof j['conclusao'] === 'string' && j['conclusao']) pensar(ctx, 'reason', novo.stepCount.reason, j['conclusao']);
          const acao = j['acao'];
          if (j['precisaAcaoComEfeitoReal'] === true && acao && typeof acao === 'object' && !Array.isArray(acao)) {
            const nome = typeof acao['tool'] === 'string' ? acao['tool'] : '';
            const def = toolDef(nome as ToolName);
            if (def?.effect === 'write') {
              ctx.proposta = { tool: def.name, args: (acao['args'] ?? {}) as Json };
              return { estado: novo, edge: 'conclusao_pede_acao' };
            }
          }
        }
      } catch (e) {
        pensar(ctx, 'reason', novo.stepCount.reason, `${e instanceof LlmError ? e.message : 'Falha do modelo ao fechar a análise.'} Uso o desfecho determinístico.`);
        ctx.llm = null;
      }
      if (ctx.llm) return { estado: novo, edge: 'conclusao_sem_acao' };
    }
  }

  // caminho determinístico
  for (const passo of reasonSteps(intent, janela, alvos.map((a) => a.nome))) {
    if (novo.stepCount.reason >= ORCAMENTO.maxSteps) break;
    pensar(ctx, 'reason', novo.stepCount.reason + 1, passo.pensamento);
    const r = callTool(ctx, novo, 'reason', { tool: passo.tool, args: passo.args, chavePayload: passo.chavePayload });
    novo = r.estado;
  }

  const acao = proposedAction(intent, alvos);
  if (acao) {
    pensar(ctx, 'reason', novo.stepCount.reason, `${alvos.length} criativo(s) com CTA fraco justificam pausa. Isso tem efeito real: proponho ao gate em vez de executar.`);
    ctx.proposta = acao;
    return { estado: novo, edge: 'conclusao_pede_acao' };
  }
  return { estado: novo, edge: 'conclusao_sem_acao' };
}
