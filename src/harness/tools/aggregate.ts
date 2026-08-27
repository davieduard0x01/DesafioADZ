/**
 * Agregação numérica — em CÓDIGO, não no modelo (decisão de projeto do paper).
 *
 * LLM somando linha a linha erra em silêncio. Aqui todo join, group-by e média
 * roda em JS puro e determinístico; o modelo recebe o resultado já fechado, com
 * a contagem explícita do que ficou de FORA do agrupamento. É essa contagem que
 * permite a resposta declarar "12 leads não entram nesta tabela" em vez de somir
 * com eles.
 */
import { crm, criativos, ga, googleAds, metaAds, timeline } from '../datasets';
import type { CrmLead, MetaInsight } from '../datasets';

export const SEMANAS: readonly { readonly rotulo: string; readonly from: string; readonly to: string }[] = [
  { rotulo: 'S1', from: '2026-07-27', to: '2026-08-02' },
  { rotulo: 'S2', from: '2026-08-03', to: '2026-08-09' },
  { rotulo: 'S3', from: '2026-08-10', to: '2026-08-16' },
  { rotulo: 'S4', from: '2026-08-17', to: '2026-08-23' },
];

/** Semana atual do dataset (a mídia vai até 23/08; "hoje" é 26/08). */
export const SEMANA_ATUAL = SEMANAS[3];
export const SEMANA_ANTERIOR = SEMANAS[2];

export function dentro(data: string, from: string, to: string): boolean {
  const d = data.slice(0, 10);
  return d >= from && d <= to;
}

export function janelaAnterior(from: string, to: string): { from: string; to: string } {
  const dias = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const fimAnterior = new Date(Date.parse(from) - 86_400_000);
  const inicioAnterior = new Date(fimAnterior.getTime() - (dias - 1) * 86_400_000);
  return { from: inicioAnterior.toISOString().slice(0, 10), to: fimAnterior.toISOString().slice(0, 10) };
}

export function arred(n: number, casas = 2): number {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

// --- Meta -------------------------------------------------------------------

export type MetaRow = {
  chave: string;
  rotulo: string;
  campanha: string;
  adset?: string;
  utm_content: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  cpa: number;
  frequency: number;
};

export function agruparMeta(from: string, to: string, breakdown: 'campaign' | 'adset' | 'ad'): MetaRow[] {
  const linhas = metaAds().insights.filter((i) => dentro(i.date, from, to));
  const chaveDe = (i: MetaInsight) => (breakdown === 'campaign' ? i.campaign : breakdown === 'adset' ? `${i.campaign} · ${i.adset}` : i.ad_name);
  const mapa = new Map<string, MetaRow & { _freq: number[] }>();
  for (const i of linhas) {
    const k = chaveDe(i);
    const atual = mapa.get(k) ?? {
      chave: k,
      rotulo: breakdown === 'ad' ? i.ad_name : k,
      campanha: i.campaign,
      adset: breakdown === 'ad' ? i.adset : undefined,
      utm_content: i.utm_content,
      spend: 0, impressions: 0, clicks: 0, ctr: 0, conversions: 0, cpa: 0, frequency: 0,
      _freq: [],
    };
    atual.spend += i.spend;
    atual.impressions += i.impressions;
    atual.clicks += i.clicks;
    atual.conversions += i.conversions;
    atual._freq.push(i.frequency);
    // um anúncio pode ter utm em parte do período e vazio no resto (é o caso do encurtador)
    if (!atual.utm_content && i.utm_content) atual.utm_content = i.utm_content;
    mapa.set(k, atual);
  }
  return [...mapa.values()]
    .map(({ _freq, ...r }) => ({
      ...r,
      spend: arred(r.spend),
      ctr: r.impressions ? arred((r.clicks / r.impressions) * 100) : 0,
      cpa: r.conversions ? arred(r.spend / r.conversions) : 0,
      frequency: _freq.length ? arred(_freq.reduce((a, b) => a + b, 0) / _freq.length) : 0,
    }))
    .sort((a, b) => b.spend - a.spend);
}

/** Gasto do anúncio no período que NÃO carregou utm_content (o buraco de atribuição). */
export function gastoSemUtm(from: string, to: string): { spend: number; conversions: number; porAnuncio: { ad_name: string; spend: number; conversions: number }[] } {
  const linhas = metaAds().insights.filter((i) => dentro(i.date, from, to) && !i.utm_content);
  const mapa = new Map<string, { ad_name: string; spend: number; conversions: number }>();
  for (const i of linhas) {
    const a = mapa.get(i.ad_name) ?? { ad_name: i.ad_name, spend: 0, conversions: 0 };
    a.spend += i.spend;
    a.conversions += i.conversions;
    mapa.set(i.ad_name, a);
  }
  const porAnuncio = [...mapa.values()].map((a) => ({ ...a, spend: arred(a.spend) }));
  return {
    spend: arred(porAnuncio.reduce((s, a) => s + a.spend, 0)),
    conversions: porAnuncio.reduce((s, a) => s + a.conversions, 0),
    porAnuncio,
  };
}

// --- CRM --------------------------------------------------------------------

export type CrmAgregado = {
  total: number;
  ganhos: number;
  receita: number;
  semUtm: number;
  receitaSemUtm: number;
  porUtm: { utm_content: string; leads: number; ganhos: number; receita: number }[];
};

export function agregarCrm(from: string, to: string, filtro?: { estagio?: string; produto?: string }): CrmAgregado {
  const leads = crm().leads.filter(
    (l) => dentro(l.created_at, from, to) && (!filtro?.estagio || l.estagio === filtro.estagio) && (!filtro?.produto || l.produto === filtro.produto),
  );
  const mapa = new Map<string, { utm_content: string; leads: number; ganhos: number; receita: number }>();
  let semUtm = 0;
  let receitaSemUtm = 0;
  for (const l of leads) {
    if (!l.utm_content) {
      semUtm++;
      if (l.estagio === 'ganho') receitaSemUtm += l.valor;
      continue;
    }
    const a = mapa.get(l.utm_content) ?? { utm_content: l.utm_content, leads: 0, ganhos: 0, receita: 0 };
    a.leads++;
    if (l.estagio === 'ganho') {
      a.ganhos++;
      a.receita += l.valor;
    }
    mapa.set(l.utm_content, a);
  }
  const ganhos = leads.filter((l) => l.estagio === 'ganho');
  return {
    total: leads.length,
    ganhos: ganhos.length,
    receita: arred(ganhos.reduce((s, l) => s + l.valor, 0)),
    semUtm,
    receitaSemUtm: arred(receitaSemUtm),
    porUtm: [...mapa.values()].map((a) => ({ ...a, receita: arred(a.receita) })).sort((a, b) => b.leads - a.leads),
  };
}

export function leadsBrutos(from: string, to: string, filtro?: { estagio?: string; utmContent?: string | null; incluirSemUtm?: boolean }): CrmLead[] {
  return crm().leads.filter((l) => {
    if (!dentro(l.created_at, from, to)) return false;
    if (filtro?.estagio && l.estagio !== filtro.estagio) return false;
    if (filtro?.utmContent === null) return !l.utm_content;
    if (typeof filtro?.utmContent === 'string' && l.utm_content !== filtro.utmContent) return false;
    if (filtro?.incluirSemUtm === false && !l.utm_content) return false;
    return true;
  });
}

// --- o join do prompt 4 -----------------------------------------------------

export type CruzamentoLinha = {
  utm_content: string;
  canal: 'Meta' | 'Google';
  campanha: string;
  spend: number;
  conversoesMidia: number;
  leads: number;
  ganhos: number;
  receita: number;
  cpl: number | null;
  roas: number | null;
};

export type Cruzamento = {
  from: string;
  to: string;
  linhas: CruzamentoLinha[];
  /** O que ficou de FORA do agrupamento — declarar isto é obrigatório. */
  fora: {
    leadsSemUtm: number;
    receitaSemUtm: number;
    gastoSemUtm: number;
    conversoesSemUtm: number;
    anunciosSemUtm: string[];
    utmsDoCrmSemMidia: string[];
  };
  totais: { spend: number; leads: number; receita: number };
};

export function cruzarMetaCrm(from: string, to: string): Cruzamento {
  const meta = agruparMeta(from, to, 'ad');
  const gads = googleAds().insights.filter((i) => dentro(i.date, from, to));
  const crmAgg = agregarCrm(from, to);
  const buraco = gastoSemUtm(from, to);

  const gastoPorUtm = new Map<string, { canal: 'Meta' | 'Google'; campanha: string; spend: number; conversoes: number }>();
  for (const r of meta) {
    // só o gasto que efetivamente carregou utm entra no join
    const comUtm = metaAds().insights.filter((i) => dentro(i.date, from, to) && i.ad_name === r.rotulo && i.utm_content);
    if (!comUtm.length) continue;
    const utm = comUtm[0].utm_content;
    const a = gastoPorUtm.get(utm) ?? { canal: 'Meta' as const, campanha: r.campanha, spend: 0, conversoes: 0 };
    a.spend += comUtm.reduce((s, i) => s + i.spend, 0);
    a.conversoes += comUtm.reduce((s, i) => s + i.conversions, 0);
    gastoPorUtm.set(utm, a);
  }
  for (const i of gads) {
    const a = gastoPorUtm.get(i.utm_content) ?? { canal: 'Google' as const, campanha: i.campaign, spend: 0, conversoes: 0 };
    a.spend += i.spend;
    a.conversoes += i.conversions;
    gastoPorUtm.set(i.utm_content, a);
  }

  const linhas: CruzamentoLinha[] = [...gastoPorUtm.entries()].map(([utm, m]) => {
    const c = crmAgg.porUtm.find((p) => p.utm_content === utm);
    const leads = c?.leads ?? 0;
    return {
      utm_content: utm,
      canal: m.canal,
      campanha: m.campanha,
      spend: arred(m.spend),
      conversoesMidia: m.conversoes,
      leads,
      ganhos: c?.ganhos ?? 0,
      receita: c?.receita ?? 0,
      cpl: leads ? arred(m.spend / leads) : null,
      roas: m.spend ? arred((c?.receita ?? 0) / m.spend) : null,
    };
  });
  linhas.sort((a, b) => (b.cpl ?? Number.MAX_SAFE_INTEGER) - (a.cpl ?? Number.MAX_SAFE_INTEGER));

  const utmsDoCrmSemMidia = crmAgg.porUtm.filter((p) => !gastoPorUtm.has(p.utm_content)).map((p) => p.utm_content);

  return {
    from,
    to,
    linhas,
    fora: {
      leadsSemUtm: crmAgg.semUtm,
      receitaSemUtm: crmAgg.receitaSemUtm,
      gastoSemUtm: buraco.spend,
      conversoesSemUtm: buraco.conversions,
      anunciosSemUtm: buraco.porAnuncio.map((a) => a.ad_name),
      utmsDoCrmSemMidia,
    },
    totais: {
      spend: arred(linhas.reduce((s, l) => s + l.spend, 0)),
      leads: linhas.reduce((s, l) => s + l.leads, 0),
      receita: arred(linhas.reduce((s, l) => s + l.receita, 0)),
    },
  };
}

// --- a análise do prompt 2 --------------------------------------------------

export type AnaliseAtribuicao = {
  porSemana: { semana: string; from: string; to: string; leadsSemUtm: number; leadsAtribuidos: number; receitaGanha: number; conversoesMeta: number; sessoesDirect: number; sessoesPaidSocial: number }[];
  baselineSemUtmPorDia: number;
  buracoSemanaAtual: number;
  buracoSemanaAnterior: number;
  anuncioSuspeito: { nome: string; link: string; linkOriginal: string | null; trocadoEm: string | null; conversoesSemUtmSemana: number; gastoSemana: number } | null;
  criativoSaturado: { nome: string; cta: string; ctrInicial: number; ctrAtual: number; frequenciaAtual: number; conversoesInicial: number; conversoesAtual: number; cpaAtual: number; gastoSemana: number } | null;
  receitaEstavel: boolean;
  metaEstavel: boolean;
};

export function analisarAtribuicao(produto = 'Ômega 3'): AnaliseAtribuicao {
  const porSemana = SEMANAS.map((s) => {
    const agg = agregarCrm(s.from, s.to, { produto });
    const metaLinhas = metaAds().insights.filter((i) => dentro(i.date, s.from, s.to) && i.ad_name.startsWith('omega3'));
    const gaLinhas = ga().sessoes_por_canal_dia.filter((g) => dentro(g.date, s.from, s.to));
    return {
      semana: s.rotulo,
      from: s.from,
      to: s.to,
      leadsSemUtm: agg.semUtm,
      leadsAtribuidos: agg.total - agg.semUtm,
      receitaGanha: agg.receita,
      conversoesMeta: metaLinhas.reduce((acc, i) => acc + i.conversions, 0),
      sessoesDirect: gaLinhas.filter((g) => g.canal_agrupado === 'direct').reduce((acc, g) => acc + g.sessions, 0),
      sessoesPaidSocial: gaLinhas.filter((g) => g.canal_agrupado === 'paid_social').reduce((acc, g) => acc + g.sessions, 0),
    };
  });

  const baselinePorDia = arred((porSemana[0].leadsSemUtm + porSemana[1].leadsSemUtm) / 14, 2);
  const esperado = Math.round(baselinePorDia * 7);
  const buracoAtual = porSemana[3].leadsSemUtm - esperado;
  const buracoAnterior = porSemana[2].leadsSemUtm - esperado;

  const encurtado = criativos().criativos.find((c) => c.link_original && c.link && c.link !== c.link_original);
  const evTroca = timeline().eventos.find((e) => e.tipo === 'alteracao_campanha' && /encurtad|link/i.test(e.resumo));
  const semUtmSemana = gastoSemUtm(SEMANA_ATUAL.from, SEMANA_ATUAL.to);
  const linhaSuspeita = encurtado ? semUtmSemana.porAnuncio.find((a) => a.ad_name === encurtado.nome) : undefined;

  const saturado = criativos()
    .criativos.filter((c) => c.metricas_por_semana.length === 4)
    .map((c) => ({ c, s: c.metricas_por_semana }))
    .filter(({ s }) => s[3].frequency > s[0].frequency && s[3].ctr < s[0].ctr && s[3].conversions < s[0].conversions)
    .sort((a, b) => b.s[3].frequency - a.s[3].frequency)[0];

  const receitas = porSemana.map((s) => s.receitaGanha);
  const metas = porSemana.map((s) => s.conversoesMeta);

  return {
    porSemana,
    baselineSemUtmPorDia: baselinePorDia,
    buracoSemanaAtual: buracoAtual,
    buracoSemanaAnterior: buracoAnterior,
    anuncioSuspeito: encurtado
      ? {
          nome: encurtado.nome,
          link: encurtado.link ?? '',
          linkOriginal: encurtado.link_original ?? null,
          trocadoEm: evTroca ? evTroca.ts.slice(0, 10) : null,
          conversoesSemUtmSemana: linhaSuspeita?.conversions ?? 0,
          gastoSemana: linhaSuspeita?.spend ?? 0,
        }
      : null,
    criativoSaturado: saturado
      ? {
          nome: saturado.c.nome,
          cta: saturado.c.cta,
          ctrInicial: saturado.s[0].ctr,
          ctrAtual: saturado.s[3].ctr,
          frequenciaAtual: saturado.s[3].frequency,
          conversoesInicial: saturado.s[0].conversions,
          conversoesAtual: saturado.s[3].conversions,
          cpaAtual: saturado.s[3].cpa,
          gastoSemana: saturado.s[3].spend,
        }
      : null,
    receitaEstavel: Math.abs(receitas[3] - receitas[1]) / Math.max(receitas[1], 1) < 0.15,
    metaEstavel: metas[3] >= metas[1] * 0.9,
  };
}

/** Criativos com CTA da lista de fracos, com o número que justifica a pausa. */
export function criativosComCtaFraco(): { nome: string; id: string; cta: string; campanha: string; ctr: number; cpa: number; spendSemana: number; conversoesSemana: number; frequencia: number; motivo: string }[] {
  const { ctas_fracos, criativos: lista } = criativos();
  return lista
    .filter((c) => c.status === 'ativo' && ctas_fracos.includes(c.cta))
    .map((c) => {
      const s4 = c.metricas_por_semana.find((s) => s.semana.startsWith('S4'));
      return {
        nome: c.nome,
        id: c.id,
        cta: c.cta,
        campanha: c.campanha,
        ctr: s4?.ctr ?? c.metricas?.ctr ?? 0,
        cpa: s4?.cpa ?? c.metricas?.cpa ?? 0,
        spendSemana: s4?.spend ?? 0,
        conversoesSemana: s4?.conversions ?? 0,
        frequencia: s4?.frequency ?? c.metricas?.frequency_media ?? 0,
        motivo: `CTA "${c.cta}" é genérico; CTR ${(s4?.ctr ?? 0).toFixed(2)}% e CPA R$ ${(s4?.cpa ?? 0).toFixed(0)} na semana atual.`,
      };
    })
    .sort((a, b) => b.cpa - a.cpa);
}
