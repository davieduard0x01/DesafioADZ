/**
 * Carregamento dos datasets de `data/`.
 *
 * Regra do projeto: os JSONs são a fonte de verdade e NUNCA são alterados em disco.
 * Aqui só se lê. Cada arquivo é lido uma vez por processo e memoizado em módulo —
 * o custo some depois do primeiro turno e o replay fica determinístico.
 *
 * Nada daqui entra no contexto do modelo direto: quem expõe esses dados são as
 * tools em `src/harness/tools/**`. Este módulo é infraestrutura, não superfície.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Json } from './types';

// --- formas dos arquivos (só o que o runtime consome) ----------------------

export type GraphNode = {
  id: string;
  type: string;
  label: string;
  props?: Record<string, string | number | boolean | null>;
};
export type GraphEdge = { from: string; to: string; rel: string; props?: Record<string, string | number | boolean | null> };
export type Supercerebro = { nodes: GraphNode[]; edges: GraphEdge[] };

export type TimelineEvent = {
  ts: string;
  tipo: string;
  ator: string;
  entidades: string[];
  resumo: string;
  trecho?: string;
};
export type Timeline = { eventos: TimelineEvent[] };

export type MetaInsight = {
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  campaign: string;
  adset: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  frequency: number;
  conversions: number;
  cpa: number;
  utm_content: string;
  link: string;
};
export type MetaCampanha = {
  campaign_id: string;
  campaign: string;
  objetivo: string;
  produto: string;
  verba_diaria: number;
  spend_total: number;
  conversions_total: number;
  cpa_medio: number;
  ads: string[];
};
export type MetaAds = { campanhas: MetaCampanha[]; insights: MetaInsight[] };

export type GoogleInsight = {
  campaign_id: string;
  campaign: string;
  tipo: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversions: number;
  utm_content: string;
  link: string;
};
export type GoogleAds = {
  campanhas: { campaign_id: string; campaign: string; tipo: string; utm_content: string; spend_total: number; conversions_total: number; cpa_medio: number }[];
  insights: GoogleInsight[];
};

export type GaCanalDia = { date: string; canal_agrupado: string; source: string; medium: string; sessions: number; usuarios: number; conversoes: number };
export type GaLandingDia = { date: string; landing_page: string; sessions: number; conversoes: number };
export type Ga = { sessoes_por_canal_dia: GaCanalDia[]; sessoes_por_landing_page_dia: GaLandingDia[] };

export type CrmLead = {
  lead_id: string;
  created_at: string;
  utm_source: string;
  utm_medium: string;
  utm_content: string;
  canal_relatado: string;
  estagio: string;
  valor: number;
  produto: string;
};
export type Crm = { total_leads: number; leads: CrmLead[] };

export type CriativoMetricas = {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  frequency_media: number;
  conversions: number;
  cpa: number;
};
export type Criativo = {
  id: string;
  nome: string;
  campanha: string;
  adset?: string;
  produto: string;
  formato: string;
  copy: { headline: string; corpo: string };
  cta: string;
  status: string;
  data_subida: string | null;
  autor: string;
  link: string | null;
  link_original?: string;
  utm_content: string;
  metricas: CriativoMetricas | null;
  metricas_por_semana: { semana: string; spend: number; ctr: number; cpc: number; frequency: number; conversions: number; cpa: number }[];
  aprovacao?: { enviado_em: string; aguarda: string; dias_parado: number };
  observacao?: string;
};
export type Criativos = { ctas_fracos: string[]; criativos: Criativo[] };

// --- leitura memoizada ------------------------------------------------------

const cache = new Map<string, unknown>();

function load<T>(arquivo: string): T {
  const chave = arquivo;
  const memo = cache.get(chave);
  if (memo) return memo as T;
  const bruto = readFileSync(join(process.cwd(), 'data', arquivo), 'utf8');
  const dado = JSON.parse(bruto) as T;
  cache.set(chave, dado);
  return dado;
}

export const supercerebro = (): Supercerebro => load<Supercerebro>('supercerebro.json');
export const timeline = (): Timeline => load<Timeline>('timeline.json');
export const metaAds = (): MetaAds => load<MetaAds>('meta_ads.json');
export const googleAds = (): GoogleAds => load<GoogleAds>('google_ads.json');
export const ga = (): Ga => load<Ga>('ga.json');
export const crm = (): Crm => load<Crm>('crm.json');
export const criativos = (): Criativos => load<Criativos>('criativos.json');

/** Fonte citável de cada arquivo, com a janela quando ela existe. */
export function source(arquivo: string, from?: string, to?: string): string {
  return from && to ? `${arquivo}@${from}..${to}` : arquivo;
}

/**
 * Converte um payload tipado para `Json` do contrato. Único ponto de cast do
 * runtime: os payloads são literais JSON, mas interfaces não ganham index
 * signature implícita em TS.
 */
export function asJson<T>(valor: T): Json {
  return valor as unknown as Json;
}

/** "hoje" do dataset. Fora do escopo do protótipo consultar relógio real. */
export const HOJE = '2026-08-26';
