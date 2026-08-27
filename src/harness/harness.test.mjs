/**
 * Checagem executável do harness — Node puro, sem framework.
 *
 *   node src/harness/harness.test.mjs      (ou: node --test src/harness/harness.test.mjs)
 *
 * Cobre o que quebra em silêncio:
 *   1. tool de escrita chamada fora do `act` é recusada com `denied_by_policy`;
 *   2. os tetos do loop ReAct são respeitados;
 *   3. o gate interrompe e a retomada não reexecuta a ação;
 *   4. o join Meta × CRM devolve a contagem correta do que ficou de fora;
 *   5. a chave do OpenRouter não aparece em nenhum trace serializado.
 *
 * O gancho de resolução abaixo existe porque o runtime é TypeScript com imports
 * sem extensão: o Node 22+ tira os tipos sozinho, mas não resolve `./x` → `x.ts`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador.startsWith('.')) {
      const base = new URL(especificador, contexto.parentURL);
      for (const candidato of [`${base.href}.ts`, `${base.href}/index.ts`]) {
        if (existsSync(fileURLToPath(candidato))) return { url: candidato, shortCircuit: true };
      }
    }
    return proximo(especificador, contexto);
  },
});

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
process.chdir(RAIZ); // as tools leem `data/` a partir do cwd

const { executeTool } = await import('./tools/index.ts');
const { BUDGETS, MAX_REACT_CYCLES } = await import('./state.ts');
const { cruzarMetaCrm, SEMANA_ATUAL } = await import('./tools/aggregate.ts');
const { runReplayTurn, resumeReplayTurn } = await import('./replay.ts');
const { estadoSimulado, limparEstadoSimulado } = await import('./tools/write.ts');
const { runTurn, route } = await import('./graph.ts');
const { replayFrames } = await import('./replay.ts');
const { createOpenRouterClient } = await import('./llm.ts');
const { createCtx, createState, deterministicClock, approxTokens } = await import('./state.ts');
const { reason } = await import('./nodes/reason.ts');
const { compact } = await import('./nodes/compact.ts');
const { errorHandler } = await import('./nodes/errorHandler.ts');

function ctxDeTeste() {
  const clock = deterministicClock();
  return createCtx({ turnId: 'turn-teste', sessionId: 'sessao-teste', clock, llm: null, model: 'teste', replay: true });
}

const perm = (node, confirmado = false) => ({ node, budget: BUDGETS[node], confirmedByHuman: confirmado });

// ---------------------------------------------------------------------------
test('1. tool de escrita fora do `act` é recusada com denied_by_policy', () => {
  limparEstadoSimulado();

  for (const node of ['reason', 'fetch', 'interpret', 'plan', 'gate', 'respond']) {
    const { result } = executeTool('pause_ads', { adIds: ['23861004419'], motivo: 'teste' }, perm(node));
    assert.equal(result.ok, false, `pause_ads não podia rodar em ${node}`);
    assert.equal(result.error.code, 'denied_by_policy');
  }

  // no `act`, mas SEM confirmação humana: continua barrada (terceira trava)
  const semConfirmar = executeTool('send_whatsapp', { destinatarioId: 'pessoa_rafael', mensagem: 'oi' }, perm('act', false));
  assert.equal(semConfirmar.result.ok, false);
  assert.equal(semConfirmar.result.error.code, 'awaiting_approval');
  assert.equal(estadoSimulado().enviados.length, 0, 'nenhuma mensagem podia ter saído');

  // tool de leitura fora da allowlist do nó também é barrada
  const leituraForaDoNo = executeTool('meta_ads_insights', { conta: 'housewhey', from: '2026-08-17', to: '2026-08-23', breakdown: 'ad' }, perm('reason'));
  assert.equal(leituraForaDoNo.result.ok, false);
  assert.equal(leituraForaDoNo.result.error.code, 'denied_by_policy');

  // e com confirmação, no nó certo, roda
  const ok = executeTool('pause_ads', { adIds: ['23861004419'], motivo: 'teste' }, perm('act', true));
  assert.equal(ok.result.ok, true);
  limparEstadoSimulado();
});

// ---------------------------------------------------------------------------
test('2. os tetos do loop ReAct são respeitados', async () => {
  const estado = await runReplayTurn({ sessionId: 't2', texto: 'Por que caíram as vendas da Ômega 3 essa semana?' });

  assert.ok(estado.stepCount.fetch <= BUDGETS.fetch.maxSteps, `fetch usou ${estado.stepCount.fetch} passos`);
  assert.ok(estado.stepCount.reason <= BUDGETS.reason.maxSteps, `reason usou ${estado.stepCount.reason} passos`);
  assert.ok(estado.reactCycles <= MAX_REACT_CYCLES);
  assert.equal(estado.halt, 'done');

  const entradas = estado.trace.filter((e) => e.kind === 'node_enter');
  assert.ok(entradas.length < 20, 'o grafo não pode ficar circulando entre nós');
  // todo nó visitado tem o par enter/exit — é o que a UI usa para desenhar o chip
  const saidas = estado.trace.filter((e) => e.kind === 'node_exit');
  assert.equal(entradas.length, saidas.length);
  assert.ok(entradas.some((e) => e.node === 'respond'), 'o respond precisa aparecer no trace');
});

// ---------------------------------------------------------------------------
test('3. o gate interrompe e a retomada não reexecuta a ação', async () => {
  limparEstadoSimulado();
  const sessionId = 't3';
  const parado = await runReplayTurn({ sessionId, texto: 'Pause os criativos com CTA ruim e proponha 3 variações.' });

  assert.equal(parado.halt, 'awaiting_confirmation');
  assert.ok(parado.pendingAction, 'o gate precisa deixar uma ação pendente');
  assert.equal(parado.pendingAction.tool, 'pause_ads');
  assert.ok(parado.pendingAction.preview.itens.length > 0, 'o preview precisa listar cada anúncio');
  assert.equal(parado.trace.filter((e) => e.kind === 'action_executed').length, 0, 'nada pode ter sido executado antes da confirmação');
  assert.equal(estadoSimulado().pausados.length, 0);

  const decisao = { pendingActionId: parado.pendingAction.id, decision: 'aprovar' };
  const retomado = await resumeReplayTurn({ sessionId, decision: decisao });
  assert.equal(retomado.executedActions.length, 1);
  const executados = estadoSimulado().pausados.length;
  assert.ok(executados > 0);
  assert.equal(retomado.pendingAction, null, 'o estado retomado não pode continuar com ação pendente');
  // o turno retomado não refaz a coleta
  assert.equal(retomado.trace.filter((e) => e.kind === 'tool_call' && e.tool === 'list_criativos').length, 1);

  const segundaTentativa = await resumeReplayTurn({ sessionId, decision: decisao });
  assert.equal(segundaTentativa, null, 'a mesma confirmação não pode rodar duas vezes');
  assert.equal(estadoSimulado().pausados.length, executados, 'nada pode ter sido pausado de novo');
  limparEstadoSimulado();
});

// ---------------------------------------------------------------------------
test('4. o join Meta × CRM conta corretamente o que ficou de fora', () => {
  const { from, to } = SEMANA_ATUAL;
  const cruzamento = cruzarMetaCrm(from, to);

  const crm = JSON.parse(readFileSync(join(RAIZ, 'data', 'crm.json'), 'utf8'));
  const naJanela = crm.leads.filter((l) => l.created_at.slice(0, 10) >= from && l.created_at.slice(0, 10) <= to);
  const semUtmEsperado = naJanela.filter((l) => !l.utm_content).length;

  assert.equal(cruzamento.fora.leadsSemUtm, semUtmEsperado);
  assert.equal(
    cruzamento.linhas.reduce((s, l) => s + l.leads, 0) + cruzamento.fora.leadsSemUtm,
    naJanela.length,
    'leads agrupados + leads fora do agrupamento tem que fechar o total da janela',
  );
  assert.ok(cruzamento.fora.gastoSemUtm > 0, 'o gasto sem utm_content é o buraco de atribuição');
  assert.ok(cruzamento.fora.anunciosSemUtm.includes('omega3_vid_prova_social_v2'));

  const meta = JSON.parse(readFileSync(join(RAIZ, 'data', 'meta_ads.json'), 'utf8'));
  const gastoEsperado = meta.insights
    .filter((i) => i.date >= from && i.date <= to && !i.utm_content)
    .reduce((s, i) => s + i.spend, 0);
  assert.ok(Math.abs(cruzamento.fora.gastoSemUtm - gastoEsperado) < 0.05);
});

// ---------------------------------------------------------------------------
test('5. o replay é determinístico byte a byte', async () => {
  const a = JSON.stringify(await replayFrames('t5', 'Por que caíram as vendas da Ômega 3 essa semana?'));
  const b = JSON.stringify(await replayFrames('t5', 'Por que caíram as vendas da Ômega 3 essa semana?'));
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
test('6. o roteamento por edge é o do diagrama (e não existe reason → act)', () => {
  assert.equal(route('interpret', 'entidades_resolvidas'), 'plan');
  assert.equal(route('interpret', 'ambiguidade_de_entidade'), 'respond');
  assert.equal(route('plan', 'precisa_dados'), 'fetch');
  assert.equal(route('plan', 'sem_dados_necessarios'), 'respond');
  assert.equal(route('fetch', 'dados_coletados'), 'reason');
  assert.equal(route('fetch', 'falha_de_tool'), 'errorHandler');
  assert.equal(route('reason', 'lacuna_de_dado'), 'fetch');
  assert.equal(route('reason', 'orcamento_de_contexto_estourado'), 'compact');
  assert.equal(route('compact', 'contexto_compactado'), 'reason');
  assert.equal(route('reason', 'conclusao_pede_acao'), 'gate', 'conclusão que pede ação vai ao gate, nunca ao act');
  assert.equal(route('reason', 'conclusao_sem_acao'), 'respond');
  assert.equal(route('gate', null), 'HALT');
  assert.equal(route('gate', 'sem_efeito_real'), 'respond');
  assert.equal(route('act', 'falha_de_tool'), 'errorHandler');
  assert.equal(route('errorHandler', 'retry'), 'fetch');
  assert.equal(route('errorHandler', 'degradar'), 'respond');
  assert.equal(route('respond', null), 'END');
});

// ---------------------------------------------------------------------------
test('7. a chave do OpenRouter não vaza para trace, frames nem mensagem de erro', async () => {
  const CHAVE = 'sk-or-v1-CHAVE-SECRETA-DO-AVALIADOR-0000';
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'no auth credentials found' } }), { status: 401 });

  const frames = [];
  let estado;
  try {
    estado = await runTurn({
      sessionId: 't5',
      texto: 'Cruza gasto do Meta com leads do CRM por utm_content e me diz o que está caro.',
      model: 'modelo/inexistente',
      llm: createOpenRouterClient(CHAVE, 'modelo/inexistente'),
      onFrame: (f) => frames.push(f),
    });
  } finally {
    globalThis.fetch = fetchOriginal;
  }

  const serializado = `${JSON.stringify(estado)}\n${JSON.stringify(frames)}`;
  assert.ok(!serializado.includes(CHAVE), 'a chave não pode aparecer no estado nem nos frames');
  assert.ok(!serializado.includes('sk-or-'), 'nenhum prefixo de chave pode aparecer');
  // e o turno degrada em vez de quebrar
  assert.equal(estado.halt, 'done');
  assert.ok(estado.trace.some((e) => e.kind === 'assistant_message'));
});

// ---------------------------------------------------------------------------
test('8. observação acima do orçamento desvia para o compact, que preserva números e fontes', async () => {
  const ctx = ctxDeTeste();
  const base = createState({ turnId: 'turn-teste', sessionId: 'sessao-teste', userText: 'e aí?', clock: ctx.clock });
  const gorda = (i) => {
    const texto = `Observação ${i}: gasto R$ 1.234,56 e 42 conversões. ${'x'.repeat(9000)}`;
    return { id: `obs-${i}`, node: 'fetch', tool: 'meta_ads_insights', text: texto, source: `meta_ads.json#${i}`, approxTokens: approxTokens(texto), createdAt: '2026-08-26T14:00:00.000Z' };
  };
  const estado = { ...base, intent: 'cruzamento_utm', observations: [gorda(1), gorda(2), gorda(3), gorda(4)], reactCycles: 3 };

  const saidaReason = await reason(estado, ctx);
  assert.equal(saidaReason.edge, 'orcamento_de_contexto_estourado');

  const saidaCompact = await compact(saidaReason.estado, ctx);
  assert.equal(saidaCompact.edge, 'contexto_compactado');
  assert.ok(saidaCompact.estado.observations.length < estado.observations.length);
  const resumo = saidaCompact.estado.observations[0];
  assert.equal(resumo.compacted, true);
  assert.ok(resumo.text.includes('R$ 1.234,56'), 'o resumo tem que preservar os números');
  assert.ok(resumo.source.includes('meta_ads.json'), 'o resumo tem que preservar as fontes');
  const evento = ctx.events.find((e) => e.kind === 'compaction');
  assert.ok(evento && evento.tokensAfter < evento.tokensBefore);
});

// ---------------------------------------------------------------------------
test('9. errorHandler tenta de novo uma vez e depois degrada explicitamente', async () => {
  const ctx = ctxDeTeste();
  ctx.emit({
    kind: 'tool_call', node: 'fetch', step: 1, tool: 'meta_ads_insights', layer: 'api', effect: 'read',
    args: {}, resultSummary: null, ok: false, durationMs: 1,
    error: { code: 'upstream', message: 'API fora do ar.', retryable: true },
  });
  const base = createState({ turnId: 'turn-teste', sessionId: 'sessao-teste', userText: 'e aí?', clock: ctx.clock });

  const primeira = await errorHandler(base, ctx);
  assert.equal(primeira.edge, 'retry');
  const segunda = await errorHandler(primeira.estado, ctx);
  assert.equal(segunda.edge, 'degradar');
  assert.equal(ctx.events.filter((e) => e.kind === 'error').length, 2);
});

// ---------------------------------------------------------------------------
test('10. entidade que não existe no supercérebro vira pergunta, não chute', async () => {
  const estado = await runReplayTurn({ sessionId: 't10', texto: 'Como está a campanha de colágeno essa semana?' });
  assert.equal(estado.halt, 'needs_clarification');
  assert.equal(estado.visited.join(','), 'interpret,respond', 'não pode chamar API nenhuma antes de resolver a entidade');
  assert.ok(estado.entities.some((e) => e.confidence < 0.6));
  const resposta = estado.trace.find((e) => e.kind === 'assistant_message');
  assert.ok(/colágeno|colageno/i.test(resposta.text) && /\?/.test(resposta.text), 'a resposta precisa perguntar');
});

// ---------------------------------------------------------------------------
test('11. com modelo, o loop ReAct é conduzido por tool-calling — e a allowlist continua valendo', async () => {
  limparEstadoSimulado();
  const CHAVE = 'sk-or-v1-CHAVE-DE-TESTE-1111';
  const chamada = (nome, args) => ({ id: `call-${nome}`, type: 'function', function: { name: nome, arguments: JSON.stringify(args) } });
  const resposta = (message) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });

  const janela = { conta: 'housewhey', from: '2026-08-17', to: '2026-08-23' };
  const roteiro = [
    { content: JSON.stringify({ intent: 'cruzamento_utm', janela: { ...janela, mention: 'essa semana' }, raciocinio: 'Cruzamento por utm_content.' }) },
    { content: JSON.stringify({ passos: [{ descricao: 'Puxar gasto do Meta', tools: ['meta_ads_insights'] }, { descricao: 'Puxar leads do CRM', tools: ['crm_leads'] }] }) },
    // o modelo tenta pausar anúncio de dentro do fetch: tem que ser barrado
    { content: 'Vou puxar o gasto e já pausar o pior anúncio.', tool_calls: [chamada('pause_ads', { adIds: ['23861004419'], motivo: 'caro' }), chamada('meta_ads_insights', { ...janela, breakdown: 'ad' })] },
    { content: '', tool_calls: [chamada('crm_leads', { ...janela, incluirSemUtm: true })] },
    { content: 'Tenho as duas pontas.' },
    { content: 'O CPL alto do prova social é rastreio quebrado, não performance.' },
    { content: JSON.stringify({ conclusao: 'Nada a executar.', precisaAcaoComEfeitoReal: false, acao: null, lacuna: '' }) },
    { content: 'RESPOSTA_DO_MODELO: o caro de verdade é o whey_est_combo_v1.' },
  ];

  let i = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => resposta(roteiro[Math.min(i++, roteiro.length - 1)]);
  let estado;
  try {
    estado = await runTurn({
      sessionId: 't11',
      texto: 'Cruza gasto do Meta com leads do CRM por utm_content e me diz o que está caro.',
      model: 'modelo/de-teste',
      llm: createOpenRouterClient(CHAVE, 'modelo/de-teste'),
    });
  } finally {
    globalThis.fetch = fetchOriginal;
  }

  const negada = estado.trace.find((e) => e.kind === 'tool_call' && e.tool === 'pause_ads');
  assert.ok(negada, 'a tentativa de pausar tem que aparecer no trace');
  assert.equal(negada.ok, false);
  assert.equal(negada.error.code, 'denied_by_policy');
  assert.equal(estadoSimulado().pausados.length, 0, 'nada pode ter sido pausado');

  assert.ok(estado.trace.some((e) => e.kind === 'tool_call' && e.tool === 'meta_ads_insights' && e.ok));
  assert.ok(estado.trace.some((e) => e.kind === 'tool_call' && e.tool === 'crm_leads' && e.ok));
  assert.equal(estado.halt, 'done');
  const final = estado.trace.find((e) => e.kind === 'assistant_message');
  assert.ok(final.text.startsWith('RESPOSTA_DO_MODELO'), 'a redação final é do modelo');
  const tabela = estado.artifacts.find((a) => a.kind === 'metrics_table');
  assert.ok(tabela && /não entram nesta tabela/i.test(tabela.footnote ?? ''), 'a tabela precisa declarar o que ficou de fora');
  assert.ok(!JSON.stringify(estado).includes(CHAVE));
});
