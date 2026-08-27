# `data/` — dataset da conta Housewhey

> ## ⚠️ TODOS OS DADOS AQUI SÃO FICTÍCIOS
> Nada neste diretório vem de uma conta real. Contas de anúncio, IDs, pessoas, e-mails,
> leads, valores, conversas de WhatsApp e reuniões foram **inventados** para o desafio
> Harness Agêntico da AdzHub e gerados por script (`generate.mjs`).
> Nenhum dado pessoal real, nenhum acesso a API de produção, nenhuma marca real envolvida.
>
> **Sobre o contrato de dados:** este dataset foi gerado **antes** de o `dataset_prompt.md`
> oficial estar em mãos — na ocasião o link retornava o shell HTML da SPA. O contrato usado
> foi o descrito no próprio guia do desafio. O arquivo oficial foi obtido depois e está em
> `docs/adzhub/dataset_prompt.md`; o dataset foi **conferido contra ele**. Divergências
> registradas, todas de nomenclatura:
>
> - **Nomes de arquivo.** Aqui: `supercerebro.json`, `timeline.json`, `meta_ads.json`,
>   `crm.json`, `criativos.json`, `ga.json`, `google_ads.json`. O contrato sugere
>   `supercerebro_graph.json`, `supercerebro_timeline.json`, `api_meta_ads.json`,
>   `api_crm_leads.json`, `app_analise_criativos.json`, `app_mapa_solucao.json`, `conversas.json`.
> - **Nomes de tool.** Aqui: `graph_query`, `timeline_query`, `crm_leads`. O contrato sugere
>   `search_client_context`, `get_timeline`, `get_leads`. A malha de dados é a mesma.
> - **Lacuna real.** O contrato pede um `app_mapa_solucao` (ficha de marca: oferta, promessa,
>   prova, objeções, tom de voz) e um `conversas.json` separado. Não existem como arquivos
>   próprios; os trechos de conversa vivem dentro de `timeline.json`.
>
> **Regra 2 do contrato** ("não escreva a resposta no campo `notes`; deixe o harness
> descobrir") está cumprida. Havia em `ga.json` uma nota que descrevia a causa-raiz; ela foi
> removida. Nenhuma tool devolvia esse campo ao modelo — verificado no stream da rota.

---

## Conta simulada

| | |
|---|---|
| Cliente | **Housewhey** — e-commerce de suplementos |
| Agência | **SPOT** |
| Time SPOT | **Aline Ferraz** (gestora de tráfego), **Carolina Nunes** (analista de performance), **Luiza Prado** (criação e copy) |
| Time cliente | **Rafael Menezes** (Head de Marketing, aprova criativo e verba), **Bianca Torres** (analista de e-commerce) |
| Linhas de produto | **Ômega 3** (principal), Whey Protein, Creatina, Multivitamínico |
| Verba de mídia | R$ 18.000/mês — R$ 15.000 Meta Ads + R$ 3.000 Google Ads |
| Período dos dados de mídia | **2026-07-27 a 2026-08-23** (4 semanas), "hoje" = 26/08/2026 |
| Timeline | vai além disso: **2026-06-15 a 2026-08-27** (onboarding → reunião de amanhã) |

Semanas usadas em todos os arquivos:

| Rótulo | Intervalo |
|---|---|
| S1 | 27/07 – 02/08 |
| S2 | 03/08 – 09/08 |
| S3 — **semana anterior** | 10/08 – 16/08 |
| S4 — **semana atual** | 17/08 – 23/08 |

Todos os valores monetários em **BRL**. Datas em ISO (`YYYY-MM-DD`); timestamps com fuso
`-03:00`. `ctr` é percentual (`2.55` = 2,55%).

---

## Arquivos

### `supercerebro.json` — grafo de memória da operação
```
{ nodes: [ { id, type, label, props } ], edges: [ { from, to, rel, props? } ] }
```
`type` ∈ `pessoa` | `campanha` | `canal` | `criativo` | `tarefa` | `cliente` | `produto`.
`rel` ∈ `gerencia`, `atende`, `reporta_para`, `trabalha_em`, `pertence_a`, `veicula_em`,
`mede_em`, `conversa_em`, `promove`, `responsavel_por`, `criou`, `alterou`, `aprovou`,
`aguarda_aprovacao_de`, `causa_provavel_de`, `motivo_de`, `objeto_de`, `impacta`.

Caminho garantido (validado): `pessoa_aline —gerencia→ cliente_housewhey`,
`pessoa_aline —responsavel_por→ campanha_omega3 —promove→ produto_omega3`,
`campanha_omega3 —veicula_em→ canal_meta_ads`,
`criativo_omega3_* —pertence_a→ campanha_omega3`,
`criativo_omega3_vid_ugc_rotina_v1 —aguarda_aprovacao_de→ pessoa_rafael`.

Nós `tarefa` carregam `status`, `desde`, `prazo`, `responsavel` e `impacto` — é a
matéria-prima da pauta de reunião.

### `timeline.json` — memória temporal
```
{ eventos: [ { ts, tipo, ator, entidades: [ids do grafo], resumo, trecho? } ] }
```
`tipo` ∈ `onboarding`, `briefing`, `reuniao`, `whatsapp`, `alteracao_campanha`,
`aprovacao`, `alerta`. Ordenado por `ts`. `trecho` traz conversas de WhatsApp e reunião
**parafraseadas** (4 eventos têm). Todo id em `entidades` existe em `supercerebro.nodes`.

### `meta_ads.json` — insights por anúncio **e por dia**
```
{ campanhas: [ { campaign_id, campaign, verba_diaria, spend_total, conversions_total, cpa_medio, ads: [ad_id] } ],
  insights:  [ { ad_id, ad_name, campaign_id, campaign, adset, date,
                 spend, impressions, clicks, ctr, cpc, frequency,
                 conversions, cpa, utm_content, link } ] }
```
- 4 campanhas, 11 anúncios, 304 linhas diárias.
- **`utm_content` é o que um parser extrairia da URL de destino naquela data** — vazio
  quando a URL não carrega UTM (o caso do encurtador). `ad_name` continua preenchido.
- `conversions` são compras registradas pelo pixel: **não dependem de UTM**.

### `google_ads.json`
Mesma forma, 2 campanhas (`HW | Search | Marca`, `HW | Shopping | Ômega 3`), 56 linhas
diárias. Serve de contraste barato/caro no cruzamento por `utm_content`.

### `ga.json` — GA4
```
{ sessoes_por_canal_dia:        [ { date, canal_agrupado, source, medium, sessions, usuarios, conversoes } ],
  sessoes_por_landing_page_dia: [ { date, landing_page, sessions, conversoes } ] }
```
Canais: `paid_social`, `paid_search`, `direct`, `organic_search`, `referral`, `email`.

### `crm.json` — leads individuais
```
{ total_leads, leads: [ { lead_id, created_at, utm_source, utm_medium, utm_content,
                          canal_relatado, estagio, valor, produto } ] }
```
- **397 leads**. `estagio` ∈ `novo`, `contato`, `agendado`, `ganho`, `perdido`
  (leads recentes ficam em `novo`/`contato`; leads antigos já resolveram).
- **Receita = soma de `valor` onde `estagio = "ganho"`.**
- `utm_content` **vazio** = a origem não chegou ao CRM. O `produto` continua conhecido,
  porque vem do pedido, não da URL — essa assimetria é a pista principal.

### `criativos.json`
```
{ ctas_fracos: [...],
  criativos: [ { id, nome, campanha, adset, produto, formato, copy: {headline, corpo},
                 cta, status, data_subida, autor, link, link_original?, utm_content,
                 metricas, metricas_por_semana: [...], aprovacao?, observacao? } ] }
```
13 criativos: 11 `ativo` (com métricas agregadas do Meta + série semanal) e 2
`em_aprovacao` (sem métricas, com bloco `aprovacao`). Copy em PT-BR real de suplemento.

### `generate.mjs` / `validate.mjs`
Gerador determinístico (`node data/generate.mjs`, seed fixa — regenerar dá byte a byte o
mesmo resultado) e validador sem dependências (`node data/validate.mjs`).

---

## Chaves de join

| De | Para | Chave |
|---|---|---|
| `meta_ads.insights` | `crm.leads` | **`utm_content`** (= `ad_name`, quando a URL carrega UTM) |
| `google_ads.insights` | `crm.leads` | **`utm_content`** (`search_marca_exata`, `shopping_omega3_feed`) |
| `meta_ads.insights` | `criativos.criativos` | `ad_id` ↔ `id`, `ad_name` ↔ `nome` |
| `meta_ads.insights` | `meta_ads.campanhas` | `campaign_id` |
| `supercerebro.nodes` | `timeline.eventos` | `id` ↔ `entidades[]` |
| `supercerebro.nodes` | `criativos` / `meta_ads` | `criativo_<ad_name>`, `campanha_<produto>` |
| `ga.*` | `meta_ads` / `google_ads` | `date` + canal (`paid_social` ≈ Meta, `paid_search` ≈ Google) |

---

## A história plantada no dataset

### Causa principal — o encurtador que comeu as UTMs

Em **11/08/2026, às 09:12**, a **Carolina** trocou a URL de destino do anúncio
**`omega3_vid_prova_social_v2`** (o melhor da conta) por um encurtador,
`https://hwy.link/o3ps`. O pedido veio do **Rafael**, do lado do cliente: o link completo
com UTMs "virava um monstro" no card de compartilhamento do WhatsApp. Ninguém testou o
redirecionamento — e o encurtador **descarta a query string**.

A partir dali, em cadeia:

1. **O Meta continua normal.** O pixel não depende de UTM: o anúncio segue gastando e
   reportando conversões. Aline até **aumentou a verba dele em 14/08** (de R$ 100 para
   R$ 128/dia), porque no gerenciador ele era o melhor CPA da conta. Isso **aumentou** o
   problema.
2. **O CRM recebe os leads sem origem.** `utm_source`, `utm_medium` e `utm_content`
   chegam vazios; os leads caem no balde `(direct)/(none)` — "origem desconhecida".
3. **O GA4 registra o mesmo em sessões.** `direct / (none)` sai de **632 sessões** na
   semana de 04–10/08 para **1.430** em 17–23/08, enquanto `paid_social` cai de **2.922**
   para **2.054**. O que sumiu de um apareceu no outro.
4. **O relatório de atribuição despenca, o faturamento não.** As vendas de Ômega 3 *com
   origem* caem de 54 (S2) para 31 (S3) e 26 (S4) — **−52%** — mas a receita total do CRM
   fica praticamente estável (R$ 8.888 → R$ 8.367 → R$ 8.208). A venda continua
   acontecendo; **quebrou a atribuição, não a operação.**

O buraco é aritmeticamente demonstrável. Leads sem origem antes da troca: **1,00/dia**
(baseline direto/orgânico, estável nas semanas S1 e S2). Depois:

| Semana | leads sem origem | baseline esperado (7 dias) | **buraco** |
|---|---|---|---|
| S1 (27/07–02/08) | 7 | 7 | 0 |
| S2 (03/08–09/08) | 7 | 7 | 0 |
| **S3 (10–16/08)** | 27 | 7 | **20** |
| **S4 (17–23/08)** | 37 | 7 | **30** |

E o buraco fecha com a fonte: o `omega3_vid_prova_social_v2` registra **30 conversões no
Meta** na semana atual com `utm_content` vazio — exatamente o tamanho do buraco. O Meta,
enquanto isso, reporta conversões **estáveis ou em alta** na campanha de Ômega 3
(45 → 51 → 47 → 51 de S1 a S4), com o gasto plano em ~R$ 1.950/semana.

### Causa secundária — o carrossel genuinamente saturado

Para o diagnóstico não ser monocausal (nem o agente parecer bom demais), há uma segunda
queda **real**: o **`omega3_carrossel_beneficios_v1`** está esgotado de verdade.

| | S1 | S2 | S3 | S4 |
|---|---|---|---|---|
| frequência | 2,1 | 3,2 | 4,4 | **5,6** |
| CTR | 1,92% | 1,54% | 1,05% | **0,71%** |
| conversões | 15 | 11 | 7 | **4** |
| CPA | ~R$ 43 | ~R$ 56 | ~R$ 81 | **~R$ 95** |

Esse criativo perdeu ~11 conversões/semana entre S1 e S4, e essa perda é **verdadeira** —
não é atribuição. Ele também tem o CTA genérico **"Saiba mais"**. Ou seja: é um alvo
legítimo de pausa, e explica uma fatia menor (mas real) da queda de Ômega 3.

---

## O que cada prompt de aceite encontra no dataset

1. **"Pause os criativos com CTA ruim e proponha 3 variações."**
   `criativos.json` → `ctas_fracos` + os três candidatos: `omega3_carrossel_beneficios_v1`
   ("Saiba mais", CTR 0,71%, freq 5,6, CPA R$ 95), `whey_est_combo_v1` ("Saiba mais", CTR
   0,64%, CPA R$ 136, ROAS 0,36) e `creatina_est_pote_v2` ("Ver mais", CTR 0,83%). Os
   criativos bons trazem CTAs concretos ("Comprar agora", "Aproveitar oferta") como
   referência de tom para as variações. **Armadilha deliberada:** o
   `omega3_vid_prova_social_v2` aparece com CPA aparente péssimo se o agente olhar só o
   CRM — e pausá-lo seria o erro mais caro possível.

2. **"Por que caíram as vendas da Ômega 3 essa semana?"**
   Exige cruzar `meta_ads` (conversões estáveis), `crm` (atribuídas em queda), `ga`
   (salto de direct), `timeline` (a edição de 11/08) e `criativos` (o carrossel saturado).
   Resposta correta = causa principal (atribuição quebrada pelo encurtador) + causa
   secundária (saturação real do carrossel), não uma só.

3. **"Monta a pauta da reunião de amanhã com a Housewhey."**
   `timeline` (reunião confirmada para 27/08 10h, cobrança do Rafael em 19/08, decisões da
   call de 13/08) + nós `tarefa` do supercérebro: 2 criativos parados aguardando aprovação
   (6 e 5 dias), a investigação da Ômega 3, a proposta de pausa do carrossel e a decisão de
   verba de setembro (R$ 18k → R$ 22k, condicionada).

4. **"Cruza gasto do Meta com leads do CRM por `utm_content` e me diz o que está caro."**
   Join direto `meta_ads.insights.utm_content` × `crm.leads.utm_content`. Caro de verdade:
   `whey_est_combo_v1` (CPL R$ 136, ROAS 0,36), `creatina_est_pote_v2` (CPL R$ 67),
   `multi_carrossel_kit_v1` (ROAS 0,85). Barato: `multi_est_remarketing_v1` (CPL R$ 30),
   `omega3_est_oferta_frete_v1` (CPL R$ 36). E o join **não fecha**: R$ 1.081 de gasto
   atribuído ao `omega3_vid_prova_social_v2` contra R$ 2.580 realmente gastos no anúncio no
   período — a diferença é o buraco.

---

## Validação

```bash
node data/validate.mjs
```

Checa, com `assert`, e imprime um relatório:

1. gasto e conversões por anúncio somam o total da campanha (Meta e Google) e batem com o
   agregado de `criativos.json` — tolerância de centavos;
2. todo `utm_content` presente no CRM existe em `meta_ads` ou `google_ads`;
3. por semana, `leads atribuídos + buraco de atribuição` ≈ `conversões de mídia` (erro < 8%),
   e leads atribuídos nunca excedem as conversões;
4. o buraco da semana atual (30) é maior que o da semana anterior (20), as semanas
   pré-troca têm buraco ~0, o buraco é explicado pelas conversões do anúncio afetado, o
   Meta **não** caiu e a Ômega 3 atribuída caiu mais de 40%;
5. todo `from`/`to` de `edges` aponta para um `id` existente em `nodes`, sem ids
   duplicados, o caminho Housewhey ↔ Aline ↔ Ômega 3 ↔ Meta ↔ criativos ↔ aprovação
   existe, e toda entidade citada na timeline existe no grafo;
6. todas as datas caem dentro do período declarado de cada arquivo e a timeline está em
   ordem cronológica;
7. o GA confirma a história: `direct` salta >50% e `paid_social` cai, com volumes que
   batem entre si (diferença < 30%);
8. o criativo saturado tem CTR caindo e frequência subindo **todas** as semanas, fecha
   acima de frequência 5 e abaixo de 1% de CTR, existem exatamente 2 criativos em
   aprovação e há pelo menos um alvo de CTA fraco.
