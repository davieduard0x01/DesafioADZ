# ADR-001 — Grafo de estados como espinha dorsal

**Status:** aceito · **Data:** 2026-08-26

## Contexto

O gestor da AdzHub não pede tarefas de um passo. "Por que caíram as vendas da Ômega 3 essa
semana?" exige resolver a entidade no supercérebro, buscar Meta, buscar CRM, cruzar por
`utm_content`, notar a discrepância, formular e descartar hipóteses. Um ReAct puro faria
isso — mas o produto do trabalho não é só a resposta: é a **defesa da resposta** diante do
cliente. O gestor vai repetir esse diagnóstico numa call com a Housewhey. Se ele não
conseguir mostrar como se chegou lá, a resposta é inútil mesmo quando está certa.

Um loop ReAct puro produz um histórico linear de mensagens onde não existe fronteira
nomeada. Não dá para dizer "aqui ele parou de coletar e começou a analisar", não dá para
recomeçar do meio, e não dá para limitar o que é chamável em cada fase.

## Decisão

O harness é um grafo de estados com nós nomeados (`interpret`, `plan`, `fetch`, `reason`,
`compact`, `gate`, `act`, `respond`, `errorHandler`) e edges condicionais nomeadas. O
`HarnessState` é explícito e serializável; cada transição de nó é um checkpoint. Retry e
degradação acontecem por nó, não pelo turno inteiro.

Três coisas passam a ser possíveis por construção:

1. **Allowlist por fase.** `pause_ads` só existe no `act`. Não é uma instrução no prompt
   que o modelo pode ignorar — é topologia.
2. **Trace legível como narrativa.** `TraceEvent` com `node_enter`/`node_exit` e `viaEdge`
   dá à UI a legenda `pedido → raciocínio → tool → observação → ação → resposta` sem que a
   UI precise inferir nada.
3. **Retomada.** O gate interrompe o turno de verdade, e a retomada é reentrada num nó com
   estado restaurado, não uma nova conversa.

## Alternativas consideradas

- **ReAct puro (loop tool-calling).** Mais simples, menos código, mais flexível. Rejeitado
  porque a auditabilidade sai de graça no grafo e sai cara no ReAct — teria que ser
  reconstruída por convenção de prompt, e convenção de prompt é violável pelo modelo.
- **Workflow determinístico (pipeline fixo).** Auditável ao extremo, mas quebra em qualquer
  pedido fora do roteiro. Ver ADR-002.
- **Multi-agente com supervisor.** Cada especialista (Meta, CRM, criativos) como agente. O
  supervisor vira um grafo implícito, mal-especificado, com custo de tokens multiplicado e
  fronteiras menos claras. É o grafo, mas escondido e mais caro.

## Consequências

**Boas.** Auditabilidade estrutural. Permissão por topologia, não por prompt. Checkpoint e
retry por nó. Testabilidade: cada nó é uma função de estado, testável isolada.

**Ruins — e são reais.**

- **Rigidez na borda.** Um pedido que não cabe em `interpret → plan → fetch → reason` (por
  exemplo, "me ensina a ler esse relatório") atravessa o grafo inteiro à toa, gastando
  latência e tokens em nós que não fazem nada. O grafo cobra pedágio até no pedido trivial.
- **Custo fixo de latência.** São 4 a 6 chamadas de LLM no caminho feliz, contra 2 ou 3 de
  um ReAct puro. Para o gestor isso são segundos a mais em toda pergunta.
- **O grafo vira código a manter.** Toda capacidade nova pede um nó, uma edge, ou um caso a
  mais numa condição — e edges condicionais mal-especificadas são o bug mais chato desse
  desenho, porque falham silenciosamente indo para o nó errado.
- **Ilusão de rigor.** Um grafo bonito dá a impressão de que o sistema é determinístico. Ele
  não é: a decisão de qual edge tomar continua sendo do LLM na maioria dos casos.
