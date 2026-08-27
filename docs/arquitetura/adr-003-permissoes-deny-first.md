# ADR-003 — Permissões deny-first com confirmação humana

**Status:** aceito · **Data:** 2026-08-26

## Contexto

O harness opera sobre a conta de anúncios de um cliente real. As ações disponíveis não são
simétricas: ler o CPA da semana não tem custo, pausar dois anúncios muda a entrega
imediatamente, e mandar um WhatsApp para a Housewhey é irreversível — não existe
"despausar" uma mensagem enviada ao cliente.

Ao mesmo tempo, um agente que só lê não resolve o pedido "pause os criativos com CTA ruim".
Ele devolve uma lista e o gestor vai fazer na mão — o que é exatamente o trabalho que o
produto deveria eliminar.

## Decisão

Toda tool declara `effect: 'read' | 'write'`. Leitura roda livre dentro da allowlist do nó.
**Toda** escrita para o turno no nó `gate`, que emite um `ActionPreview` e devolve
`halt: 'awaiting_confirmation'`. A execução só retoma num novo request com `decision`.

O preview é escrito para o gestor, não para o dev, e tem quatro partes obrigatórias:

1. **itens** — cada objeto afetado pelo nome que o gestor reconhece, com o número que
   justifica ("Ômega 3 — Frete Grátis · R$ 1.240 em 7 dias · 0 leads atribuídos");
2. **impacto** — a consequência em uma frase;
3. **reversivel** + **comoDesfazer** — e quando é `false`, isso aparece em destaque;
4. **seNegada** — o que o agente faz se o gestor recusar. Nunca "nada acontece" sem dizer o
   que sobra.

O `act` executa **exatamente** os `args` que estavam no preview. Nada é re-inferido depois
da aprovação — senão o gestor aprova uma coisa e outra é executada.

## Alternativas consideradas

- **Autonomia total com log.** O agente age e registra. Rejeitado: o dano é assimétrico e o
  log é lido depois do prejuízo. Confiança em produto de marketing se perde uma vez.
- **Somente leitura.** Seguro e honesto. Rejeitado porque tira do produto a parte que
  justifica ele existir; vira um dashboard conversacional.
- **Allowlist por tool com autonomia configurável** (estilo "aprovar sempre esta ação").
  Rejeitado para o MVP porque é justamente o mecanismo que transforma o gate em teatro —
  ver as consequências ruins abaixo. Vale reconsiderar com telemetria real de uso.
- **Dry-run + aplicar em lote no fim.** Menos interrupções. Rejeitado: o lote esconde o item
  individual e é mais fácil aprovar sem ler.

## Consequências

**Boas.** Nenhuma ação irreversível sem um humano olhando. A separação `read`/`write` é
estrutural, não uma instrução de prompt. O preview força o agente a explicitar o efeito, o
que — de brinde — expõe alucinação de argumento antes dela virar dano.

**Ruins — e são reais.**

- **O gate vira teatro por hábito.** Este é o custo principal e não tem solução técnica
  completa. Depois da décima confirmação, o gestor clica "confirmar" sem ler. O preview
  bonito não impede isso; ele só garante que a informação *estava* lá. Mitigações parciais:
  destacar o irreversível, exigir digitar a quantidade em ações acima de um limiar, e
  agrupar por item em vez de por lote — nenhuma delas resolve o problema de atenção.
- **Fricção real no fluxo.** Pausar 8 criativos em 8 confirmações separadas é pior que fazer
  no gerenciador. Agrupar em uma confirmação reduz a fricção e aumenta o risco de aprovação
  cega — o trade-off não some, só muda de lado.
- **Latência e complexidade de sessão.** O turno interrompido exige persistir estado entre
  requests. É a parte mais complexa do runtime, e um bug aqui perde trabalho já feito.
- **A responsabilidade migra para o humano sem migrar o entendimento.** O gestor assina uma
  ação que o agente decidiu por um caminho que ele não leu. Formalmente ele aprovou;
  praticamente ele delegou. O trace ajuda quem quer olhar — não obriga ninguém a olhar.
