'use client';

/** AdzChat — conversa, trace por turno e o gate de permissão, na ordem em que acontecem. */
import { useEffect, useRef, useState } from 'react';
import type { PendingAction, PermissionDecision } from '@/harness/types';
import { ConfirmDialog } from './ConfirmDialog';
import { PROMPTS } from './ui-text';
import { TraceView } from './TraceView';
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {turns.length === 0 && (
          <div className="py-6">
            <p className="text-[14px] leading-relaxed text-muted">
              Peça em português. O harness resolve as entidades no supercérebro, monta um plano, lê as fontes por
              tool e só então responde — e para o turno antes de qualquer ação com efeito real.
            </p>
            <p className="mt-5 mb-2 font-mono text-[10px] uppercase tracking-wider text-faint">
              os 4 pedidos de aceite do desafio
            </p>
            <ul className="space-y-1.5">
              {PROMPTS.map((p) => (
                <li key={p.texto}>
                  <button
                    type="button"
                    onClick={() => enviar(p.texto)}
                    disabled={ocupado}
                    className="w-full rounded border border-line bg-surface px-3 py-2.5 text-left hover:border-accent/60 hover:bg-surface-2 disabled:opacity-50"
                  >
                    <span className="block text-[13px] leading-snug text-ink">{p.texto}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-faint">{p.nota}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-6">
          {turns.map((t) => (
            <div key={t.id} className="space-y-2.5">
              <div className="border-l-2 border-accent pl-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-faint">você</p>
                <p className="text-[14px] leading-relaxed text-ink">{t.userText}</p>
              </div>

              <TraceView events={t.events} running={t.running} />

              {t.reply && (
                <div className="pl-0.5">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-faint">AdzChat</p>
                  <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{t.reply}</p>
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
          <p className="mt-4 rounded border border-crit/50 bg-crit/[0.08] px-3 py-2 text-[13px] text-crit">{erro}</p>
        )}

        <div ref={fim} />
      </div>

      <div className="border-t border-line bg-surface px-4 py-3">
        {turns.length > 0 && status === 'idle' && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PROMPTS.map((p) => (
              <button
                key={p.texto}
                type="button"
                onClick={() => enviar(p.texto)}
                title={p.texto}
                className="max-w-[220px] truncate rounded-full border border-line-strong px-2.5 py-1 text-[11px] text-muted hover:border-accent/60 hover:text-ink"
              >
                {p.texto}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                enviar(texto);
              }
            }}
            rows={2}
            disabled={ocupado}
            placeholder={
              status === 'awaiting_confirmation'
                ? 'O turno está parado no gate — decida acima para continuar.'
                : 'Pergunte alguma coisa sobre a conta Housewhey…'
            }
            className="min-h-[52px] flex-1 resize-none rounded border border-line-strong bg-bg px-3 py-2 text-[13px] leading-relaxed text-ink outline-none focus:border-accent disabled:opacity-60 placeholder:text-faint"
          />
          <button
            type="button"
            onClick={() => enviar(texto)}
            disabled={ocupado || !texto.trim()}
            className="rounded border border-accent bg-accent-soft px-3.5 py-2 text-[13px] text-ink hover:bg-accent/25 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-faint"
          >
            {status === 'running' ? 'rodando…' : 'enviar'}
          </button>
        </div>
        <p className="mt-1.5 font-mono text-[10px] text-faint">
          {replay
            ? 'replay determinístico · os 4 pedidos acima têm roteiro gravado'
            : 'enter envia · shift+enter quebra linha'}
        </p>
      </div>
    </div>
  );
}
