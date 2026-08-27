'use client';

/**
 * AdzChat — conversa, trace por turno e o gate de permissão, na ordem em que acontecem.
 *
 * Linguagem visual do blueprint da AdzHub: cabeçalho com avatar índigo, bolha do
 * gestor alinhada à direita em índigo sólido, linhas de trace com ícone circular
 * e campo de entrada arredondado com botão circular laranja.
 */
import { useEffect, useRef, useState } from 'react';
import type { PendingAction, PermissionDecision } from '@/harness/types';
import { ConfirmDialog } from './ConfirmDialog';
import { PROMPTS } from './ui-text';
import { IconeResposta, TraceView } from './TraceView';
import type { Status, Turn } from './useTurn';

interface Props {
  readonly turns: readonly Turn[];
  readonly pending: PendingAction | null;
  readonly status: Status;
  readonly erro: string | null;
  readonly replay: boolean;
  readonly onEnviar: (texto: string) => void;
  readonly onDecidir: (d: PermissionDecision) => void;
}

/** Cabeçalho do chat: círculo índigo com "A", nome e subtítulo — como no blueprint. */
export function ChatHeader() {
  return (
    <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
      <span
        aria-hidden
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-semibold text-white"
      >
        A
      </span>
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold leading-tight tracking-tight text-ink">AdzChat</h1>
        <p className="text-[11px] leading-tight text-faint">harness · loop de tools</p>
      </div>
    </div>
  );
}

function Enviar({ onClick, disabled, rodando }: { onClick: () => void; disabled: boolean; rodando: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={rodando ? 'Rodando…' : 'Enviar pedido'}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-send text-white transition-colors hover:bg-send-hover disabled:cursor-not-allowed disabled:bg-line-strong"
    >
      {rodando ? (
        <span aria-hidden className="block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      ) : (
        <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M8 13V3.5M8 3.5 4 7.5M8 3.5l4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

export function Chat({ turns, pending, status, erro, replay, onEnviar, onDecidir }: Props) {
  const [texto, setTexto] = useState('');
  const fim = useRef<HTMLDivElement>(null);
  const ocupado = status !== 'idle';

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, status, pending]);

  const enviar = (t: string) => {
    if (!t.trim() || ocupado) return;
    onEnviar(t.trim());
    setTexto('');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {turns.length === 0 && (
          <div className="py-2">
            <p className="text-[14px] leading-relaxed text-muted">
              Peça em português. O harness resolve as entidades no supercérebro, monta um plano, lê as fontes por
              tool e só então responde — e para o turno antes de qualquer ação com efeito real.
            </p>
            <p className="mt-6 mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
              os 4 pedidos de aceite do desafio
            </p>
            <ul className="space-y-2">
              {PROMPTS.map((p) => (
                <li key={p.texto}>
                  <button
                    type="button"
                    onClick={() => enviar(p.texto)}
                    disabled={ocupado}
                    className="w-full rounded-[10px] border border-line bg-surface px-3.5 py-3 text-left transition-colors hover:border-accent-line hover:bg-accent-soft disabled:opacity-50"
                  >
                    <span className="block text-[13px] font-medium leading-snug text-ink">{p.texto}</span>
                    <span className="mt-1 block text-[11px] text-faint">{p.nota}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-6">
          {turns.map((t) => (
            <div key={t.id} className="space-y-3">
              <div className="flex justify-end">
                <p className="max-w-[85%] rounded-[16px] bg-accent px-4 py-2.5 text-[13px] leading-relaxed text-white">
                  {t.userText}
                </p>
              </div>

              <TraceView events={t.events} running={t.running} />

              {t.reply && (
                <div className="flex gap-2.5">
                  <IconeResposta />
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{t.reply}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        {pending && (
          <div className="mt-4">
            <ConfirmDialog key={pending.id} acao={pending} onDecidir={onDecidir} />
          </div>
        )}

        {erro && (
          <p className="mt-4 rounded-[10px] border border-crit-line bg-crit-soft px-3 py-2 text-[13px] text-crit">
            {erro}
          </p>
        )}

        <div ref={fim} />
      </div>

      <div className="border-t border-line bg-surface px-5 py-3">
        {turns.length > 0 && status === 'idle' && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PROMPTS.map((p) => (
              <button
                key={p.texto}
                type="button"
                onClick={() => enviar(p.texto)}
                title={p.texto}
                className="max-w-[220px] truncate rounded-full border border-line px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-accent-line hover:bg-accent-soft hover:text-accent-ink"
              >
                {p.texto}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-[16px] border border-line-strong bg-surface px-2 py-1.5 focus-within:border-accent">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                enviar(texto);
              }
            }}
            rows={1}
            disabled={ocupado}
            aria-label="Pedido para o AdzChat"
            placeholder={
              status === 'awaiting_confirmation'
                ? 'O turno está parado no gate — decida acima para continuar.'
                : 'Peça uma tarefa…'
            }
            className="min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-[13px] leading-relaxed text-ink outline-none disabled:opacity-60 placeholder:text-faint"
          />
          <Enviar onClick={() => enviar(texto)} disabled={ocupado || !texto.trim()} rodando={status === 'running'} />
        </div>
        <p className="mt-2 text-[11px] text-faint">
          {replay
            ? 'Modo replay: os 4 pedidos acima têm roteiro determinístico gravado.'
            : 'Enter envia · Shift+Enter quebra linha'}
        </p>
      </div>
    </div>
  );
}
