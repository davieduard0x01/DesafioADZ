// Gerador determinístico dos mocks da conta Housewhey (dados 100% fictícios).
// Uso: node data/generate.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
const w = (nome, obj) => writeFileSync(join(OUT, nome), JSON.stringify(obj, null, 2) + "\n");

// ---------- utilidades determinísticas ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260826);
const jit = (base, pct) => base * (1 + (rnd() * 2 - 1) * pct);
const r2 = (n) => Math.round(n * 100) / 100;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const D0 = Date.UTC(2026, 6, 27); // 2026-07-27
const DIAS = 28; // até 2026-08-23
const dia = (i) => new Date(D0 + i * 86400000).toISOString().slice(0, 10);
const semanaDe = (i) => Math.floor(i / 7); // 0..3
const INICIO = dia(0), FIM = dia(DIAS - 1);
const SEMANAS = [0, 1, 2, 3].map((s) => ({
  indice: s,
  rotulo: ["S1", "S2", "S3 (semana anterior)", "S4 (semana atual)"][s],
  inicio: dia(s * 7), fim: dia(s * 7 + 6),
}));

// pesos de dia da semana (seg..dom a partir de 27/07 = segunda-feira)
const PESO_DIA = [1.02, 1.05, 1.04, 1.0, 1.06, 0.94, 0.89];

function splitMoney(total, pesos) {
  const soma = pesos.reduce((a, b) => a + b, 0);
  const out = pesos.map((p) => r2((total * p) / soma));
  const dif = r2(total - out.reduce((a, b) => a + b, 0));
  out[out.length - 1] = r2(out[out.length - 1] + dif);
  return out;
}
function splitInt(total, pesos) {
  const soma = pesos.reduce((a, b) => a + b, 0);
  const bruto = pesos.map((p) => (total * p) / soma);
  const out = bruto.map(Math.floor);
  let resto = total - out.reduce((a, b) => a + b, 0);
  const ordem = bruto.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; resto > 0; k++, resto--) out[ordem[k % ordem.length][1]]++;
  return out;
}

// ---------- a causa-raiz plantada ----------
const AD_AFETADO = "omega3_vid_prova_social_v2";
const DATA_TROCA = "2026-08-11";     // edição feita às 09:12, antes da entrega do dia
const FRACAO_DIA_TROCA = 0;          // nenhum clique do dia 11/08 saiu com UTM
const ENCURTADOR = "https://hwy.link/o3ps";
const afetadoEm = (d) => d >= DATA_TROCA;

// ---------- catálogo ----------
const SITE = "https://housewhey.com.br";
const CAMPANHAS = {
  omega3: { id: "23860991102", nome: "HW | Ômega 3 | Conversão | Ago", objetivo: "Vendas no site", produto: "Ômega 3", lp: "/omega-3-1000mg", utm_campaign: "omega3_conversao_ago", verba_diaria: 280 },
  whey: { id: "23860991103", nome: "HW | Whey Protein | Conversão | Ago", objetivo: "Vendas no site", produto: "Whey Protein", lp: "/whey-protein-concentrado", utm_campaign: "whey_conversao_ago", verba_diaria: 130 },
  creatina: { id: "23860991104", nome: "HW | Creatina | Conversão | Ago", objetivo: "Vendas no site", produto: "Creatina", lp: "/creatina-monohidratada", utm_campaign: "creatina_conversao_ago", verba_diaria: 80 },
  multi: { id: "23860991105", nome: "HW | Multivitamínico | Remarketing | Ago", objetivo: "Vendas no site", produto: "Multivitamínico", lp: "/multivitaminico-az", utm_campaign: "multi_remarketing_ago", verba_diaria: 50 },
};

const linkPadrao = (c, utm) =>
  `${SITE}${CAMPANHAS[c].lp}?utm_source=facebook&utm_medium=paid_social&utm_campaign=${CAMPANHAS[c].utm_campaign}&utm_content=${utm}`;

// spend/conv por semana (S1..S4). A soma por anúncio é o total da campanha.
const ADS = [
  { ad_id: "23861004417", nome: AD_AFETADO, camp: "omega3", adset: "LAL 2% Compradores 180d | 25-54 | BR",
    desde: "2026-07-31", formato: "video", cta: "Comprar agora",
    spend: [330, 650, 700, 900], conv: [11, 22, 23, 30],
    cpc: [1.02, 1.04, 1.05, 1.06], ctr: [2.74, 2.68, 2.61, 2.55], freq: [1.6, 1.9, 2.2, 2.4] },
  { ad_id: "23861004418", nome: "omega3_vid_depoimento_dra_v3", camp: "omega3", adset: "Interesses Saúde e Suplementação | 30-55 | BR",
    desde: "2026-07-27", formato: "video", cta: "Quero meu frasco",
    spend: [470, 470, 480, 480], conv: [13, 13, 12, 12],
    cpc: [1.13, 1.15, 1.16, 1.18], ctr: [2.18, 2.12, 2.09, 2.04], freq: [1.9, 2.2, 2.4, 2.6] },
  { ad_id: "23861004419", nome: "omega3_carrossel_beneficios_v1", camp: "omega3", adset: "Interesses Saúde e Suplementação | 30-55 | BR",
    desde: "2026-07-27", formato: "carrossel", cta: "Saiba mais",
    spend: [640, 620, 570, 380], conv: [15, 11, 7, 4],
    cpc: [0.92, 1.08, 1.27, 1.48], ctr: [1.92, 1.54, 1.05, 0.71], freq: [2.1, 3.2, 4.4, 5.6] },
  { ad_id: "23861004420", nome: "omega3_est_oferta_frete_v1", camp: "omega3", adset: "Retargeting Visitantes 30d | BR",
    desde: "2026-07-27", formato: "estatico", cta: "Aproveitar oferta",
    spend: [190, 190, 190, 190], conv: [6, 5, 5, 5],
    cpc: [1.26, 1.28, 1.3, 1.31], ctr: [1.78, 1.75, 1.72, 1.7], freq: [2.1, 2.3, 2.5, 2.7] },

  { ad_id: "23861004431", nome: "whey_vid_receita_shake_v2", camp: "whey", adset: "LAL 3% Compradores | 18-40 | BR",
    desde: "2026-07-27", formato: "video", cta: "Ver sabores",
    spend: [450, 450, 450, 450], conv: [11, 10, 10, 9],
    cpc: [1.18, 1.2, 1.21, 1.23], ctr: [1.94, 1.9, 1.86, 1.82], freq: [1.7, 1.9, 2.1, 2.2] },
  { ad_id: "23861004432", nome: "whey_carrossel_sabores_v3", camp: "whey", adset: "Interesses Fitness | 18-40 | BR",
    desde: "2026-07-27", formato: "carrossel", cta: "Comprar agora",
    spend: [280, 280, 280, 280], conv: [6, 5, 5, 4],
    cpc: [1.3, 1.32, 1.34, 1.36], ctr: [1.48, 1.45, 1.42, 1.39], freq: [2.2, 2.4, 2.6, 2.8] },
  { ad_id: "23861004433", nome: "whey_est_combo_v1", camp: "whey", adset: "Interesses Fitness | 18-40 | BR",
    desde: "2026-07-27", formato: "estatico", cta: "Saiba mais",
    spend: [170, 170, 170, 170], conv: [2, 1, 1, 1],
    cpc: [1.5, 1.53, 1.56, 1.59], ctr: [0.7, 0.67, 0.65, 0.64], freq: [2.6, 2.8, 3.0, 3.1] },

  { ad_id: "23861004441", nome: "creatina_vid_treino_v1", camp: "creatina", adset: "Interesses Musculação | 18-45 | BR",
    desde: "2026-07-27", formato: "video", cta: "Quero minha creatina",
    spend: [350, 350, 350, 350], conv: [7, 8, 7, 7],
    cpc: [1.16, 1.17, 1.19, 1.2], ctr: [1.83, 1.8, 1.78, 1.76], freq: [1.6, 1.7, 1.8, 1.9] },
  { ad_id: "23861004442", nome: "creatina_est_pote_v2", camp: "creatina", adset: "Interesses Musculação | 18-45 | BR",
    desde: "2026-07-27", formato: "estatico", cta: "Ver mais",
    spend: [200, 200, 200, 200], conv: [3, 3, 3, 3],
    cpc: [1.36, 1.38, 1.4, 1.42], ctr: [0.86, 0.84, 0.83, 0.82], freq: [2.5, 2.7, 2.8, 2.9] },

  { ad_id: "23861004451", nome: "multi_est_remarketing_v1", camp: "multi", adset: "Carrinho abandonado 14d | BR",
    desde: "2026-07-27", formato: "estatico", cta: "Finalizar compra",
    spend: [220, 220, 220, 220], conv: [7, 7, 8, 7],
    cpc: [0.76, 0.77, 0.78, 0.8], ctr: [3.46, 3.42, 3.38, 3.34], freq: [4.2, 4.5, 4.7, 4.8] },
  { ad_id: "23861004452", nome: "multi_carrossel_kit_v1", camp: "multi", adset: "Compradores 90d | BR",
    desde: "2026-07-27", formato: "carrossel", cta: "Montar meu kit",
    spend: [130, 130, 130, 130], conv: [3, 3, 3, 3],
    cpc: [0.92, 0.94, 0.95, 0.97], ctr: [2.26, 2.22, 2.19, 2.16], freq: [3.2, 3.4, 3.5, 3.6] },
];

// ---------- meta_ads.json ----------
const insights = [];
for (const ad of ADS) {
  for (let s = 0; s < 4; s++) {
    const idx = [];
    for (let i = s * 7; i < s * 7 + 7; i++) if (dia(i) >= ad.desde) idx.push(i);
    if (!idx.length) continue;
    const pesos = idx.map((i) => jit(PESO_DIA[i % 7], 0.08));
    const spends = splitMoney(ad.spend[s], pesos);
    const convs = splitInt(ad.conv[s], pesos);
    idx.forEach((i, k) => {
      const d = dia(i);
      const cpc = r2(jit(ad.cpc[s], 0.05));
      const ctr = r2(jit(ad.ctr[s], 0.06));
      const clicks = Math.max(1, Math.round(spends[k] / cpc));
      const impressions = Math.round(clicks / (ctr / 100));
      const quebrado = ad.nome === AD_AFETADO && afetadoEm(d);
      insights.push({
        ad_id: ad.ad_id, ad_name: ad.nome,
        campaign_id: CAMPANHAS[ad.camp].id, campaign: CAMPANHAS[ad.camp].nome, adset: ad.adset,
        date: d,
        spend: spends[k], impressions, clicks,
        ctr: r2((clicks / impressions) * 100), cpc: r2(spends[k] / clicks),
        frequency: r2(jit(ad.freq[s], 0.05)),
        conversions: convs[k],
        cpa: r2(convs[k] ? spends[k] / convs[k] : 0),
        utm_content: quebrado ? "" : ad.nome,
        link: quebrado ? ENCURTADOR : linkPadrao(ad.camp, ad.nome),
      });
    });
  }
}
insights.sort((a, b) => (a.date + a.ad_id).localeCompare(b.date + b.ad_id));

const campResumo = Object.entries(CAMPANHAS).map(([k, c]) => {
  const rows = insights.filter((r) => r.campaign_id === c.id);
  const spend = r2(rows.reduce((a, r) => a + r.spend, 0));
  const conv = rows.reduce((a, r) => a + r.conversions, 0);
  return {
    campaign_id: c.id, campaign: c.nome, objetivo: c.objetivo, produto: c.produto,
    verba_diaria: c.verba_diaria, spend_total: spend, conversions_total: conv,
    cpa_medio: r2(spend / conv),
    ads: ADS.filter((a) => a.camp === k).map((a) => a.ad_id),
  };
});

w("meta_ads.json", {
  _aviso: "DADOS FICTÍCIOS gerados para o desafio AdzHub. Nenhuma conta real.",
  conta: { ad_account_id: "act_318842907", nome: "Housewhey", moeda: "BRL", fuso: "America/Sao_Paulo" },
  periodo: { inicio: INICIO, fim: FIM, semanas: SEMANAS },
  notas: {
    ctr: "percentual (2.55 = 2,55%)",
    utm_content: "extraído da URL de destino do anúncio na data. Vazio quando a URL não carrega UTM (ex.: encurtador).",
    conversions: "eventos de compra reportados pelo pixel; independem de UTM.",
  },
  campanhas: campResumo,
  insights,
});

// ---------- google_ads.json ----------
const GCAMP = [
  { id: "1789004411", nome: "HW | Search | Marca", tipo: "Search", utm_content: "search_marca_exata",
    spendSem: 240, convSem: [4, 4, 4, 4], cpc: 0.71, ctr: 9.4, produto: "misto", lp: "/" },
  { id: "1789004412", nome: "HW | Shopping | Ômega 3", tipo: "Shopping", utm_content: "shopping_omega3_feed",
    spendSem: 510, convSem: [3, 3, 3, 3], cpc: 1.94, ctr: 1.12, produto: "Ômega 3", lp: "/omega-3-1000mg" },
];
const gRows = [];
for (const c of GCAMP) {
  for (let s = 0; s < 4; s++) {
    const idx = Array.from({ length: 7 }, (_, k) => s * 7 + k);
    const pesos = idx.map((i) => jit(PESO_DIA[i % 7], 0.1));
    const spends = splitMoney(c.spendSem, pesos);
    const convs = splitInt(c.convSem[s], pesos);
    idx.forEach((i, k) => {
      const cpc = r2(jit(c.cpc, 0.07));
      const clicks = Math.max(1, Math.round(spends[k] / cpc));
      const impressions = Math.round(clicks / (jit(c.ctr, 0.08) / 100));
      gRows.push({
        campaign_id: c.id, campaign: c.nome, tipo: c.tipo, date: dia(i),
        spend: spends[k], impressions, clicks, ctr: r2((clicks / impressions) * 100),
        cpc: r2(spends[k] / clicks), conversions: convs[k],
        utm_content: c.utm_content,
        link: `${SITE}${c.lp}?utm_source=google&utm_medium=cpc&utm_campaign=${c.tipo.toLowerCase()}_ago&utm_content=${c.utm_content}`,
      });
    });
  }
}
gRows.sort((a, b) => (a.date + a.campaign_id).localeCompare(b.date + b.campaign_id));
w("google_ads.json", {
  _aviso: "DADOS FICTÍCIOS gerados para o desafio AdzHub.",
  conta: { customer_id: "784-119-3320", nome: "Housewhey", moeda: "BRL" },
  periodo: { inicio: INICIO, fim: FIM },
  campanhas: GCAMP.map((c) => {
    const rows = gRows.filter((r) => r.campaign_id === c.id);
    const spend = r2(rows.reduce((a, r) => a + r.spend, 0));
    const conv = rows.reduce((a, r) => a + r.conversions, 0);
    return { campaign_id: c.id, campaign: c.nome, tipo: c.tipo, utm_content: c.utm_content, spend_total: spend, conversions_total: conv, cpa_medio: r2(spend / conv) };
  }),
  insights: gRows,
});

// ---------- crm.json ----------
const TICKET = { "Ômega 3": 189, "Whey Protein": 249, Creatina: 159, "Multivitamínico": 99 };
const HORAS = [9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21];
let seq = 0;
const leads = [];
const HOJE = Date.UTC(2026, 7, 26);

function estagio(dataISO) {
  const idade = (HOJE - Date.parse(dataISO + "T00:00:00Z")) / 86400000;
  const r = rnd();
  if (idade <= 2) return r < 0.55 ? "novo" : r < 0.9 ? "contato" : "agendado";
  if (idade <= 5) return r < 0.15 ? "novo" : r < 0.45 ? "contato" : r < 0.6 ? "agendado" : r < 0.87 ? "ganho" : "perdido";
  return r < 0.05 ? "contato" : r < 0.11 ? "agendado" : r < 0.62 ? "ganho" : "perdido";
}
function novoLead(date, produto, src, med, cont, canal) {
  const ts = `${date}T${String(pick(HORAS)).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00-03:00`;
  return {
    lead_id: `HW-2026-${String(++seq).padStart(4, "0")}`,
    created_at: ts,
    utm_source: src, utm_medium: med, utm_content: cont,
    canal_relatado: canal,
    estagio: estagio(date),
    valor: r2(jit(TICKET[produto], 0.28)),
    produto,
  };
}

for (const r of insights) {
  const produto = campResumo.find((c) => c.campaign_id === r.campaign_id).produto;
  const quebrado = r.ad_name === AD_AFETADO && afetadoEm(r.date);
  const comUtm = quebrado
    ? r.date === DATA_TROCA ? Math.round(r.conversions * FRACAO_DIA_TROCA) : 0
    : r.conversions;
  for (let k = 0; k < r.conversions; k++) {
    leads.push(k < comUtm
      ? novoLead(r.date, produto, "facebook", "paid_social", r.ad_name, "Meta Ads")
      : novoLead(r.date, produto, "(direct)", "(none)", "", "Origem desconhecida"));
  }
}
// nota: no dia 11/08 a troca ocorreu às 16:42; parte do dia ainda saiu com UTM.
for (const r of gRows) {
  const produto = r.produto === "Ômega 3" ? "Ômega 3" : pick(["Ômega 3", "Whey Protein", "Creatina", "Multivitamínico"]);
  for (let k = 0; k < r.conversions; k++)
    leads.push(novoLead(r.date, r.tipo === "Shopping" ? "Ômega 3" : produto, "google", "cpc", r.utm_content, "Google Ads"));
}
// baseline orgânico/direto: 1 lead por dia, existe o período inteiro
for (let i = 0; i < DIAS; i++)
  leads.push(novoLead(dia(i), pick(["Ômega 3", "Whey Protein", "Creatina", "Multivitamínico"]), "(direct)", "(none)", "", "Origem desconhecida"));

leads.sort((a, b) => a.created_at.localeCompare(b.created_at));
leads.forEach((l, i) => (l.lead_id = `HW-2026-${String(i + 1).padStart(4, "0")}`));

w("crm.json", {
  _aviso: "DADOS FICTÍCIOS gerados para o desafio AdzHub. Nenhum dado pessoal real.",
  crm: "RD Station (simulado)",
  periodo: { inicio: INICIO, fim: FIM },
  notas: {
    join: "utm_content é a chave de join com meta_ads.json / google_ads.json.",
    utm_vazio: "utm_content vazio = a origem não chegou ao CRM. O produto continua conhecido (veio do pedido).",
    estagios: ["novo", "contato", "agendado", "ganho", "perdido"],
    receita: "receita = soma de `valor` onde estagio = 'ganho'.",
  },
  total_leads: leads.length,
  leads,
});

// ---------- ga.json ----------
const LPS = {
  omega3: "/omega-3-1000mg", whey: "/whey-protein-concentrado",
  creatina: "/creatina-monohidratada", multi: "/multivitaminico-az",
};
const gaCanais = [], gaLps = [];
for (let i = 0; i < DIAS; i++) {
  const d = dia(i);
  const rows = insights.filter((r) => r.date === d);
  const cliquesPorCamp = {};
  for (const r of rows) cliquesPorCamp[r.campaign_id] = (cliquesPorCamp[r.campaign_id] || 0) + r.clicks;
  const rowAfet = rows.find((r) => r.ad_name === AD_AFETADO);
  let orfas = 0;
  if (rowAfet && afetadoEm(d))
    orfas = Math.round(rowAfet.clicks * 0.88 * (d === DATA_TROCA ? 1 - FRACAO_DIA_TROCA : 1));
  const cliquesTotais = rows.reduce((a, r) => a + r.clicks, 0);
  const paidSocial = Math.round(cliquesTotais * 0.88) - orfas;
  const paidSearch = Math.round(gRows.filter((r) => r.date === d).reduce((a, r) => a + r.clicks, 0) * 0.91);
  const directBase = Math.round(jit(94, 0.12) * PESO_DIA[i % 7]);
  const direct = directBase + orfas;
  const organic = Math.round(jit(206, 0.11) * PESO_DIA[i % 7]);
  const referral = Math.round(jit(34, 0.22) * PESO_DIA[i % 7]);
  const email = Math.round(jit(43, 0.3) * PESO_DIA[i % 7]);

  const canais = [
    { canal: "paid_social", source: "facebook", medium: "paid_social", sessions: paidSocial, conv: rows.reduce((a, r) => a + r.conversions, 0) - (rowAfet && afetadoEm(d) ? 0 : 0) },
    { canal: "paid_search", source: "google", medium: "cpc", sessions: paidSearch, conv: gRows.filter((r) => r.date === d).reduce((a, r) => a + r.conversions, 0) },
    { canal: "direct", source: "(direct)", medium: "(none)", sessions: direct, conv: 1 + (orfas ? Math.round(orfas * 0.031) : 0) },
    { canal: "organic_search", source: "google", medium: "organic", sessions: organic, conv: Math.round(organic * 0.012) },
    { canal: "referral", source: "blog.housewhey.com.br", medium: "referral", sessions: referral, conv: Math.round(referral * 0.01) },
    { canal: "email", source: "rdstation", medium: "email", sessions: email, conv: Math.round(email * 0.02) },
  ];
  // conversões de paid_social caem junto com as sessões órfãs
  canais[0].conv = rows.reduce((a, r) => a + (r.ad_name === AD_AFETADO && afetadoEm(d) ? (d === DATA_TROCA ? Math.round(r.conversions * FRACAO_DIA_TROCA) : 0) : r.conversions), 0);

  for (const c of canais)
    gaCanais.push({ date: d, canal_agrupado: c.canal, source: c.source, medium: c.medium, sessions: c.sessions, usuarios: Math.round(c.sessions * 0.86), conversoes: c.conv });

  const porLp = {
    [LPS.omega3]: Math.round(paidSocial * 0.46) + Math.round(organic * 0.28) + Math.round(direct * 0.34),
    [LPS.whey]: Math.round(paidSocial * 0.27) + Math.round(organic * 0.24) + Math.round(direct * 0.18),
    [LPS.creatina]: Math.round(paidSocial * 0.16) + Math.round(organic * 0.16) + Math.round(direct * 0.12),
    [LPS.multi]: Math.round(paidSocial * 0.11) + Math.round(organic * 0.1) + Math.round(direct * 0.09),
    "/": Math.round(organic * 0.22) + Math.round(direct * 0.27) + paidSearch + referral + email,
  };
  for (const [lp, s] of Object.entries(porLp))
    gaLps.push({ date: d, landing_page: lp, sessions: s, conversoes: Math.round(s * 0.021) });
}
w("ga.json", {
  _aviso: "DADOS FICTÍCIOS gerados para o desafio AdzHub.",
  propriedade: { property_id: "properties/419883210", nome: "Housewhey — GA4", fuso: "America/Sao_Paulo" },
  periodo: { inicio: INICIO, fim: FIM },
  sessoes_por_canal_dia: gaCanais,
  sessoes_por_landing_page_dia: gaLps,
});

// ---------- criativos.json ----------
const COPY = {
  [AD_AFETADO]: { headline: "12 mil pessoas já trocaram o ômega 3 de farmácia pelo nosso", corpo: "1000mg por cápsula, com 660mg de EPA+DHA de verdade — não aquele rótulo que soma tudo e entrega pouco. Óleo purificado por destilação molecular, certificado IFOS, e sem o refluxo com gosto de peixe. Cada lote tem laudo aberto no site. Frete grátis acima de R$ 199." },
  omega3_vid_depoimento_dra_v3: { headline: "A nutricionista explica por que a maioria dos ômegas 3 não funciona", corpo: "A conta que quase ninguém faz: 1000mg de óleo de peixe não é 1000mg de ômega 3. O que importa é o EPA + DHA. No nosso são 660mg por cápsula, com laudo de pureza por lote. Dose real, resultado real." },
  omega3_carrossel_beneficios_v1: { headline: "Conheça os benefícios do Ômega 3", corpo: "O ômega 3 auxilia na saúde do coração, do cérebro e das articulações, e faz parte de uma rotina equilibrada. Confira a linha completa Housewhey e escolha a sua." },
  omega3_est_oferta_frete_v1: { headline: "3 potes de Ômega 3 por R$ 189 — frete grátis pro Brasil inteiro", corpo: "São 3 meses de tratamento pelo preço de menos de R$ 2,10 por dia. Estoque limitado do lote de agosto." },
  omega3_vid_ugc_rotina_v1: { headline: "Minha rotina de suplementação leva 40 segundos (e três potes)", corpo: "Vídeo UGC, gravado no celular, sem trilha: a cliente mostra os potes na bancada da cozinha e conta o que mudou nos exames em 4 meses. Sem promessa de cura, sem antes e depois de corpo — só a rotina e o laudo do lote na tela." },
  whey_vid_receita_shake_v2: { headline: "Shake de whey com banana em 40 segundos", corpo: "Uma dose, 200ml de leite, meia banana e gelo. 24g de proteína por dose, 8 sabores, e sem aquele gosto artificial que sobra na boca." },
  whey_carrossel_sabores_v3: { headline: "8 sabores. Zero desculpa pra pular a dose.", corpo: "Do baunilha clássico ao doce de leite. Todos com 24g de proteína por dose e rótulo auditado. Escolha o seu e monte o kit." },
  whey_est_combo_v1: { headline: "Combo Whey + Coqueteleira", corpo: "Leve o pote de 900g e ganhe a coqueteleira Housewhey. Confira as condições no site." },
  whey_est_combo_setembro_v1: { headline: "Combo de setembro: Whey 900g + Creatina 300g por R$ 289", corpo: "O par que a maioria dos nossos clientes já compra junto, agora com R$ 118 de desconto. Válido de 01 a 15 de setembro ou enquanto durar o lote." },
  creatina_vid_treino_v1: { headline: "3g por dia. Todo dia. É literalmente isso.", corpo: "Creatina monohidratada Creapure®, sem sabor, sem ciclo, sem fase de saturação obrigatória. O suplemento mais estudado do mundo não precisa de marketing — precisa de constância." },
  creatina_est_pote_v2: { headline: "Creatina monohidratada 300g", corpo: "Pote de 300g, 100 doses. Confira no site." },
  multi_est_remarketing_v1: { headline: "Você deixou o multivitamínico no carrinho", corpo: "Ainda dá tempo: finalize em até 24h e o frete continua por nossa conta." },
  multi_carrossel_kit_v1: { headline: "Monte seu kit e economize 18%", corpo: "Escolha 3 itens da linha Housewhey e o desconto entra sozinho no carrinho. Sem cupom, sem pegadinha." },
};
const EM_APROVACAO = {
  omega3_vid_ugc_rotina_v1: { campanha: "HW | Ômega 3 | Conversão | Ago", formato: "video", cta: "Comprar agora", enviado_em: "2026-08-20", aguarda: "Rafael Menezes (Housewhey)" },
  whey_est_combo_setembro_v1: { campanha: "HW | Whey Protein | Conversão | Ago", formato: "estatico", cta: "Quero o combo", enviado_em: "2026-08-21", aguarda: "Rafael Menezes (Housewhey)" },
};

const criativos = ADS.map((ad) => {
  const rows = insights.filter((r) => r.ad_id === ad.ad_id);
  const agg = (sel) => rows.reduce((a, r) => a + sel(r), 0);
  const spend = r2(agg((r) => r.spend)), clicks = agg((r) => r.clicks), imp = agg((r) => r.impressions), conv = agg((r) => r.conversions);
  const saturado = ad.nome === "omega3_carrossel_beneficios_v1";
  return {
    id: ad.ad_id, nome: ad.nome, campanha: CAMPANHAS[ad.camp].nome, adset: ad.adset,
    produto: CAMPANHAS[ad.camp].produto, formato: ad.formato,
    copy: COPY[ad.nome], cta: ad.cta,
    status: "ativo",
    data_subida: ad.desde,
    autor: ad.formato === "video" ? "Luiza Prado" : "Luiza Prado",
    link: ad.nome === AD_AFETADO ? ENCURTADOR : linkPadrao(ad.camp, ad.nome),
    link_original: ad.nome === AD_AFETADO ? linkPadrao(ad.camp, ad.nome) : undefined,
    utm_content: ad.nome === AD_AFETADO ? "" : ad.nome,
    metricas: {
      spend, impressions: imp, clicks, ctr: r2((clicks / imp) * 100), cpc: r2(spend / clicks),
      frequency_media: r2(rows.reduce((a, r) => a + r.frequency, 0) / rows.length),
      conversions: conv, cpa: r2(spend / conv),
    },
    metricas_por_semana: [0, 1, 2, 3].map((s) => {
      const rs = rows.filter((r) => r.date >= SEMANAS[s].inicio && r.date <= SEMANAS[s].fim);
      if (!rs.length) return { semana: SEMANAS[s].rotulo, sem_veiculacao: true };
      const sp = r2(rs.reduce((a, r) => a + r.spend, 0)), cl = rs.reduce((a, r) => a + r.clicks, 0);
      const im = rs.reduce((a, r) => a + r.impressions, 0), cv = rs.reduce((a, r) => a + r.conversions, 0);
      return { semana: SEMANAS[s].rotulo, spend: sp, ctr: r2((cl / im) * 100), cpc: r2(sp / cl),
        frequency: r2(rs.reduce((a, r) => a + r.frequency, 0) / rs.length), conversions: cv, cpa: r2(cv ? sp / cv : 0) };
    }),
    observacao: saturado
      ? "Frequência subiu de 2,1 para 5,6 e o CTR caiu de 1,92% para 0,71% em 4 semanas. CPA quase dobrou. Público esgotado — candidato legítimo a pausa."
      : ad.nome === AD_AFETADO
        ? `Link trocado por encurtador em ${DATA_TROCA}. O anúncio continua vendendo (o pixel registra), mas as UTMs não chegam mais ao CRM.`
        : ["whey_est_combo_v1", "creatina_est_pote_v2"].includes(ad.nome)
          ? "CTA genérico e copy sem oferta concreta. CTR abaixo de 1%."
          : undefined,
  };
}).concat(Object.entries(EM_APROVACAO).map(([nome, m], i) => ({
  id: `rascunho_${i + 1}`, nome, campanha: m.campanha,
  produto: m.campanha.includes("Ômega") ? "Ômega 3" : "Whey Protein",
  formato: m.formato, copy: COPY[nome], cta: m.cta,
  status: "em_aprovacao", data_subida: null, autor: "Luiza Prado",
  link: null, utm_content: nome, metricas: null, metricas_por_semana: [],
  aprovacao: { enviado_em: m.enviado_em, aguarda: m.aguarda, dias_parado: Math.round((HOJE - Date.parse(m.enviado_em + "T00:00:00Z")) / 86400000) },
})));

w("criativos.json", {
  _aviso: "DADOS FICTÍCIOS gerados para o desafio AdzHub.",
  periodo: { inicio: INICIO, fim: FIM },
  ctas_fracos: ["Saiba mais", "Ver mais", "Conheça"],
  criativos: JSON.parse(JSON.stringify(criativos)),
});

// ---------- supercerebro.json ----------
const nodes = [
  { id: "cliente_housewhey", type: "cliente", label: "Housewhey", props: { segmento: "E-commerce de suplementos", site: SITE, agencia: "SPOT", cliente_desde: "2026-06-15", verba_midia_mensal: 18000, fee_agencia_mensal: 4500, ticket_medio: 186, crm: "RD Station" } },
  { id: "pessoa_aline", type: "pessoa", label: "Aline Ferraz", props: { papel: "Gestora de tráfego", empresa: "SPOT", email: "aline@spot.ag", decisoes: "verba, escala, pausa de campanha" } },
  { id: "pessoa_carolina", type: "pessoa", label: "Carolina Nunes", props: { papel: "Analista de performance", empresa: "SPOT", email: "carolina@spot.ag", decisoes: "setup de anúncio, UTMs, relatórios" } },
  { id: "pessoa_luiza", type: "pessoa", label: "Luiza Prado", props: { papel: "Criação e copy", empresa: "SPOT", email: "luiza@spot.ag", decisoes: "roteiro, headline, CTA" } },
  { id: "pessoa_rafael", type: "pessoa", label: "Rafael Menezes", props: { papel: "Head de Marketing", empresa: "Housewhey", email: "rafael@housewhey.com.br", decisoes: "aprovação de criativo, verba, calendário promocional" } },
  { id: "pessoa_bianca", type: "pessoa", label: "Bianca Torres", props: { papel: "Analista de e-commerce", empresa: "Housewhey", email: "bianca@housewhey.com.br", decisoes: "estoque, preço, frete" } },

  { id: "produto_omega3", type: "produto", label: "Ômega 3 1000mg", props: { preco: 89, combo_3_potes: 189, margem: 0.58, lp: LPS.omega3, prioridade: "linha principal do trimestre" } },
  { id: "produto_whey", type: "produto", label: "Whey Protein Concentrado 900g", props: { preco: 249, margem: 0.41, lp: LPS.whey } },
  { id: "produto_creatina", type: "produto", label: "Creatina Monohidratada 300g", props: { preco: 159, margem: 0.47, lp: LPS.creatina } },
  { id: "produto_multi", type: "produto", label: "Multivitamínico A-Z", props: { preco: 99, margem: 0.52, lp: LPS.multi } },

  { id: "canal_meta_ads", type: "canal", label: "Meta Ads", props: { conta: "act_318842907", verba_mensal: 15000 } },
  { id: "canal_google_ads", type: "canal", label: "Google Ads", props: { conta: "784-119-3320", verba_mensal: 3000 } },
  { id: "canal_ga4", type: "canal", label: "Google Analytics 4", props: { property_id: "properties/419883210", papel: "fonte de verdade de tráfego" } },
  { id: "canal_crm", type: "canal", label: "CRM (RD Station)", props: { papel: "fonte de verdade de venda", join: "utm_content" } },
  { id: "canal_whatsapp", type: "canal", label: "WhatsApp — Grupo SPOT × Housewhey", props: { participantes: 5 } },
];
for (const [k, c] of Object.entries(CAMPANHAS))
  nodes.push({ id: `campanha_${k}`, type: "campanha", label: c.nome, props: { plataforma: "Meta Ads", campaign_id: c.id, objetivo: c.objetivo, verba_diaria: c.verba_diaria, status: "ativa", utm_campaign: c.utm_campaign } });
for (const c of GCAMP)
  nodes.push({ id: `gcampanha_${c.utm_content}`, type: "campanha", label: c.nome, props: { plataforma: "Google Ads", campaign_id: c.id, tipo: c.tipo, verba_diaria: r2(c.spendSem / 7), status: "ativa", utm_content: c.utm_content } });
for (const cr of criativos)
  nodes.push({ id: `criativo_${cr.nome}`, type: "criativo", label: cr.nome, props: { formato: cr.formato, cta: cr.cta, status: cr.status, produto: cr.produto, cpa: cr.metricas?.cpa ?? null, ctr: cr.metricas?.ctr ?? null } });

const tarefas = [
  { id: "tarefa_aprovar_ugc", label: "Aprovar omega3_vid_ugc_rotina_v1", props: { status: "aguardando_cliente", desde: "2026-08-20", prazo: "2026-08-27", impacto: "É a substituição planejada do carrossel saturado. Cada dia parado é verba rodando no criativo velho." } },
  { id: "tarefa_aprovar_combo_setembro", label: "Aprovar whey_est_combo_setembro_v1", props: { status: "aguardando_cliente", desde: "2026-08-21", prazo: "2026-08-28", impacto: "A campanha precisa subir dia 01/09; sem aprovação até 28/08 o combo perde a primeira quinzena." } },
  { id: "tarefa_investigar_cpa_omega3", label: "Investigar queda das vendas atribuídas de Ômega 3", props: { status: "em_andamento", desde: "2026-08-18", prazo: "2026-08-27", responsavel: "Carolina Nunes", impacto: "Rafael cobrou explicação em 19/08. O faturamento não caiu; o relatório de atribuição sim." } },
  { id: "tarefa_pausar_carrossel", label: "Pausar omega3_carrossel_beneficios_v1 e subir substituto", props: { status: "proposta", desde: "2026-08-24", prazo: "2026-08-27", responsavel: "Aline Ferraz", impacto: "Frequência 5,6 e CTR 0,71%. R$ 380 na última semana para 4 conversões." } },
  { id: "tarefa_verba_setembro", label: "Fechar verba de setembro", props: { status: "aguardando_decisao", desde: "2026-08-22", prazo: "2026-08-29", impacto: "Rafael sinalizou possível aumento para R$ 22.000 se a Ômega 3 comprovar retorno." } },
];
for (const t of tarefas) nodes.push({ id: t.id, type: "tarefa", label: t.label, props: t.props });

const edges = [
  { from: "cliente_housewhey", to: "canal_meta_ads", rel: "veicula_em" },
  { from: "cliente_housewhey", to: "canal_google_ads", rel: "veicula_em" },
  { from: "cliente_housewhey", to: "canal_ga4", rel: "mede_em" },
  { from: "cliente_housewhey", to: "canal_crm", rel: "mede_em" },
  { from: "cliente_housewhey", to: "canal_whatsapp", rel: "conversa_em" },
  { from: "pessoa_aline", to: "cliente_housewhey", rel: "gerencia", props: { desde: "2026-06-15" } },
  { from: "pessoa_carolina", to: "cliente_housewhey", rel: "atende" },
  { from: "pessoa_luiza", to: "cliente_housewhey", rel: "atende" },
  { from: "pessoa_rafael", to: "cliente_housewhey", rel: "trabalha_em" },
  { from: "pessoa_bianca", to: "cliente_housewhey", rel: "trabalha_em" },
  { from: "pessoa_carolina", to: "pessoa_aline", rel: "reporta_para" },
  { from: "pessoa_luiza", to: "pessoa_aline", rel: "reporta_para" },
];
for (const [k, c] of Object.entries(CAMPANHAS)) {
  edges.push({ from: `campanha_${k}`, to: "cliente_housewhey", rel: "pertence_a" });
  edges.push({ from: `campanha_${k}`, to: "canal_meta_ads", rel: "veicula_em" });
  edges.push({ from: `campanha_${k}`, to: `produto_${k}`, rel: "promove" });
  edges.push({ from: "pessoa_aline", to: `campanha_${k}`, rel: "responsavel_por" });
}
for (const c of GCAMP) {
  edges.push({ from: `gcampanha_${c.utm_content}`, to: "cliente_housewhey", rel: "pertence_a" });
  edges.push({ from: `gcampanha_${c.utm_content}`, to: "canal_google_ads", rel: "veicula_em" });
  edges.push({ from: "pessoa_aline", to: `gcampanha_${c.utm_content}`, rel: "responsavel_por" });
}
const campDeNome = {};
for (const [k, c] of Object.entries(CAMPANHAS)) campDeNome[c.nome] = `campanha_${k}`;
for (const cr of criativos) {
  edges.push({ from: `criativo_${cr.nome}`, to: campDeNome[cr.campanha], rel: "pertence_a" });
  edges.push({ from: "pessoa_luiza", to: `criativo_${cr.nome}`, rel: "criou" });
  if (cr.status === "em_aprovacao")
    edges.push({ from: `criativo_${cr.nome}`, to: "pessoa_rafael", rel: "aguarda_aprovacao_de", props: { desde: cr.aprovacao.enviado_em } });
}
edges.push(
  { from: "pessoa_carolina", to: `criativo_${AD_AFETADO}`, rel: "alterou", props: { quando: "2026-08-11T09:12:00-03:00", o_que: "trocou a URL de destino pelo encurtador hwy.link/o3ps" } },
  { from: `criativo_${AD_AFETADO}`, to: "tarefa_investigar_cpa_omega3", rel: "causa_provavel_de" },
  { from: "criativo_omega3_carrossel_beneficios_v1", to: "tarefa_pausar_carrossel", rel: "motivo_de" },
  { from: "criativo_omega3_vid_ugc_rotina_v1", to: "tarefa_aprovar_ugc", rel: "objeto_de" },
  { from: "criativo_whey_est_combo_setembro_v1", to: "tarefa_aprovar_combo_setembro", rel: "objeto_de" },
  { from: "tarefa_aprovar_ugc", to: "pessoa_rafael", rel: "aguarda_aprovacao_de" },
  { from: "tarefa_aprovar_combo_setembro", to: "pessoa_rafael", rel: "aguarda_aprovacao_de" },
  { from: "tarefa_verba_setembro", to: "pessoa_rafael", rel: "aguarda_aprovacao_de" },
  { from: "tarefa_investigar_cpa_omega3", to: "pessoa_carolina", rel: "responsavel_por" },
  { from: "tarefa_pausar_carrossel", to: "pessoa_aline", rel: "responsavel_por" },
  { from: "tarefa_aprovar_ugc", to: "campanha_omega3", rel: "impacta" },
  { from: "tarefa_pausar_carrossel", to: "campanha_omega3", rel: "impacta" },
  { from: "tarefa_investigar_cpa_omega3", to: "campanha_omega3", rel: "impacta" },
  { from: "pessoa_rafael", to: "campanha_omega3", rel: "aprovou", props: { quando: "2026-07-20" } },
);

w("supercerebro.json", {
  _aviso: "DADOS FICTÍCIOS gerados para o desafio AdzHub.",
  gerado_em: "2026-08-26",
  conta: "Housewhey",
  nodes, edges,
});

// ---------- timeline.json ----------
const eventos = [
  { ts: "2026-06-15T10:00:00-03:00", tipo: "onboarding", ator: "Aline Ferraz", entidades: ["cliente_housewhey", "pessoa_aline", "pessoa_rafael"],
    resumo: "SPOT assume a operação de mídia da Housewhey. Verba inicial de R$ 18.000/mês (R$ 15.000 Meta + R$ 3.000 Google). Rafael Menezes é o ponto único de aprovação do lado do cliente; Bianca Torres cuida de estoque e preço." },
  { ts: "2026-06-22T14:20:00-03:00", tipo: "briefing", ator: "Rafael Menezes", entidades: ["cliente_housewhey", "produto_omega3", "canal_whatsapp"],
    resumo: "Briefing da linha Ômega 3 pelo grupo de WhatsApp. É a linha de maior margem (58%) e a prioridade do trimestre.",
    trecho: "Rafael: \"Foca em Ômega 3 no Q3. É onde a margem está e onde a gente perde pra farmácia por causa de preço, não de produto. Se a comunicação explicar EPA e DHA direito, a gente ganha. Whey e creatina mantém rodando, mas sem escalar.\"" },
  { ts: "2026-07-18T11:05:00-03:00", tipo: "briefing", ator: "Luiza Prado", entidades: ["produto_omega3", "criativo_omega3_carrossel_beneficios_v1", "criativo_omega3_vid_depoimento_dra_v3", "criativo_omega3_est_oferta_frete_v1"],
    resumo: "Luiza entrega o primeiro pacote de criativos de Ômega 3: um carrossel de benefícios, um vídeo com nutricionista e um estático de oferta de frete. Rafael aprova os três sem alteração." },
  { ts: "2026-07-20T09:40:00-03:00", tipo: "alteracao_campanha", ator: "Aline Ferraz", entidades: ["campanha_omega3", "canal_meta_ads"],
    resumo: "Campanha \"HW | Ômega 3 | Conversão | Ago\" sobe com R$ 280/dia. Padrão de UTM definido com Carolina: utm_content = nome do anúncio, sempre." },
  { ts: "2026-07-31T15:10:00-03:00", tipo: "alteracao_campanha", ator: "Carolina Nunes", entidades: ["campanha_omega3", `criativo_${AD_AFETADO}`],
    resumo: "Sobe o omega3_vid_prova_social_v2 (vídeo de prova social, CTA \"Comprar agora\") com R$ 110/dia. Vira o melhor anúncio da conta em 3 dias: CPA de R$ 30." },
  { ts: "2026-08-06T16:00:00-03:00", tipo: "reuniao", ator: "Aline Ferraz", entidades: ["cliente_housewhey", "campanha_omega3", "criativo_omega3_carrossel_beneficios_v1"],
    resumo: "Call semanal. Decisões: (1) escalar o prova social; (2) Luiza produz um UGC para substituir o carrossel de benefícios, que já dava sinal de desgaste; (3) manter whey e creatina no piloto automático.",
    trecho: "Carolina: \"O carrossel já tá em frequência 3,2 e o CTR caiu de 1,9 pra 1,5. Ele ainda paga, mas não por muito tempo.\" — Aline: \"Deixa rodar mais duas semanas enquanto a Luiza produz o substituto.\"" },
  { ts: "2026-08-10T10:15:00-03:00", tipo: "alerta", ator: "Carolina Nunes", entidades: ["criativo_omega3_carrossel_beneficios_v1"],
    resumo: "Alerta de frequência: carrossel_beneficios_v1 passa de 4,4 com CTR em 1,05%. CPA da semana em R$ 81 contra R$ 43 na primeira semana." },
  { ts: "2026-08-11T09:12:00-03:00", tipo: "alteracao_campanha", ator: "Carolina Nunes", entidades: [`criativo_${AD_AFETADO}`, "campanha_omega3", "canal_meta_ads"],
    resumo: "CAUSA-RAIZ: às 09:12, a pedido do Rafael, Carolina troca a URL de destino do omega3_vid_prova_social_v2 pelo encurtador hwy.link/o3ps, para que o link caiba no card de compartilhamento do WhatsApp e o cliente consiga contar cliques na ferramenta dele. O encurtador redireciona sem repassar a query string — as UTMs param de chegar ao site a partir desse momento.",
    trecho: "Rafael: \"Dá pra encurtar esse link? No WhatsApp ele vira um monstro e ninguém clica.\" — Carolina: \"Dá sim, troco agora.\"" },
  { ts: "2026-08-11T09:40:00-03:00", tipo: "whatsapp", ator: "Rafael Menezes", entidades: ["canal_whatsapp", `criativo_${AD_AFETADO}`],
    resumo: "Rafael confirma no grupo que o link encurtado ficou melhor para compartilhar. Ninguém revisa o efeito nas UTMs." },
  { ts: "2026-08-13T09:00:00-03:00", tipo: "reuniao", ator: "Aline Ferraz", entidades: ["cliente_housewhey", "campanha_omega3"],
    resumo: "Call semanal. O relatório de atribuição já mostra queda nas vendas de Ômega 3, mas o time lê como sazonalidade de meio de mês. Decisão: aumentar a verba do prova social, que continua com o melhor CPA no gerenciador." },
  { ts: "2026-08-14T11:20:00-03:00", tipo: "alteracao_campanha", ator: "Aline Ferraz", entidades: [`criativo_${AD_AFETADO}`, "campanha_omega3"],
    resumo: "Verba do omega3_vid_prova_social_v2 sobe de R$ 100 para R$ 128/dia. Efeito colateral: o buraco de atribuição cresce junto com a verba." },
  { ts: "2026-08-18T08:50:00-03:00", tipo: "alerta", ator: "Carolina Nunes", entidades: ["campanha_omega3", "tarefa_investigar_cpa_omega3"],
    resumo: "Alerta no relatório de atribuição: CPA aparente da Ômega 3 estoura. Leads com utm_content preenchido caem 59% contra a semana de 03–09/08, enquanto o Meta reporta MAIS conversões." },
  { ts: "2026-08-19T14:30:00-03:00", tipo: "whatsapp", ator: "Rafael Menezes", entidades: ["canal_whatsapp", "cliente_housewhey", "tarefa_investigar_cpa_omega3"],
    resumo: "Rafael cobra explicação no grupo. O faturamento da loja não caiu; o relatório da agência diz que caiu.",
    trecho: "Rafael: \"Gente, o faturamento aqui tá normal, agosto até melhor que julho. Mas o relatório de vocês diz que a Ômega 3 caiu quase 60%. Uma das duas contas tá errada e eu preciso saber qual antes da reunião de quinta.\"" },
  { ts: "2026-08-20T10:00:00-03:00", tipo: "aprovacao", ator: "Luiza Prado", entidades: ["criativo_omega3_vid_ugc_rotina_v1", "tarefa_aprovar_ugc", "pessoa_rafael"],
    resumo: "UGC de Ômega 3 (omega3_vid_ugc_rotina_v1) enviado para aprovação do Rafael. É o substituto planejado do carrossel saturado. PENDENTE." },
  { ts: "2026-08-21T17:40:00-03:00", tipo: "aprovacao", ator: "Luiza Prado", entidades: ["criativo_whey_est_combo_setembro_v1", "tarefa_aprovar_combo_setembro", "pessoa_rafael"],
    resumo: "Combo de setembro (Whey 900g + Creatina 300g por R$ 289) enviado para aprovação. Precisa subir dia 01/09. PENDENTE." },
  { ts: "2026-08-22T15:00:00-03:00", tipo: "whatsapp", ator: "Rafael Menezes", entidades: ["canal_whatsapp", "tarefa_verba_setembro"],
    resumo: "Rafael sinaliza que pode subir a verba de setembro de R$ 18.000 para R$ 22.000, condicionado a entender o que aconteceu com a Ômega 3. Decisão PENDENTE." },
  { ts: "2026-08-24T09:15:00-03:00", tipo: "alerta", ator: "Carolina Nunes", entidades: ["criativo_omega3_carrossel_beneficios_v1", "tarefa_pausar_carrossel"],
    resumo: "Carrossel de benefícios fecha a semana com frequência 5,6 e CTR 0,71%. R$ 380 gastos para 4 conversões (CPA R$ 95, contra R$ 30 do prova social). Proposta de pausa registrada." },
  { ts: "2026-08-25T18:30:00-03:00", tipo: "reuniao", ator: "Aline Ferraz", entidades: ["cliente_housewhey"],
    resumo: "Call semanal com a Housewhey confirmada para 27/08 às 10h. Pauta em aberto: explicar a Ômega 3, decidir a pausa do carrossel, destravar as duas aprovações e fechar a verba de setembro." },
];
w("timeline.json", {
  _aviso: "DADOS FICTÍCIOS gerados para o desafio AdzHub. Conversas parafraseadas, não transcritas.",
  conta: "Housewhey",
  periodo: { inicio: "2026-06-15", fim: "2026-08-27", hoje: "2026-08-26" },
  tipos: ["onboarding", "briefing", "reuniao", "whatsapp", "alteracao_campanha", "aprovacao", "alerta"],
  eventos: eventos.sort((a, b) => a.ts.localeCompare(b.ts)),
});

console.log("ok:", leads.length, "leads,", insights.length, "linhas meta,", nodes.length, "nós,", edges.length, "edges");
