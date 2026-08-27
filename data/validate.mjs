// Valida a coerência interna dos mocks da Housewhey. Sem dependências.
// Uso: node data/validate.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const ler = (n) => JSON.parse(readFileSync(join(DIR, n), "utf8"));

const meta = ler("meta_ads.json");
const google = ler("google_ads.json");
const ga = ler("ga.json");
const crm = ler("crm.json");
const criativos = ler("criativos.json");
const cerebro = ler("supercerebro.json");
const timeline = ler("timeline.json");

const r2 = (n) => Math.round(n * 100) / 100;
const soma = (a, f) => a.reduce((s, x) => s + f(x), 0);
const INICIO = meta.periodo.inicio, FIM = meta.periodo.fim;
const SEM = meta.periodo.semanas;
const semanaDe = (d) => SEM.find((s) => d >= s.inicio && d <= s.fim);
const ok = [];
const check = (nome, fn) => { fn(); ok.push(nome); };

// 1. gasto por criativo soma o gasto por campanha
check("1. spend por anúncio soma o spend da campanha (Meta e Google)", () => {
  for (const c of meta.campanhas) {
    const rows = meta.insights.filter((r) => r.campaign_id === c.campaign_id);
    assert.ok(Math.abs(soma(rows, (r) => r.spend) - c.spend_total) < 0.05, `${c.campaign}: soma dos anúncios ≠ spend_total`);
    assert.equal(soma(rows, (r) => r.conversions), c.conversions_total, `${c.campaign}: conversões não fecham`);
    const ids = new Set(rows.map((r) => r.ad_id));
    assert.deepEqual([...ids].sort(), [...c.ads].sort(), `${c.campaign}: lista de ads divergente`);
  }
  for (const c of google.campanhas) {
    const rows = google.insights.filter((r) => r.campaign_id === c.campaign_id);
    assert.ok(Math.abs(soma(rows, (r) => r.spend) - c.spend_total) < 0.05, `${c.campaign}: spend não fecha`);
  }
  // criativos.json tem que espelhar o agregado do Meta
  for (const cr of criativos.criativos.filter((x) => x.metricas)) {
    const rows = meta.insights.filter((r) => r.ad_id === cr.id);
    assert.ok(rows.length, `${cr.nome}: sem insights no Meta`);
    assert.ok(Math.abs(soma(rows, (r) => r.spend) - cr.metricas.spend) < 0.05, `${cr.nome}: spend agregado divergente`);
    assert.equal(soma(rows, (r) => r.conversions), cr.metricas.conversions, `${cr.nome}: conversões agregadas divergentes`);
  }
});

// 2. todo utm_content do CRM existe no Meta ou no Google
const utmMeta = new Set(meta.insights.map((r) => r.utm_content).filter(Boolean));
const utmGoogle = new Set(google.insights.map((r) => r.utm_content).filter(Boolean));
check("2. todo utm_content do CRM existe em Meta ou Google", () => {
  for (const l of crm.leads) {
    if (!l.utm_content) continue;
    assert.ok(utmMeta.has(l.utm_content) || utmGoogle.has(l.utm_content), `utm_content órfão no CRM: ${l.utm_content}`);
  }
});

// 3/4. buraco de atribuição
const semLead = (l) => semanaDe(l.created_at.slice(0, 10));
const porSemana = SEM.map((s) => {
  const leads = crm.leads.filter((l) => semLead(l)?.indice === s.indice);
  const metaRows = meta.insights.filter((r) => semanaDe(r.date)?.indice === s.indice);
  const gRows = google.insights.filter((r) => semanaDe(r.date)?.indice === s.indice);
  return {
    semana: s.rotulo, inicio: s.inicio, fim: s.fim,
    meta_spend: r2(soma(metaRows, (r) => r.spend)),
    meta_conversions: soma(metaRows, (r) => r.conversions),
    google_conversions: soma(gRows, (r) => r.conversions),
    leads_total: leads.length,
    leads_meta: leads.filter((l) => l.utm_medium === "paid_social").length,
    leads_google: leads.filter((l) => l.utm_medium === "cpc").length,
    leads_sem_origem: leads.filter((l) => !l.utm_content).length,
    leads_omega3_atribuidos: leads.filter((l) => l.produto === "Ômega 3" && l.utm_content).length,
    receita: r2(soma(leads.filter((l) => l.estagio === "ganho"), (l) => l.valor)),
  };
});

// baseline de leads sem origem = média diária ANTES da troca do link (27/07 a 10/08)
const TROCA = "2026-08-11";
const diasPre = (Date.parse(TROCA) - Date.parse(INICIO)) / 86400000;
const semOrigemPre = crm.leads.filter((l) => !l.utm_content && l.created_at.slice(0, 10) < TROCA).length;
const baselineDia = semOrigemPre / diasPre;
for (const s of porSemana) s.buraco_atribuicao = Math.round(s.leads_sem_origem - baselineDia * 7);

check("3. leads (atribuídos + buraco) batem com as conversões de mídia", () => {
  for (const s of porSemana) {
    const esperado = s.meta_conversions + s.google_conversions;
    const observado = s.leads_meta + s.leads_google + s.buraco_atribuicao;
    const erro = Math.abs(observado - esperado) / esperado;
    assert.ok(erro < 0.08, `${s.semana}: leads(${observado}) vs conversões(${esperado}), erro ${(erro * 100).toFixed(1)}%`);
  }
  const totalMidia = soma(meta.insights, (r) => r.conversions) + soma(google.insights, (r) => r.conversions);
  const totalAtrib = crm.leads.filter((l) => l.utm_content).length;
  const totalSem = crm.leads.filter((l) => !l.utm_content).length;
  assert.ok(totalAtrib + totalSem === crm.leads.length && crm.leads.length === crm.total_leads);
  assert.ok(totalAtrib <= totalMidia, "leads atribuídos não podem exceder as conversões de mídia");
});

const anterior = porSemana[2], atual = porSemana[3];
check("4. o buraco de atribuição da semana atual > o da semana anterior", () => {
  assert.ok(atual.buraco_atribuicao > anterior.buraco_atribuicao,
    `atual ${atual.buraco_atribuicao} não é maior que anterior ${anterior.buraco_atribuicao}`);
  assert.ok(porSemana[0].buraco_atribuicao <= 2 && porSemana[1].buraco_atribuicao <= 2, "semanas pré-troca deveriam ter buraco ~0");
  // o buraco tem que ser explicado pelas conversões do anúncio afetado
  const afetado = meta.insights.filter((r) => r.ad_name === "omega3_vid_prova_social_v2" && r.utm_content === "" && semanaDe(r.date)?.indice === 3);
  const conv = soma(afetado, (r) => r.conversions);
  assert.ok(Math.abs(conv - atual.buraco_atribuicao) <= Math.max(3, conv * 0.15),
    `buraco (${atual.buraco_atribuicao}) não é explicado pelas conversões do anúncio afetado (${conv})`);
  // e o Meta NÃO caiu: é a atribuição que caiu
  assert.ok(atual.meta_conversions >= anterior.meta_conversions, "o Meta deveria manter/subir as conversões");
  assert.ok(atual.leads_omega3_atribuidos < porSemana[1].leads_omega3_atribuidos * 0.6, "Ômega 3 atribuída deveria despencar");
});

// 5. integridade do grafo
check("5. todo from/to de edges existe em nodes", () => {
  const ids = new Set(cerebro.nodes.map((n) => n.id));
  assert.equal(ids.size, cerebro.nodes.length, "ids duplicados em nodes");
  for (const e of cerebro.edges) {
    assert.ok(ids.has(e.from), `edge.from inexistente: ${e.from}`);
    assert.ok(ids.has(e.to), `edge.to inexistente: ${e.to}`);
    assert.ok(e.rel, "edge sem rel");
  }
  // o caminho exigido: Housewhey ↔ Aline ↔ Ômega 3 ↔ Meta Ads ↔ criativos ↔ aprovação pendente
  const tem = (f, r, t) => cerebro.edges.some((e) => e.from === f && e.rel === r && e.to === t);
  assert.ok(tem("pessoa_aline", "gerencia", "cliente_housewhey"));
  assert.ok(tem("pessoa_aline", "responsavel_por", "campanha_omega3"));
  assert.ok(tem("campanha_omega3", "veicula_em", "canal_meta_ads"));
  assert.ok(tem("campanha_omega3", "promove", "produto_omega3"));
  assert.ok(tem("criativo_omega3_vid_prova_social_v2", "pertence_a", "campanha_omega3"));
  assert.ok(cerebro.edges.some((e) => e.rel === "aguarda_aprovacao_de" && e.to === "pessoa_rafael"), "sem aprovação pendente no grafo");
  // toda entidade citada na timeline existe no grafo
  for (const ev of timeline.eventos)
    for (const id of ev.entidades) assert.ok(ids.has(id), `timeline cita entidade inexistente: ${id} (${ev.ts})`);
});

// 6. datas dentro do período declarado
check("6. datas dentro dos períodos declarados", () => {
  const noPeriodo = (d, a, b, ctx) => assert.ok(d >= a && d <= b, `data fora do período em ${ctx}: ${d}`);
  for (const r of meta.insights) noPeriodo(r.date, INICIO, FIM, "meta_ads");
  for (const r of google.insights) noPeriodo(r.date, google.periodo.inicio, google.periodo.fim, "google_ads");
  for (const r of ga.sessoes_por_canal_dia) noPeriodo(r.date, ga.periodo.inicio, ga.periodo.fim, "ga canal");
  for (const r of ga.sessoes_por_landing_page_dia) noPeriodo(r.date, ga.periodo.inicio, ga.periodo.fim, "ga lp");
  for (const l of crm.leads) noPeriodo(l.created_at.slice(0, 10), crm.periodo.inicio, crm.periodo.fim, "crm");
  for (const ev of timeline.eventos) noPeriodo(ev.ts.slice(0, 10), timeline.periodo.inicio, timeline.periodo.fim, "timeline");
  const ts = timeline.eventos.map((e) => e.ts);
  assert.deepEqual(ts, [...ts].sort(), "timeline fora de ordem cronológica");
});

// 7. o GA confirma a história (direct sobe, paid_social cai, no mesmo volume)
const gaDia = (canal, de, ate) => soma(ga.sessoes_por_canal_dia.filter((r) => r.canal_agrupado === canal && r.date >= de && r.date <= ate), (r) => r.sessions);
check("7. GA mostra o salto de direct/(none) a partir de 11/08", () => {
  const preD = gaDia("direct", "2026-08-04", "2026-08-10") / 7;
  const posD = gaDia("direct", "2026-08-17", "2026-08-23") / 7;
  const preP = gaDia("paid_social", "2026-08-04", "2026-08-10") / 7;
  const posP = gaDia("paid_social", "2026-08-17", "2026-08-23") / 7;
  assert.ok(posD > preD * 1.5, `direct não saltou (${preD.toFixed(0)} → ${posD.toFixed(0)})`);
  assert.ok(posP < preP, `paid_social não caiu (${preP.toFixed(0)} → ${posP.toFixed(0)})`);
  const ganho = posD - preD, perda = preP - posP;
  assert.ok(Math.abs(ganho - perda) / ganho < 0.3, `volumes não batem: direct +${ganho.toFixed(0)} vs paid_social ${perda.toFixed(0)}`);
});

// 8. o alvo legítimo de pausa (causa secundária)
check("8. existe criativo genuinamente saturado + criativos em aprovação", () => {
  const sat = criativos.criativos.find((c) => c.nome === "omega3_carrossel_beneficios_v1");
  const sem = sat.metricas_por_semana;
  for (let i = 1; i < sem.length; i++) {
    assert.ok(sem[i].ctr < sem[i - 1].ctr, "CTR do saturado deveria cair semana a semana");
    assert.ok(sem[i].frequency > sem[i - 1].frequency, "frequência do saturado deveria subir");
  }
  assert.ok(sem[3].frequency > 5 && sem[3].ctr < 1, "saturado não está saturado o bastante");
  assert.equal(criativos.criativos.filter((c) => c.status === "em_aprovacao").length, 2);
  assert.ok(criativos.criativos.some((c) => c.cta === "Saiba mais" && c.metricas && c.metricas.ctr < 1.5), "sem alvo de CTA fraco");
});

// ---------- relatório ----------
console.log("\n=== VALIDAÇÃO DO DATASET HOUSEWHEY (dados fictícios) ===\n");
for (const o of ok) console.log("  PASS  " + o);

console.log("\n--- resumo semanal ---");
const cols = ["semana", "meta_spend", "meta_conversions", "leads_total", "leads_meta", "leads_sem_origem", "buraco_atribuicao", "leads_omega3_atribuidos", "receita"];
console.log(cols.join(" | "));
for (const s of porSemana) console.log(cols.map((c) => String(s[c])).join(" | "));

console.log("\n--- baseline de leads sem origem (antes de 11/08): " + baselineDia.toFixed(2) + "/dia ---");
console.log("buraco semana anterior (10–16/08): " + anterior.buraco_atribuicao + " leads");
console.log("buraco semana atual   (17–23/08): " + atual.buraco_atribuicao + " leads");
console.log("Ômega 3 atribuída: S2=" + porSemana[1].leads_omega3_atribuidos + " → S3=" + anterior.leads_omega3_atribuidos + " → S4=" + atual.leads_omega3_atribuidos +
  "  (" + Math.round((atual.leads_omega3_atribuidos / porSemana[1].leads_omega3_atribuidos - 1) * 100) + "%)");
console.log("Receita total do CRM: S2=R$ " + porSemana[1].receita + " | S3=R$ " + anterior.receita + " | S4=R$ " + atual.receita);

console.log("\n--- custo por utm_content (Meta × CRM, período todo) ---");
const linhas = [...utmMeta].map((u) => {
  const rows = meta.insights.filter((r) => r.utm_content === u);
  const spend = r2(soma(rows, (r) => r.spend));
  const leads = crm.leads.filter((l) => l.utm_content === u);
  const ganhos = leads.filter((l) => l.estagio === "ganho");
  return { utm_content: u, spend, conv_meta: soma(rows, (r) => r.conversions), leads_crm: leads.length,
    cpl_real: leads.length ? r2(spend / leads.length) : null, receita: r2(soma(ganhos, (l) => l.valor)),
    roas: leads.length ? r2(soma(ganhos, (l) => l.valor) / spend) : null };
}).sort((a, b) => (b.cpl_real ?? 1e9) - (a.cpl_real ?? 1e9));
for (const l of linhas) console.log(`  ${l.utm_content.padEnd(32)} spend R$ ${String(l.spend).padStart(8)} | conv_meta ${String(l.conv_meta).padStart(3)} | leads_crm ${String(l.leads_crm).padStart(3)} | CPL R$ ${String(l.cpl_real).padStart(7)} | ROAS ${l.roas}`);

console.log("\nTODOS OS CHECKS PASSARAM.\n");
