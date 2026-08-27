# ADR-005 — Recorte: sem sandbox/CodeAct e sem RLM completo

**Status:** aceito · **Data:** 2026-08-26

## Contexto

Duas das cinco abordagens de referência do desafio ficaram de fora: runtime com
sandbox/CodeAct e contexto como ambiente (RLM). Ambas são defensáveis e ambas resolveriam
problemas que este harness resolve pior. A decisão de não usá-las precisa ser declarada com
o que se perde, senão é omissão travestida de escopo.

## Decisão

**Sem sandbox/CodeAct.** O agente não escreve nem executa código. Toda capacidade é uma
tool com assinatura fixa e argumentos validados.

**Sem RLM completo.** Não há um "ambiente de contexto" navegável onde o agente lê e escreve
arquivos de trabalho ao longo da sessão. A gestão de contexto é local: `maxObservationTokens`
por nó e um nó `compact` que resume observações preservando números e fontes, registrando
`tokensBefore`/`tokensAfter` no trace.

## Alternativas consideradas

- **CodeAct para análise de dados.** Seria genuinamente melhor no prompt 4 (cruzar Meta com
  CRM por `utm_content`): um `pandas` de dez linhas faz o join, o group-by e o cálculo de
  CPA por criativo com precisão aritmética que LLM não tem. Rejeitado pelo custo de
  segurança: código gerado rodando com acesso a credenciais de conta de anúncios de cliente
  exige isolamento de verdade (VM, rede fechada, quotas), e nada disso cabe no escopo. A
  superfície de ataque cresce muito mais rápido que o valor no domínio.
- **RLM completo.** Contexto como sistema de arquivos, com o agente materializando notas e
  relendo. Resolveria bem a sessão longa — a reunião semanal onde o gestor volta ao mesmo
  assunto por meses. Rejeitado porque o supercérebro já é a memória de longo prazo do
  produto, e sobrepor um segundo mecanismo de memória num MVP cria duas fontes de verdade.

## Consequências

**Boas.** Superfície de segurança pequena e enumerável: 12 tools, argumentos tipados, 2
escritas atrás de gate. Auditoria de "o que esse agente consegue fazer" cabe numa tabela.
Custo de infra do protótipo é ~zero.

**Ruins — e é aqui que dói.**

- **Aritmética sobre muitas linhas é frágil.** Sem CodeAct, o cruzamento do prompt 4 é feito
  pelo LLM lendo linhas do Meta e do CRM. Com poucas dezenas de linhas funciona; com
  centenas de criativos o modelo erra soma e agrupamento — e erra silenciosamente, com o
  número parecendo plausível. A mitigação usada é empurrar a agregação para dentro das
  tools (`get_metrics` com `granularidade`), o que só transfere o problema: agregação que a
  tool não previu, o agente não consegue fazer.
- **Cauda longa fechada.** "Refaz esse gráfico com média móvel de 7 dias" não tem tool e
  não tem como ser improvisado. Com CodeAct seria trivial. Toda capacidade nova aqui é um
  ciclo de desenvolvimento, não uma frase do gestor.
- **Sessão longa degrada.** `compact` é lossy por definição. Numa conversa de trinta turnos
  sobre a mesma conta, detalhes de turnos antigos somem, e o agente não sabe que sumiram —
  ele responde com o resumo achando que é o todo. Um RLM com contexto persistente daria ao
  agente a chance de reler o original.
- **A compactação é por nó, não por sessão.** O contexto do chat inteiro cresce sem teto no
  protótipo. É um problema conhecido e não resolvido: em sessões realmente longas o custo
  por turno sobe e a qualidade cai, e o harness não tem hoje um mecanismo para isso.
