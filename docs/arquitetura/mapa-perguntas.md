# Mapa das 11 perguntas do guia → seções do paper

O guia oficial (`docs/adzhub/guia-do-desafio.md`, "Roteiro do paper") traz 11 perguntas. O
paper mantém a forma de artigo curto e responde as 11 dentro das seções. Nenhuma fica sem
resposta. As respostas abaixo são matéria-prima redigida — o subagente `paper` pode cortar
e reescrever, mas não precisa reinventar o conteúdo.

**Estrutura do paper adotada:**

| § | Seção |
|---|---|
| 1 | Problema: o gestor de marketing e o trabalho multi-etapa |
| 2 | Tese (2.1 De chatbot a agente) |
| 3 | Estudo: os cinco tipos de harness (3.4 O que mudou) |
| 4 | Arquitetura (4.1 grafo · 4.2 ReAct no nó · 4.3 permissões · 4.4 tool/memória/app) |
| 5 | Trade-offs aceitos |
| 6 | Onde a solução quebra |
| 7 | Protótipo (7.1 o que ilustra · 7.2 dataset · 7.3 chave e modelo) |
| 8 | Próximos passos e recorte deliberado |

---

## Tabela

| # | Pergunta | Seção | Resposta (matéria-prima) |
|---|---|---|---|
| 1 | Qual é a tese do harness, em 3–5 frases? | §2 | Proponho um harness híbrido: **grafo de estados como espinha dorsal, loops ReAct dentro dos nós de investigação e uma camada de permissões deny-first**, com o supercérebro como fonte de contexto de primeira classe acessada por tool. O grafo dá fronteiras nomeadas — `interpret`, `plan`, `fetch`, `reason`, `gate`, `act`, `respond` — que tornam um diagnóstico de cinco etapas legível para quem vai repeti-lo numa call com o cliente. O ReAct dentro do nó preserva a flexibilidade de descobrir o passo que ninguém planejou, sob teto de `max_steps` e allowlist. O gate garante que nenhuma ação com efeito real acontece sem um humano ver o preview do efeito. A aposta central: no domínio de marketing, **a defensibilidade da resposta vale mais que a autonomia do agente**. |
| 2 | O que deixa de ser chatbot e passa a ser agente? | §2.1 | Três coisas. Primeira: ele **resolve entidade contra a operação real** — "a Ômega 3" vira um id de campanha da Housewhey e uma janela de datas, antes de qualquer API. Segunda: ele **busca o dado que ele mesmo decidiu que faltava** — no diagnóstico da queda de vendas, ninguém programou "olhar o link de destino dos criativos"; esse passo nasce da observação de que o Meta reporta mais conversão do que o CRM atribui. Terceira: ele **age sob permissão** — pausa anúncio de verdade depois de mostrar o que vai pausar e quanto aquilo gastou. Chatbot devolve texto; agente devolve efeito rastreável. |
| 3 | O que você acreditava sobre harness no início e o que mudou? | §3.4 | *Ver texto completo abaixo.* Resumo: eu tratava harness como escolha de loop e achava que qualidade vinha do modelo. Depois de estudar, o loop virou a parte menos diferenciada do problema: o que define a qualidade é o **contrato de fronteira** — o que atravessa para o contexto e o que é permitido — e a permissão precisou virar **nó do grafo**, não middleware de tool. |
| 4 | Qual abordagem escolheu e por quê, em vez das outras? | §4 | Híbrida: grafo (tipo 4) + ReAct (tipo 1) + permissões/skills (tipo 3). ReAct puro não deixa a investigação auditável nem permite allowlist por fase — a permissão viraria instrução de prompt, que o modelo pode ignorar. Workflow determinístico não diagnostica: exigiria um pipeline codificado por prompt de aceite, e o quinto pedido do gestor não teria pipeline. Sandbox/CodeAct e RLM completo foram recortados com custo declarado (ADR-005). O grafo entra como topologia de segurança, não só de orquestração: `pause_ads` só existe no nó `act`. |
| 5 | Como o harness conversa com supercérebro, Apps e APIs? O que é tool, memória, app? | §4.4, Fig. 1, Tab. 1 | **Memória** é o supercérebro (grafo + linha do tempo). **App** é uma metodologia empacotada que devolve estrutura, não parágrafo — `app_diagnostico` retorna veredito, causa-raiz com evidência, hipóteses descartadas e próximos passos. **Tool** é o mecanismo único de acesso: memória, App e API entram no contexto **exclusivamente** como retorno de tool, nunca colados no prompt do sistema. São 12 tools, 10 de leitura e 2 de escrita. Consequência prática: cada afirmação da resposta tem um evento de trace com `source` atrás dela. |
| 6 | Quais trade-offs aceitou de propósito? | §5 | **Latência** por auditabilidade: 4 a 6 chamadas de LLM no caminho feliz contra 2 ou 3 de um ReAct puro. **Fricção** por segurança: o gate interrompe o turno em toda escrita, e pausar 8 criativos custa mais cliques que fazer no gerenciador. **Cauda longa** por superfície pequena: sem CodeAct, "refaz com média móvel de 7 dias" não tem tool e não tem como ser improvisado. **Sessão longa** por simplicidade de MVP: `compact` é lossy e o contexto do chat cresce sem teto. **Fidelidade aritmética** por segurança: agregação feita pelo LLM erra em silêncio quando as linhas passam de algumas dezenas. |
| 7 | Onde a solução quebra nas tarefas reais do gestor? | §6 | *Ver as quatro falhas nomeadas abaixo.* Resumo: no **relatório**, o LLM soma linhas e erra em silêncio; no **diagnóstico**, o agente não sabe o que não pode ver; na **pauta**, ela fica plausível justamente onde está incompleta; nos **criativos**, o gate degrada em teatro e a resolução de entidade quebra no apelido interno do time. |
| 8 | O que o protótipo ilustra e o que ficou só no paper? | §7.1 | O protótipo roda os quatro prompts de aceite ponta a ponta com o grafo real: nós, edges, loop ReAct com `max_steps`, trace visível na legenda `pedido → raciocínio → tool → observação → ação → resposta`, e o gate bloqueando `pause_ads` e `send_whatsapp` até a confirmação. O Palco mostra tabela de métricas, lista de criativos com badges, pauta, diff de CTA e diagnóstico. Ficou só no paper: checkpoint persistente entre sessões, retry com backoff exponencial de verdade, avaliação quantitativa e qualquer integração real — as APIs são datasets locais. |
| 9 | Quais datasets/tools existem, o que é fake, o que dá para testar? | §7.2 | Datasets em `data/`: `supercerebro.json` (grafo Pessoas/Campanhas/Canais/Tarefas), `timeline.json` (eventos datados), `meta_ads.json`, `google_ads.json`, `ga.json`, `crm.json`, `criativos.json`. **Tudo é fake** — nomes, números e eventos foram gerados; a conta Housewhey e o time Aline/Carolina/Luiza vêm do próprio guia. As 12 tools são reais no sentido de que rodam, validam argumentos e respeitam a allowlist — só a fonte é local. O avaliador pode testar os quatro prompts, mudar a pergunta, negar uma confirmação para ver o caminho `acao_negada`, e abrir o trace para conferir cada número. O `dataset_prompt.md` oficial não estava público na data de execução; o contrato foi derivado do guia e isso está registrado em `data/README.md`. |
| 10 | Como o avaliador cola a `OPENROUTER_API_KEY` e troca de modelo? | §7.3 | Há um campo de chave no topo da interface. A chave fica em `sessionStorage` do browser e viaja no header `x-openrouter-key` a cada request — **não é lida de variável de ambiente, não é persistida no servidor e não aparece em log nem no trace**. Ao lado, um seletor de modelo envia o slug do OpenRouter no corpo do request. Sem chave, o modo replay determinístico roda os quatro prompts com um roteiro gravado, rotulado como replay na interface. |
| 11 | Com mais uma semana, o que construiria e o que deliberadamente não construiria? | §8 | *Ver texto completo abaixo.* Construiria, nesta ordem: avaliação com casos e runner; agregação determinística dentro das tools; e aprendizado de alias na resolução de entidade. Não construiria: sandbox/CodeAct, multi-agente com supervisor, escrita autônoma no supercérebro e mais conectores de canal. |

---

## P3 — O que eu acreditava e o que mudou (texto completo)

**No início eu tratava "harness" como sinônimo de "loop".** A pergunta que eu achava
central era: ReAct, grafo, CodeAct ou plan-and-execute? E eu assumia que, escolhido o loop,
a qualidade do agente seria basicamente a qualidade do modelo — o harness sendo encanamento.

**Duas coisas mudaram.**

A primeira: **o loop é a parte menos diferenciada do problema.** Todos os cinco tipos
resolvem os quatro prompts de aceite de alguma forma. O que separa uma resposta que o
gestor consegue levar para a call de uma resposta que ele não consegue defender não é o
formato do loop — é o **contrato de fronteira**: o que atravessa para o contexto do modelo,
com que rastro, e o que é permitido em cada fase. Foi por isso que o artefato mais
trabalhoso desta arquitetura acabou sendo `src/harness/types.ts`, e não o executor do
grafo. O `TraceEvent` como união discriminada serializável, o `ActionPreview` em PT-BR e o
`ResolvedEntity` com `confidence` são o harness. O loop é o resto.

A segunda, e essa foi um erro concreto que eu cometi no primeiro rascunho: **eu ia
implementar permissão como middleware em volta da execução de tool** — um wrapper que
checa `effect` e decide se deixa passar. Parece limpo e é o que a maioria dos exemplos faz.
Não funciona neste domínio, por um motivo específico: um middleware pode *negar*, mas não
pode **parar o turno, montar um preview legível e devolver o controle ao humano com o
trabalho já feito preservado para retomar depois**. Ele só sabe dizer não. Permissão que só
sabe negar empurra o produto para um dos dois extremos ruins — ou vira somente-leitura, ou
alguém desliga a checagem. Por isso `gate` virou **nó de primeira classe do grafo**, com
`halt: 'awaiting_confirmation'` fechando a resposta HTTP e a retomada acontecendo por
reentrada com estado restaurado. A permissão deixou de ser uma checagem e passou a ser uma
**fase do fluxo de trabalho**. Essa foi a mudança que mais alterou o desenho.

Uma terceira, menor mas honesta: eu superestimava RAG. Achava que despejar o contexto da
conta no system prompt era a forma pragmática de dar memória ao agente. Ao escrever a
resposta do prompt 2 percebi que o valor não está em *ter* o contexto — está em conseguir
dizer **de onde ele veio**. Contexto colado no prompt é indistinguível de alucinação na
hora em que o cliente pergunta "como você sabe disso?".

---

## P7 — Onde a solução quebra (quatro falhas nomeadas)

Uma por tarefa típica do gestor. São falhas do harness que eu propus, não do estado da arte.

### 1. Relatório de criativos × resultado real — *a soma silenciosa*

Sem CodeAct (ADR-005), o cruzamento de gasto do Meta com leads do CRM por `utm_content` é
feito pelo LLM lendo linhas. Com os poucos criativos do dataset funciona. Com uma conta real
de centenas de anúncios, o modelo erra soma e agrupamento — e erra **em silêncio**, porque
o número errado é plausível. O agravante é específico deste caso: parte dos leads chega sem
`utm_content` e simplesmente **não aparece na tabela**. A única coisa que impede o artefato
de mentir com cara de rigor é o `footnote` do `MetricsTableArtifact` ("12 leads chegaram sem
`utm_content` e não entram nesta tabela"). Ou seja: a correção da peça mais importante do
relatório depende do nó `respond` lembrar de preencher um campo opcional. Isso não é uma
garantia, é uma esperança.

### 2. Diagnóstico de conta — *o agente não sabe o que não pode ver*

O harness chega à causa-raiz do prompt 2 (encurtador de link derrubando os UTMs) por um
motivo frágil: `list_criativos` devolve `linkDestino`. Se a pista morasse num campo que
nenhuma tool expõe — uma configuração de rastreamento, um parâmetro de redirect, uma
mudança feita direto no gerenciador — o agente **não hesitaria**. Ele concluiria "queda de
demanda na semana" com a mesma estrutura de evidência e a mesma confiança, porque a ausência
de dado não gera sinal. Junte a isso o teto de `reactCycles` = 3: uma investigação legítima
que precisasse de um quarto ciclo é cortada, e o corte por orçamento é, para o gestor,
indistinguível de "investiguei e não achei mais nada". O `budget_exhausted` existe no
estado; ele só ajuda se a resposta o mencionar.

### 3. Pauta de reunião — *completa na aparência, incompleta no que importa*

`timeline_query` só conhece o que foi registrado. Na operação real, a decisão mais
importante da semana costuma ter acontecido numa ligação, num áudio de WhatsApp não
transcrito, ou numa mudança que a Aline fez direto no gerenciador e comentou com a Carolina
no corredor. A pauta gerada vem bem-formatada, com blocos, responsáveis e prioridades — e
**omite exatamente o item que fará a reunião existir**. Esse é o modo de falha mais perigoso
dos quatro, porque a pauta *parece* completa: o gestor entra na call confiando nela em vez
de conferir. Uma pauta vazia seria menos danosa que uma pauta plausível e furada.

### 4. Análise de criativos — *o gate vira teatro e o apelido não resolve*

Duas falhas na mesma tarefa. **(a)** O gate depende de o gestor ler o preview. Depois da
décima confirmação, ele clica "confirmar" por reflexo, e o preview passa a ser um registro
de que a informação estava disponível — não uma decisão informada. Se eu agrupar as
confirmações para reduzir a fricção, aumento a aprovação cega; se eu mantiver uma por item,
o gestor prefere fazer no gerenciador. O trade-off não tem saída técnica: ele só muda de
lado (ADR-003). **(b)** A resolução de entidade no `interpret` quebra com apelido interno.
O time chama a campanha de "a nova da Ômega"; esse alias não está no grafo; a confiança cai
abaixo de 0,6 e o agente **pergunta**. Comportamento correto e irritante — o gestor sabe
perfeitamente do que está falando e o agente parece obtuso. A correção real não é técnica,
é curadoria contínua de aliases no supercérebro, trabalho que o harness não faz sozinho.

---

## P11 — Mais uma semana (texto completo)

### O que eu construiria, nesta ordem

**1. Avaliação antes de qualquer feature nova.** Um conjunto de 20 a 30 prompts com
resultado esperado e um runner que executa o grafo em modo determinístico medindo quatro
coisas: a entidade foi resolvida corretamente; as tools chamadas foram as necessárias e
apenas elas; a causa-raiz foi encontrada quando existia; o gate foi acionado em toda
escrita. Hoje `max_steps = 6` e `reactCycles = 3` são **números que eu estimei olhando
quatro prompts** — sem medição, todo ajuste continua sendo chute e toda regressão passa
despercebida. É a primeira coisa porque as outras duas ficam impossíveis de validar sem ela.

**2. Agregação determinística dentro das tools.** Mover o join Meta × CRM por `utm_content`,
o group-by e o cálculo de CPA para dentro de uma tool que faz aritmética em código, e
devolver ao modelo o resultado agregado com a contagem explícita do que ficou de fora. Isso
mata a falha 1 do P7 sem abrir sandbox: o código é meu, não gerado. O custo é rigidez —
cada agregação nova é uma tool nova — e eu aceito, porque errar soma em silêncio é pior que
não conseguir agregar de um jeito específico.

**3. Aprendizado de alias na resolução de entidade.** Quando `interpret` pergunta e o gestor
corrige ("é a Ômega 3 Prospecção"), gravar esse alias no supercérebro para a próxima vez.
Ataca a falha 4b do P7 no ponto certo — o problema é de curadoria, e a correção mais barata
é aproveitar a correção que o humano já está fazendo de graça.

### O que eu deliberadamente NÃO construiria

**Sandbox/CodeAct.** É a tentação óbvia depois do item 2, e é justamente por isso que
precisa estar escrita aqui. Código gerado com acesso a credenciais de conta de anúncios de
cliente exige isolamento de verdade — VM, rede fechada, quotas, revisão de saída — e nada
disso se constrói bem em uma semana. Meio sandbox é pior que nenhum. A agregação em tool
resolve 80% do valor com 5% da superfície de ataque.

**Multi-agente com supervisor.** Um agente para Meta, outro para CRM, outro para criativos.
Dobra o custo de tokens, multiplica os pontos de falha e reintroduz um grafo — só que
implícito, mal-especificado e mais difícil de auditar. O grafo explícito já faz esse
trabalho melhor.

**Escrita autônoma no supercérebro.** O agente inferir fatos da conversa e gravar na memória
sem confirmação. Isso é sedutor e é a coisa mais perigosa da lista: memória é `write`, e
memória errada é pior que dado errado, porque **contamina silenciosamente todos os turnos
futuros** — o erro deixa de ter data e vira contexto. Se eu fizesse, seria com o mesmo gate
das outras escritas, e aí o custo de fricção provavelmente não compensaria.

**Mais conectores de canal** (TikTok Ads, LinkedIn, e-mail marketing). É a feature mais
fácil de vender e a que menos prova a tese. Cada conector novo é largura sem profundidade —
o desafio é sobre decisões de arquitetura, e nenhuma delas fica mais forte com a sexta API
de anúncios ligada.

**Um modo de "autonomia configurável"** que permita pular o gate para ações marcadas como
seguras. É exatamente o mecanismo que transforma o gate em teatro por decisão de produto em
vez de por fadiga do usuário. Se um dia existir, tem que vir depois da telemetria que mostre
quais confirmações são realmente ruído — não antes.
