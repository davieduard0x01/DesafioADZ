/**
 * Nó `interpret` — resolve intenção e entidades ANTES de qualquer API (ADR-004).
 *
 * Divisão de trabalho: o modelo interpreta a linguagem ("a Ômega 3", "essa
 * semana"); a tool `graph_query` resolve o termo em id do supercérebro; o código
 * calcula a confiança. Abaixo de 0,6 o nó sai por `ambiguidade_de_entidade` e
 * pergunta — não chuta.
 */
import { classifyIntent, resolveEntities, resolveWindow } from '../heuristics';
import { LlmError, extractJson } from '../llm';
import type { Ctx, NodeResult } from '../state';
import { lastUserText, merge } from '../state';
import type { HarnessState, ResolvedEntity } from '../types';
import { SISTEMA_BASE, callTool, pensar } from './shared';

const CONFIANCA_MINIMA = 0.6;

export async function interpret(estado: HarnessState, ctx: Ctx): Promise<NodeResult> {
  const pedido = lastUserText(estado);
  let intent = classifyIntent(pedido);
  let janela = resolveWindow(pedido);

  if (ctx.llm) {
    try {
      const r = await ctx.llm.complete({
        json: true,
        messages: [
          {
            role: 'system',
            content: `${SISTEMA_BASE}\nClassifique o pedido do gestor. Responda SÓ com JSON: {"intent": "pausar_ctas_fracos"|"diagnostico_queda_vendas"|"pauta_reuniao"|"cruzamento_utm"|"pergunta_generica", "janela": {"from":"YYYY-MM-DD","to":"YYYY-MM-DD","mention":"como o gestor falou"}, "raciocinio": "uma frase"}\nSemanas fechadas do dataset: S3 = 2026-08-10..2026-08-16, S4 (semana atual) = 2026-08-17..2026-08-23.`,
          },
          { role: 'user', content: pedido },
        ],
      });
      const j = extractJson(r.text);
      if (j) {
        const i = typeof j['intent'] === 'string' ? j['intent'] : '';
        if (['pausar_ctas_fracos', 'diagnostico_queda_vendas', 'pauta_reuniao', 'cruzamento_utm', 'pergunta_generica'].includes(i)) {
          intent = i as typeof intent;
        }
        const jw = j['janela'];
        if (jw && typeof jw === 'object' && !Array.isArray(jw) && typeof jw['from'] === 'string' && typeof jw['to'] === 'string') {
          janela = { ...janela, from: jw['from'], to: jw['to'], mention: typeof jw['mention'] === 'string' ? jw['mention'] : janela.mention };
        }
        pensar(ctx, 'interpret', 1, typeof j['raciocinio'] === 'string' ? j['raciocinio'] : `Intenção classificada como ${intent}.`);
      }
    } catch (e) {
      degradar(ctx, e);
    }
  }

  if (!ctx.llm) {
    pensar(ctx, 'interpret', 1, `O pedido não nomeia ids. Classifiquei a intenção como "${intent}" e a janela como ${janela.from}..${janela.to} (${janela.mention}). Agora resolvo as entidades no supercérebro antes de tocar em qualquer API.`);
  }

  // Resolução de entidade SEMPRE passa pelo supercérebro, via tool.
  const candidatas = resolveEntities(pedido, ctx.clock.id);
  const alvo = candidatas.find((e) => e.confidence >= CONFIANCA_MINIMA && e.kind !== 'conta') ?? candidatas[0];
  const chamada = callTool(ctx, estado, 'interpret', {
    tool: 'graph_query',
    args: alvo && alvo.confidence >= CONFIANCA_MINIMA ? { id: alvo.id, profundidade: 1 } : { tipo: 'conta' },
    chavePayload: 'graph_query:interpret',
  });
  let novo = chamada.estado;

  const entidades: ResolvedEntity[] = chamada.result.ok
    ? candidatas
    : candidatas.map((e) => ({ ...e, confidence: Math.min(e.confidence, 0.5) }));

  const duvidosa = entidades.find((e) => e.confidence < CONFIANCA_MINIMA);
  novo = merge(novo, { intent, entities: entidades, timeWindow: janela }, ctx.clock.now());

  if (duvidosa) {
    pensar(ctx, 'interpret', novo.stepCount.interpret + 1, `"${duvidosa.mention}" não bate com nenhuma entidade do supercérebro (confiança ${duvidosa.confidence.toFixed(2)}). Perguntar é mais barato que chutar.`);
    return { estado: novo, edge: 'ambiguidade_de_entidade' };
  }
  return { estado: novo, edge: 'entidades_resolvidas' };
}

function degradar(ctx: Ctx, e: unknown): void {
  const msg = e instanceof LlmError ? e.message : 'O modelo falhou de forma inesperada.';
  pensar(ctx, 'interpret', 1, `${msg} Sigo com o roteiro determinístico do harness e sinalizo isso na resposta.`);
  ctx.llm = null;
}
