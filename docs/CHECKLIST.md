# Checklist de entrega — Desafio Harness Agêntico AdzHub

Prazo: **28/08/2026 23:59 (BRT)**. Verificado em 26/08/2026.
Método: nada é marcado por leitura de código. Cada item foi executado.

---

## Paper (obrigatório, peso 50%)

- [x] `paper/main.pdf` existe, **10 páginas, 139 KB** (limite 3 MB — folga de 21×)
- [x] Português do Brasil, duas colunas, hifenização e acentuação corretas
- [x] Abstract (8–15 linhas), keywords, seções numeradas, referências
- [x] **Figura 1** (TikZ vetorial): gestor → chat → harness → supercérebro/Apps/APIs, com legenda dizendo o que é tool, memória e App, e que o gate não é tool
- [x] **Figura 2** (TikZ vetorial): o grafo de estados, com o loop ReAct delimitado e o gate interrompendo
- [x] **Tabela 1**: 12 tools × camada × leitura/ação, rotulada como ilustrativa
- [x] Compila limpo: `tectonic -X compile paper/main.tex`, sem erro, sem referência indefinida, sem overfull box
- [x] Bibliografia só com fontes realmente acessadas; as inacessíveis (podcast AdzHub, *How I AI*) declaradas como tal em nota
- [x] As **11 perguntas** do roteiro oficial respondidas (mapa em `docs/arquitetura/mapa-perguntas.md`)
- [x] Nenhuma menção a repositório público, código disponível ou clone (varredura no PDF: 0 ocorrências)

## Tese == implementação

- [x] Grafo de 9 nós do paper == `NodeName` em `src/harness/types.ts`
- [x] Loop ReAct confinado a `fetch` e `reason` no paper == allowlist no runtime
- [x] Tetos citados no paper (`interpret` 3, `fetch` 6, `reason` 4, ciclo 3, `act` 2) == `maxSteps` em `src/harness/state.ts`
- [x] 12 tools, 10 leitura / 2 escrita no paper == `src/harness/tools/registry.ts`
- [x] Aresta `act → respond` nomeada `acao_confirmada` no runtime, na legenda da Figura 2 e na §4.3
- [x] Números do dataset citados no paper conferidos contra os JSONs: 39 nós, 76 edges, 18 eventos, 304 insights, 397 leads, 13 criativos, 544 KB

## Demo pública (peso 25%)

- [x] **https://desafio-adz-harness.vercel.app** — HTTP 200 **sem login e sem cookie**
- [x] URL estável (alias de produção, não URL de deploy)
- [x] Campo de `OPENROUTER_API_KEY` visível na coluna do chat
- [x] Chave só em `sessionStorage`; viaja apenas no header `x-openrouter-key`
- [x] **Não vaza**: testado com chave-canário — ausente do stream NDJSON e do log do servidor
- [x] Seletor de modelo (`claude-sonnet-4.5`, `gpt-4.1`, `gemini-2.5-pro`) + campo livre para outro slug
- [x] Sem chave: modo replay determinístico, rotulado de forma permanente
- [x] Os 4 prompts de aceite rodam **na rota de produção**, com trace visível
- [x] Palco reflete o que o harness executou (artefatos por percurso, conforme Tabela 3 do paper)

## Permissões (o núcleo da tese)

- [x] `pause_ads` e `send_whatsapp` só executam a partir do nó `act`
- [x] Escrita chamada de outro nó é recusada com `denied_by_policy` e o fato entra no trace
- [x] Turno para em `awaiting_confirmation` com preview em PT-BR (itens, gasto, CPA, impacto, reversibilidade, como desfazer, o que acontece se negar)
- [x] **Aprovar executa uma vez**; reenviar a mesma aprovação executa **zero** vezes
- [x] **Negar** vai direto a `respond`, zero ações, pendência zerada
- [x] Na interface, "negar" é o botão sólido com foco inicial; "confirmar" exige marcar que leu

## Qualidade verificada

- [x] `npx tsc --noEmit` limpo
- [x] `npx next build` sem erro nem warning
- [x] `node src/harness/harness.test.mjs` — **11/11 passando**
- [x] `node data/validate.mjs` — **8/8 checagens aritméticas passando**
- [x] Dados 100% fictícios, declarado no paper e em `data/README.md`

---

## Pendente — só o candidato pode fazer

- [ ] Preencher o formulário em https://www.adzhub.com.br/vagas/desafio-harness
  - Nome completo
  - **WhatsApp da candidatura** (o mesmo usado na inscrição)
  - Tipo de harness → **"Outra / híbrida / própria"**
  - PDF: `paper/main.pdf`
  - URL da demo: `https://desafio-adz-harness.vercel.app`
  - Repo GitHub: **deixar em branco** (o repositório é privado por decisão do candidato; o campo é opcional)
  - Notas: ver `docs/NOTAS-FORMULARIO.md`
  - Aceite LGPD
- [ ] Clicar na demo uma vez antes de enviar (o fluxo de clique — expandir trace, aprovar/negar no diálogo — foi verificado por código e pela rota HTTP, mas não por um humano com mouse)

## Limites declarados (estão no paper, §5.5)

- O caminho com LLM real não foi executado ponta a ponta com chave paga — quem cola a chave é o avaliador. O paper não afirma desempenho com modelo real.
- Sem checkpoint persistente entre sessões: o estado vive no turno.
- Sem retry com backoff exponencial, sem avaliação quantitativa, sem integração com API real.
