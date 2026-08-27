# Prompt para gerar datasets (mock AdzHub)

Cole este arquivo no seu agente **depois** do [`guia-do-desafio.md`](./guia-do-desafio.md). O objetivo é criar dados coerentes que **simulem** o que o harness chamaria no mundo real: Supercérebro, APIs e Apps — sem acesso à infra da AdzHub.

Isto **não** é o schema de produção. É um contrato fictício, estável o bastante para um MVP de chat.

---

## Instrução para o agente

Gere uma pasta `data/` (JSON UTF-8, datas em ISO-8601, dinheiro em BRL) para **um cliente só**, coerente ponta a ponta.

Cliente-base sugerido (o mesmo dos diagramas da página): **Housewhey** — e-commerce de suplementos, operação SPOT, time Aline (tráfego), Carolina (gestão), Luiza (atendimento/WhatsApp). Você pode mudar o cliente, mas mantenha o mesmo tipo de malha.

Regras:

1. Tudo precisa **cruzar**: `ad_id` no Meta = `utm_content` no CRM; pessoas do grafo aparecem na timeline e no WhatsApp; criativos do App batem com os ads.
2. **Não escreva a resposta no campo `notes`.** Não use “ANOMALIA:”. Deixe o agente/harness descobrir. Plante 3–5 problemas reais de gestão (CPA estourado, criativo saturado, origem inconsistente, aprovação travada, spend vs budget).
3. Volume pequeno: o suficiente para uma demo de 5–10 minutos, não um data lake.
4. Exponha os JSON via arquivos locais, `fetch('/data/...')` ou um HTTP mock. Cada arquivo abaixo vira **uma tool** do harness (args mínimos, retorno JSON).
5. Inclua um `README` curto: lista de tools, 3 prompts de teste no chat, e o que o avaliador deveria conseguir ver.

---

## Arquivos a gerar

### 1. `supercerebro_graph.json` — memória (grafo)

Nós com `id`, `type`, `label`, `props`.

Tipos: `hub` (SPOT, cliente), `person`, `campaign`, `channel`, `meeting`, `task`, `asset`.

Arestas: `from`, `to`, `rel` (`MEMBER_OF`, `OPERATES`, `MENTIONS`, `APPROVES`, `TRACKS`).

Exemplo de recorte (não copie cego — complete o grafo):

```json
{
  "client_id": "cli_housewhey",
  "nodes": [
    { "id": "hub_spot", "type": "hub", "label": "SPOT" },
    { "id": "cli_housewhey", "type": "hub", "label": "Housewhey" },
    { "id": "p_aline", "type": "person", "label": "Aline", "role": "tráfego" },
    { "id": "camp_namorados", "type": "campaign", "label": "Namorados" },
    { "id": "ch_meta", "type": "channel", "label": "Meta Ads" }
  ],
  "edges": [
    { "from": "p_aline", "to": "hub_spot", "rel": "MEMBER_OF" },
    { "from": "p_aline", "to": "ch_meta", "rel": "OPERATES" }
  ]
}
```

**Tool sugerida:** `search_client_context({ query, client_id? })` → nós e arestas relevantes (não dump o grafo inteiro).

### 2. `supercerebro_timeline.json` — contexto temporal

Eventos ordenados, `occurred_at`, `title`, `summary` (linguagem de **tarefa**, não jargão de grafo), `actor_ids`, `related_node_ids`.

Inclua uma linha do tempo tipo:

| Quando | O que aconteceu |
|---|---|
| onboarding | Cliente entra na operação SPOT; Aline e Carolina assumem a conta |
| briefing | WhatsApp + reunião para criativos da campanha Namorados |
| mídia | Campanha Ômega 3 sobe no Meta Ads; KPI acompanhado com a Carolina |
| agora | Aprovação de peças pendente, com histórico da conta |

**Tool sugerida:** `get_timeline({ client_id, since, until })`

### 3. `api_meta_ads.json` — mídia (anúncio, não só campanha)

Campanhas → adsets → **ads**. Em cada ad: `ad_id`, `ad_name`, `spend`, `impressions`, `clicks`, `hook_rate` (se tiver), `status`, `utm_content` (= `ad_id` ou slug estável).

Sem isso o relatório “gasto por anúncio × lead no CRM” não dá para simular.

**Tools:** `list_ads({ client_id, since, until })`, `get_ad_insights({ ad_id })`

### 4. `api_crm_leads.json` — resultado real

Leads com `created_at`, `status` (`lead` / `agendamento` / `venda` / `perdido`), `value_brl`, `utm_source`, `utm_medium`, `utm_content` (bate com o ad), `origem_declarada` (pode **mentir** vs UTM — isso vira diagnóstico).

**Tool:** `get_leads({ client_id, since, until, utm_content? })`

### 5. `app_analise_criativos.json` — App de metodologia

Não é a API crua. É o **aplicativo** que o gestor já usa: nota de hook/CTA, palco, recomendação (`seguir` / `pausar` / `variar`), brief sugerido (`publico`, `hook`, `mensagem`, `cta`, `metrica_sucesso`).

**Tool:** `run_app_analise_criativos({ client_id })` → ranking + recomendações. O harness **chama o app**, não reimplementa a metodologia no prompt.

### 6. `app_mapa_solucao.json` — contexto de marca

Ficha curta do cliente: oferta, promessa, prova, objeções, tom de voz, o que não pode falar. No produto real isso vive na AdzHub (`mapa_solucao`), não no Canva.

**Tool:** `get_mapa_solucao({ client_id })`

### 7. `conversas.json` — reunião e WhatsApp (memória textual)

Poucas mensagens / bullets de ata. Devem **explicar** aprovações pendentes e alinhamentos de briefing, sem ser novelas.

**Tool:** `search_conversations({ query, client_id })`

---

## Contratos das tools (para o harness)

Assinatura única, retorno sempre JSON. Erros: `{ "ok": false, "error": "..." }`.

| Tool | Camada que simula |
|---|---|
| `search_client_context` | Supercérebro · grafo |
| `get_timeline` | Supercérebro · temporal |
| `list_ads` / `get_ad_insights` | API Meta |
| `get_leads` | API CRM |
| `run_app_analise_criativos` | App |
| `get_mapa_solucao` | App |
| `search_conversations` | memória de canal |

Não exponha a OpenRouter key nesses arquivos. LLM só no harness, com o campo de key na UI da demo.

---

## Prompt de geração (cole se o agente precisar de um empurrão)

```
Com o guia-do-desafio.md e este dataset_prompt.md, gere a pasta data/ completa
para Housewhey (ou o cliente que eu escolher), JSON válido, cruzado, com 3–5
problemas plantados mas NÃO rotulados. Depois liste 3 prompts de chat que um
avaliador pode colar para ver o harness orquestrar pelo menos 2 tools.
```

---

*Mock de desafio — não use estes arquivos como documentação da API AdzHub.*
