# ADR-004 — Supercérebro como tool dedicada, não RAG no prompt

**Status:** aceito · **Data:** 2026-08-26

## Contexto

O supercérebro é a memória da operação: um grafo de Pessoas, Campanhas, Canais e Tarefas
somado a uma linha do tempo de decisões. É o que diferencia este harness de um wrapper de
API — ele sabe que Aline cuida da Housewhey, que a Ômega 3 teve briefing revisto no
WhatsApp, que existe uma aprovação de criativo pendente desde tal data.

O caminho default seria embutir isso no system prompt: um resumo da conta, os últimos N
eventos, os nomes do time. É o que a maioria dos assistentes de domínio faz.

## Decisão

O supercérebro é acessado **exclusivamente** por duas tools: `graph_query` (navegação por
tipo, id, texto ou relação, com profundidade controlada) e `timeline_query` (eventos
datados, filtráveis por entidade, janela e tipo).

Além disso, o nó `interpret` **sempre** resolve entidades antes de qualquer chamada de API.
O gestor escreve "a Ômega 3"; a API precisa de um id de campanha e de uma janela de datas
concreta. Essa tradução é a primeira coisa que o grafo faz, e o resultado vive no estado
como `ResolvedEntity[]` com `confidence` — abaixo de 0,6 o grafo sai por
`ambiguidade_de_entidade` e pergunta, em vez de chutar.

## Alternativas consideradas

- **RAG no system prompt.** Buscar top-k trechos e colar. Rejeitado por três motivos:
  (a) custo fixo em todo turno para um contexto que a maioria dos turnos não usa;
  (b) a resposta perde a rastreabilidade — não dá para dizer *de onde* veio a afirmação, e
  a defesa do diagnóstico é metade do produto; (c) similaridade vetorial responde mal a
  perguntas relacionais e temporais, que são o formato da maioria dos pedidos aqui
  ("o que mudou desde a última reunião", "quem aprovou esse criativo").
- **Grafo inteiro no contexto.** Viável no protótipo porque o dataset é pequeno. Rejeitado
  por não escalar e por ensinar a arquitetura errada — a decisão precisa ser a mesma com
  200 contas.
- **Memória implícita gerenciada pelo framework** (estilo memória automática de agente).
  Rejeitado: perde o controle sobre o que entra no contexto e quando, que é a única forma
  de manter o `maxObservationTokens` por nó significativo.

## Consequências

**Boas.** Cada afirmação da resposta tem um `ToolCallEvent` com `source` atrás dela.
Contexto entra sob demanda, então o orçamento por nó é real. `interpret` fica sendo o único
lugar onde apelido vira id — um ponto de falha, mas um ponto só, e observável.

**Ruins — e são reais.**

- **Custa uma ida e volta.** Resolver entidade é uma chamada de LLM + tool antes de começar
  o trabalho de fato. Em pedidos simples isso dobra a latência percebida.
- **O modelo precisa saber consultar.** Com RAG no prompt o contexto simplesmente está lá.
  Como tool, se o modelo não formular a `graph_query` certa, ele opera sem contexto e não
  percebe. Modelos mais fracos — os que um avaliador pode escolher no seletor do OpenRouter
  — erram mais aqui.
- **Apelido fora do grafo é ponto cego.** Se o time chama a campanha de "a nova da Ômega" e
  esse alias não existe no supercérebro, `interpret` devolve baixa confiança e pergunta. É
  o comportamento correto e é irritante: o gestor sabe do que está falando e o agente não.
  A correção real é alimentar aliases no grafo, o que é trabalho de curadoria contínua que
  o harness não resolve.
- **Duas tools não cobrem tudo.** Perguntas agregadas sobre o próprio grafo ("quantas
  campanhas a Aline toca?") ficam desconfortáveis nessa interface e provavelmente pedirão
  uma terceira tool.
