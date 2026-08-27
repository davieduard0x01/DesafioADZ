/**
 * As 10 tools de LEITURA. Assinaturas conforme docs/arquitetura/tools.md.
 *
 * Cada uma devolve `{ data, summary, source }`: `summary` é a linha que o trace
 * e a UI mostram, `source` é a origem citável — o campo que permite ao gestor
 * responder "como você sabe disso?" na frente do cliente.
 *
 * Toda conta numérica sai daqui já fechada por `aggregate.ts`. O modelo recebe
 * resultado, não planilha.
 */
import { asJson, criativos, ga, googleAds, metaAds, source, supercerebro, timeline } from '../datasets';
import type { Json } from '../types';
import {
  agregarCrm,
  agruparMeta,
  analisarAtribuicao,
  arred,
  cruzarMetaCrm,
  dentro,
  gastoSemUtm,
  janelaAnterior,
  leadsBrutos,
  SEMANA_ATUAL,
} from './aggregate';

export interface ToolPayload {
  readonly data: Json;
  readonly summary: string;
  readonly source: string;
}

/** Erro de tool que vira `ToolResult.ok: false` — nunca escapa como exceção. */
export class ToolFailure extends Error {
  readonly code: 'not_found' | 'bad_args' | 'upstream' | 'timeout';
  constructor(code: ToolFailure['code'], message: string) {
    super(message);
    this.name = 'ToolFailure';
    this.code = code;
  }
}

// --- leitura de argumentos (o modelo alucina campo; aqui isso vira bad_args) --

type Args = Record<string, Json>;

function texto(args: Args, chave: string, obrigatorio = false, padrao = ''): string {
  const v = args[chave];
  if (typeof v === 'string' && v.length) return v;
  if (obrigatorio) throw new ToolFailure('bad_args', `Argumento \`${chave}\` é obrigatório e precisa ser texto.`);
  return padrao;
}

function data(args: Args, chave: string, padrao: string): string {
  const v = args[chave];
  if (typeof v !== 'string' || !v) return padrao;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ToolFailure('bad_args', `Argumento \`${chave}\` precisa ser uma data ISO (YYYY-MM-DD). Recebi "${v}".`);
  return v;
}

function lista(args: Args, chave: string): string[] {
  const v = args[chave];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v) return [v];
  return [];
}

function numero(args: Args, chave: string, padrao: number): number {
  const v = args[chave];
  return typeof v === 'number' && Number.isFinite(v) ? v : padrao;
}

function booleano(args: Args, chave: string): boolean {
  return args[chave] === true;
}

const JANELA_PADRAO = { from: SEMANA_ATUAL.from, to: SEMANA_ATUAL.to };

/** Dinheiro em PT-BR: o preview e a evidência são lidos por gestor, não por dev. */
const brl = (n: number): string => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// --- supercérebro -----------------------------------------------------------

export function graph_query(args: Args): ToolPayload {
  const { nodes, edges } = supercerebro();
  const tipo = texto(args, 'tipo');
  const id = texto(args, 'id');
  const busca = texto(args, 'texto').toLowerCase();
  const relacionadoA = texto(args, 'relacionadoA');
  const profundidade = numero(args, 'profundidade', 1);

  let selecionados = nodes;
  if (id) selecionados = selecionados.filter((n) => n.id === id);
  if (tipo) selecionados = selecionados.filter((n) => n.type === tipo || (tipo === 'conta' && n.type === 'cliente'));
  if (busca) {
    selecionados = selecionados.filter(
      (n) => n.label.toLowerCase().includes(busca) || n.id.toLowerCase().includes(busca) || JSON.stringify(n.props ?? {}).toLowerCase().includes(busca),
    );
  }
  if (relacionadoA) {
    const alcancados = new Set<string>([relacionadoA]);
    for (let nivel = 0; nivel < profundidade; nivel++) {
      for (const e of edges) {
        if (alcancados.has(e.from)) alcancados.add(e.to);
        else if (alcancados.has(e.to)) alcancados.add(e.from);
      }
    }
    selecionados = nodes.filter((n) => alcancados.has(n.id) && (!tipo || n.type === tipo));
  }
  if (!selecionados.length) throw new ToolFailure('not_found', 'Nenhuma entidade do supercérebro bate com esse filtro.');

  const ids = new Set(selecionados.map((n) => n.id));
  const arestas = edges.filter((e) => ids.has(e.from) || ids.has(e.to)).map((e) => ({ de: e.from, relacao: e.rel, alvoId: e.to }));

  return {
    data: asJson({
      nos: selecionados.map((n) => ({ id: n.id, kind: n.type, label: n.label, props: n.props ?? {} })),
      arestas,
    }),
    summary: `${selecionados.length} entidade(s) no supercérebro: ${selecionados.slice(0, 4).map((n) => n.label).join(', ')}${selecionados.length > 4 ? '…' : ''}.`,
    source: source('supercerebro.json'),
  };
}

export function timeline_query(args: Args): ToolPayload {
  const entidadeId = texto(args, 'entidadeId');
  const from = texto(args, 'from');
  const to = texto(args, 'to');
  const tipos = lista(args, 'tipos');
  const limite = numero(args, 'limite', 20);

  const eventos = timeline()
    .eventos.filter((e) => {
      if (entidadeId && !e.entidades.includes(entidadeId)) return false;
      if (from && e.ts.slice(0, 10) < from) return false;
      if (to && e.ts.slice(0, 10) > to) return false;
      if (tipos.length && !tipos.includes(e.tipo)) return false;
      return true;
    })
    .slice(-limite)
    .map((e) => ({
      at: e.ts,
      tipo: e.tipo,
      titulo: e.resumo.split('. ')[0].slice(0, 110),
      resumo: e.resumo,
      atores: [e.ator],
      entidadesIds: e.entidades,
      ...(e.trecho ? { trecho: e.trecho } : {}),
    }));

  return {
    data: asJson({ eventos }),
    summary: eventos.length ? `${eventos.length} evento(s) na linha do tempo, de ${eventos[0].at.slice(0, 10)} a ${eventos[eventos.length - 1].at.slice(0, 10)}.` : 'Nenhum evento na linha do tempo para esse filtro.',
    source: source('timeline.json'),
  };
}

// --- APIs -------------------------------------------------------------------

export function meta_ads_insights(args: Args): ToolPayload {
  const from = data(args, 'from', JANELA_PADRAO.from);
  const to = data(args, 'to', JANELA_PADRAO.to);
  const brutoBreakdown = texto(args, 'breakdown', false, 'ad');
  const breakdown = brutoBreakdown === 'campaign' || brutoBreakdown === 'adset' ? brutoBreakdown : 'ad';
  const linhas = agruparMeta(from, to, breakdown);
  if (!linhas.length) throw new ToolFailure('not_found', `Sem linhas do Meta Ads entre ${from} e ${to}.`);

  const totais = {
    spend: arred(linhas.reduce((s, l) => s + l.spend, 0)),
    conversions: linhas.reduce((s, l) => s + l.conversions, 0),
  };
  const buraco = gastoSemUtm(from, to);
  const comparar = booleano(args, 'comparar');
  const anterior = comparar ? janelaAnterior(from, to) : null;

  return {
    data: asJson({
      janela: { from, to },
      breakdown,
      linhas,
      totais,
      semUtmContent: buraco,
      ...(anterior
        ? {
            comparacao: {
              janela: anterior,
              linhas: agruparMeta(anterior.from, anterior.to, breakdown),
            },
          }
        : {}),
    }),
    summary: `Meta Ads ${from}..${to} por ${breakdown}: R$ ${totais.spend.toFixed(2)} e ${totais.conversions} conversões em ${linhas.length} linha(s).${buraco.spend ? ` R$ ${buraco.spend.toFixed(2)} sem utm_content.` : ''}`,
    source: source('meta_ads.json', from, to),
  };
}

export function google_ads_insights(args: Args): ToolPayload {
  const from = data(args, 'from', JANELA_PADRAO.from);
  const to = data(args, 'to', JANELA_PADRAO.to);
  const linhas = googleAds().insights.filter((i) => dentro(i.date, from, to));
  if (!linhas.length) throw new ToolFailure('not_found', `Sem linhas do Google Ads entre ${from} e ${to}.`);
  const mapa = new Map<string, { campanha: string; utm_content: string; spend: number; clicks: number; conversions: number }>();
  for (const i of linhas) {
    const a = mapa.get(i.campaign) ?? { campanha: i.campaign, utm_content: i.utm_content, spend: 0, clicks: 0, conversions: 0 };
    a.spend += i.spend;
    a.clicks += i.clicks;
    a.conversions += i.conversions;
    mapa.set(i.campaign, a);
  }
  const agregado = [...mapa.values()].map((a) => ({ ...a, spend: arred(a.spend), cpa: a.conversions ? arred(a.spend / a.conversions) : null }));
  return {
    data: asJson({ janela: { from, to }, linhas: agregado }),
    summary: `Google Ads ${from}..${to}: ${agregado.map((a) => `${a.campanha} R$ ${a.spend.toFixed(0)}/${a.conversions} conv`).join(' · ')}.`,
    source: source('google_ads.json', from, to),
  };
}

export function ga_report(args: Args): ToolPayload {
  const from = data(args, 'from', JANELA_PADRAO.from);
  const to = data(args, 'to', JANELA_PADRAO.to);
  const dimensoes = lista(args, 'dimensoes');
  const porLanding = dimensoes.some((d) => d.toLowerCase().includes('landing'));
  const base = ga();

  if (porLanding) {
    const mapa = new Map<string, { landing_page: string; sessions: number; conversoes: number }>();
    for (const l of base.sessoes_por_landing_page_dia.filter((x) => dentro(x.date, from, to))) {
      const a = mapa.get(l.landing_page) ?? { landing_page: l.landing_page, sessions: 0, conversoes: 0 };
      a.sessions += l.sessions;
      a.conversoes += l.conversoes;
      mapa.set(l.landing_page, a);
    }
    const linhas = [...mapa.values()].sort((a, b) => b.sessions - a.sessions);
    return {
      data: asJson({ janela: { from, to }, dimensao: 'landingPage', linhas }),
      summary: `GA4 ${from}..${to} por landing page: ${linhas.slice(0, 3).map((l) => `${l.landing_page} ${l.sessions}`).join(' · ')}.`,
      source: source('ga.json', from, to),
    };
  }

  const mapa = new Map<string, { canal: string; source: string; medium: string; sessions: number; usuarios: number; conversoes: number }>();
  for (const l of base.sessoes_por_canal_dia.filter((x) => dentro(x.date, from, to))) {
    const a = mapa.get(l.canal_agrupado) ?? { canal: l.canal_agrupado, source: l.source, medium: l.medium, sessions: 0, usuarios: 0, conversoes: 0 };
    a.sessions += l.sessions;
    a.usuarios += l.usuarios;
    a.conversoes += l.conversoes;
    mapa.set(l.canal_agrupado, a);
  }
  const linhas = [...mapa.values()].sort((a, b) => b.sessions - a.sessions);
  const anterior = janelaAnterior(from, to);
  const direct = linhas.find((l) => l.canal === 'direct');
  const directAntes = base.sessoes_por_canal_dia
    .filter((x) => dentro(x.date, anterior.from, anterior.to) && x.canal_agrupado === 'direct')
    .reduce((s, x) => s + x.sessions, 0);

  return {
    data: asJson({
      janela: { from, to },
      dimensao: 'canal',
      linhas,
      comparacaoDirect: { janelaAnterior: anterior, sessoesAntes: directAntes, sessoesAgora: direct?.sessions ?? 0 },
    }),
    summary: `GA4 ${from}..${to}: ${linhas.map((l) => `${l.canal} ${l.sessions}`).join(' · ')}. Direct saiu de ${directAntes} para ${direct?.sessions ?? 0} sessões.`,
    source: source('ga.json', from, to),
  };
}

export function crm_leads(args: Args): ToolPayload {
  const from = data(args, 'from', JANELA_PADRAO.from);
  const to = data(args, 'to', JANELA_PADRAO.to);
  const estagio = texto(args, 'estagio');
  const incluirSemUtm = booleano(args, 'incluirSemUtm');
  const utmContent = args['utmContent'] === null ? null : texto(args, 'utmContent') || undefined;

  const agg = agregarCrm(from, to, estagio ? { estagio } : undefined);
  const brutos = leadsBrutos(from, to, { estagio: estagio || undefined, utmContent: utmContent ?? (args['utmContent'] === null ? null : undefined), incluirSemUtm });
  const amostraSemUtm = brutos.filter((l) => !l.utm_content).slice(0, 5);

  return {
    data: asJson({
      janela: { from, to },
      total: agg.total,
      atribuidos: agg.total - agg.semUtm,
      semUtmContent: agg.semUtm,
      ganhos: agg.ganhos,
      receitaGanha: agg.receita,
      receitaGanhaSemUtm: agg.receitaSemUtm,
      porUtmContent: agg.porUtm,
      ...(incluirSemUtm
        ? {
            amostraSemUtm: amostraSemUtm.map((l) => ({
              lead_id: l.lead_id,
              criadoEm: l.created_at,
              estagio: l.estagio,
              valor: l.valor,
              produto: l.produto,
              utm_content: l.utm_content || null,
              origemDeclarada: l.canal_relatado,
            })),
          }
        : {}),
    }),
    summary: `CRM ${from}..${to}: ${agg.total} leads, ${agg.total - agg.semUtm} com utm_content e ${agg.semUtm} sem. Receita ganha R$ ${agg.receita.toFixed(2)}${incluirSemUtm ? ` (R$ ${agg.receitaSemUtm.toFixed(2)} vem de leads sem origem)` : ''}.`,
    source: source('crm.json', from, to),
  };
}

export function list_criativos(args: Args): ToolPayload {
  const status = lista(args, 'status');
  const campanhaId = texto(args, 'campanhaId');
  const lista_ = criativos()
    .criativos.filter((c) => (!status.length || status.includes(c.status)) && (!campanhaId || c.campanha.toLowerCase().includes(campanhaId.toLowerCase()) || c.id === campanhaId))
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      campanha: c.campanha,
      produto: c.produto,
      formato: c.formato,
      copy: c.copy,
      cta: c.cta,
      ctaFraco: criativos().ctas_fracos.includes(c.cta),
      status: c.status,
      linkDestino: c.link,
      linkOriginal: c.link_original ?? null,
      linkEncurtado: Boolean(c.link_original && c.link && c.link !== c.link_original),
      utm_content: c.utm_content || null,
      metricas: c.metricas,
      metricasPorSemana: c.metricas_por_semana,
      ...(c.aprovacao ? { aprovacao: c.aprovacao } : {}),
      ...(c.observacao ? { observacao: c.observacao } : {}),
    }));
  if (!lista_.length) throw new ToolFailure('not_found', 'Nenhum criativo bate com esse filtro.');

  const encurtados = lista_.filter((c) => c.linkEncurtado).map((c) => c.nome);
  return {
    data: asJson({ criativos: lista_, ctasFracos: criativos().ctas_fracos }),
    summary: `${lista_.length} criativo(s); ${lista_.filter((c) => c.ctaFraco).length} com CTA da lista de fracos${encurtados.length ? `; link encurtado em: ${encurtados.join(', ')}` : ''}.`,
    source: source('criativos.json'),
  };
}

export function get_metrics(args: Args): ToolPayload {
  const from = data(args, 'from', JANELA_PADRAO.from);
  const to = data(args, 'to', JANELA_PADRAO.to);
  const entidadeIds = lista(args, 'entidadeIds');
  const metricas = lista(args, 'metricas');
  const granularidade = texto(args, 'granularidade', false, 'dia') === 'semana' ? 'semana' : 'dia';
  const campos = metricas.length ? metricas : ['spend', 'conversions', 'ctr'];

  const linhas = metaAds().insights.filter(
    (i) => dentro(i.date, from, to) && (!entidadeIds.length || entidadeIds.includes(i.ad_id) || entidadeIds.includes(i.ad_name) || entidadeIds.includes(i.campaign_id) || entidadeIds.includes(i.campaign)),
  );
  if (!linhas.length) throw new ToolFailure('not_found', 'Sem série temporal para essas entidades no período.');

  const chaveTempo = (dataStr: string) => (granularidade === 'dia' ? dataStr : `semana de ${new Date(Date.parse(dataStr) - ((new Date(dataStr).getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10)}`);
  const mapa = new Map<string, { entidade: string; ponto: string; spend: number; conversions: number; clicks: number; impressions: number }>();
  for (const i of linhas) {
    const k = `${i.ad_name}|${chaveTempo(i.date)}`;
    const a = mapa.get(k) ?? { entidade: i.ad_name, ponto: chaveTempo(i.date), spend: 0, conversions: 0, clicks: 0, impressions: 0 };
    a.spend += i.spend;
    a.conversions += i.conversions;
    a.clicks += i.clicks;
    a.impressions += i.impressions;
    mapa.set(k, a);
  }
  const serie = [...mapa.values()].map((p) => {
    const linha: Record<string, string | number> = { entidade: p.entidade, ponto: p.ponto };
    if (campos.includes('spend')) linha.spend = arred(p.spend);
    if (campos.includes('conversions')) linha.conversions = p.conversions;
    if (campos.includes('clicks')) linha.clicks = p.clicks;
    if (campos.includes('impressions')) linha.impressions = p.impressions;
    if (campos.includes('ctr')) linha.ctr = p.impressions ? arred((p.clicks / p.impressions) * 100) : 0;
    if (campos.includes('cpa')) linha.cpa = p.conversions ? arred(p.spend / p.conversions) : 0;
    return linha;
  });

  return {
    data: asJson({ janela: { from, to }, granularidade, metricas: campos, serie }),
    summary: `Série de ${serie.length} ponto(s) por ${granularidade} para ${[...new Set(serie.map((s) => String(s.entidade)))].length} entidade(s).`,
    source: source('meta_ads.json', from, to),
  };
}

// --- Apps de metodologia ----------------------------------------------------

export function app_diagnostico(args: Args): ToolPayload {
  const pergunta = texto(args, 'pergunta', false, 'O que explica a variação de performance na janela?');
  const janelaBruta = args['janela'];
  const janela =
    janelaBruta && typeof janelaBruta === 'object' && !Array.isArray(janelaBruta)
      ? { from: String(janelaBruta['from'] ?? SEMANA_ATUAL.from), to: String(janelaBruta['to'] ?? SEMANA_ATUAL.to) }
      : { from: SEMANA_ATUAL.from, to: SEMANA_ATUAL.to };

  const a = analisarAtribuicao();
  const cruz = cruzarMetaCrm(janela.from, janela.to);
  const s3 = a.porSemana[2];
  const s4 = a.porSemana[3];
  const s2 = a.porSemana[1];

  const causaRaiz: { afirmacao: string; evidencia: string; fonte: string }[] = [];
  if (a.anuncioSuspeito) {
    causaRaiz.push({
      afirmacao: `O anúncio "${a.anuncioSuspeito.nome}" teve o link de destino trocado por um encurtador (${a.anuncioSuspeito.link}) em ${a.anuncioSuspeito.trocadoEm ?? 'agosto'}, e o encurtador descarta a query string com as UTMs.`,
      evidencia: `Link original tinha utm_content=${a.anuncioSuspeito.nome}; as linhas do Meta a partir da troca vêm com utm_content vazio. ${brl(a.anuncioSuspeito.gastoSemana)} e ${a.anuncioSuspeito.conversoesSemUtmSemana} conversões na semana atual sem origem.`,
      fonte: 'criativos.json + meta_ads.json + timeline.json',
    });
    causaRaiz.push({
      afirmacao: 'A venda não caiu: o que caiu foi a atribuição. O pixel do Meta não depende de UTM, o CRM depende.',
      evidencia: `Meta reporta ${s4.conversoesMeta} conversões de Ômega 3 na semana atual contra ${s2.conversoesMeta} em S2; leads atribuídos caíram de ${s2.leadsAtribuidos} para ${s4.leadsAtribuidos}, e os leads sem origem subiram de ${s2.leadsSemUtm} para ${s4.leadsSemUtm}. Receita ganha do produto: ${brl(s2.receitaGanha)} (S2) → ${brl(s4.receitaGanha)} (S4).`,
      fonte: 'meta_ads.json + crm.json',
    });
    causaRaiz.push({
      afirmacao: 'O GA4 mostra o mesmo desvio em sessões: o que sumiu de paid_social apareceu em direct.',
      evidencia: `paid_social ${a.porSemana[1].sessoesPaidSocial} → ${s4.sessoesPaidSocial} sessões; direct ${a.porSemana[1].sessoesDirect} → ${s4.sessoesDirect}.`,
      fonte: 'ga.json',
    });
  }
  if (a.criativoSaturado) {
    causaRaiz.push({
      afirmacao: `Causa secundária REAL: o criativo "${a.criativoSaturado.nome}" está saturado — essa perda não é atribuição.`,
      evidencia: `Frequência ${a.criativoSaturado.frequenciaAtual}, CTR ${a.criativoSaturado.ctrInicial}% → ${a.criativoSaturado.ctrAtual}%, conversões ${a.criativoSaturado.conversoesInicial} → ${a.criativoSaturado.conversoesAtual}, CPA ${brl(a.criativoSaturado.cpaAtual)} com ${brl(a.criativoSaturado.gastoSemana)} na semana.`,
      fonte: 'criativos.json (métricas por semana) + meta_ads.json',
    });
  }

  const descartadas = [
    { hipotese: 'Queda de investimento', porque: `O gasto do período está em ${brl(cruz.totais.spend)} atribuídos + ${brl(cruz.fora.gastoSemUtm)} sem utm — patamar equivalente ao das semanas anteriores.` },
    { hipotese: 'Queda de demanda / faturamento', porque: `A receita ganha do CRM ficou estável (${brl(s3.receitaGanha)} → ${brl(s4.receitaGanha)}), e ${brl(cruz.fora.receitaSemUtm)} dela vem de leads sem origem.` },
    ...(a.anuncioSuspeito
      ? [{ hipotese: `Pausar "${a.anuncioSuspeito.nome}" por CPA ruim no CRM`, porque: `É a armadilha: pelo CRM ele parece caríssimo, mas ele tem ${a.anuncioSuspeito.conversoesSemUtmSemana} conversões no Meta na semana. Pausar seria cortar o melhor anúncio da conta — o que quebrou foi o rastreio, não o anúncio.` }]
      : []),
  ];

  const proximosPassos = [
    ...(a.anuncioSuspeito
      ? [{ acao: `Trocar o encurtador ${a.anuncioSuspeito.link} pelo link direto com UTM em "${a.anuncioSuspeito.nome}" (ou configurar o encurtador para propagar a query string).`, dono: 'Carolina Nunes', exigeConfirmacao: true }]
      : []),
    { acao: `Reprocessar os ${s4.leadsSemUtm} leads sem origem da semana por horário de clique antes de fechar o relatório do cliente.`, exigeConfirmacao: false },
    ...(a.criativoSaturado
      ? [{ acao: `Pausar "${a.criativoSaturado.nome}" (frequência ${a.criativoSaturado.frequenciaAtual}) e subir o substituto que está parado em aprovação.`, dono: 'Aline Ferraz', exigeConfirmacao: true }]
      : []),
  ];

  return {
    data: asJson({
      pergunta,
      janela,
      veredito: a.anuncioSuspeito
        ? 'As vendas não caíram na proporção que o relatório mostra: a atribuição quebrou. Um encurtador de link derrubou as UTMs do melhor anúncio, e uma segunda queda — essa real — vem de um criativo saturado.'
        : 'Não encontrei ruptura de atribuição na janela; a variação parece de performance.',
      confianca: a.anuncioSuspeito && a.receitaEstavel ? 'alta' : 'media',
      causaRaiz,
      descartadas,
      proximosPassos,
      numeros: { porSemana: a.porSemana, buracoSemanaAtual: a.buracoSemanaAtual, buracoSemanaAnterior: a.buracoSemanaAnterior },
    }),
    summary: a.anuncioSuspeito
      ? `Diagnóstico: atribuição quebrada pelo encurtador em "${a.anuncioSuspeito.nome}" (${a.anuncioSuspeito.trocadoEm}) + saturação real de "${a.criativoSaturado?.nome ?? '—'}". Receita estável.`
      : 'Diagnóstico sem ruptura de atribuição identificada.',
    source: 'app_diagnostico (meta_ads.json + crm.json + ga.json + criativos.json + timeline.json)',
  };
}

export function propose_ctas(args: Args): ToolPayload {
  const ids = lista(args, 'criativoIds');
  const quantidade = Math.max(1, Math.min(5, numero(args, 'quantidade', 3)));
  const restricoes = lista(args, 'restricoesDeMarca');
  const base = criativos().criativos;
  const alvos = ids.length ? base.filter((c) => ids.includes(c.id) || ids.includes(c.nome)) : base.filter((c) => criativos().ctas_fracos.includes(c.cta) && c.status === 'ativo');
  if (!alvos.length) throw new ToolFailure('not_found', 'Nenhum criativo encontrado para propor CTA.');

  const referencia = base
    .filter((c) => c.metricas && !criativos().ctas_fracos.includes(c.cta))
    .sort((a, b) => (b.metricas?.ctr ?? 0) - (a.metricas?.ctr ?? 0))[0];

  const propostas = alvos.map((c) => {
    const s4 = c.metricas_por_semana.find((s) => s.semana.startsWith('S4'));
    const ctr = s4?.ctr ?? c.metricas?.ctr ?? 0;
    const produtoCurto = c.produto.toLowerCase();
    const banco = [
      {
        texto: `Quero meu ${produtoCurto}`,
        hipotese: 'O CTA genérico não pede decisão; a objeção é falta de próximo passo claro.',
        justificativa: `"${c.cta}" entrega CTR ${ctr.toFixed(2)}% enquanto "${referencia?.cta ?? 'Comprar agora'}" (${referencia?.nome ?? 'criativo irmão'}) faz ${(referencia?.metricas?.ctr ?? 0).toFixed(2)}% no mesmo público.`,
      },
      {
        texto: 'Ver preço com frete incluso',
        hipotese: 'A objeção é preço final, não o produto.',
        justificativa: `O criativo de oferta com frete é o de menor CPL da conta; o copy atual promete benefício sem preço.`,
      },
      {
        texto: `Comparar com o meu ${produtoCurto} atual`,
        hipotese: 'O público já consome a categoria e decide por comparação, não por descoberta.',
        justificativa: `Headline atual ("${c.copy.headline}") é de topo de funil e roda em campanha de conversão — a promessa não bate com o objetivo.`,
      },
      {
        texto: 'Aproveitar enquanto tem estoque',
        hipotese: 'Falta urgência: o anúncio roda há semanas para o mesmo público.',
        justificativa: `Frequência ${(s4?.frequency ?? c.metricas?.frequency_media ?? 0).toFixed(1)} na semana atual — o público já viu o anúncio várias vezes.`,
      },
      {
        texto: 'Ver o laudo do lote',
        hipotese: 'A objeção é confiança na qualidade do suplemento.',
        justificativa: 'Os criativos com prova (laudo, certificação, depoimento) são os de maior CTR da conta.',
      },
    ];
    return {
      criativoId: c.id,
      criativoNome: c.nome,
      ctaAtual: c.cta,
      copyAtual: `${c.copy.headline} — ${c.copy.corpo}`,
      campanha: c.campanha,
      propostas: banco.slice(0, quantidade),
    };
  });

  return {
    data: asJson({ criativos: propostas, restricoesDeMarca: restricoes, observacao: 'Propor não é publicar: nada aqui vai ao ar. Subir a variação exige uma tool de escrita que este protótipo não expõe.' }),
    summary: `${propostas.length} criativo(s) com ${quantidade} variação(ões) de CTA cada, com hipótese declarada.`,
    source: 'propose_ctas (criativos.json)',
  };
}
