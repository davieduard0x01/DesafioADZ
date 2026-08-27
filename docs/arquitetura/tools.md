# Catálogo de tools

Toda entrada de contexto do modelo passa por uma tool. Não existe dado injetado no prompt
do sistema fora daqui — é essa regra que torna a resposta auditável.

Convenções:

- **Efeito** `read` = não altera nada fora do harness, roda livre. `write` = efeito real no
  mundo, passa obrigatoriamente pelo nó `gate` e nunca executa no mesmo turno em que foi
  proposta sem confirmação humana.
- **Nós** é a allowlist: a tool é recusada com `denied_by_policy` se chamada de outro nó.
- Todas retornam `ToolResult` (`src/harness/types.ts`), com `summary` de uma linha e
  `source` — a origem citável do dado.
- No protótipo as camadas `api` e `app` leem dos datasets em `data/`; a assinatura é a
  mesma que uma implementação real teria.

---

## Tabela completa

| Tool | Camada | Efeito | Nós que podem chamar | Argumentos | Retorna |
|---|---|---|---|---|---|
| `graph_query` | supercérebro | read | `interpret`, `fetch`, `reason` | `{ tipo?: EntityKind, id?: string, texto?: string, relacionadoA?: string, profundidade?: 1\|2 }` | Nós do grafo com `id`, `kind`, `label`, atributos e arestas (`relacao`, `alvoId`). Usado para resolver "a Ômega 3" no id da campanha e para achar quem é dono do quê |
| `timeline_query` | supercérebro | read | `interpret`, `fetch`, `reason` | `{ entidadeId?: string, from?: IsoDate, to?: IsoDate, tipos?: ('reuniao'\|'whatsapp'\|'aprovacao'\|'mudanca_campanha'\|'briefing')[], limite?: number }` | Eventos datados em ordem cronológica: `{ at, tipo, titulo, resumo, atores[], entidadesIds[] }`. É o que dá precisão temporal a "essa semana" e o que alimenta a pauta |
| `meta_ads_insights` | API | read | `fetch` | `{ conta: string, from: IsoDate, to: IsoDate, breakdown: 'campaign'\|'adset'\|'ad', campos?: string[], comparar?: boolean }` | Linhas por objeto com gasto, impressões, cliques, CTR, conversões reportadas e `utm_content` associado. `comparar: true` traz também a janela anterior equivalente |
| `google_ads_insights` | API | read | `fetch` | `{ conta: string, from: IsoDate, to: IsoDate, breakdown: 'campaign'\|'ad_group'\|'ad' }` | Mesma forma do Meta: gasto, cliques, conversões por objeto. No protótipo é a fonte mais rasa — existe para provar que o cruzamento não é mono-canal |
| `ga_report` | API | read | `fetch` | `{ propriedade: string, from: IsoDate, to: IsoDate, dimensoes: string[], metricas: string[] }` | Sessões, usuários e eventos por dimensão (`source`, `medium`, `campaign`, `landingPage`). É aqui que aparece o tráfego que chegou sem parâmetro de campanha |
| `crm_leads` | API | read | `fetch` | `{ conta: string, from: IsoDate, to: IsoDate, estagio?: string, utmContent?: string \| null, incluirSemUtm?: boolean }` | Leads com `id`, `criadoEm`, `estagio`, `valor`, `utm_content` (pode ser `null`), origem declarada. `incluirSemUtm: true` é o que expõe a causa-raiz do prompt 2 |
| `list_criativos` | API | read | `fetch` | `{ conta: string, campanhaId?: string, status?: CreativeStatus[] }` | Criativos com `copy`, `cta`, `status`, `linkDestino`, `campanhaId`. O `linkDestino` é o campo que revela o encurtador |
| `get_metrics` | API | read | `fetch` | `{ entidadeIds: string[], metricas: string[], from: IsoDate, to: IsoDate, granularidade?: 'dia'\|'semana' }` | Série temporal por entidade e métrica. Usada para "caiu comparado a quando?" sem puxar o insight inteiro de novo |
| `app_diagnostico` | App | read | `reason` | `{ conta: string, pergunta: string, janela: TimeWindow, observacoesIds: string[] }` | Diagnóstico estruturado: `veredito`, `causaRaiz[]` com evidência e fonte, `descartadas[]`, `proximosPassos[]`. Mapeia direto em `DiagnosticArtifact` — o App entrega estrutura, não parágrafo |
| `propose_ctas` | App | read | `reason` | `{ criativoIds: string[], quantidade: number, restricoesDeMarca?: string[] }` | Por criativo: `ctaAtual`, `copyAtual` e N propostas com `texto`, `hipotese` e `justificativa`. Mapeia em `CtaDiffArtifact`. **Propor não é publicar**: nada vai ao ar por aqui |
| `pause_ads` | API | **write** | `act` | `{ adIds: string[], motivo: string }` | `{ pausados: string[], falharam: {id, erro}[] }`. Gera preview obrigatório listando cada anúncio pelo nome com gasto e resultado do período. Reversível |
| `send_whatsapp` | API | **write** | `act` | `{ destinatarioId: string, mensagem: string, anexos?: {tipo, ref}[] }` | `{ enviadoEm, messageId }`. Preview mostra **o destinatário pelo nome** e o **texto integral** da mensagem. **Irreversível** — o preview diz isso explicitamente |

---

## Notas de projeto

**Por que o supercérebro é tool e não prompt.** Injetar o grafo no system prompt custaria
tokens em todo turno para um contexto que a maioria dos turnos não usa, e — pior — tornaria
impossível dizer *de onde* veio uma afirmação. Como tool, cada consulta vira um
`ToolCallEvent` com `source`, e a resposta pode citar. Detalhe em `adr-004`.

**Por que `propose_ctas` é `read`.** Ela produz texto novo, mas não altera nada fora do
harness. O que publicaria uma variação seria uma tool de escrita separada — deliberadamente
fora do escopo do protótipo. Confundir "gerar" com "publicar" é como um harness passa a
agir sem gate.

**Por que `pause_ads` só existe no `act`.** Se `reason` pudesse chamá-la, o loop ReAct
poderia executá-la durante a análise, antes do gate. A allowlist do nó é a garantia
estrutural — não depende do modelo se comportar.

**Por que `send_whatsapp` é o caso mais perigoso.** É a única irreversível da lista: não há
"despausar" uma mensagem enviada ao cliente. Por isso o preview mostra o texto integral, e
o `ActionPreview.reversivel` vem `false` sem `comoDesfazer`. É o caso que justifica o gate
existir mesmo quando ele incomoda.

**O que ficou de fora de propósito.** Não há tool de escrita para orçamento
(`update_budget`), criação de campanha, nem execução de código. Escrita em orçamento é a
ação de maior dano por clique errado, e o protótipo não tem como demonstrar reversão
crível. Sandbox/CodeAct está descartado em `adr-005`.

---

## Versão do paper (Table 1)

Versão enxuta, para caber em uma coluna. Só camada, efeito e nó de origem — a assinatura
completa fica no repositório.

| Tool | Camada | Efeito | Nó |
|---|---|---|---|
| `graph_query` | supercérebro | read | interpret, fetch, reason |
| `timeline_query` | supercérebro | read | interpret, fetch, reason |
| `meta_ads_insights` | API | read | fetch |
| `google_ads_insights` | API | read | fetch |
| `ga_report` | API | read | fetch |
| `crm_leads` | API | read | fetch |
| `list_criativos` | API | read | fetch |
| `get_metrics` | API | read | fetch |
| `app_diagnostico` | App | read | reason |
| `propose_ctas` | App | read | reason |
| `pause_ads` | API | **write** | act (pós-gate) |
| `send_whatsapp` | API | **write** | act (pós-gate) |

*10 tools de leitura, 2 de escrita. Toda escrita atravessa o gate de permissão.*
