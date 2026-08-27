# ADR-002 — Loop ReAct dentro do nó

**Status:** aceito · **Data:** 2026-08-26

## Contexto

O ADR-001 escolheu o grafo. A pergunta seguinte é o que acontece *dentro* de `fetch` e
`reason`. Se cada nó fizer exatamente uma chamada de tool predefinida, o harness vira um
workflow determinístico — e workflow determinístico não diagnostica.

A prova disso é o prompt 2. A causa-raiz plantada no dataset é que um criativo usa
encurtador de link e derruba os UTMs, então o CRM não atribui parte dos leads. Nenhum
planejador escrito de antemão prevê "buscar o `linkDestino` dos criativos" como passo de
uma investigação de queda de vendas. Esse passo só aparece **depois** de observar que o
Meta reporta mais conversão do que o CRM atribui. É exatamente a estrutura
observação-decide-próxima-tool que o ReAct resolve.

## Decisão

Dentro de `fetch` e `reason` roda um loop ReAct: pensar → chamar tool → observar → repetir.
Cada iteração é limitada por três coisas:

- `maxSteps` por nó (`fetch` = 6, `reason` = 4);
- allowlist de tools do nó, checada duplamente (`NodeBudget.allowlist` **e**
  `ToolDef.allowedNodes`);
- `maxObservationTokens`, que ao ser estourado desvia para `compact` em vez de truncar.

O ciclo `fetch ⇄ reason` tem teto próprio (`reactCycles` = 3). Ao estourar, o grafo força a
saída para `respond`, que redige **declarando a lacuna** — a resposta diz o que não foi
possível verificar em vez de preencher com plausibilidade.

Nos demais nós não há loop. `plan`, `gate`, `act` e `respond` são passagem única.

## Alternativas consideradas

- **Workflow determinístico puro.** Cada nó com sua sequência fixa de tools. Rejeitado: os
  quatro prompts de aceite exigiriam quatro pipelines codificados à mão, e o quinto pedido
  do gestor não teria pipeline. É automação, não agente.
- **ReAct sem teto de passos.** Simples e mais poderoso na cauda longa. Rejeitado por
  custo: um loop que se perde num dataset ambíguo queima tokens e latência sem convergir, e
  no chat isso aparece como o produto travado.
- **Planejar tudo em `plan` e só executar depois.** Plan-and-execute clássico. Rejeitado
  porque o plano bom depende da primeira observação — planejar antes de olhar o dado é
  exatamente o erro que o prompt 2 pune.

## Consequências

**Boas.** Flexibilidade real dentro de fronteiras auditáveis. O nó continua sendo uma
unidade nomeada no trace, mesmo com N passos dentro. O `max_steps` dá um teto de custo
previsível por turno, coisa que ReAct aberto não dá.

**Ruins — e são reais.**

- **`max_steps` é um número chutado.** 6 e 4 não vieram de medição, vieram de estimativa
  sobre os quatro prompts de aceite. Um diagnóstico legítimo que precise de 7 buscas é
  cortado no meio, e o corte não distingue "não achou porque não existe" de "não achou
  porque acabou o orçamento" — a não ser pelo `budget_exhausted` no estado, que a resposta
  precisa lembrar de mencionar.
- **Não-determinismo dentro do nó.** Duas execuções do mesmo prompt podem tomar caminhos
  diferentes de tool. Isso torna teste de regressão difícil e é por isso que o protótipo
  tem modo replay.
- **Loops improdutivos.** O modelo pode chamar a mesma tool com argumentos quase idênticos
  duas vezes, consumindo passos. Mitigação barata (cache de chamada idêntica dentro do
  turno) resolve o caso literal, não o caso "quase igual".
- **Fronteira `fetch`/`reason` é convencional.** Nada impede o modelo de raciocinar no
  `fetch` ou de querer buscar no `reason` — a allowlist do `reason` inclui `graph_query` e
  `timeline_query` justamente porque a separação pura não sobreviveu ao primeiro caso real.
