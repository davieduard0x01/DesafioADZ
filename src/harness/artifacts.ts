/**
 * Materialização dos artefatos do Palco a partir dos payloads das tools.
 *
 * Nada aqui inventa número: todo valor vem de um payload que já passou por uma
 * tool e por um `ToolCallEvent` no trace. O `footnote` das tabelas carrega o que
 * ficou de FORA do agrupamento — é o que impede o artefato de mentir com cara de
 * rigor.
 *
 * Escala de percentual: pontos percentuais (0,72 = 0,72%), como o CTR vem do Meta.
 */
import type { Ctx } from './state';
import type {
  AgendaArtifact,
  AgendaItem,
  CreativeItem,
  CreativeListArtifact,
  CreativeStatus,
  CtaDiffArtifact,
  DiagnosticArtifact,
  Id,
  Json,
  MetricsTableArtifact,
  StageArtifact,
} from './types';
import type { Intent } from './heuristics';

// --- acesso seguro ao payload (é `Json`, não pode virar `any`) --------------

const obj = (j: Json | undefined): Record<string, Json> => (j && typeof j === 'object' && !Array.isArray(j) ? j : {});
const arr = (j: Json | undefined): Json[] => (Array.isArray(j) ? j : []);
const str = (j: Json | undefined, padrao = ''): string => (typeof j === 'string' ? j : padrao);
const num = (j: Json | undefined, padrao = 0): number => (typeof j === 'number' ? j : padrao);
const brl = (n: number): string => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Evidência = os eventos de trace que sustentam o artefato.
 * `ObservationEvent` não carrega o nome da tool no contrato, então a observação
 * é associada ao `tool_call` imediatamente anterior.
 */
function evidenciaDe(ctx: Ctx, tools: string[]): Id[] {
  const ids: Id[] = [];
  let ultimaRelevante = false;
  for (const e of ctx.events) {
    if (e.kind === 'tool_call') {
      ultimaRelevante = tools.includes(e.tool);
      if (ultimaRelevante) ids.push(e.id);
    } else if (e.kind === 'observation' && ultimaRelevante) {
      ids.push(e.id);
    }
  }
  return ids;
}

// --- tabela do cruzamento Meta × CRM por utm_content ------------------------

export function tabelaCruzamento(ctx: Ctx): MetricsTableArtifact | null {
  const meta = obj(ctx.payloads['meta_ads_insights']);
  const crm = obj(ctx.payloads['crm_leads']);
  if (!Object.keys(meta).length || !Object.keys(crm).length) return null;

  const porUtm = new Map<string, { utm: string; canal: string; campanha: string; spend: number; conv: number }>();
  for (const bruta of arr(meta['linhas'])) {
    const l = obj(bruta);
    const utm = str(l['utm_content']);
    if (!utm) continue;
    const a = porUtm.get(utm) ?? { utm, canal: 'Meta', campanha: str(l['campanha']), spend: 0, conv: 0 };
    a.spend += num(l['spend']);
    a.conv += num(l['conversions']);
    porUtm.set(utm, a);
  }
  for (const bruta of arr(obj(ctx.payloads['google_ads_insights'])['linhas'])) {
    const l = obj(bruta);
    const utm = str(l['utm_content']);
    if (!utm) continue;
    const a = porUtm.get(utm) ?? { utm, canal: 'Google', campanha: str(l['campanha']), spend: 0, conv: 0 };
    a.spend += num(l['spend']);
    a.conv += num(l['conversions']);
    porUtm.set(utm, a);
  }

  const leadsPorUtm = new Map<string, { leads: number; ganhos: number; receita: number }>();
  for (const bruta of arr(crm['porUtmContent'])) {
    const l = obj(bruta);
    leadsPorUtm.set(str(l['utm_content']), { leads: num(l['leads']), ganhos: num(l['ganhos']), receita: num(l['receita']) });
  }

  const linhas = [...porUtm.values()]
    .map((m) => {
      const c = leadsPorUtm.get(m.utm) ?? { leads: 0, ganhos: 0, receita: 0 };
      return {
        utm_content: m.utm,
        canal: m.canal,
        gasto: Math.round(m.spend * 100) / 100,
        conversoes_midia: m.conv,
        leads: c.leads,
        cpl: c.leads ? Math.round((m.spend / c.leads) * 100) / 100 : null,
        receita: c.receita,
        roas: m.spend ? Math.round((c.receita / m.spend) * 100) / 100 : null,
      };
    })
    .sort((a, b) => (b.cpl ?? 0) - (a.cpl ?? 0));

  const leadsSemUtm = num(crm['semUtmContent']);
  const receitaSemUtm = num(crm['receitaGanhaSemUtm']);
  const fora = obj(meta['semUtmContent']);
  const gastoSemUtm = num(fora['spend']);
  const convSemUtm = num(fora['conversions']);
  const anuncios = arr(fora['porAnuncio']).map((a) => str(obj(a)['ad_name'])).filter(Boolean);

  const notas = [
    `${leadsSemUtm} lead(s) do CRM chegaram sem utm_content e NÃO entram nesta tabela${receitaSemUtm ? ` (${brl(receitaSemUtm)} de receita ganha)` : ''}.`,
    gastoSemUtm ? `${brl(gastoSemUtm)} de gasto do Meta e ${convSemUtm} conversões também ficam de fora, do(s) anúncio(s) ${anuncios.join(', ')} — a URL parou de carregar UTM.` : '',
    'CPL = gasto ÷ leads atribuídos: para um anúncio com rastreio quebrado ele fica artificialmente alto.',
  ].filter(Boolean);

  const cplValidos = linhas.map((l) => l.cpl).filter((c): c is number => typeof c === 'number');
  const mediana = cplValidos.length ? [...cplValidos].sort((a, b) => a - b)[Math.floor(cplValidos.length / 2)] : 0;

  return {
    kind: 'metrics_table',
    id: 'art-cruzamento',
    title: `Gasto × leads por utm_content · ${str(obj(meta['janela'])['from'])} a ${str(obj(meta['janela'])['to'])}`,
    createdAt: ctx.clock.now(),
    evidence: evidenciaDe(ctx, ['meta_ads_insights', 'google_ads_insights', 'crm_leads']),
    columns: [
      { key: 'utm_content', label: 'utm_content', format: 'texto', align: 'left' },
      { key: 'canal', label: 'Canal', format: 'texto', align: 'left' },
      { key: 'gasto', label: 'Gasto', format: 'moeda_brl', align: 'right' },
      { key: 'conversoes_midia', label: 'Conv. mídia', format: 'inteiro', align: 'right' },
      { key: 'leads', label: 'Leads CRM', format: 'inteiro', align: 'right' },
      { key: 'cpl', label: 'CPL', format: 'moeda_brl', align: 'right', highlight: true },
      { key: 'receita', label: 'Receita', format: 'moeda_brl', align: 'right' },
      { key: 'roas', label: 'ROAS', format: 'decimal_2', align: 'right', highlight: true },
    ],
    rows: linhas,
    flaggedRows: linhas.map((l, i) => (typeof l.cpl === 'number' && l.cpl > mediana * 1.5 ? i : -1)).filter((i) => i >= 0),
    footnote: notas.join(' '),
  };
}

// --- tabela semana a semana do diagnóstico ---------------------------------

export function tabelaSemanal(ctx: Ctx): MetricsTableArtifact | null {
  const diag = obj(ctx.payloads['app_diagnostico']);
  const numeros = obj(diag['numeros']);
  const semanas = arr(numeros['porSemana']);
  if (!semanas.length) return null;

  const rows = semanas.map((bruta) => {
    const s = obj(bruta);
    return {
      semana: `${str(s['semana'])} (${str(s['from']).slice(5)} a ${str(s['to']).slice(5)})`,
      conversoes_meta: num(s['conversoesMeta']),
      leads_atribuidos: num(s['leadsAtribuidos']),
      leads_sem_origem: num(s['leadsSemUtm']),
      receita: num(s['receitaGanha']),
      direct: num(s['sessoesDirect']),
      paid_social: num(s['sessoesPaidSocial']),
    };
  });

  return {
    kind: 'metrics_table',
    id: 'art-semanas',
    title: 'Ômega 3 semana a semana: mídia, CRM e GA4',
    createdAt: ctx.clock.now(),
    evidence: evidenciaDe(ctx, ['app_diagnostico', 'meta_ads_insights', 'crm_leads', 'ga_report']),
    columns: [
      { key: 'semana', label: 'Semana', format: 'texto', align: 'left' },
      { key: 'conversoes_meta', label: 'Conv. Meta', format: 'inteiro', align: 'right', highlight: true },
      { key: 'leads_atribuidos', label: 'Leads com origem', format: 'inteiro', align: 'right', highlight: true },
      { key: 'leads_sem_origem', label: 'Leads sem origem', format: 'inteiro', align: 'right' },
      { key: 'receita', label: 'Receita ganha', format: 'moeda_brl', align: 'right' },
      { key: 'direct', label: 'Sessões direct', format: 'inteiro', align: 'right' },
      { key: 'paid_social', label: 'Sessões paid social', format: 'inteiro', align: 'right' },
    ],
    rows,
    flaggedRows: [rows.length - 2, rows.length - 1].filter((i) => i >= 0),
    footnote: `As linhas só contam leads de Ômega 3. Os leads sem origem NÃO entram em "leads com origem" — o buraco da semana atual é de ${num(numeros['buracoSemanaAtual'])} leads contra ${num(numeros['buracoSemanaAnterior'])} na anterior.`,
  };
}

// --- lista de criativos -----------------------------------------------------

export function listaCriativos(ctx: Ctx): CreativeListArtifact | null {
  const payload = obj(ctx.payloads['list_criativos']);
  const criativos = arr(payload['criativos']);
  if (!criativos.length) return null;

  const itens: CreativeItem[] = [];
  for (const bruto of criativos) {
    const c = obj(bruto);
    const fraco = c['ctaFraco'] === true;
    const encurtado = c['linkEncurtado'] === true;
    if (!fraco && !encurtado) continue;
    const semanas = arr(c['metricasPorSemana']);
    const s4 = obj(semanas[semanas.length - 1]);
    const badges: { label: string; tone: 'neutro' | 'ok' | 'atencao' | 'critico' }[] = [];
    if (fraco) badges.push({ label: `CTA fraco: "${str(c['cta'])}"`, tone: 'critico' });
    if (num(s4['frequency']) >= 4) badges.push({ label: `Frequência ${num(s4['frequency']).toFixed(1).replace('.', ',')}`, tone: 'atencao' });
    if (encurtado) badges.push({ label: 'Rastreio quebrado — NÃO pausar', tone: 'critico' });

    itens.push({
      id: str(c['id']),
      nome: str(c['nome']),
      campanha: str(c['campanha']),
      copy: `${str(obj(c['copy'])['headline'])} — ${str(obj(c['copy'])['corpo'])}`,
      cta: str(c['cta']),
      status: (str(c['status'], 'ativo') as CreativeStatus) ?? 'ativo',
      badges,
      metricas: [
        { label: 'Gasto na semana', valor: brl(num(s4['spend'])) },
        { label: 'CTR', valor: `${num(s4['ctr']).toFixed(2).replace('.', ',')}%` },
        { label: 'Conversões', valor: String(num(s4['conversions'])) },
        { label: 'CPA', valor: brl(num(s4['cpa'])) },
      ],
      motivo: encurtado
        ? `Este anúncio parece caro no CRM porque o link foi trocado por um encurtador e as UTMs pararam de chegar — o Meta registra ${num(s4['conversions'])} conversões na semana. Pausar aqui seria cortar o melhor anúncio da conta.`
        : `CTA "${str(c['cta'])}" é genérico: CTR ${num(s4['ctr']).toFixed(2).replace('.', ',')}% e CPA ${brl(num(s4['cpa']))} na semana atual, com frequência ${num(s4['frequency']).toFixed(1).replace('.', ',')}.`,
    });
  }
  if (!itens.length) return null;

  return {
    kind: 'creative_list',
    id: 'art-criativos',
    title: 'Criativos sinalizados na revisão de CTA',
    createdAt: ctx.clock.now(),
    evidence: evidenciaDe(ctx, ['list_criativos', 'meta_ads_insights']),
    items: itens,
  };
}

// --- diffs de CTA -----------------------------------------------------------

export function diffsDeCta(ctx: Ctx): CtaDiffArtifact[] {
  const payload = obj(ctx.payloads['propose_ctas']);
  return arr(payload['criativos']).map((bruto, i) => {
    const c = obj(bruto);
    return {
      kind: 'cta_diff' as const,
      id: `art-cta-${i + 1}`,
      title: `Variações de CTA — ${str(c['criativoNome'])}`,
      createdAt: ctx.clock.now(),
      evidence: evidenciaDe(ctx, ['propose_ctas', 'list_criativos']),
      criativoId: str(c['criativoId']),
      criativoNome: str(c['criativoNome']),
      ctaAtual: str(c['ctaAtual']),
      copyAtual: str(c['copyAtual']),
      propostas: arr(c['propostas']).map((p) => {
        const v = obj(p);
        return { texto: str(v['texto']), hipotese: str(v['hipotese']), justificativa: str(v['justificativa']) };
      }),
    };
  });
}

// --- diagnóstico ------------------------------------------------------------

export function diagnostico(ctx: Ctx, pergunta: string): DiagnosticArtifact | null {
  const p = obj(ctx.payloads['app_diagnostico']);
  if (!Object.keys(p).length) return null;
  const confianca = str(p['confianca'], 'media');
  return {
    kind: 'diagnostic',
    id: 'art-diagnostico',
    title: 'Diagnóstico — Ômega 3',
    createdAt: ctx.clock.now(),
    evidence: evidenciaDe(ctx, ['app_diagnostico', 'meta_ads_insights', 'crm_leads', 'ga_report', 'list_criativos', 'timeline_query']),
    pergunta: str(p['pergunta'], pergunta),
    veredito: str(p['veredito']),
    confianca: confianca === 'alta' || confianca === 'baixa' ? confianca : 'media',
    causaRaiz: arr(p['causaRaiz']).map((c) => {
      const v = obj(c);
      return { afirmacao: str(v['afirmacao']), evidencia: str(v['evidencia']), fonte: str(v['fonte']) };
    }),
    descartadas: arr(p['descartadas']).map((c) => {
      const v = obj(c);
      return { hipotese: str(v['hipotese']), porque: str(v['porque']) };
    }),
    proximosPassos: arr(p['proximosPassos']).map((c) => {
      const v = obj(c);
      return { acao: str(v['acao']), ...(str(v['dono']) ? { dono: str(v['dono']) } : {}), exigeConfirmacao: v['exigeConfirmacao'] === true };
    }),
  };
}

// --- pauta de reunião -------------------------------------------------------

export function pauta(ctx: Ctx): AgendaArtifact | null {
  const eventos = arr(obj(ctx.payloads['timeline_query'])['eventos']);
  const grafo = obj(ctx.payloads['graph_query']);
  const tarefas = arr(grafo['nos']).map(obj).filter((n) => str(n['kind']) === 'tarefa');
  if (!eventos.length && !tarefas.length) return null;

  const ultimaReuniao = [...eventos].reverse().map(obj).find((e) => str(e['tipo']) === 'reuniao');
  const resumoReuniao = str(ultimaReuniao?.['resumo']);
  const match = /(\d{2})\/(\d{2}).{0,6}?(\d{1,2})h/.exec(resumoReuniao);
  const quando = match ? `2026-${match[2]}-${match[1]}T${match[3].padStart(2, '0')}:00:00-03:00` : str(ultimaReuniao?.['at'], '2026-08-27T10:00:00-03:00');

  const itemDeTarefa = (t: Record<string, Json>): AgendaItem => {
    const props = obj(t['props']);
    const status = str(props['status']);
    return {
      texto: `${str(t['label'])} — ${str(props['impacto'])}`,
      origem: `Supercérebro · tarefa ${str(t['id'])} (desde ${str(props['desde'])}, prazo ${str(props['prazo'])})`,
      prioridade: status === 'aguardando_cliente' || status === 'aguardando_decisao' ? 'alta' : 'media',
      ...(str(props['responsavel']) ? { responsavel: str(props['responsavel']) } : {}),
    };
  };

  const recentes = eventos
    .map(obj)
    .filter((e) => ['whatsapp', 'alerta', 'alteracao_campanha', 'aprovacao'].includes(str(e['tipo'])))
    .slice(-6)
    .map<AgendaItem>((e) => ({
      texto: str(e['resumo']),
      origem: `${str(e['tipo'])} ${str(e['at']).slice(0, 10)} — ${arr(e['atores']).map((a) => str(a)).join(', ')}`,
      prioridade: str(e['tipo']) === 'alerta' || str(e['tipo']) === 'whatsapp' ? 'alta' : 'media',
    }));

  const aguardando = tarefas.filter((t) => str(obj(t['props'])['status']).startsWith('aguardando')).map(itemDeTarefa);
  const emAberto = tarefas.filter((t) => !str(obj(t['props'])['status']).startsWith('aguardando')).map(itemDeTarefa);

  return {
    kind: 'agenda',
    id: 'art-pauta',
    title: 'Pauta — reunião com a Housewhey',
    createdAt: ctx.clock.now(),
    evidence: evidenciaDe(ctx, ['timeline_query', 'graph_query', 'meta_ads_insights', 'crm_leads']),
    cliente: 'Housewhey',
    quando,
    participantes: ['Aline Ferraz (SPOT)', 'Carolina Nunes (SPOT)', 'Luiza Prado (SPOT)', 'Rafael Menezes (Housewhey)', 'Bianca Torres (Housewhey)'],
    blocos: [
      { titulo: 'O que o cliente vai perguntar primeiro', itens: recentes.filter((i) => i.prioridade === 'alta') },
      { titulo: 'Investigação e mudanças da semana', itens: [...emAberto, ...recentes.filter((i) => i.prioridade !== 'alta')] },
    ],
    pendencias: aguardando,
  };
}

// --- orquestração -----------------------------------------------------------

export function buildArtifacts(intent: Intent, ctx: Ctx, pergunta: string): StageArtifact[] {
  const saida: StageArtifact[] = [];
  const push = (a: StageArtifact | null): void => {
    if (a) saida.push(a);
  };
  switch (intent) {
    case 'pausar_ctas_fracos':
      push(listaCriativos(ctx));
      for (const d of diffsDeCta(ctx)) push(d);
      break;
    case 'diagnostico_queda_vendas':
      push(diagnostico(ctx, pergunta));
      push(tabelaSemanal(ctx));
      push(tabelaCruzamento(ctx));
      break;
    case 'pauta_reuniao':
      push(pauta(ctx));
      break;
    case 'cruzamento_utm':
      push(tabelaCruzamento(ctx));
      break;
    default:
      push(tabelaCruzamento(ctx));
      break;
  }
  return saida;
}
