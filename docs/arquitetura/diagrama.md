# Diagramas da arquitetura

Duas figuras. A **Figura 1** vai para o paper como visão de sistema; a **Figura 2** é o
grafo interno do harness. Ambas em Mermaid, sem cor semântica — precisam ser lidas em
preto e branco (a distinção é feita por forma e por rótulo, nunca por cor).

---

## Figura 1 — O harness entre o gestor e as três camadas

```mermaid
flowchart TD
    G["Gestor de marketing<br/>(Aline · Carolina · Luiza)"]
    C["Chat agêntico<br/>Palco + AdzChat"]
    H{{"HARNESS<br/>grafo de estados · ReAct no nó · permissões deny-first"}}

    SC[("Supercérebro<br/>grafo + linha do tempo<br/>MEMÓRIA")]
    AP["Apps de metodologia<br/>diagnóstico · brief · criativos<br/>APP"]
    API["APIs da operação<br/>Meta · Google · GA · CRM · WhatsApp<br/>API"]

    GATE[/"Gate de permissão<br/>confirmação humana"/]
    ACT["Ação com efeito real<br/>pausar anúncio · enviar WhatsApp"]

    G -->|pedido em linguagem natural| C
    C -->|turno| H
    H -->|"tool de leitura"| SC
    H -->|"tool de leitura"| AP
    H -->|"tool de leitura"| API
    SC -.->|entidades e histórico| H
    AP -.->|análise estruturada| H
    API -.->|métricas e leads| H
    H -->|"tool de escrita (proposta)"| GATE
    GATE -->|aprovado pelo humano| ACT
    GATE -->|negado| H
    ACT --> API
    H -->|resposta + artefatos + trace| C
    C --> G
```

**Legenda da Figura 1**

| Elemento | O que é | Como o harness acessa |
|---|---|---|
| Supercérebro (cilindro) | **Memória** da operação: grafo de Pessoas, Campanhas, Canais, Tarefas + linha do tempo | Só por **tool** (`graph_query`, `timeline_query`). Nunca é despejado no prompt do sistema |
| Apps (retângulo) | **App** de metodologia: uma análise empacotada que devolve estrutura, não texto solto | Por **tool** (`app_diagnostico`, `propose_ctas`) |
| APIs (retângulo) | Fonte de dado bruto da operação | Por **tool** de leitura; escrita só via gate |
| Gate (paralelogramo) | Trava de permissão. Interrompe o turno e devolve um preview em PT-BR | Não é tool: é um **nó do grafo** |
| Setas cheias | Chamada do harness para fora | — |
| Setas tracejadas | Retorno que vira observação no estado | — |

A leitura da figura: **tudo que entra no contexto do modelo entra como retorno de tool.**
Não existe "contexto ambiente". Isso é o que torna cada afirmação da resposta rastreável
até uma linha do trace.

---

## Figura 2 — Grafo de estados interno

```mermaid
flowchart TD
    START(["turno inicia"]) --> INT

    INT["interpret<br/>resolve intenção e entidades"]
    PLAN["plan<br/>monta os passos"]
    FETCH["fetch ◆ ReAct<br/>chama tools de leitura"]
    REASON["reason ◆ ReAct<br/>interpreta e decide"]
    COMPACT["compact<br/>resume observações"]
    GATE{"gate<br/>tem efeito real?"}
    ACT["act<br/>executa o confirmado"]
    RESP["respond<br/>redige + monta artefatos"]
    ERR["errorHandler<br/>retry ou degrada"]
    HALT(["turno pausa<br/>aguardando humano"])
    END(["turno encerra"])

    INT -->|entidades_resolvidas| PLAN
    INT -->|ambiguidade_de_entidade| RESP
    PLAN -->|precisa_dados| FETCH
    PLAN -->|sem_dados_necessarios| RESP
    FETCH -->|dados_coletados| REASON
    REASON -->|lacuna_de_dado| FETCH
    REASON -->|orcamento_de_contexto_estourado| COMPACT
    COMPACT -->|contexto_compactado| REASON
    REASON -->|conclusao_sem_acao| RESP
    REASON -->|conclusao_pede_acao| GATE
    GATE -->|sem_efeito_real| RESP
    GATE -->|"aguarda decisão"| HALT
    HALT -->|acao_confirmada| ACT
    HALT -->|acao_negada| RESP
    ACT --> RESP
    RESP --> END

    FETCH -.->|falha_de_tool| ERR
    ACT -.->|falha_de_tool| ERR
    ERR -.->|retry| FETCH
    ERR -.->|degradar| RESP
```

**Onde o loop ReAct vive:** apenas nos nós marcados com `◆` — `fetch` e `reason`.
Dentro deles o modelo pensa → chama tool → observa → repete, limitado por `maxSteps`.
Fora deles não há loop: `interpret`, `plan`, `gate`, `act` e `respond` são passagens
únicas (o `interpret` admite até 3 chamadas de resolução, mas sem re-planejamento).

**Onde o gate interrompe:** entre `reason` e `act`. O turno **para de verdade** — a
resposta HTTP fecha com `halt: 'awaiting_confirmation'`. A execução só retoma quando a UI
manda um novo `POST /api/chat` com `decision`. Não existe caminho de `reason` direto para
`act`.

**Ciclo fetch ⇄ reason:** teto de 3 ciclos por turno (`reactCycles`). Estourou, o grafo é
forçado por `conclusao_sem_acao` para `respond`, que redige com o que tem e **declara a
lacuna** em vez de inventar.

---

## Contrato de cada nó

| Nó | O que faz | Allowlist de tools | `maxSteps` | Condição de saída |
|---|---|---|---|---|
| `interpret` | Classifica a intenção e resolve os apelidos do gestor ("a Ômega 3", "essa semana") em ids do supercérebro e numa `TimeWindow` | `graph_query`, `timeline_query` | 3 | Toda entidade com `confidence ≥ 0,6` → `entidades_resolvidas`. Alguma abaixo → `ambiguidade_de_entidade` (pergunta em vez de chutar) |
| `plan` | Decide quais dados o pedido exige e emite `PlanStep[]`. Não chama tool — é a única chamada de LLM puramente deliberativa | — (vazia) | 1 | Plano com ≥1 passo → `precisa_dados`. Pedido respondível só com o supercérebro já lido → `sem_dados_necessarios` |
| `fetch` | Loop ReAct de **leitura**: escolhe tool, chama, transforma retorno em `Observation` | `graph_query`, `timeline_query`, `meta_ads_insights`, `google_ads_insights`, `ga_report`, `crm_leads`, `list_criativos`, `get_metrics` | 6 | Todos os `PlanStep` com dado coletado, **ou** `maxSteps` esgotado → `dados_coletados`. Erro retryable → `falha_de_tool` |
| `reason` | Loop ReAct de **análise**: cruza observações, testa e descarta hipóteses, pode acionar um App | `app_diagnostico`, `propose_ctas`, `graph_query`, `timeline_query` | 4 | Falta dado nomeado → `lacuna_de_dado`. Observações acima de 6k tokens → `orcamento_de_contexto_estourado`. Conclusão pronta sem efeito real → `conclusao_sem_acao`. Conclusão que exige write → `conclusao_pede_acao` |
| `compact` | Substitui observações antigas por um resumo, preservando números e fontes citadas | — (vazia) | 1 | Sempre → `contexto_compactado`. Registra `tokensBefore`/`tokensAfter` no trace |
| `gate` | Verifica se a tool proposta tem `effect: 'write'`, monta o `ActionPreview` em PT-BR e **para o turno** | — (vazia) | 1 | Tool de leitura mal roteada até aqui → `sem_efeito_real`. Write → emite `permission_request` e devolve `halt: 'awaiting_confirmation'` |
| `act` | Executa **exatamente** os `args` que foram mostrados no preview. Não re-infere nada | `pause_ads`, `send_whatsapp` | 2 | Sucesso ou falha não-retryable → `respond`. Falha retryable → `falha_de_tool` |
| `respond` | Redige a resposta em PT-BR e materializa os `StageArtifact` do Palco | — (vazia) | 1 | Sempre encerra o turno com `halt: 'done'` |
| `errorHandler` | Classifica o erro. Retryable e `attempt < 2` → volta ao nó de origem com backoff; caso contrário degrada | — (vazia) | 1 | `retry` ou `degradar` |

Duas travas independentes protegem a allowlist: o `NodeBudget` do nó e o campo
`allowedNodes` de cada `ToolDef`. Uma tool só executa se **as duas** permitirem — assim um
bug de configuração de nó não abre acesso a `pause_ads`.
