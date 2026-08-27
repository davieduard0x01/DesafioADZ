/**
 * Nó `respond` — redige a resposta e materializa os artefatos do Palco.
 *
 * A redação pode ser do modelo, mas os NÚMEROS e os artefatos vêm de
 * `artifacts.ts`, que lê os payloads das tools. O modelo escreve sobre o que já
 * foi apurado; ele não é a fonte de nenhum valor.
 */
import { buildArtifacts } from '../artifacts';
import type { Intent } from '../heuristics';
import { LlmError } from '../llm';
import type { Ctx, NodeResult } from '../state';
import { BUDGETS, bumpStep, lastUserText, merge } from '../state';
import type { AgendaArtifact, DiagnosticArtifact, EdgeName, HarnessState, Json, MetricsTableArtifact, StageArtifact } from '../types';
import { SISTEMA_BASE } from './shared';

const obj = (j: Json | undefined): Record<string, Json> => (j && typeof j === 'object' && !Array.isArray(j) ? j : {});
const arr = (j: Json | undefined): Json[] => (Array.isArray(j) ? j : []);
const str = (j: Json | undefined, d = ''): string => (typeof j === 'string' ? j : d);
const num = (j: Json | undefined, d = 0): number => (typeof j === 'number' ? j : d);
const brl = (n: number): string => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function respond(estado: HarnessState, ctx: Ctx, viaEdge: EdgeName | null): Promise<NodeResult> {
  const intent = (estado.intent ?? 'pergunta_generica') as Intent;
  const pergunta = lastUserText(estado);
  let novo = bumpStep(estado, 'respond');

  const artefatos = viaEdge === 'ambiguidade_de_entidade' ? [] : buildArtifacts(intent, ctx, pergunta);
  for (const a of artefatos) ctx.frame({ type: 'artifact', artifact: a });

  let texto = textoDeterministico(estado, ctx, intent, viaEdge, artefatos);

  if (ctx.llm && viaEdge !== 'ambiguidade_de_entidade') {
    try {
      const r = await ctx.llm.complete({
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: `${SISTEMA_BASE}\nVocê está no nó \`respond\`. Escreva a resposta final ao gestor em 1 a 3 parágrafos curtos, direto ao ponto, citando a origem dos números entre parênteses (ex.: "Meta Ads 17–23/08"). NÃO repita a tabela: ela já está no Palco. Se algum dado ficou de fora do agrupamento, diga quantos.`,
          },
          {
            role: 'user',
            content: `Pedido: ${pergunta}\n\nObservações apuradas:\n${estado.observations.map((o) => `- [${o.source}] ${o.text}`).join('\n')}\n\nArtefatos no Palco: ${artefatos.map((a) => `${a.kind} "${a.title}"`).join(', ') || 'nenhum'}\n\nRascunho determinístico (use como base factual, pode reescrever o texto, NUNCA os números):\n${texto}`,
          },
        ],
      });
      if (r.text.trim()) texto = r.text.trim();
    } catch (e) {
      texto = `${texto}\n\n(Observação: ${e instanceof LlmError ? e.message : 'o modelo falhou ao redigir'} — este texto foi montado pelo próprio harness a partir dos dados apurados.)`;
      ctx.llm = null;
    }
  }

  if (ctx.replay) {
    texto += '\n\n_(Modo replay determinístico: sem chave e sem LLM. As tools, os números e o trace são reais, vindos dos datasets em `data/`; a redação é do próprio harness.)_';
  } else if (!ctx.llm) {
    texto += '\n\n_(Sem modelo disponível neste turno: a coleta, os cálculos e os artefatos são do harness; a redação é determinística.)_';
  }

  if (novo.stepCount.fetch >= BUDGETS.fetch.maxSteps || novo.reactCycles >= 3) {
    texto += `\n\nNota de orçamento: o nó de coleta usou o teto de passos deste turno. Se faltou algo, me diga o recorte e eu volto só nele.`;
  }

  for (const pedaco of texto.match(/[\s\S]{1,90}/g) ?? []) ctx.frame({ type: 'reply_delta', text: pedaco });

  const evento = ctx.emit({ kind: 'assistant_message', node: 'respond', text: texto, artifactIds: artefatos.map((a) => a.id) });
  novo = merge(
    novo,
    {
      // mesmo `id` substitui em vez de duplicar (o gate já pode ter publicado)
      artifacts: [...novo.artifacts.filter((a) => !artefatos.some((n) => n.id === a.id)), ...artefatos],
      messages: [...novo.messages, { id: ctx.clock.id('msg'), role: 'assistant', content: texto, createdAt: evento.at, artifactIds: artefatos.map((a) => a.id) }],
      // a ação negada sai do estado: nada fica pendente para a UI reabrir
      pendingAction: null,
      halt: viaEdge === 'ambiguidade_de_entidade' ? 'needs_clarification' : 'done',
    },
    ctx.clock.now(),
  );
  return { estado: novo, edge: null };
}

// --- redação determinística -------------------------------------------------

function textoDeterministico(estado: HarnessState, ctx: Ctx, intent: Intent, viaEdge: EdgeName | null, artefatos: readonly StageArtifact[]): string {
  if (viaEdge === 'ambiguidade_de_entidade') {
    const duvidosa = estado.entities.find((e) => e.confidence < 0.6);
    const opcoes = duvidosa?.alternatives?.map((a) => a.label).join(', ') ?? 'as linhas de produto da conta';
    return `Não achei "${duvidosa?.mention ?? 'essa entidade'}" no supercérebro da Housewhey, então prefiro perguntar a chutar: você quis dizer alguma destas? ${opcoes}. Me diga qual e eu sigo com a análise na hora.`;
  }

  if (viaEdge === 'acao_negada') {
    const pendente = estado.pendingAction;
    const corpo = textoPorIntencao(estado, ctx, intent, artefatos);
    return `Beleza — não executei nada.${pendente ? ` ${pendente.preview.seNegada}` : ''}\n\n${corpo}`;
  }

  const executada = estado.executedActions[estado.executedActions.length - 1];
  const prefixo = executada
    ? executada.result.ok
      ? `${executada.result.summary}\n\n`
      : `Não consegui concluir a ação: ${executada.result.error.message}\n\n`
    : '';
  return prefixo + textoPorIntencao(estado, ctx, intent, artefatos);
}

function textoPorIntencao(estado: HarnessState, ctx: Ctx, intent: Intent, artefatos: readonly StageArtifact[]): string {
  switch (intent) {
    case 'pausar_ctas_fracos':
      return textoCtas(ctx, artefatos);
    case 'diagnostico_queda_vendas':
      return textoDiagnostico(artefatos);
    case 'pauta_reuniao':
      return textoPauta(artefatos);
    case 'cruzamento_utm':
      return textoCruzamento(artefatos);
    default:
      return textoGenerico(estado);
  }
}

function textoCtas(ctx: Ctx, artefatos: readonly StageArtifact[]): string {
  const lista = artefatos.find((a) => a.kind === 'creative_list');
  const diffs = artefatos.filter((a) => a.kind === 'cta_diff');
  const fracos = lista?.kind === 'creative_list' ? lista.items.filter((i) => i.badges.some((b) => b.label.startsWith('CTA fraco'))) : [];
  const armadilha = lista?.kind === 'creative_list' ? lista.items.find((i) => i.badges.some((b) => b.label.includes('NÃO pausar'))) : undefined;

  const linhas = fracos.map((i) => `• ${i.nome} — CTA "${i.cta}", ${i.metricas.map((m) => `${m.label} ${m.valor}`).join(', ')}`);
  const partes = [
    `Achei ${fracos.length} criativo(s) ativos com CTA da lista de fracos (${['Saiba mais', 'Ver mais', 'Conheça'].join(', ')}):`,
    linhas.join('\n'),
    diffs.length ? `\nPropus 3 variações de CTA para cada um, com a hipótese que cada variação testa — está no Palco. Propor não é publicar: nada subiu.` : '',
  ];
  if (armadilha) {
    partes.push(
      `\nUm aviso importante: **não** incluí o ${armadilha.nome} na lista de pausa, mesmo com o CPA horrível no CRM. ${armadilha.motivo}`,
    );
  }
  const semUtm = num(obj(ctx.payloads['crm_leads'])['semUtmContent']);
  if (semUtm) partes.push(`\nNa janela analisada, ${semUtm} leads chegaram ao CRM sem utm_content e não entram em nenhum CPA por criativo.`);
  return partes.filter(Boolean).join('\n');
}

function textoDiagnostico(artefatos: readonly StageArtifact[]): string {
  const d = artefatos.find((a): a is DiagnosticArtifact => a.kind === 'diagnostic');
  if (!d) return 'Não consegui fechar o diagnóstico com os dados que consegui coletar neste turno.';
  const causas = d.causaRaiz.map((c, i) => `${i + 1}. ${c.afirmacao}\n   Evidência: ${c.evidencia} (${c.fonte})`);
  const descartadas = d.descartadas.map((h) => `• ${h.hipotese} — ${h.porque}`);
  const passos = d.proximosPassos.map((p) => `• ${p.acao}${p.dono ? ` (${p.dono})` : ''}${p.exigeConfirmacao ? ' — precisa da sua confirmação' : ''}`);
  const tabela = artefatos.find((a): a is MetricsTableArtifact => a.kind === 'metrics_table');
  return [
    d.veredito,
    '',
    'Causa-raiz:',
    causas.join('\n'),
    '',
    'Hipóteses que testei e descartei:',
    descartadas.join('\n'),
    '',
    'Próximos passos:',
    passos.join('\n'),
    tabela?.footnote ? `\n${tabela.footnote}` : '',
  ].filter((l) => l !== undefined).join('\n');
}

function textoPauta(artefatos: readonly StageArtifact[]): string {
  const p = artefatos.find((a): a is AgendaArtifact => a.kind === 'agenda');
  if (!p) return 'Não consegui montar a pauta: faltou memória da conta neste turno.';
  const blocos = p.blocos.map((b) => `${b.titulo}:\n${b.itens.map((i) => `• ${i.texto} (${i.origem})`).join('\n')}`);
  const pend = p.pendencias?.length ? `\nTravado esperando o cliente:\n${p.pendencias.map((i) => `• ${i.texto} (${i.origem})`).join('\n')}` : '';
  return [`Pauta da reunião com a ${p.cliente} em ${p.quando.slice(8, 10)}/${p.quando.slice(5, 7)} às ${p.quando.slice(11, 16)}:`, '', blocos.join('\n\n'), pend].join('\n');
}

function textoCruzamento(artefatos: readonly StageArtifact[]): string {
  const t = artefatos.find((a): a is MetricsTableArtifact => a.kind === 'metrics_table');
  if (!t) return 'Não consegui montar o cruzamento: faltou o gasto de mídia ou os leads do CRM.';
  const caras = (t.flaggedRows ?? []).map((i) => t.rows[i]).filter(Boolean);
  const linhas = caras.map((r) => `• ${String(r['utm_content'])} — ${brl(num(r['gasto'] as Json))} para ${num(r['leads'] as Json)} lead(s), CPL ${r['cpl'] === null ? 'sem lead atribuído' : brl(num(r['cpl'] as Json))}, ROAS ${r['roas'] === null ? '—' : num(r['roas'] as Json).toFixed(2)}`);
  return [
    `Cruzei o gasto do Meta e do Google com os leads do CRM por utm_content. O que está caro:`,
    linhas.join('\n') || '• Nenhuma linha ficou acima de 1,5× o CPL mediano da conta.',
    '',
    t.footnote ?? '',
  ].join('\n');
}

function textoGenerico(estado: HarnessState): string {
  const linhas = estado.observations.map((o) => `• ${o.text.split('\n')[0]} (${o.source})`);
  return [`Levantei o que dá para afirmar com os dados da conta:`, linhas.join('\n') || '• Não consegui coletar dado nenhum neste turno.'].join('\n');
}

/** exportado para os testes */
export const _internals = { textoDeterministico, arr, str };
