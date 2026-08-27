'use client';

/**
 * Gate de permissão — o turno está PARADO aqui esperando o humano.
 *
 * A interface não pode contradizer o paper: se confirmar for o caminho de menor
 * resistência visual, o gate vira teatro. Por isso:
 *  - o botão neutro é o de NEGAR — negar é caminho normal do grafo;
 *  - o foco inicial vai para o PAINEL, nunca para um botão: com foco num botão,
 *    uma barra de espaço para rolar a leitura já dispararia a decisão;
 *  - confirmar só habilita depois que o gestor marca que leu o efeito;
 *  - ação irreversível ganha aviso próprio, não a mesma moldura de uma reversível.
 */
import { useEffect, useRef, useState } from 'react';
import type { PendingAction, PermissionDecision } from '@/harness/types';

interface Props {
  readonly acao: PendingAction;
  readonly onDecidir: (d: PermissionDecision) => void;
}

export function ConfirmDialog({ acao, onDecidir }: Props) {
  const painel = useRef<HTMLElement>(null);
  useEffect(() => painel.current?.focus(), []);
  const [leu, setLeu] = useState(false);
  const [comentario, setComentario] = useState('');
  const { preview } = acao;

  const decidir = (decision: PermissionDecision['decision']) =>
    onDecidir({ pendingActionId: acao.id, decision, ...(comentario.trim() ? { comment: comentario.trim() } : {}) });

  return (
    <section
      ref={painel}
      tabIndex={-1}
      role="alertdialog"
      aria-labelledby="gate-titulo"
      className="overflow-hidden rounded-xl border border-warn-line bg-warn-soft"
    >
      <header className="flex items-center gap-2 border-b border-warn-line px-4 py-2">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warn" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-warn">
          turno interrompido · aguardando sua decisão
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted">{acao.tool}</span>
      </header>

      <div className="px-4 py-3">
        <h3 id="gate-titulo" className="text-[15px] font-semibold text-ink">
          {preview.titulo}
        </h3>

        <ul className="mt-3 space-y-1.5">
          {preview.itens.map((item, i) => (
            <li key={i} className="border-l-2 border-warn-line pl-2.5">
              <p className="text-[13px] leading-snug text-ink">{item.label}</p>
              {item.detalhe && <p className="font-mono text-[11px] text-muted">{item.detalhe}</p>}
            </li>
          ))}
        </ul>

        <dl className="mt-3 space-y-1.5 text-[12px] leading-relaxed">
          <div>
            <dt className="inline text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">o que acontece · </dt>
            <dd className="inline text-muted">{preview.impacto}</dd>
          </div>
          <div>
            <dt className="inline text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">se você negar · </dt>
            <dd className="inline text-muted">{preview.seNegada}</dd>
          </div>
          {preview.reversivel ? (
            <div>
              <dt className="inline text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">reversível · </dt>
              <dd className="inline text-muted">{preview.comoDesfazer ?? 'sim'}</dd>
            </div>
          ) : (
            <div className="rounded-[10px] border border-crit-line bg-crit-soft px-2.5 py-1.5">
              <dt className="inline text-[10px] font-semibold uppercase tracking-[0.12em] text-crit">irreversível · </dt>
              <dd className="inline text-ink">Não há como desfazer depois de confirmado.</dd>
            </div>
          )}
        </dl>

        <details className="mt-3">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.12em] text-faint hover:text-ink">
            argumentos exatos que serão executados
          </summary>
          <pre className="mt-1.5 overflow-x-auto rounded-md border border-line bg-surface p-2 font-mono text-[11px] leading-relaxed text-muted">
            {JSON.stringify(acao.args, null, 2)}
          </pre>
        </details>

        <input
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          placeholder="Justificativa (opcional) — entra no contexto da resposta"
          className="mt-3 w-full rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent placeholder:text-faint"
        />

        <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-[12px] font-medium text-ink">
          <input
            type="checkbox"
            checked={leu}
            onChange={(e) => setLeu(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-warn)]"
          />
          Li o que vai acontecer e assumo esta ação.
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => decidir('negar')}
            className="rounded-lg border border-line-strong bg-surface px-3.5 py-1.5 text-[13px] font-medium text-ink hover:border-muted"
          >
            Negar e seguir sem a ação
          </button>
          <button
            type="button"
            disabled={!leu}
            onClick={() => decidir('aprovar')}
            className="rounded-lg border border-warn-line bg-surface px-3.5 py-1.5 text-[13px] font-medium text-warn enabled:hover:bg-warn-soft disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-3 disabled:text-faint"
          >
            Confirmar {preview.titulo.toLowerCase()}
          </button>
          {!leu && <span className="text-[11px] text-muted">marque a caixa para liberar a confirmação</span>}
        </div>
      </div>
    </section>
  );
}
