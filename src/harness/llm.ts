/**
 * Cliente OpenRouter — `fetch` nativo, sem SDK.
 *
 * SEGURANÇA (regra do desafio): a chave chega no header da requisição do cliente
 * (`OPENROUTER_KEY_HEADER`), vive só na memória desta requisição, NUNCA é lida de
 * variável de ambiente, NUNCA é persistida, NUNCA entra em log, em trace ou em
 * mensagem de erro. Por isso a chave não é campo de nenhum objeto que o runtime
 * serialize: ela fica capturada no closure do cliente.
 */
import type { Json, ToolDef } from './types';

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  readonly role: LlmRole;
  readonly content: string;
  /** Só em `role: 'tool'` — id da chamada respondida. */
  readonly toolCallId?: string;
  /** Só em `role: 'assistant'` — chamadas que o modelo pediu neste turno. */
  readonly toolCalls?: readonly LlmToolCall[];
}

export interface LlmToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Json;
}

export interface LlmReply {
  readonly text: string;
  readonly toolCalls: readonly LlmToolCall[];
}

export interface LlmRequest {
  readonly messages: readonly LlmMessage[];
  /** Tools oferecidas ao modelo neste passo — já filtradas pela allowlist do nó. */
  readonly tools?: readonly ToolDef[];
  readonly temperature?: number;
  /** Pede resposta em JSON puro (usado por interpret/reason). */
  readonly json?: boolean;
}

export interface LlmPort {
  complete(req: LlmRequest): Promise<LlmReply>;
}

/** Falha do provedor já traduzida para PT-BR. Nunca carrega a chave. */
export class LlmError extends Error {
  readonly code: 'invalid_key' | 'sem_tool_calling' | 'upstream' | 'timeout' | 'resposta_invalida';
  constructor(code: LlmError['code'], message: string) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
  }
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 60_000;

type OpenAiToolCall = { id?: string; function?: { name?: string; arguments?: string } };
type OpenAiChoice = { message?: { content?: string | null; tool_calls?: OpenAiToolCall[] } };
type OpenAiResponse = { choices?: OpenAiChoice[]; error?: { message?: string; code?: string | number } };

export function createOpenRouterClient(apiKey: string, model: string): LlmPort {
  return {
    async complete(req) {
      const body = {
        model,
        temperature: req.temperature ?? 0.2,
        messages: req.messages.map(toOpenAiMessage),
        ...(req.tools?.length ? { tools: req.tools.map(toOpenAiTool), tool_choice: 'auto' } : {}),
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let resposta: Response;
      try {
        resposta = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            // A chave aparece exatamente aqui e em lugar nenhum mais.
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            'x-title': 'AdzHub Harness',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof Error && e.name === 'AbortError') {
          throw new LlmError('timeout', 'O modelo não respondeu em 60s. Tente de novo ou escolha um modelo mais rápido.');
        }
        throw new LlmError('upstream', 'Não consegui falar com o OpenRouter. Verifique a conexão e tente de novo.');
      }
      clearTimeout(timer);

      if (!resposta.ok) {
        // Texto do provedor NÃO é ecoado: pode conter o header enviado.
        if (resposta.status === 401 || resposta.status === 403) {
          throw new LlmError('invalid_key', 'A chave do OpenRouter foi recusada (401/403). Confira a chave colada no campo do topo.');
        }
        if (resposta.status === 404) {
          throw new LlmError('upstream', `O modelo "${model}" não foi encontrado no OpenRouter. Escolha outro no seletor.`);
        }
        if (resposta.status === 400 && req.tools?.length) {
          throw new LlmError('sem_tool_calling', `O modelo "${model}" recusou a chamada com tools. Escolha um modelo com suporte a tool-calling.`);
        }
        throw new LlmError('upstream', `O OpenRouter respondeu ${resposta.status}. Tente de novo em instantes.`);
      }

      const dado = (await resposta.json()) as OpenAiResponse;
      if (dado.error) throw new LlmError('upstream', `O provedor recusou a requisição (${dado.error.code ?? 'erro'}).`);
      const escolha = dado.choices?.[0]?.message;
      if (!escolha) throw new LlmError('resposta_invalida', 'O modelo devolveu uma resposta vazia.');

      const toolCalls: LlmToolCall[] = (escolha.tool_calls ?? []).map((c, i) => ({
        id: c.id ?? `call-${i}`,
        name: c.function?.name ?? '',
        args: parseArgs(c.function?.arguments),
      }));
      return { text: escolha.content ?? '', toolCalls };
    },
  };
}

function parseArgs(bruto: string | undefined): Json {
  if (!bruto) return {};
  try {
    return JSON.parse(bruto) as Json;
  } catch {
    return {};
  }
}

function toOpenAiMessage(m: LlmMessage): Json {
  if (m.role === 'tool') {
    return { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? '' };
  }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function toOpenAiTool(def: ToolDef): Json {
  return {
    type: 'function',
    function: { name: def.name, description: def.description, parameters: def.parameters },
  };
}

/** Extrai o primeiro objeto JSON de uma resposta que veio com cercas ou preâmbulo. */
export function extractJson(texto: string): Record<string, Json> | null {
  const limpo = texto.replace(/```json/gi, '```').trim();
  const cercado = limpo.includes('```') ? limpo.split('```')[1] ?? limpo : limpo;
  const inicio = cercado.indexOf('{');
  const fim = cercado.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) return null;
  try {
    return JSON.parse(cercado.slice(inicio, fim + 1)) as Record<string, Json>;
  } catch {
    return null;
  }
}
