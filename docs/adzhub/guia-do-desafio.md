# Desafio Harness Agêntico — guia para o seu agente
AdzHub · Núcleo Fundacional · 2026

Cole este arquivo inteiro no Cursor, Claude, ChatGPT ou no agente que preferir. Ele é o contexto oficial do desafio.

*O paper é a entrega principal. O protótipo de chat ilustra a tese — pode ser omitido se não der tempo.*
*Fique à vontade para incluir gráficos, imagens ou diagramas no PDF.*

**Prazo:** 28/08/2026 23:59 (horário de Brasília) · estimativa ~6–10 h  
**Envio:** [https://www.adzhub.com.br/vagas/desafio-harness](https://www.adzhub.com.br/vagas/desafio-harness)  
**WhatsApp:** use o mesmo da candidatura.

Se for construir um protótipo, baixe também o [`dataset_prompt.md`](./dataset_prompt.md) e cole no agente para gerar mocks do Supercérebro, APIs e Apps.

---

## Como usar este guia

1. Cole este markdown no contexto do seu agente.
2. Peça para ele te ajudar a **estudar harness**, **fechar uma tese** e **escrever o paper** (e, se quiser, o protótipo).
3. Entregue o **Paper do conceito em PDF** (máx. 3 MB) no formulário da página.

---

## O que é o desafio

Você estuda tipos de **harness** (o runtime que orquestra um agente: loop, tools, estado, permissões, contexto), **escolhe ou idealiza uma abordagem** e entrega:

1. **Paper defendendo a tese/arquitetura escolhida** — foco principal.
2. **Protótipo web de chat agentico** (estilo Cursor) — só para ilustrar a tese aos avaliadores. Não precisa executar a infra real do paper; **simule/demonstre o resultado**.

Não temos a pretensão de um harness de produção. Queremos ver você **tomar decisões de arquitetura** para o domínio de marketing da AdzHub.

Pode usar frameworks, SDKs, AI SDK, LangGraph, padrões de Agent SDK, templates e libs prontas — ou criar do zero.

---

## Contexto AdzHub (o domínio)

A AdzHub é a plataforma da SPOT para profissionais de marketing (gestores de conta, operação diária). O produto-alvo do harness é um **chat agentico**: o gestor pede uma tarefa complexa e o agente orquestra contexto + tools, como um Cursor, mas para marketing.

Arquitetura de referência:

```
profissional de marketing
        ↓
chat agentico (estilo Cursor)
        ↓
harness (runtime do agente)
        ↓
  supercérebro     Apps          APIs
  (grafo +         (metodologias (Meta / Google /
   memória          insight, brief, Supabase, CRM…)
   temporal)        diag, análise
                    de criativos)
        ↓
ação útil no marketing
```

**Supercérebro:** memória da operação — pessoas, cliente, canais, campanhas e decisões ligados em grafo (estilo Mem0 / Graphiti) + **linha do tempo** (contexto temporal). O agente navega o histórico da conta, não um texto solto.

**Apps:** metodologias empacotadas (insight da semana, brief de criativo, diagnóstico de conta, análise de criativos, mapa de solução do cliente).

**APIs:** dados da operação (Meta Ads, Google Ads, Analytics, CRM, WhatsApp, etc.).

Cliente de referência nos diagramas da página: **Housewhey** (e-commerce de suplementos), operação **SPOT**, time **Aline / Carolina / Luiza**.

### Tarefas típicas (inspiração — não é checklist do protótipo)

Não predefinimos o que o chat precisa fazer. Estes são exemplos do dia a dia do gestor:

1. **Relatório de criativos × resultado real.** Cruzar gasto por anúncio no Meta Ads com leads no CRM por `utm_content` (parâmetro de URL) e apontar o que está caro vs. barato — sem confiar só no gerenciador.
2. **Diagnóstico de conta / período.** Investigar anomalias (muitos agendamentos e poucas vendas, CPA estourado, origem inconsistente) e devolver causa + próximos passos. Fontes via API (GA, Meta, Google Ads, CRM) + contextos do supercérebro e conversas (reunião, WhatsApp).
3. **Pauta de reunião.** Montar a pauta da call com o cliente a partir do histórico recente: métricas da semana, criativos em aprovação, riscos e decisões pendentes.
4. **Análise de criativos e novos briefings.** Acessar o App de análise de criativos, sugerir pausar o que está fraco e propor variações de copy/CTA com base nos dados e no contexto da marca.

---

## Regras de execução

- **Paper:** PDF, máx. 3 MB, em português. Curto, no espírito de *The OpenHands Software Agent SDK* (arXiv:2511.03690), porém bem mais simples: tese, estudo, decisões, trade-offs e o que o (eventual) protótipo ilustra.
- **Protótipo:** opcional. Chat web. Pode simular Tools / APIs / Supercérebro com **datasets gerados** ([`dataset_prompt.md`](./dataset_prompt.md)). Sem acesso à infra real da AdzHub.
- **OpenRouter:** se houver demo, use OpenRouter como motor de LLM e deixe um **campo na UI** para o avaliador colar `OPENROUTER_API_KEY`. Guarde a key só na sessão do browser; não persista no servidor.
- **Repo GitHub e URL da demo:** opcionais. Se enviar demo, URL pública estável ajuda.
- **Fontes de estudo** na página: ponto de partida, não obrigatórias. Não se limite a elas.
- **Tipo de harness:** pode ser uma das referências, híbrido ou próprio — desde que a lógica faça sentido para este domínio.
- Trabalho **individual**.

### Tipos de harness de referência (escolha 1, híbrido ou próprio)

1. Loop tool-calling (ReAct)
2. Runtime com sandbox / CodeAct
3. Sessão com permissões & skills
4. Orquestração por estados (grafo)
5. Contexto como ambiente (RLM)

---

## Roteiro do paper

Trate as perguntas abaixo como o miolo do PDF. Não precisa numerar igual, mas **responda com substância**. Inclua diagramas se ajudar.

### Tese

**1. Em 3–5 frases, qual é a tese do harness que você propõe?**

**2. Para o gestor de marketing da AdzHub, o que esse harness deixa de ser “chatbot” e passa a ser “agente”?**

**3. O que você acreditava sobre harness no início do estudo e o que mudou depois de estudar?**

### Arquitetura

**4. Qual abordagem você escolheu (uma das 5, híbrida ou própria) e por quê — em vez das outras?**

**5. Como o harness conversa com supercérebro (grafo + linha do tempo), Apps de metodologia e APIs? O que é tool, o que é memória, o que é app?**

**6. Quais trade-offs você aceitou de propósito (latência, fidelidade, segurança, custo, simplicidade do MVP)?**

**7. Onde a solução quebra nas tarefas reais do gestor (relatório, diagnóstico, pauta, criativos)? Seja específico.**

### Execução

**8. O que o protótipo ilustra — e o que ficou só no paper? Se não houver protótipo, descreva o experimento mental do loop (intent → tools/memória → observação → resposta) em um caso concreto.**

**9. Se simulou dados: quais datasets/tools existem, o que é fake, e o que um avaliador consegue testar no chat?**

**10. Se houver demo: como o avaliador cola a `OPENROUTER_API_KEY` e troca de modelo?**

### Encerramento

**11. Se você tivesse mais uma semana, o que construiria em seguida — e o que deliberadamente não construiria?**

---

## O que colar no formulário

- Nome completo
- WhatsApp da candidatura
- Tipo de harness (ou “Outra / híbrida / própria”)
- PDF do paper (obrigatório)
- Repo GitHub e URL da demo (opcionais)
- Notas (opcional): decisões, limitações, o que simular

---

*Envie o paper em PDF pelo formulário da página do desafio.*
