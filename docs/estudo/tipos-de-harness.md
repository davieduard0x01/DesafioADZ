# Os cinco tipos de harness, testados contra a conta da Housewhey

Fichas de estudo para o paper. Cada tipo é descrito pela **mecânica do loop**, não pela filosofia: o que entra, o que o runtime faz com isso, o que sai, e onde o estado mora. Cada ficha termina num **teste contra uma tarefa real** da conta Housewhey (e-commerce de suplementos, operação SPOT, time Aline / Carolina / Luiza) — o tipo puro é executado mentalmente contra a tarefa até quebrar, e a falha recebe nome.

As referências estão detalhadas em [`fontes.md`](./fontes.md). Convenção mantida: `[FONTE]` é o que o documento afirma; `[ANÁLISE]` é minha leitura. Os cenários da Housewhey são **hipotéticos e ilustrativos** — servem para exercitar a mecânica, não descrevem dados reais da conta.

As quatro tarefas usadas como banco de prova, conforme o guia oficial:

| # | Tarefa | Fontes que ela toca |
|---|---|---|
| T1 | Relatório de criativos × resultado real: cruzar gasto por anúncio no Meta Ads com leads no CRM por `utm_content` | Meta Ads, CRM |
| T2 | Diagnóstico de conta / período: investigar anomalia e devolver causa + próximos passos | GA, Meta, Google Ads, CRM, supercérebro, WhatsApp |
| T3 | Pauta de reunião a partir do histórico recente | Supercérebro (grafo + linha do tempo), métricas da semana |
| T4 | Análise de criativos e novos briefings de copy/CTA | App de análise de criativos, Meta Ads, contexto de marca |

---

## Tipo 1 — Loop tool-calling (ReAct)

### O que é

`[FONTE]` O ReAct gera **traços de raciocínio e ações de forma intercalada**: o raciocínio induz, rastreia e atualiza o plano e lida com exceções; a ação interfaceia com fontes externas para coletar informação (Yao et al., ICLR 2023, arXiv:2210.03629).

A mecânica concreta, sem romantismo: o runtime mantém uma lista de mensagens. A cada iteração envia o histórico + os esquemas das tools ao modelo; o modelo devolve ou texto final ou uma tool call; o runtime executa, anexa a observação ao histórico e repete. **O estado do agente É o histórico de mensagens.** Não há mais nada. A parada é um contador ou um `finish_reason` — `[FONTE]` no AI SDK 7.x, `stopWhen` com `isStepCount(20)` por padrão, e o loop também para quando o finish reason não é tool-call, quando uma tool não tem `execute`, ou quando exige aprovação.

### De onde vem

Yao et al. (2023). `[FONTE]` Ganhos de **+34 pontos absolutos** de taxa de sucesso em ALFWorld e **+10** em WebShop com um ou dois exemplos in-context, e o abstract reivindica explicitamente "improved human interpretability and trustworthiness". É a base de praticamente todo loop de tool-calling comercial: `[FONTE]` a própria descrição do episódio da AdzHub sobre harness lista "o loop ReAct" entre seus quatro pilares.

### Onde brilha

Tarefa curta, aberta, com poucas chamadas e sem consequência. É imbatível em **custo de construção**: um agente ReAct útil sobre cinco tools de leitura é meio dia de trabalho. E é o único tipo que lida bem com o imprevisto — se o CRM devolver um campo inesperado, o modelo simplesmente muda de plano no próximo passo, sem que ninguém tenha previsto essa aresta.

### Onde quebra

Três lugares, e todos pioram com o tamanho da tarefa. **(a)** O histórico é o estado, então tudo que foi observado compete pela janela de contexto com tudo que ainda será observado. **(b)** Não há etapas nomeadas: um traço de 12 passos é uma sequência linear onde nada distingue "coletei" de "concluí". **(c)** O único freio é um contador de passos, que é uma métrica de quantidade, não de progresso — um agente girando em falso e um agente investigando a fundo consomem passos igual.

### Teste contra a Housewhey — T2, diagnóstico de conta

O gestor pergunta: *"a Housewhey teve muito agendamento e pouca venda nos últimos 14 dias, o que aconteceu?"*

O loop roda: pega insights do Meta por campanha; percebe que a linha Ômega 3 concentra o gasto; puxa Google Ads; puxa sessões e origem no GA; consulta leads do CRM por estágio; nota que muitos leads estão travados em "agendado"; volta ao Meta para olhar por criativo; puxa o histórico de WhatsApp da conta; encontra uma mensagem da Carolina avisando de mudança no atendimento. Doze, treze chamadas. O modelo então escreve um parágrafo: *"o volume de agendamentos cresceu porque o criativo novo promete consulta gratuita, mas a taxa de comparecimento caiu após a mudança no atendimento; recomendo revisar o script."*

A conclusão pode até estar certa. O problema é o que acontece na terça, na call com o cliente, quando a Aline pergunta **"de onde saiu que a taxa de comparecimento caiu?"**. Chamo essa falha de **conclusão órfã**: o número existe na resposta e não existe em lugar nenhum do traço como resultado nomeado. Ele foi calculado de cabeça pelo modelo a partir de dois JSONs que passaram pelo contexto seis passos antes. Para auditar, o gestor teria que ler as treze observações cruas — que é exatamente o trabalho que ele delegou.

Pior: numa conversa longa, entra a **erosão do traço por compactação**. `[FONTE]` O OpenHands documenta que o `Condenser` descarta eventos e os substitui por sumários quando o histórico cresce, e que essa é a mecânica que permite reduzir custo de API em até 2×. Num ReAct puro, sem log fora da janela, a observação #3 — a que sustentava a conclusão — pode ter sido resumida para fora antes da resposta final. `[ANÁLISE]` A resposta sobrevive; a evidência, não. E ninguém percebe, porque não há nada apontando para o buraco.

> **Veredicto.** ReAct entrega a resposta e destrói a procedência. Para um gestor que vai **defender** o número na frente do cliente, procedência não é um extra.

---

## Tipo 2 — Runtime com sandbox / CodeAct

### O que é

Em vez de emitir uma tool call por vez em JSON, o modelo emite **um bloco de código executável** que roda num interpretador com estado. `[FONTE]` A crítica de Wang et al. (ICML 2024, arXiv:2402.01030) ao formato JSON é dupla: espaço de ação restrito (o escopo das tools pré-definidas) e **flexibilidade restrita — "inability to compose multiple tools"**. Com um interpretador acoplado, o agente pode revisar ações anteriores e emitir novas em interação multi-turno. `[FONTE]` Até **20% a mais de taxa de sucesso** em análise com 17 LLMs no API-Bank.

Mecânica: o runtime expõe um kernel persistente. O modelo escreve código, o kernel executa, `stdout`/`stderr`/exceção voltam como observação, e as **variáveis sobrevivem entre passos** — é essa persistência que diferencia CodeAct de uma tool `run_python`. O estado do agente passa a ser o histórico **mais o namespace do interpretador**.

### De onde vem

Wang et al. (2024), e a linha continua no OpenHands SDK — `[FONTE]` cuja tabela comparativa de features aponta "Agent Environment Sandboxing" como capacidade que ele tem e que os SDKs de OpenAI, Anthropic e LangChain avaliados não têm de forma nativa (avaliação de outubro de 2025).

### Onde brilha

Onde a tarefa é **composição de dados**. Um join, uma agregação, uma janela móvel, um diff. Também brilha na exploração: o agente pode olhar o shape do dado antes de decidir o que fazer com ele, o que nenhuma tool de assinatura fixa permite.

### Onde quebra

O sandbox é uma fronteira de segurança **e** uma fronteira de dados. Para executar o join, o dado precisa estar **dentro** do processo. E o artefato que o agente produz — o script — é descartável por construção: o próximo turno escreve outro.

### Teste contra a Housewhey — T1, relatório de criativos × resultado real

Esta é a tarefa em que o CodeAct deveria ganhar de lavada, e quase ganha. Cruzar gasto por anúncio do Meta com leads do CRM por `utm_content` é literalmente a "composição de múltiplas tools" que o paper diz que o JSON não faz. O agente puxa os dois datasets, normaliza o `utm_content` (que vem com sufixo de plataforma em um lado e sem no outro), agrupa, divide gasto por lead, ordena, e devolve a tabela de caro vs. barato. Funciona. É melhor do que o ReAct faria.

Duas falhas aparecem depois.

A primeira é **metodologia volátil**. A SPOT tem um jeito de calcular custo por lead qualificado — o que conta como lead, que estágio do CRM entra, como tratar lead sem `utm_content`, o que fazer com o criativo que rodou três dias. Num CodeAct puro, essa metodologia vive no código que o modelo escreveu naquele turno. Na semana seguinte ele escreve outro código, faz outra escolha para os leads órfãos, e a Housewhey recebe dois relatórios com números diferentes sem que nada tenha mudado na conta. `[ANÁLISE]` O App de metodologia da AdzHub deixa de ser um App: vira uma sugestão que o modelo segue quando lembra.

A segunda é a **fronteira de dados no interpretador**. Para fazer o join, os leads do CRM entram no processo — com nome, telefone e e-mail, porque é assim que a linha vem. O modelo tem acesso irrestrito a eles e nada impede que uma linha inteira apareça no `stdout` truncado que volta para o contexto, e daí para o trace que o gestor vê e, se o trace for persistido, para o banco. `[FONTE]` O OpenHands trata a versão *credencial* desse problema com o `SecretRegistry`, que injeta segredos só no momento da execução e mascara ocorrências na saída com `<secret-hidden>` — mas isso protege o token do Meta Ads, não o telefone do lead. `[ANÁLISE]` Aqui a superfície é dado pessoal do cliente final da Housewhey, e um sandbox de propósito geral não sabe o que é PII.

> **Veredicto.** CodeAct resolve o join e dissolve a metodologia. Para a AdzHub, cujo produto **é** a metodologia empacotada, trocar App por script gerado é vender o ativo.

---

## Tipo 3 — Sessão com permissões & skills

### O que é

O runtime é uma **sessão persistente** com três coisas que o ReAct puro não tem: identidade (a sessão pode ser retomada e bifurcada), um **pacote de contexto carregado sob demanda** (skills), e um **pipeline de autorização** entre a decisão do modelo e a execução da tool.

`[FONTE]` O Claude Agent SDK avalia cada tool call em **seis passos, nesta ordem**: hooks → deny rules → ask rules → permission mode → allow rules → callback `canUseTool`. Um deny bloqueia mesmo em `bypassPermissions`; uma ask rule cai no callback mesmo em `bypassPermissions`. A doc dá o aviso que é o coração do desenho: **"Auto-approved tools never reach `canUseTool`"** — logo, para uma checagem que rode em *toda* tool call, o mecanismo correto é um hook `PreToolUse`, porque "hooks run before every other step, and a hook deny applies even in `bypassPermissions` mode". Subagentes **herdam o modo do pai**.

`[FONTE]` No OpenHands o mesmo desenho aparece com outra roupa e uma separação explícita: o `SecurityAnalyzer` classifica cada tool call em `low`/`medium`/`high`/`unknown`, a `ConfirmationPolicy` decide se exige aprovação, e o agente entra num estado `WAITING_FOR_CONFIRMATION` até aprovação ou rejeição explícita — podendo tentar alternativa mais segura se rejeitado. O par embutido é `LLMSecurityAnalyzer` + `ConfirmRisky` (limiar padrão `high`), e a política é **atualizável durante a sessão** ("adaptive trust").

Skills: `[FONTE]` no OpenHands, `AgentContext` centraliza os inputs que moldam o comportamento do LLM, e cada `Skill` pode ser **sempre ativa** (`trigger=None`) ou **ativada por keyword** no input do usuário. No Claude Agent SDK, skills e memória carregam de `.claude/` e `~/.claude/`.

### De onde vem

Claude Agent SDK (docs, acesso 26/08/2026) e OpenHands SDK §4.5/§4.9. `[FONTE]` O episódio "How I AI" de Claire Vo é o exemplo aplicado: um harness próprio sobre o Claude Agent SDK para triagem de bugs do Sentry, com adaptadores opinativos para Sentry, Linear, GitHub e Vercel, organizado em **runs, tasks, tools e artifacts**.

### Onde brilha

É o tipo que trata **ação com consequência** como cidadã de primeira classe, e o único dos cinco que traz uma resposta pronta para "quem autoriza". Skills resolvem elegantemente o problema dos Apps de metodologia: um pacote de instrução carregado por gatilho, sem inchar o system prompt de todo turno.

### Onde quebra

Permissão governa **o quê**, nunca **quando**. A ordem das operações continua sendo decidida pelo modelo dentro de um loop que, por baixo, segue sendo ReAct — com todas as falhas do Tipo 1 intactas. E skills carregadas por keyword são um mecanismo de recuperação frágil: o gatilho é lexical, a intenção não é.

### Teste contra a Housewhey — T4, análise de criativos e novos briefings

O gestor pede: *"olha os criativos da Housewhey, sugere o que pausar e me propõe três variações de copy e CTA."*

A parte boa funciona bem. `criativos.listar` e `meta_ads.insights_por_anuncio` são leitura, risco `low`, rodam sem prompt. `ads.pause` é `high`: o agente para, o gestor vê "pausar 3 conjuntos na campanha Ômega 3 — confirmar?", e nada acontece sem clique. A skill "análise de criativos" foi carregada porque a palavra "criativos" apareceu no input. Isso é exatamente o que se quer.

A falha é **ordem não governada**. Nada no sistema de permissões tem opinião sobre a *sequência*. O agente pode — e, na prática, com um modelo apressado, vai — listar os criativos, ler as copies, e escrever as três variações de CTA **antes** de olhar o desempenho dos últimos 14 dias, porque escrever copy é a parte que ele faz bem e a métrica é a parte chata. O resultado é um briefing bonito, plausível, e derivado do texto do criativo em vez do dado. `criativos.listar` é `low`; a política deixa passar; não há regra concebível de permissão que expresse "não proponha CTA antes de ter lido a métrica", porque isso não é uma pergunta sobre autorização.

Falha secundária, mais sutil: **colisão de skills**. Se "brief de criativo" e "análise de criativos" são duas skills e ambas disparam pela keyword "criativo", as duas entram no contexto e passam a competir — a metodologia de diagnóstico e a metodologia de produção dando instruções simultâneas ao mesmo turno. `[ANÁLISE]` E o gestor não tem como saber qual foi seguida, porque a resposta é um texto só.

> **Veredicto.** Permissões e skills são condição necessária e claramente insuficiente. Elas impedem o agente de fazer a coisa errada; não o obrigam a fazer as coisas na ordem certa.

---

## Tipo 4 — Orquestração por estados (grafo)

### O que é

O agente deixa de ser um loop e vira um **grafo de nós tipados sobre um estado explícito**. `[FONTE]` No LangGraph, `StateGraph` é parametrizado por um `State` (`TypedDict`, `dataclass` ou Pydantic), e **cada chave do estado pode ter um reducer** dizendo como o update se combina com o valor atual — o padrão substitui, um reducer como `operator.add` acumula. Nós são funções que recebem `state` e devolvem update. `add_edge` liga nós; `add_conditional_edges` roteia por função; `START`/`END` são nós virtuais; `Command` combina update e roteamento num retorno só (`update`, `goto`, `graph`, `resume`). O grafo exige `.compile()`.

Persistência e humano no meio: `[FONTE]` o **checkpointer** salva o estado nas **fronteiras de superstep — não no meio de um nó** — e permite retomar por `thread_id`. **`interrupt()`** pausa esperando input humano; retoma com `Command(resume=value)`. E o aviso decisivo: efeitos colaterais anteriores ao interrupt **"must be idempotent"**, porque na retomada **o nó afetado roda de novo desde o início da função**.

### De onde vem

Documentação do LangGraph (acesso 26/08/2026). `[FONTE]` O OpenHands, na seção de trabalhos relacionados, descreve LangChain/LangGraph como focados em "pipelines composicionais e execução de grafo com estado, com checkpoints duráveis para workflows de raciocínio de longa duração".

### Onde brilha

Onde a tarefa tem **forma conhecida**. Se a metodologia da SPOT diz que um diagnóstico é coleta → normalização → detecção de anomalia → hipótese → recomendação, o grafo torna essa sequência uma propriedade do runtime e não uma sugestão ao modelo. E dá o que falta a todos os outros quatro: um **lugar tipado para os achados**. Um campo `findings: Finding[]` com reducer aditivo transforma "o número apareceu na resposta" em "o número é um registro produzido pelo nó X a partir da tool Y".

### Onde quebra

Toda aresta é uma decisão tomada em tempo de projeto. O que não foi enumerado, não existe. E o custo de modelagem é real: cada metodologia nova é um subgrafo novo.

### Teste contra a Housewhey — T3, pauta de reunião

Grafo modelado: `coletar_métricas → coletar_supercérebro → detectar_pendências → montar_pauta → END`. Roda bem. A pauta sai com métricas da semana, os dois criativos parados em aprovação com a Carolina, e a decisão sobre orçamento de setembro que ficou em aberto na última call. Estruturada, auditável, repetível toda segunda-feira. O gestor gosta.

Aí ele lê e digita: *"e o que ficou pendente com a Luiza no WhatsApp semana passada?"*

**Enumeração antecipada.** Não há nó para isso. O grafo tem quatro nós e nenhum deles consulta thread de WhatsApp por pessoa. As opções são todas ruins: o `montar_pauta` responde do que já está no estado e alucina, porque não tem o dado; ou o sistema devolve algo equivalente a "não sei fazer isso"; ou alguém abre o código e adiciona um nó — que é a resposta certa em engenharia e a resposta errada num produto de chat, onde a pergunta seguinte do gestor é sempre imprevisível. `[ANÁLISE]` O gestor de marketing não conversa em fluxograma. Um harness que só sabe executar caminhos pré-desenhados é um formulário com cara de chat, e o guia do desafio é explícito ao dizer que "não predefinimos o que o chat precisa fazer".

Falha secundária, esta puramente técnica e cara: se o mesmo nó chamar `interrupt()` **e** executar o efeito colateral, a retomada re-executa o nó desde o início. Num grafo de pauta que termina mandando o resumo no WhatsApp da Aline, isso é **mensagem duplicada**. `[FONTE]` A doc do LangGraph avisa disso em uma linha e a maioria dos tutoriais ignora. `[ANÁLISE]` A consequência de projeto é dura e simples: **aprovação e efeito têm que morar em nós separados** — um nó `gate` que só interrompe, um nó `act` que só executa.

> **Veredicto.** O grafo dá auditabilidade e controle, e paga com rigidez. Ele é ótimo espinha dorsal e péssimo corpo inteiro.

---

## Tipo 5 — Contexto como ambiente (RLM)

### O que é

O contexto para de ser algo que se injeta e passa a ser algo que se **navega**. `[FONTE]` Zhang, Kraska e Khattab (arXiv:2512.24601) propõem tratar prompts longos "como parte de um ambiente externo", deixando o LLM "examinar, decompor e chamar a si mesmo recursivamente sobre trechos do prompt". A mecânica: o contexto é carregado como **variável Python num REPL**; o modelo raiz (profundidade 0) **nunca vê o contexto inteiro** — recebe só a query e escreve código para inspecionar e fatiar a variável, com a saída do REPL voltando truncada; dentro do ambiente ele pode invocar sub-LLMs (profundidade 1) sobre trechos; termina com `FINAL(...)` ou `FINAL_VAR(...)`.

`[FONTE]` Sem serem programadas, emergem estratégias de *peeking* (ler os primeiros ~2.000 caracteres), *grepping* por regex, *partition + map* com chamadas recursivas, e sumarização. Números: em OOLONG a 132k tokens, RLM(GPT-5-mini) ~64 pontos contra ~30 do GPT-5 puro (**+114%**), a custo por query aproximadamente igual; em BrowseComp-Plus com 1.000 documentos, RLM(GPT-5) atinge **100%** de acurácia contra 90% da variante sem recursão.

### De onde vem

Zhang et al. (2025/2026) e o blog técnico do primeiro autor. `[ANÁLISE]` É a mais nova e a menos madura das cinco referências — e a única que ataca frontalmente o problema que a AdzHub ainda não tem, mas terá.

### Onde brilha

Quando o corpus é grande demais para caber e específico demais para ser resumido de antemão. O supercérebro da Housewhey depois de dezoito meses de operação — eventos de campanha, threads de WhatsApp, atas, milhares de linhas de CRM — é exatamente isso.

### Onde quebra

`[FONTE]` Os próprios autores declaram: chamadas recursivas são **bloqueantes**, sem prefix caching; a duração varia de segundos a "vários minutos"; **não há garantia forte sobre custo total nem sobre runtime**; os experimentos usam apenas profundidade 1; e a performance **degrada mais em problemas de contagem** sobre contextos grandes.

### Teste contra a Housewhey — T3, pauta de reunião (a mesma tarefa do Tipo 4, de propósito)

Escolhi repetir a T3 porque o contraste é o argumento. Onde o grafo falha por rigidez, o RLM falha pelo oposto — e ver as duas falhas na mesma tarefa é o que torna o híbrido inevitável.

O gestor pede a pauta. O RLM carrega o histórico da conta Housewhey como variável, dá uma espiada, faz grep por "aprovação" e por "orçamento", particiona os últimos 30 dias em blocos, roda sub-chamadas para extrair decisões pendentes de cada bloco, e monta a pauta. **E responde bem à pergunta de follow-up sobre a Luiza**, porque nada foi pré-enumerado: é só mais um grep numa variável que já está carregada. Nesse quesito ele ganha do grafo com folga.

O que quebra é o produto. **Latência sem teto:** o gestor está com a call marcada para daqui a dez minutos e a resposta leva "de segundos a vários minutos" sem que ninguém consiga dizer qual. Um chat estilo Cursor tem um orçamento de paciência de dezenas de segundos, não de minutos, e o pior caso não é o caso médio — é o caso que acontece na frente do cliente. **Custo sem teto:** o paper reporta custo *comparável* em benchmark, com a ressalva explícita de que não há garantia forte; numa plataforma multi-conta com dezenas de gestores da SPOT abrindo chat ao mesmo tempo, "sem garantia forte de custo" é uma linha de P&L que ninguém consegue projetar.

E há uma terceira falha, que é a mais irônica: **auditoria por script descartável**. A pauta afirma "3 decisões pendentes". A procedência desse 3 é um trecho de código Python que o modelo escreveu, executou e não guardou como parte da metodologia. `[FONTE]` E é justamente em contagem sobre contexto grande que os autores dizem que a degradação é maior. `[ANÁLISE]` Ou seja: o RLM erra com mais probabilidade exatamente na classe de afirmação — "quantos criativos", "quantas decisões", "quantos leads" — que enche uma pauta de reunião, e é a classe que o gestor menos vai conferir, porque contagem parece trivial.

> **Veredicto.** O princípio do RLM está certo e a AdzHub deveria adotá-lo. A implementação — REPL livre, recursão sem teto, custo sem previsão — não cabe num chat interativo de produção em 2026.

---

## Síntese comparativa

Notas de **1 (ruim) a 5 (ótimo)**, sempre no **tipo puro**, aplicadas ao domínio da AdzHub. `[ANÁLISE]` — a tabela é julgamento meu a partir das mecânicas descritas acima, não medição de nenhuma fonte.

| Tipo | Auditabilidade | Flexibilidade | Segurança operacional | Custo / latência | Esforço de modelagem |
|---|:---:|:---:|:---:|:---:|:---:|
| **1. ReAct** | 2 — traço linear, sem etapas nomeadas; conclusão sem procedência | 5 — absorve o imprevisto sem código novo | 2 — só o que a tool proibir; nenhum gate nativo | 4 — barato, previsível, teto por contador de passos | 5 — dias |
| **2. CodeAct / sandbox** | 2 — o método é código descartável, irreprodutível entre turnos | 5 — compõe e explora dado livremente | 1 — PII e credenciais dentro do processo; superfície ampla | 3 — kernel + tokens de código; latência média | 2 — sandbox, isolamento, ciclo de vida |
| **3. Sessão + permissões & skills** | 3 — decisão de autorização fica registrada; o raciocínio, não | 4 — loop interno segue livre | **5** — deny-first, gate explícito, segredos isolados | 4 — overhead de política é desprezível | 3 — catálogo de risco e skills bem escritas |
| **4. Grafo de estados** | **5** — nó nomeado + estado tipado + checkpoint por superstep | 2 — só executa caminhos enumerados | 4 — `interrupt()` pronto, mas exige separar gate de efeito | 4 — previsível; nós supérfluos custam | 1 — cada metodologia é um subgrafo |
| **5. RLM / contexto como ambiente** | 1 — procedência é um script jogado fora | **5** — nada é pré-enumerado | 2 — REPL com o corpus da conta dentro | 1 — "segundos a vários minutos", sem garantia de custo | 3 — ambiente e limites de recursão |

Três leituras que a tabela torna difíceis de negar:

1. **Auditabilidade e flexibilidade são anticorrelacionadas nos tipos puros.** Os dois que pontuam 5 em flexibilidade (ReAct, RLM) pontuam 1–2 em auditabilidade; o que pontua 5 em auditabilidade (grafo) pontua 2 em flexibilidade. Não é coincidência: auditabilidade vem de **estrutura declarada antes**, flexibilidade vem de **estrutura decidida durante**.
2. **A coluna de segurança operacional é quase ortogonal às outras quatro.** O Tipo 3 pontua 5 em segurança sem ganhar nada em auditabilidade ou flexibilidade — o que sugere que ele não é um *tipo* concorrente, e sim uma **camada** que se aplica sobre qualquer um dos outros.
3. **Ninguém pontua bem em custo/latência e flexibilidade ao mesmo tempo, exceto o ReAct** — que paga isso na auditabilidade. Não há almoço grátis nesta tabela.

---

## O que isso implica para a AdzHub

`[ANÁLISE]` Nenhum dos cinco puros resolve, e a razão não é que sejam imaturos — é que **as quatro tarefas do gestor não são a mesma classe de problema**. T1 é um join determinístico que precisa dar o mesmo número toda semana. T2 é uma investigação aberta cujo caminho ninguém consegue enumerar antes. T3 é navegação de um histórico que só cresce. T4 termina numa ação irreversível sobre a verba do cliente. Um harness sintonizado para uma delas está desafinado para as outras três: o grafo que faz T1 perfeitamente é o que trava em T2; o RLM que brilha em T3 é o que estoura o orçamento em T1; o ReAct que dá conta de T2 é o que entrega T4 sem gate.

Há uma segunda razão, mais estrutural. Os cinco tipos não estão no mesmo nível de abstração — tratá-los como cinco opções mutuamente exclusivas é o erro de enquadramento que o desafio convida a cometer. **ReAct é um loop. Grafo é uma topologia. Sandbox é um ambiente de execução. Permissões & skills é uma camada transversal. RLM é uma estratégia de acesso a contexto.** Só os dois primeiros de fato competem pelo mesmo lugar. Os outros três compõem com qualquer coisa. `[ANÁLISE]` O trabalho de arquitetura, portanto, não é escolher um; é decidir **o que fica por fora, o que fica por dentro, e o que atravessa tudo**.

O terreno que as fichas deixam preparado — o que um híbrido teria que ter, com a evidência que sustenta cada item:

- **Etapas nomeadas com estado tipado por fora.** É a única resposta encontrada para a *conclusão órfã* do ReAct. `[FONTE]` O grafo entrega isso via `State` com reducers e checkpoint por superstep; o OpenHands entrega o equivalente via event sourcing, com `ConversationState` como única fonte de verdade e `EventLog` append-only — a **0,20 ms de latência de persistência por evento**, o que remove o argumento de custo.
- **Liberdade real dentro de cada etapa.** É a única resposta para a *enumeração antecipada* do grafo. Um nó não pode ser uma chamada de função; tem que ser um mini-loop ReAct com objetivo declarado, teto de passos e **allowlist própria de tools** — `[FONTE]` o que o AI SDK entrega direto com `prepareStep` + `activeTools` + `stopWhen`, sem grafo nenhum.
- **Permissão deny-first como camada, não como nó.** `[FONTE]` A ordem do Claude Agent SDK (hooks → deny → ask → modo → allow → callback) e o aviso de que tool auto-aprovada nunca chega ao `canUseTool` dizem onde a checagem tem que morar: **antes de tudo, e não dentro do fluxo feliz**. `[FONTE]` E a separação do OpenHands entre `SecurityAnalyzer` (avalia risco) e `ConfirmationPolicy` (aplica) é o que permite política por conta sem reescrever tool.
- **Gate e efeito em nós separados.** Consequência direta do aviso de idempotência do LangGraph: na retomada, o nó roda de novo desde o começo. Um nó que aprova **e** dispara WhatsApp manda dois.
- **Metodologia como artefato versionado, não como código gerado.** É a resposta à *metodologia volátil* do CodeAct e à *ordem não governada* do Tipo 3. `[FONTE]` Skills com ativação por gatilho (OpenHands `AgentContext`, `.claude/` no Agent SDK) mais tools de agregação **opinativas** — no espírito dos "adaptadores opinativos" do harness de Claire Vo. A tool certa para a Housewhey não é `meta_ads.call(endpoint, params)`; é `meta_ads.gasto_por_criativo(conta, periodo)`, cuja definição de "gasto" é da SPOT e não do modelo.
- **Contexto acessado por consulta, nunca despejado.** O princípio do RLM sem o REPL: o supercérebro é uma tool de consulta ao grafo temporal, não um blob no prompt. `[FONTE]` A bi-temporalidade do Graphiti/Zep — separar quando o fato passou a valer de quando o sistema soube dele — é o que faz a diferença entre "o CPA subiu depois da troca de criativo" e "subiu antes, só descobrimos depois". Numa investigação de anomalia, essa distinção **é** a resposta.
- **Artefato como saída de primeira classe.** `[FONTE]` O vocabulário *runs / tasks / tools / artifacts* do episódio "How I AI". `[ANÁLISE]` O gestor não quer conversa: quer a pauta, o relatório, o briefing — objeto nomeado, versionado, reaproveitável na segunda-feira seguinte.

O que sobra de fora, e deveria ser recusado explicitamente em vez de silenciosamente omitido: **sandbox de execução arbitrária** (marketing não precisa rodar código do usuário, e o custo em superfície de PII é alto demais para o ganho) e **RLM completo com recursão livre** (latência e custo sem teto são incompatíveis com chat interativo). `[ANÁLISE]` Recusar por escrito, com a razão, vale mais num paper do que fingir cobertura total — e é o que a fonte-modelo do desafio faz: o OpenHands dedica uma tabela inteira a dizer o que ele tem e o que os concorrentes não têm, sem alegar que resolve tudo.
