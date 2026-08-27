/**
 * POST /api/chat — a única porta HTTP do harness.
 *
 * Sempre responde NDJSON de `StreamFrame` (uma linha por frame, `\n` no fim),
 * inclusive no replay. Erro de requisição responde `ChatErrorBody` em JSON, que
 * é o caminho que a UI trata pelo status != 200.
 *
 * A chave do OpenRouter vem NO HEADER da requisição do cliente, é usada só nesta
 * requisição e nunca é gravada, logada ou ecoada — nem em mensagem de erro.
 */
import { resumeTurn, runTurn } from '@/harness/graph';
import { decisaoJaAplicada, marcarDecisaoAplicada } from '@/harness/state';
import { createOpenRouterClient, type LlmPort } from '@/harness/llm';
import { runReplayTurn, resumeReplayTurn } from '@/harness/replay';
import { OPENROUTER_KEY_HEADER, type ChatErrorBody, type ChatRequest, type StreamFrame } from '@/harness/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NDJSON = { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' };

function erro(body: ChatErrorBody, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function stream(executar: (enviar: (f: StreamFrame) => void) => Promise<unknown>): Response {
  const encoder = new TextEncoder();
  const corpo = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enviar = (f: StreamFrame): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(f)}\n`));
      };
      try {
        await executar(enviar);
      } catch {
        // A exceção NUNCA é ecoada: pode carregar cabeçalho da requisição.
        enviar({ type: 'fatal', message: 'O turno falhou no servidor. Tente de novo; se persistir, troque o modelo no seletor.' });
      }
      controller.close();
    },
  });
  return new Response(corpo, { headers: NDJSON });
}

export async function POST(req: Request): Promise<Response> {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return erro({ error: 'Corpo da requisição não é JSON válido.', code: 'bad_request' }, 400);
  }

  const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : '';
  if (!sessionId) return erro({ error: 'Faltou `sessionId` no corpo da requisição.', code: 'bad_request' }, 400);

  const chave = (req.headers.get(OPENROUTER_KEY_HEADER) ?? '').trim();
  const modelo = typeof body.model === 'string' && body.model ? body.model : 'openrouter/auto';
  const replay = body.replay === true;

  if (!body.message && !body.decision) {
    return erro({ error: 'Envie `message` (novo pedido) ou `decision` (resposta ao gate).', code: 'bad_request' }, 400);
  }
  if (!chave && !replay) {
    return erro({ error: 'Cole sua chave do OpenRouter para rodar o agente, ou peça o modo replay.', code: 'missing_key' }, 400);
  }

  const llm: LlmPort | null = chave ? createOpenRouterClient(chave, modelo) : null;

  // --- retomada pós-gate: só `sessionId` + decisão ---------------------------
  if (body.decision) {
    const decisao = body.decision;
    // Reenvio da mesma decisão não executa de novo. A checagem vem ANTES da reconstrução
    // porque é justamente ela que ressuscitaria a pendência já consumida.
    const marcaDecisao = `${sessionId}:${decisao.pendingActionId}`;
    if (decisaoJaAplicada(marcaDecisao)) {
      return stream(async (enviar) => {
        enviar({
          type: 'fatal',
          message: 'Esta decisão já foi aplicada neste turno. Nada foi executado de novo.',
        });
      });
    }
    return stream(async (enviar) => {
      let retomado = replay
        ? await resumeReplayTurn({ sessionId, decision: decisao, onFrame: enviar })
        : await resumeTurn({ sessionId, decision: decisao, model: modelo, llm, onFrame: enviar });

      // O checkpoint vive na memória do processo, e em serverless a decisão quase nunca
      // cai na mesma instância que montou a proposta. No replay o turno é determinístico:
      // reexecuta-se em silêncio (sem emitir frames) só para reconstruir o checkpoint,
      // e então a retomada segue normal. É o que mantém o gate utilizável em produção.
      if (!retomado && replay && body.message) {
        await runReplayTurn({ sessionId, texto: String(body.message) });
        retomado = await resumeReplayTurn({ sessionId, decision: decisao, onFrame: enviar });
      }
      if (retomado) {
        marcarDecisaoAplicada(marcaDecisao);
      } else {
        enviar({ type: 'fatal', message: 'Não encontrei um turno aguardando confirmação nesta sessão. Refaça o pedido e eu monto a proposta de novo.' });
      }
    });
  }

  const texto = String(body.message ?? '');
  return stream(async (enviar) =>
    replay
      ? runReplayTurn({ sessionId, texto, onFrame: enviar })
      : runTurn({ sessionId, texto, model: modelo, llm, onFrame: enviar }),
  );
}
