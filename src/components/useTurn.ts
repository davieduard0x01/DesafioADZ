'use client';

/**
 * Cliente do turno. Fala com `POST /api/chat` (NDJSON de `StreamFrame`) quando há
 * chave. Sem chave, manda `replay: true` e a mesma rota devolve o roteiro determinístico.
 *
 * Os dois caminhos consomem o MESMO tipo de frame — a UI não sabe qual está ativo,
 * o que é justamente o que permite construir a interface antes do runtime.
 */
import { useCallback, useRef, useState } from 'react';
import {
  OPENROUTER_KEY_HEADER,
  type ChatErrorBody,
  type ChatRequest,
  type PendingAction,
  type PermissionDecision,
  type StageArtifact,
  type StreamFrame,
  type TraceEvent,
} from '@/harness/types';

export interface Turn {
  readonly id: string;
  readonly userText: string;
  readonly events: readonly TraceEvent[];
  readonly reply: string;
  /** `true` enquanto frames ainda estão chegando neste turno. */
  readonly running: boolean;
}

export type Status = 'idle' | 'running' | 'awaiting_confirmation';

function novoId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
}

const ATRASO_PADRAO = 170;
const ATRASO_TOOL = 380;

function atraso(frame: StreamFrame): number {
  if (frame.type !== 'trace') return ATRASO_PADRAO;
  return frame.event.kind === 'tool_call' ? ATRASO_TOOL : ATRASO_PADRAO;
}

export function useTurn(apiKey: string, model: string) {
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [artifacts, setArtifacts] = useState<readonly StageArtifact[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [erro, setErro] = useState<string | null>(null);

  const sessionId = useRef<string>('');
  if (!sessionId.current) sessionId.current = novoId();
  /** Roteiro do turno em replay, guardado para retomar depois da decisão do gate. */
  const cancelado = useRef(false);

  const aplicar = useCallback((frame: StreamFrame) => {
    switch (frame.type) {
      case 'turn_start':
        // o id local do turno é a chave de render e precisa ser único mesmo quando
        // o mesmo roteiro de replay roda duas vezes — por isso não é sobrescrito aqui
        break;
      case 'trace':
        setTurns((atuais) =>
          atuais.map((t, i) =>
            i === atuais.length - 1 ? { ...t, events: [...t.events, frame.event] } : t,
          ),
        );
        // a resposta final também chega pelo trace quando não há token streaming
        if (frame.event.kind === 'assistant_message') {
          const texto = frame.event.text;
          setTurns((atuais) =>
            atuais.map((t, i) => (i === atuais.length - 1 && !t.reply ? { ...t, reply: texto } : t)),
          );
        }
        break;
      case 'artifact': {
        const novo = frame.artifact;
        setArtifacts((atuais) => {
          const i = atuais.findIndex((a) => a.id === novo.id);
          if (i < 0) return [...atuais, novo];
          const copia = [...atuais];
          copia[i] = novo;
          return copia;
        });
        break;
      }
      case 'reply_delta':
        setTurns((atuais) =>
          atuais.map((t, i) => (i === atuais.length - 1 ? { ...t, reply: t.reply + frame.text } : t)),
        );
        break;
      case 'awaiting_confirmation':
        setPending(frame.pendingAction);
        setStatus('awaiting_confirmation');
        break;
      case 'turn_end':
        setPending(frame.state.pendingAction);
        setStatus(frame.halt === 'awaiting_confirmation' ? 'awaiting_confirmation' : 'idle');
        setTurns((atuais) => atuais.map((t, i) => (i === atuais.length - 1 ? { ...t, running: false } : t)));
        break;
      case 'fatal':
        setErro(frame.message);
        setStatus('idle');
        setTurns((atuais) => atuais.map((t, i) => (i === atuais.length - 1 ? { ...t, running: false } : t)));
        break;
    }
  }, []);


  const chamarApi = useCallback(
    async (body: ChatRequest) => {
      const resposta = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { [OPENROUTER_KEY_HEADER]: apiKey } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!resposta.ok || !resposta.body) {
        let mensagem = `A rota /api/chat respondeu ${resposta.status}.`;
        try {
          const corpo = (await resposta.json()) as ChatErrorBody;
          mensagem = corpo.error;
        } catch {
          /* resposta sem corpo JSON — mantém a mensagem genérica */
        }
        setErro(mensagem);
        setStatus('idle');
        setTurns((atuais) => atuais.map((t, i) => (i === atuais.length - 1 ? { ...t, running: false } : t)));
        return;
      }

      const leitor = resposta.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await leitor.read();
        if (done || cancelado.current) break;
        buffer += decoder.decode(value, { stream: true });
        const linhas = buffer.split('\n');
        buffer = linhas.pop() ?? '';
        for (const linha of linhas) {
          if (!linha.trim()) continue;
          try {
            const frame = JSON.parse(linha) as StreamFrame;
            // Sem chave o turno é replay: o servidor entrega tudo de uma vez, então o
            // ritmo de leitura fica por conta do cliente. Com chave, o modelo já pausa sozinho.
            if (!apiKey) await new Promise((r) => setTimeout(r, atraso(frame)));
            aplicar(frame);
          } catch {
            /* linha parcial ou inválida: ignora em vez de derrubar o turno */
          }
        }
      }
    },
    [apiKey, aplicar],
  );

  const enviar = useCallback(
    async (texto: string) => {
      if (!texto.trim() || status !== 'idle') return;
      cancelado.current = false;
      setErro(null);
      setPending(null);
      setStatus('running');
      setTurns((atuais) => [...atuais, { id: novoId(), userText: texto, events: [], reply: '', running: true }]);

      await chamarApi({ sessionId: sessionId.current, message: texto, model, replay: !apiKey });
    },
    [apiKey, chamarApi, model, status],
  );

  const decidir = useCallback(
    async (decisao: PermissionDecision) => {
      if (!pending) return;
      setPending(null);
      setStatus('running');
      setTurns((atuais) => atuais.map((t, i) => (i === atuais.length - 1 ? { ...t, running: true } : t)));

      await chamarApi({ sessionId: sessionId.current, decision: decisao, model, replay: !apiKey });
    },
    [apiKey, chamarApi, model, pending],
  );

  const limpar = useCallback(() => {
    cancelado.current = true;
    sessionId.current = novoId();
    setTurns([]);
    setArtifacts([]);
    setPending(null);
    setErro(null);
    setStatus('idle');
  }, []);

  return { turns, artifacts, pending, status, erro, enviar, decidir, limpar };
}
