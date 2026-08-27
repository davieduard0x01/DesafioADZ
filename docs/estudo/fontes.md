# Fontes de estudo — harness agêntico

Notas de leitura para o paper do Desafio AdzHub. Data do levantamento: **26/08/2026**.

**Convenção usada aqui:** trechos marcados `[FONTE]` são o que o documento afirma — número, nome de API ou conclusão que está escrito lá. Trechos marcados `[ANÁLISE]` são minha leitura aplicada ao domínio da AdzHub e **não** devem ser citados como se fossem da fonte. Nada neste arquivo foi reconstruído de memória: tudo que aparece como citação foi lido na URL indicada. O que não consegui ler está registrado como **não acessível**, com o que tentei.

---

## 1. The OpenHands Software Agent SDK

**Referência.** Xingyao Wang, Simon Rosenberg, Juan Michelini, Calvin Smith, Hoang Tran, Engel Nyst, Rohit Malhotra, Xuhui Zhou, Valerie Chen, Robert Brennan, Graham Neubig. *The OpenHands Software Agent SDK: A Composable and Extensible Foundation for Production Agents*. arXiv:2511.03690v2 [cs.SE], submetido 05/11/2025, revisado 22/04/2026. Aceito no **MLSys 2026**. URL: https://arxiv.org/abs/2511.03690

**Status:** acessado na íntegra (PDF, 14 páginas + apêndice).

**O que a fonte diz.** `[FONTE]` O SDK é um redesenho arquitetural completo do OpenHands V0. O núcleo é **event sourcing**: toda interação é um evento imutável anexado a um log append-only. `ConversationState` é o *único* componente com estado — `Agent`, `Tool` e `LLM` são imutáveis e serializáveis. A hierarquia de eventos separa o que o LLM vê (`MessageEvent`, `ActionEvent`, `ObservationEvent`, `CondensationSummaryEvent`, `UserRejectObservation`, `AgentErrorEvent`) do que é bookkeeping interno (`ConversationStateUpdateEvent`, `CondensationRequest`, `Condensation`, `PauseEvent`). Tools seguem o contrato **Action–Execution–Observation**: o LLM propõe JSON, o SDK valida contra um modelo Pydantic, o `ToolExecutor` roda, e o resultado volta como `Observation`. O agente é um *processador de eventos stateless*, avançando um passo por vez — o que habilita três coisas explicitamente nomeadas no paper: interleaving de segurança, execução incremental com pause/resume, e streaming de eventos intermediários para a UI.

Segurança é tratada como cidadã de primeira classe dentro do control loop, não como wrapper: o **`SecurityAnalyzer`** classifica cada tool call em `low`/`medium`/`high`/`unknown` e a **`ConfirmationPolicy`** decide se exige aprovação. Quando exige, o agente entra num estado `WAITING_FOR_CONFIRMATION` até aprovação ou rejeição explícita; rejeitado, ele pode tentar alternativa mais segura. O par embutido é `LLMSecurityAnalyzer` + `ConfirmRisky` (limiar padrão: `high`). A política pode ser **atualizada durante a sessão** — o paper chama isso de "adaptive trust", relaxando restrições para operações read-only como `grep`. O `SecretRegistry` isola credenciais por conversa, injeta só no momento da execução e mascara ocorrências na saída com `<secret-hidden>`.

Contexto é gerido pelo **`Condenser`**, que descarta eventos e insere sumários quando o histórico cresce demais — mas a condensação vira um `CondensationEvent` no log, de modo que **o log integral sobrevive à compactação**. `[FONTE]` O `LLMSummarizingCondenser` (default) "reduz custos de API em até 2×, sem degradação de performance do agente". Skills vivem em `AgentContext` e podem ser sempre ativas (`trigger=None`) ou ativadas por keyword no input do usuário. Delegação a subagentes é implementada como uma *tool comum* do pacote `openhands.tools`, sem tocar no core.

**Números.** `[FONTE]` Rollout de produção de 15 dias, V0 e V1 servindo usuários em paralelo: erros atribuíveis ao sistema caem **61%**, de **78,0 para 30,0 por 1k conversas** (infra: 69,8 → 0,0; erros de SDK: 29,7/1k no V1). Overhead do event sourcing medido em 433 conversas do SWE-Bench Verified (39.870 eventos): persistência por evento **0,20 ms** (mediana) / 0,31 ms (P95); replay completo do estado **4,1 ms** / 9,7 ms; recuperação de crash **7,4 ms** / 14,9 ms — e o texto afirma recuperação "abaixo de 20 ms mesmo na conversa mais longa observada (358 eventos)"; armazenamento **380 KB** por conversa (mediana). Paridade de capacidade V0 vs V1 no SWE-Bench Verified com Claude Sonnet 4: **68,0% em ambos**; com Sonnet 4.5, V1 ganha **+8,2 pontos** (64,6% → 72,8%), atribuído ao suporte a extended thinking. Avaliação com 14 modelos em 5 categorias: SOTA em 3 de 5 (Commit0 56,2% vs 12,5% publicado; SWE-Bench Multimodal 44,1%; GAIA 80,0% vs 74,6%).

**O que oferece para a AdzHub.** `[ANÁLISE]` Três coisas transplantáveis quase sem tradução:

1. **Event sourcing é a resposta à auditabilidade do gestor.** O problema real da AdzHub não é o agente errar — é o gestor não conseguir defender o número na reunião com a Housewhey. Se o trace é um log append-only de `ActionEvent`/`ObservationEvent`, a resposta "o CPA do criativo X foi R$ 84" carrega o caminho: qual tool, qual payload, qual linha do CRM. O paper prova que isso custa 0,20 ms por evento — ou seja, **o argumento "auditoria é cara" não se sustenta**; o custo é o LLM, não o log.
2. **`SecurityAnalyzer` + `ConfirmationPolicy` mapeiam 1:1 no risco do domínio.** Ler o Meta Ads é `low`. Pausar um conjunto de anúncios ou disparar WhatsApp para o cliente é `high` e tem que parar num estado equivalente ao `WAITING_FOR_CONFIRMATION`. A separação entre *quem avalia risco* e *quem aplica a política* é o que permite a SPOT ter regra diferente por conta sem reescrever tool.
3. **`SecretRegistry` resolve um problema que a AdzHub tem de verdade:** tokens de Meta Ads, Google Ads e CRM por cliente, com máscara automática na saída. Um agente que loga o access token do Meta num trace visível ao gestor é um incidente, não um bug.

O que **não** transplanta: o sandbox de execução e a portabilidade local→remoto ocupam metade do paper porque o domínio é engenharia de software. Marketing não precisa executar código arbitrário do usuário. `[ANÁLISE]` Isso é um recorte a declarar no paper, não uma lacuna a esconder.

---

## 2. Recursive Language Models (RLM)

**Referência.** Alex L. Zhang, Tim Kraska, Omar Khattab. *Recursive Language Models*. arXiv:2512.24601, submetido 31/12/2025, versão de 11/05/2026. URL: https://arxiv.org/abs/2512.24601 — Blog técnico do primeiro autor (MIT CSAIL): https://alexzhang13.github.io/blog/2025/rlm/ — Código: https://github.com/alexzhang13/rlm

**Status:** abstract e página do arXiv acessados; o blog do autor (fonte mais detalhada sobre a mecânica e os números) acessado na íntegra. **Não li o PDF completo** — os números abaixo vêm do blog e do abstract, e estão marcados como tal.

**O que a fonte diz.** `[FONTE — abstract]` "We propose Recursive Language Models (RLMs), a general inference paradigm that treats long prompts as part of an external environment and allows the LLM to programmatically examine, decompose, and recursively call itself over snippets of the prompt." `[FONTE — blog]` A mecânica: o contexto longo é carregado como **variável Python num REPL (notebook Jupyter)**; o modelo raiz (profundidade 0) **nunca recebe o contexto inteiro** — recebe só a query e escreve blocos de código para inspecionar, fatiar e particionar a variável. A saída do REPL volta truncada. Dentro do ambiente, o modelo raiz pode invocar sub-LLMs (profundidade 1) sobre trechos. Termina com `FINAL(resposta)` ou `FINAL_VAR(nome_variável)`.

`[FONTE — blog]` Estratégias que emergem sem serem programadas: *peeking* (ler os primeiros ~2.000 caracteres), *grepping* (regex para reduzir o espaço de busca), *partition + map* (fatiar e chamar recursivamente), *summarization*, e transformação programática direta quando a saída é longa. Resultados: em **OOLONG** (split `trec_coarse`, ~132k tokens), RLM(GPT-5-mini) atinge ~64 pontos contra ~30 do GPT-5 puro (**+114%**), com custo por query aproximadamente igual; em 263k tokens, ~45 vs ~30 (**+49%**). Em **BrowseComp-Plus** com 1.000 documentos, RLM(GPT-5) chega a **100% de acurácia**, contra 90% da variante sem recursão. `[FONTE — arXiv]` O abstract reporta ganhos de 26% sobre compressão, 130% sobre CodeAct e 13% sobre Claude Code, e uma variante pós-treinada **RLM-Qwen3-8B** com +28,3% em média.

**Limitações declaradas.** `[FONTE — blog]` Chamadas recursivas são **bloqueantes**, sem prefix caching; a duração de uma query varia de segundos a "vários minutos"; **não há garantia forte sobre custo total nem runtime**; os experimentos usam apenas profundidade 1; e a performance degrada mais em problemas de contagem sobre contextos grandes.

**O que oferece para a AdzHub.** `[ANÁLISE]` O RLM é a única das cinco referências que ataca o problema que a AdzHub *vai* ter e ainda não tem: o supercérebro da Housewhey depois de 18 meses de operação não cabe em contexto nenhum. Meses de eventos de campanha, threads de WhatsApp, atas de reunião, milhares de linhas de CRM. A ideia central — **não injetar o contexto, deixar o agente navegá-lo programaticamente** — é exatamente a diferença entre "o gestor cola um CSV no chat" e "o agente consulta a conta".

Mas as limitações batem de frente com o produto. `[ANÁLISE]` Um chat estilo Cursor é interativo: o gestor está numa call, digitou a pergunta e tem 40 segundos de paciência. "Segundos a vários minutos, sem garantia de custo" é aceitável num benchmark offline e péssimo numa reunião. Além disso, RLM puro produz uma resposta cujo caminho é *código gerado ad hoc* — auditar "de onde veio esse número" vira ler um script que o modelo escreveu e jogou fora. **Conclusão de projeto:** vale roubar o princípio (contexto vive fora da janela, o agente busca fatias) e recusar a implementação (REPL livre de profundidade arbitrária).

---

## 3. Claude Agent SDK (Anthropic)

**Referência.** Anthropic. *Claude Agent SDK — Overview* e *Configure permissions*. Documentação oficial, consultada em 26/08/2026. URLs: https://code.claude.com/docs/en/agent-sdk/overview e https://code.claude.com/docs/en/agent-sdk/permissions

**Status:** acessado na íntegra (as duas páginas). Documentação viva, sem número de versão fixo — versionar a citação pela data de acesso.

**O que a fonte diz.** `[FONTE]` O SDK entrega "os mesmos tools, agent loop e context management que movem o Claude Code", como biblioteca Python/TypeScript. Capacidades listadas: built-in tools, **hooks** (código customizado em pontos do ciclo de vida), **subagentes**, **MCP**, **permissões**, **sessões** (mantêm contexto entre trocas, com *resume* e *fork*), **skills/commands/memory** carregados de `.claude/` e `~/.claude/`, e **plugins**.

O detalhe mais valioso é o **fluxo de avaliação de permissão em seis passos**, nesta ordem exata: (1) **hooks** — um `PreToolUse` hook pode negar de saída; um `allow` de hook *não* pula as regras de deny e ask seguintes; (2) **deny rules** — bloqueiam mesmo em `bypassPermissions`; (3) **ask rules** — caem no callback `canUseTool` mesmo em `bypassPermissions`; (4) **permission mode**; (5) **allow rules**; (6) **`canUseTool` callback**. Modos disponíveis: `default`, `dontAsk`, `acceptEdits`, `bypassPermissions`, `plan`, `auto`. A doc avisa explicitamente: **"Auto-approved tools never reach `canUseTool`"** — uma checagem colocada só no callback é silenciosamente contornada para tools aprovadas antes; para checagem em *toda* tool call, o mecanismo correto é o `PreToolUse` hook, porque "hooks run before every other step, and a hook deny applies even in `bypassPermissions` mode". Subagentes **herdam o modo do pai**, e `bypassPermissions`/`acceptEdits`/`auto` do pai não podem ser sobrescritos por subagente.

**O que oferece para a AdzHub.** `[ANÁLISE]` Duas lições de arquitetura, uma positiva e uma defensiva.

Positiva: **skills são a forma certa de modelar os Apps de metodologia**. "Insight da semana", "brief de criativo", "diagnóstico de conta" não são tools (não retornam dado) nem prompts soltos — são pacotes de instrução carregados sob demanda por gatilho, exatamente a semântica de skill descrita aqui e no OpenHands. Isso resolve um problema concreto: se as quatro metodologias da SPOT virarem quatro blocos no system prompt, o agente carrega o brief de criativo enquanto faz diagnóstico de conta e paga por isso em todo turno.

Defensiva: **a ordem de avaliação é a especificação de segurança que a AdzHub precisa copiar literalmente.** O aviso de que tool auto-aprovada nunca chega ao `canUseTool` é a armadilha exata que um harness de marketing cai: alguém marca `meta_ads_read` como allow, depois adiciona `meta_ads_pause` ao mesmo servidor MCP, e a confirmação de "pausar anúncio" some. Deny-first, com deny e ask avaliados *antes* do modo e capazes de vencer o modo, é o desenho a adotar.

---

## 4. Vercel AI SDK

**Referência.** Vercel. *AI SDK — Agents: Foundations* e *AI SDK — Loop Control*. Documentação oficial (AI SDK 7.x), consultada em 26/08/2026. URLs: https://ai-sdk.dev/docs/foundations/agents e https://ai-sdk.dev/docs/agents/loop-control

**Status:** acessado. Atenção: **a API mudou** em relação ao que o enunciado do desafio assume.

**O que a fonte diz.** `[FONTE]` O SDK decompõe um agente em três elementos: **LLM** (decide), **tools** (estendem capacidade) e **loop** (orquestra contexto e condições de parada). Na 7.x existe uma classe `ToolLoopAgent` que roda o ciclo automaticamente, e uma `HarnessAgent` para "harnesses estabelecidas como o Claude Code"; `generateText`/`streamText` continuam disponíveis para controle explícito quando o workflow exige loop customizado.

Controle de parada: `stopWhen` recebe condições; as embutidas são **`isStepCount(count)`**, **`hasToolCall(...toolNames)`** e **`isLoopFinished()`**. O default é `isStepCount(20)`. `[FONTE]` "O loop continua até: um finish reason diferente de tool-calls, uma ferramenta sem função `execute`, aprovação necessária, ou uma condição de parada ser atendida." O callback **`prepareStep`** roda antes de cada passo e permite trocar modelo, restringir o conjunto de tools via **`activeTools`**, mudar temperatura/`maxOutputTokens`, alterar mensagens e podar contexto com `pruneMessages`. Há também `runtimeContext` (estado compartilhado do agente, visível em `prepareStep` e nos callbacks de ciclo de vida) e `toolsContext` (valores por tool, ex.: API keys).

> **Correção factual para o paper:** `maxSteps` **não aparece mais** na documentação 7.x; o controle é `stopWhen` com `isStepCount()`. O nome `stepCountIs` que circula em material de 2025 corresponde a `isStepCount` na doc atual. Citar `maxSteps` como API atual do AI SDK seria um erro verificável em 30 segundos por um avaliador.

**O que oferece para a AdzHub.** `[ANÁLISE]` O `prepareStep` + `activeTools` é a peça mais subestimada da doc e a que mais interessa aqui. Ele permite **restringir o conjunto de tools por etapa dentro de um mesmo loop** — o agente na fase de coleta enxerga `meta_ads.get_insights` e `crm.query_leads`; na fase de ação enxerga `ads.pause` e mais nada. Isso é allowlist por nó de grafo implementada sem grafo, e é o que torna um híbrido "grafo por fora, ReAct por dentro" barato de construir em TypeScript.

`isStepCount(20)` como default é `[ANÁLISE]` uma boa notícia e um alerta: o teto existe, mas 20 passos de tool-calling contra APIs de anúncios é fácil de estourar num cruzamento Meta×CRM com paginação. O teto tem que ser por etapa, não por conversa.

---

## 5. LangGraph

**Referência.** LangChain. *LangGraph — Graph API / low-level concepts*. Documentação oficial, consultada em 26/08/2026. URL: https://docs.langchain.com/oss/python/langgraph/graph-api (a antiga `langchain-ai.github.io/langgraph/concepts/low_level/` agora só devolve redirect — registrado abaixo em "não acessível").

**Status:** acessado na URL nova.

**O que a fonte diz.** `[FONTE]` `StateGraph` é a classe principal, parametrizada por um objeto `State` definido pelo usuário (`TypedDict`, `dataclass` ou Pydantic `BaseModel`), e exige `.compile()` antes de rodar. Cada chave do estado pode ter um **reducer** dizendo como o update se combina com o valor existente; o reducer padrão "ignora o argumento da esquerda e substitui pelo da direita", e reducers customizados (via `Annotated`, ex. `operator.add`) acumulam em vez de substituir. `add_messages` é o reducer especializado para listas de mensagens, que rastreia IDs e sobrescreve mensagens atualizadas.

**Nodes** são funções que recebem `state` (mais `config` e `runtime` opcionais), computam e devolvem update de estado. **Edges** normais via `add_edge("a","b")`; **conditional edges** via `add_conditional_edges`, com função de roteamento que devolve o nome do próximo nó. `START`/`END` são nós virtuais. **`Command`** combina update de estado e controle de fluxo num só retorno, aceitando `update`, `goto`, `graph` e `resume`.

Persistência: o **checkpointer** salva o estado nas fronteiras de superstep (**não no meio de um nó**), permitindo retomar por `thread_id`. **`interrupt()`** pausa a execução esperando input humano; retoma com `Command(resume=value)`. `[FONTE]` Aviso importante: efeitos colaterais antes do interrupt "devem ser idempotentes", porque na retomada **o nó afetado roda de novo desde o início da função**. Checkpoints também habilitam *time travel* — rebobinar e reexecutar a partir de um snapshot.

**O que oferece para a AdzHub.** `[ANÁLISE]` O `interrupt()` é literalmente o "aprovar antes de pausar o anúncio" que a operação exige, e o `checkpointer` por `thread_id` é a conversa persistida por conta/gestor. Mas a advertência sobre idempotência é a informação mais cara desta fonte e ninguém a cita: se o nó que chama `ads.pause()` também fizer o `interrupt()`, **a retomada re-executa o nó inteiro** e a pausa pode acontecer duas vezes. Consequência de desenho para a AdzHub: **efeito colateral e ponto de aprovação têm que ficar em nós separados** — um nó `gate` que só interrompe, um nó `act` que só executa. Isso não é preferência estética; é a condição para não disparar dois WhatsApps para a Aline.

Segundo ganho: o estado explícito com reducers dá ao harness um lugar tipado para os *achados* da investigação (`findings: Finding[]` acumulando via reducer aditivo) — o que resolve o problema de auditoria do ReAct puro sem inventar mecanismo novo.

---

## 6. Podcast AdzHub — "Harness: A Engenharia Oculta da IA"

**Referência.** AdzHub Podcast. *Harness: A Engenharia Oculta da IA*. Episódio de 16 de julho, ~36 min. Spotify, show ID `5Dnw3lZNbXQPSlljcukoC7`, episódio `28uvnPU6JobJnSDrMoKel4`. URL: https://open.spotify.com/episode/28uvnPU6JobJnSDrMoKel4

**Status:** **parcialmente acessível.** Li a **descrição do episódio** na página do Spotify. **Não obtive transcrição nem o áudio** — o Spotify não expõe transcript por HTTP e não há versão em texto publicada que eu tenha encontrado. O ano não aparece na página (mostra só "16 de julho"); pelo contexto do desafio, presumo 2026, mas **não confirmei** e por isso a entrada BibTeX não afirma o ano.

**O que a descrição diz.** `[FONTE — descrição do episódio]` O harness é apresentado como "o sistema nervoso e as mãos" que permitem à IA executar tarefas complexas, gerenciar memória e interagir com o mundo real. Os tópicos anunciados: **cinco valores de design humano** que guiam sistemas como o Claude Code; o **loop ReAct**; **gestão de contexto por pipelines de compressão**; **segurança por políticas deny-first**; comparação técnica entre **Claude Code, OpenClaw e Hermes Agent**; e mecanismos de extensibilidade — **Model Context Protocol e sistemas de plugin**. A tese anunciada: "a verdadeira revolução da IA não está apenas nos modelos, mas na engenharia robusta construída em torno deles".

**O que oferece para a AdzHub.** `[ANÁLISE]` Isto é o mais próximo de uma *declaração de gosto arquitetural do avaliador* que existe no material público, e vale mais como sinal do que como fonte técnica. Os quatro pilares que a própria AdzHub escolheu narrar — ReAct como loop, compressão de contexto, **deny-first** como política de segurança, MCP/plugins como extensibilidade — são exatamente os eixos de um harness híbrido. `[ANÁLISE]` Um paper que proponha grafo de estados com ReAct dentro dos nós, condensação por nó e permissões deny-first está falando a língua que a casa já fala. Não usar isso seria desperdício. Usar isso como se fosse conteúdo técnico verificado, também: **no paper, citar como descrição de episódio, não como argumento de autoridade técnica.**

---

## 7. How I AI — "What a harness is and how to build one with Claude Agent SDK"

**Referência.** Claire Vo (host). *What a harness is and how to build one with the Claude Agent SDK*. Podcast **How I AI**, episódio publicado em **08/07/2026**. URLs: https://www.lennysnewsletter.com/p/what-a-harness-is-and-how-to-build e https://www.chatprd.ai/how-i-ai/how-i-built-a-custom-ai-harness

**Status:** acessada a **página do episódio** (show notes + resumo editorial). **Sem transcrição integral** — o que segue vem das notas do episódio, não do áudio.

**O que a fonte diz.** `[FONTE — show notes]` O episódio parte da frase que circula na indústria — "it's the harness, not the model" — e do diagnóstico de que ninguém explica o que ela significa. Vo constrói um harness próprio para **triagem de bugs do Sentry** usando o Claude Agent SDK, com **UI de terminal feita em Ink** e **adaptadores opinativos** para Sentry, Linear, GitHub e Vercel. A arquitetura é descrita em quatro conceitos: **runs, tasks, tools e artifacts**. O harness "cuida da coleta de evidências, análise de causa raiz e criação de artefatos de follow-up, tudo sem que eu precise digitar 'caro agente, por favor conserte este bug' de novo". Modelo dentro do harness: Claude Sonnet 4.6; a construção do harness usou Opus e GPT-5.5. `[FONTE]` O "unlock" declarado: um harness customizado permite **parar de microgerenciar chats** e ter agentes que fazem exatamente o que você quer.

**O que oferece para a AdzHub.** `[ANÁLISE]` É a analogia mais próxima do produto-alvo, e é quase um espelho: troque Sentry→Meta Ads, Linear→CRM, GitHub→biblioteca de criativos, e "triagem de bug" vira "diagnóstico de conta". O par **`runs` / `artifacts`** é a peça que o vocabulário acadêmico não dá: o gestor não quer uma conversa, quer um **artefato** — a pauta da reunião, o relatório de criativos, o briefing de copy. `[ANÁLISE]` Um harness de marketing que só devolve texto no chat perdeu metade do valor; ele tem que produzir objeto nomeado, versionado e reaproveitável na semana seguinte. E "adaptadores opinativos" é a defesa contra o instinto de expor a API do Meta Ads crua ao modelo: a tool certa não é `meta_ads.call(endpoint, params)`, é `meta_ads.gasto_por_criativo(conta, periodo)`.

---

## Fontes complementares (fora da lista da página, usadas nas fichas dos 5 tipos)

### 8. ReAct — origem do loop tool-calling

**Referência.** Shunyu Yao, Jeffrey Zhao, Dian Yu, Nan Du, Izhak Shafran, Karthik Narasimhan, Yuan Cao. *ReAct: Synergizing Reasoning and Acting in Language Models*. arXiv:2210.03629, 2022. **ICLR 2023**. URL: https://arxiv.org/abs/2210.03629 — **Status:** abstract e página acessados.

`[FONTE]` A proposta é gerar traços de raciocínio e ações **de forma intercalada**: o raciocínio ajuda a induzir, rastrear e atualizar planos e a lidar com exceções; as ações permitem interfacear com fontes externas. Além do ganho de performance, o abstract reivindica explicitamente **"improved human interpretability and trustworthiness"** frente a métodos sem um dos dois componentes. Números: ALFWorld **+34 pontos absolutos** de taxa de sucesso, WebShop **+10 pontos**, com um ou dois exemplos in-context; em HotpotQA e Fever, interação com uma API simples da Wikipédia reduz alucinação.

`[ANÁLISE]` Vale registrar a ironia útil para o paper: a interpretabilidade que o ReAct reivindica é a *do traço*, legível por quem lê o traço inteiro. Ela não é a auditabilidade que o gestor precisa, que é *estrutural* — saber em que etapa cada número entrou.

### 9. CodeAct — origem do runtime com sandbox

**Referência.** Xingyao Wang, Yangyi Chen, Lifan Yuan, Yizhe Zhang, Yunzhu Li, Hao Peng, Heng Ji. *Executable Code Actions Elicit Better LLM Agents*. arXiv:2402.01030, 2024. **ICML 2024**. URL: https://arxiv.org/abs/2402.01030 — **Status:** abstract e página acessados.

`[FONTE]` A tese: agentes normalmente são levados a produzir ações como JSON ou texto em formato pré-definido, o que é limitado por um espaço de ação restrito (o escopo das tools pré-definidas) e por flexibilidade restrita (incapacidade de **compor** múltiplas tools). CodeAct consolida as ações em **código Python executável**, com interpretador acoplado, permitindo revisar ações anteriores e emitir novas em interação multi-turno. Análise com **17 LLMs** no API-Bank e num benchmark novo: até **20% a mais de taxa de sucesso**. Dataset `CodeActInstruct` com 7k interações multi-turno; modelo `CodeActAgent` (fine-tune de Llama2 e Mistral) com auto-debug.

`[ANÁLISE]` "Incapacidade de compor múltiplas tools" é exatamente a dor da tarefa 1 da Housewhey: cruzar gasto do Meta com leads do CRM por `utm_content` é um **join**, e join é composição. Este paper é a melhor justificativa para não modelar tudo como tool atômica — e, ao mesmo tempo, a melhor justificativa para uma tool de *join declarativo* em vez de um interpretador Python solto.

### 10. Zep / Graphiti — o supercérebro como grafo temporal

**Referência.** Preston Rasmussen et al. *Zep: A Temporal Knowledge Graph Architecture for Agent Memory*. arXiv:2501.13956, 2025. URL: https://arxiv.org/abs/2501.13956 — **Status:** abstract e resumo de resultados acessados via página do arXiv; **PDF não lido na íntegra**.

`[FONTE]` O núcleo é o **Graphiti**, motor de grafo de conhecimento temporalmente consciente que sintetiza dados conversacionais não estruturados *e* dados de negócio estruturados, preservando relações históricas. A memória é organizada em três camadas: **nós episódicos** (mensagens cruas), **entidades e fatos semânticos** com validade **bi-temporal** nas arestas, e **sumários de comunidade**. Resultados reportados: DMR 94,8% vs 93,4%; LongMemEval com ganhos de acurácia de até **18,5%** e redução de latência de **90%** frente às baselines.

`[ANÁLISE]` Bi-temporalidade é o conceito que faltava para o supercérebro da AdzHub e que o enunciado só insinua ao dizer "linha do tempo". A diferença entre *quando o fato passou a valer* e *quando o sistema soube dele* é a diferença entre "o CPA subiu depois que trocamos o criativo" e "o CPA subiu antes, só descobrimos depois". Numa investigação de anomalia — tarefa 2 da Housewhey — essa distinção **é** a resposta.

---

## Não acessível

| Fonte | O que tentei | Resultado |
|---|---|---|
| Transcrição do episódio AdzHub "Harness: A Engenharia Oculta da IA" | WebFetch na página do show e na do episódio no Spotify; busca por transcrição publicada | Só a **descrição** do episódio. Sem transcript, sem áudio, sem ano confirmado na página |
| Transcrição integral do "How I AI · What a harness is" | WebFetch em lennysnewsletter.com e chatprd.ai | Só **show notes** e resumo editorial. Conteúdo do áudio não verificado |
| Página do desafio (`adzhub.com.br/vagas/desafio-harness`) | WebFetch direto | É SPA; o fetch devolve conteúdo institucional do site, não o texto do desafio. O único achado útil foi o link do podcast no Spotify. O guia local (`docs/adzhub/guia-do-desafio.md`) segue sendo a única versão confiável do enunciado |
| `dataset_prompt.md` | Referenciado pelo guia | Já registrado como indisponível no `PLAN.md` (achado F0). Não reinvestiguei |
| PDF completo do RLM (arXiv:2512.24601) | Fetch do `/abs`; números detalhados vieram do blog do primeiro autor | Abstract + blog. Nomes de benchmark e números conferem entre as duas fontes; **profundidade de recursão e ablações completas não foram lidas** |
| `langchain-ai.github.io/langgraph/concepts/low_level/` | WebFetch | Devolve apenas "Redirecting…". Conteúdo obtido na URL nova (`docs.langchain.com`) |

---

## Entradas de bibliografia (BibTeX)

Somente fontes efetivamente acessadas. As entradas de podcast declaram no campo `note` que a base é descrição/show notes, não transcrição — **essa honestidade é o que segura a credibilidade das outras dez citações**.

```bibtex
@inproceedings{wang2026openhands,
  author    = {Wang, Xingyao and Rosenberg, Simon and Michelini, Juan and Smith, Calvin
               and Tran, Hoang and Nyst, Engel and Malhotra, Rohit and Zhou, Xuhui
               and Chen, Valerie and Brennan, Robert and Neubig, Graham},
  title     = {The {OpenHands} Software Agent {SDK}: A Composable and Extensible
               Foundation for Production Agents},
  booktitle = {Proceedings of Machine Learning and Systems (MLSys)},
  year      = {2026},
  eprint    = {2511.03690},
  archivePrefix = {arXiv},
  primaryClass  = {cs.SE},
  url       = {https://arxiv.org/abs/2511.03690}
}

@misc{zhang2025rlm,
  author = {Zhang, Alex L. and Kraska, Tim and Khattab, Omar},
  title  = {Recursive Language Models},
  year   = {2025},
  eprint = {2512.24601},
  archivePrefix = {arXiv},
  url    = {https://arxiv.org/abs/2512.24601},
  note   = {Versão consultada de 11 mai. 2026}
}

@inproceedings{yao2023react,
  author    = {Yao, Shunyu and Zhao, Jeffrey and Yu, Dian and Du, Nan and Shafran, Izhak
               and Narasimhan, Karthik and Cao, Yuan},
  title     = {{ReAct}: Synergizing Reasoning and Acting in Language Models},
  booktitle = {International Conference on Learning Representations (ICLR)},
  year      = {2023},
  eprint    = {2210.03629},
  archivePrefix = {arXiv},
  url       = {https://arxiv.org/abs/2210.03629}
}

@inproceedings{wang2024codeact,
  author    = {Wang, Xingyao and Chen, Yangyi and Yuan, Lifan and Zhang, Yizhe
               and Li, Yunzhu and Peng, Hao and Ji, Heng},
  title     = {Executable Code Actions Elicit Better {LLM} Agents},
  booktitle = {Proceedings of the 41st International Conference on Machine Learning (ICML)},
  year      = {2024},
  eprint    = {2402.01030},
  archivePrefix = {arXiv},
  url       = {https://arxiv.org/abs/2402.01030}
}

@misc{rasmussen2025zep,
  author = {Rasmussen, Preston and others},
  title  = {Zep: A Temporal Knowledge Graph Architecture for Agent Memory},
  year   = {2025},
  eprint = {2501.13956},
  archivePrefix = {arXiv},
  url    = {https://arxiv.org/abs/2501.13956}
}

@misc{anthropic2026agentsdk,
  author       = {{Anthropic}},
  title        = {Claude Agent {SDK} --- Overview},
  year         = {2026},
  howpublished = {\url{https://code.claude.com/docs/en/agent-sdk/overview}},
  note         = {Acesso em 26 ago. 2026}
}

@misc{anthropic2026permissions,
  author       = {{Anthropic}},
  title        = {Claude Agent {SDK} --- Configure Permissions},
  year         = {2026},
  howpublished = {\url{https://code.claude.com/docs/en/agent-sdk/permissions}},
  note         = {Acesso em 26 ago. 2026}
}

@misc{vercel2026aisdk,
  author       = {{Vercel}},
  title        = {{AI SDK} --- Agents: Foundations},
  year         = {2026},
  howpublished = {\url{https://ai-sdk.dev/docs/foundations/agents}},
  note         = {AI SDK 7.x. Acesso em 26 ago. 2026}
}

@misc{vercel2026loopcontrol,
  author       = {{Vercel}},
  title        = {{AI SDK} --- Loop Control},
  year         = {2026},
  howpublished = {\url{https://ai-sdk.dev/docs/agents/loop-control}},
  note         = {AI SDK 7.x. Acesso em 26 ago. 2026}
}

@misc{langchain2026langgraph,
  author       = {{LangChain}},
  title        = {{LangGraph} --- Graph {API}},
  year         = {2026},
  howpublished = {\url{https://docs.langchain.com/oss/python/langgraph/graph-api}},
  note         = {Acesso em 26 ago. 2026}
}

@misc{vo2026harness,
  author       = {Vo, Claire},
  title        = {What a Harness Is and How to Build One with the {Claude Agent SDK}},
  howpublished = {Podcast \emph{How I AI}},
  year         = {2026},
  month        = jul,
  url          = {https://www.lennysnewsletter.com/p/what-a-harness-is-and-how-to-build},
  note         = {Episódio de 8 jul. 2026. Consultadas as notas do episódio; transcrição integral não disponível}
}

@misc{adzhub2026harness,
  author       = {{AdzHub}},
  title        = {Harness: A Engenharia Oculta da {IA}},
  howpublished = {\emph{AdzHub Podcast}, Spotify},
  year         = {2026},
  month        = jul,
  url          = {https://open.spotify.com/episode/28uvnPU6JobJnSDrMoKel4},
  note         = {Episódio de 16 jul., \textasciitilde36 min. Consultada a descrição do episódio; transcrição não disponível. Ano não indicado na página, inferido do contexto do desafio}
}
```
