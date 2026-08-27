'use client';

/**
 * Timeline de execução de um turno.
 *
 * Lê a legenda do desafio literalmente:
 *   pedido do usuário → raciocínio → tool (ler dados) → observação → ação → resposta
 *
 * Regras visuais que carregam a tese:
 *  - cada nó do grafo é um chip nomeado, na ordem executada, com duração e edge de saída;
 *  - o loop ReAct aparece como iteração numerada DENTRO do nó, nunca como lista plana;
 *  - tool de leitura e tool de ação são distinguíveis à primeira vista;
 *  - colapsado por padrão: uma linha por nó. O gestor não lê 24 eventos toda vez.
 */
import { useEffect, useMemo, useState } from 'react';
import type { EdgeName, NodeName, ToolLayer, TraceEvent } from '@/harness/types';
import { NODE_DESC } from './replay';

// ---------------------------------------------------------------------------

export function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1).replace('.', ',')}s`;
}

const CAMADA_LABEL: Record<ToolLayer, string> = {
  supercerebro: 'supercérebro',
  app: 'app',
  api: 'API',
};

type ComStep = Extract<TraceEvent, { step: number }>;
const temStep = (e: TraceEvent): e is ComStep => 'step' in e;

interface Grupo {
  readonly node: NodeName;
  readonly maxSteps: number;
  readonly viaEdgeIn: EdgeName | null;
  viaEdgeOut: EdgeName | null;
  duracao: number | null;
  passosUsados: number | null;
  readonly filhos: TraceEvent[];
  readonly ancora: string;
}

/** Agrupa a lista plana de eventos por nó do grafo. Eventos soltos viram grupo próprio. */
function agrupar(events: readonly TraceEvent[]): (Grupo | { readonly solto: TraceEvent })[] {
  const saida: (Grupo | { readonly solto: TraceEvent })[] = [];
  let atual: Grupo | null = null;

  for (const e of events) {
    if (e.kind === 'node_enter') {
      atual = {
        node: e.node,
        maxSteps: e.budget.maxSteps,
        viaEdgeIn: e.viaEdge,
        viaEdgeOut: null,
        duracao: null,
        passosUsados: null,
        filhos: [],
        ancora: e.id,
      };
      saida.push(atual);
      continue;
    }
    if (e.kind === 'node_exit') {
      if (atual && atual.node === e.node) {
        atual.viaEdgeOut = e.viaEdge;
        atual.duracao = e.durationMs;
        atual.passosUsados = e.stepsUsed;
        atual = null;
      } else {
        saida.push({ solto: e });
      }
      continue;
    }
    if (atual) atual.filhos.push(e);
    else saida.push({ solto: e });
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

function ChipNo({ node, ativo }: { node: NodeName; ativo: boolean }) {
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] leading-none ${
        ativo ? 'border-accent bg-accent-soft text-ink' : 'border-line-strong bg-surface-3 text-muted'
      }`}
    >
      {node}
    </span>
  );
}

function Edge({ nome }: { nome: EdgeName | null }) {
  if (!nome) return null;
  return <span className="font-mono text-[11px] text-faint">→ {nome}</span>;
}

function ToolCall({ e }: { e: Extract<TraceEvent, { kind: 'tool_call' }> }) {
  const [aberto, setAberto] = useState(false);
  const acao = e.effect === 'write';
  return (
    <div
      id={`trace-${e.id}`}
      className={`rounded border ${acao ? 'border-warn/45 bg-warn/[0.07]' : 'border-line bg-surface-2'}`}
    >
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/[0.02]"
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-[1px] ${acao ? 'bg-warn' : 'border border-muted'}`}
        />
        <span className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${acao ? 'text-warn' : 'text-faint'}`}>
          {acao ? 'ação' : 'ler'}
        </span>
        <span className="font-mono text-[12px] text-ink">{e.tool}</span>
        <span className="shrink-0 rounded bg-surface-3 px-1 font-mono text-[10px] text-muted">{CAMADA_LABEL[e.layer]}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
          {e.ok ? e.resultSummary : (e.error?.message ?? 'falhou')}
        </span>
        <span className={`shrink-0 font-mono text-[10px] ${e.ok ? 'text-faint' : 'text-crit'}`}>
          {e.ok ? fmtMs(e.durationMs) : e.error?.code}
        </span>
      </button>
      {aberto && (
        <div className="border-t border-line px-2.5 py-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-faint">argumentos</div>
          <pre className="overflow-x-auto rounded bg-bg p-2 font-mono text-[11px] leading-relaxed text-muted">
            {JSON.stringify(e.args, null, 2)}
          </pre>
          <div className="mt-2 mb-1 font-mono text-[10px] uppercase tracking-wider text-faint">retorno</div>
          <p className={`text-[12px] leading-relaxed ${e.ok ? 'text-ink' : 'text-crit'}`}>
            {e.ok ? e.resultSummary : `${e.error?.message} (${e.error?.retryable ? 'elegível a retry' : 'não retryable'})`}
          </p>
        </div>
      )}
    </div>
  );
}

function Filho({ e }: { e: TraceEvent }) {
  switch (e.kind) {
    case 'thought':
      return (
        <div id={`trace-${e.id}`} className="flex gap-2 px-0.5">
          <span className="shrink-0 pt-0.5 font-mono text-[10px] uppercase tracking-wider text-faint">pensa</span>
          <p className="text-[12px] leading-relaxed text-muted">{e.text}</p>
        </div>
      );
    case 'tool_call':
      return <ToolCall e={e} />;
    case 'observation':
      return (
        <div id={`trace-${e.id}`} className="border-l-2 border-line-strong pl-2.5">
          <p className="text-[12px] leading-relaxed text-ink">{e.text}</p>
          <p className="mt-0.5 font-mono text-[10px] text-faint">observação · {e.source}</p>
        </div>
      );
    case 'compaction':
      return (
        <div id={`trace-${e.id}`} className="rounded border border-dashed border-line-strong px-2.5 py-1.5">
          <p className="font-mono text-[11px] text-muted">
            compactação · {e.tokensBefore.toLocaleString('pt-BR')} → {e.tokensAfter.toLocaleString('pt-BR')} tokens ·{' '}
            {e.collapsedObservationIds.length} observações
          </p>
          <p className="mt-0.5 text-[12px] text-faint">{e.summary}</p>
        </div>
      );
    case 'error':
      return (
        <div id={`trace-${e.id}`} className="rounded border border-crit/40 bg-crit/[0.07] px-2.5 py-1.5">
          <p className="font-mono text-[11px] text-crit">
            erro · {e.error.code} · tentativa {e.attempt} · {e.willRetry ? 'vai tentar de novo' : 'degrada'}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">{e.error.message}</p>
        </div>
      );
    case 'permission_request':
      return (
        <div id={`trace-${e.id}`} className="rounded border border-warn/50 bg-warn/[0.08] px-2.5 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-warn">gate · turno interrompido</p>
          <p className="mt-1 text-[12px] text-ink">{e.pendingAction.preview.titulo}</p>
          <p className="mt-0.5 font-mono text-[11px] text-muted">
            {e.pendingAction.tool} · aguardando decisão humana
          </p>
        </div>
      );
    case 'action_executed':
      return (
        <div id={`trace-${e.id}`} className="rounded border border-warn/50 bg-warn/[0.08] px-2.5 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-warn">ação executada · {e.tool}</p>
          <p className="mt-1 text-[12px] text-ink">{e.resultSummary}</p>
          <pre className="mt-1 overflow-x-auto font-mono text-[11px] text-faint">{JSON.stringify(e.args)}</pre>
        </div>
      );
    case 'assistant_message':
      return (
        <div id={`trace-${e.id}`} className="flex gap-2 px-0.5">
          <span className="shrink-0 pt-0.5 font-mono text-[10px] uppercase tracking-wider text-faint">resposta</span>
          <p className="text-[12px] leading-relaxed text-muted">
            {e.text}
            {e.artifactIds.length > 0 && (
              <span className="ml-1 font-mono text-[11px] text-faint">
                · {e.artifactIds.length} artefato{e.artifactIds.length > 1 ? 's' : ''} no Palco
              </span>
            )}
          </p>
        </div>
      );
    case 'user_message':
      return (
        <div id={`trace-${e.id}`} className="flex gap-2 px-0.5">
          <span className="shrink-0 pt-0.5 font-mono text-[10px] uppercase tracking-wider text-faint">pedido</span>
          <p className="text-[12px] leading-relaxed text-muted">{e.text}</p>
        </div>
      );
    case 'permission_decision':
      return (
        <div
          id={`trace-${e.id}`}
          className={`rounded border px-2.5 py-1.5 ${
            e.decision === 'aprovar' ? 'border-ok/45 bg-ok/[0.07]' : 'border-line-strong bg-surface-2'
          }`}
        >
          <p className={`font-mono text-[11px] ${e.decision === 'aprovar' ? 'text-ok' : 'text-muted'}`}>
            humano {e.decision === 'aprovar' ? 'aprovou' : 'negou'} a ação · gate
          </p>
          {e.comment && <p className="mt-0.5 text-[12px] text-muted">{e.comment}</p>}
        </div>
      );
    default:
      return null;
  }
}

/** Os filhos de um nó, quebrados em iterações do loop ReAct. */
function Iteracoes({ grupo }: { grupo: Grupo }) {
  const passos = new Map<number, TraceEvent[]>();
  const soltos: TraceEvent[] = [];
  for (const f of grupo.filhos) {
    if (temStep(f)) {
      const lista = passos.get(f.step) ?? [];
      lista.push(f);
      passos.set(f.step, lista);
    } else {
      soltos.push(f);
    }
  }
  const loop = grupo.node === 'fetch' || grupo.node === 'reason';

  return (
    <div className="space-y-2">
      {[...passos.entries()].map(([step, lista]) => (
        <div key={step} className="relative pl-4">
          <span aria-hidden className="absolute left-1 top-1 bottom-1 w-px bg-line-strong" />
          <span className="absolute left-0 top-1 rounded-full bg-surface px-0 font-mono text-[10px] text-faint">
            <span className="block h-1.5 w-1.5 translate-x-[3px] rounded-full bg-line-strong" />
          </span>
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-faint">
            {loop ? 'iteração ReAct' : 'passo'} {step}/{grupo.maxSteps}
          </p>
          <div className="space-y-1.5">
            {lista.map((f) => (
              <Filho key={f.id} e={f} />
            ))}
          </div>
        </div>
      ))}
      {soltos.map((f) => (
        <Filho key={f.id} e={f} />
      ))}
    </div>
  );
}

function resumo(grupo: Grupo): string {
  const tools = grupo.filhos.filter((f) => f.kind === 'tool_call').length;
  const obs = grupo.filhos.filter((f) => f.kind === 'observation').length;
  const partes: string[] = [];
  if (tools) partes.push(`${tools} tool${tools > 1 ? 's' : ''}`);
  if (obs) partes.push(`${obs} obs`);
  if (grupo.passosUsados !== null) partes.push(`${grupo.passosUsados}/${grupo.maxSteps} passos`);
  if (!partes.length) partes.push(NODE_DESC[grupo.node]);
  return partes.join(' · ');
}

// ---------------------------------------------------------------------------

export function TraceView({ events, running }: { events: readonly TraceEvent[]; running: boolean }) {
  const [tudo, setTudo] = useState(false);
  const [abertos, setAbertos] = useState<readonly number[]>([]);
  const grupos = useMemo(() => agrupar(events), [events]);

  // um artefato do Palco pode pedir para pular até a evidência que o sustenta
  useEffect(() => {
    const aoPular = (ev: Event) => {
      const id = (ev as CustomEvent<string>).detail;
      setTudo(true);
      requestAnimationFrame(() => {
        const alvo = document.getElementById(`trace-${id}`);
        if (!alvo) return;
        alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
        alvo.classList.add('trace-flash');
        setTimeout(() => alvo.classList.remove('trace-flash'), 1500);
      });
    };
    window.addEventListener('trace-jump', aoPular);
    return () => window.removeEventListener('trace-jump', aoPular);
  }, []);

  if (!events.length) return null;

  const totalTools = events.filter((e) => e.kind === 'tool_call').length;
  const totalNos = grupos.filter((g) => !('solto' in g)).length;

  return (
    <section className="rounded-md border border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted">execução</h3>
        <span className="font-mono text-[11px] text-faint">
          {totalNos} nós · {totalTools} tools · {events.length} eventos
        </span>
        {running && <span className="font-mono text-[11px] text-accent">em curso…</span>}
        <button
          type="button"
          onClick={() => {
            setTudo((v) => !v);
            setAbertos([]);
          }}
          className="ml-auto rounded border border-line-strong px-2 py-0.5 font-mono text-[11px] text-muted hover:border-muted hover:text-ink"
        >
          {tudo ? 'colapsar' : 'expandir tudo'}
        </button>
      </header>

      <ol className="divide-y divide-line">
        {grupos.map((g, i) => {
          if ('solto' in g) {
            return (
              <li key={g.solto.id} className="px-3 py-2">
                <Filho e={g.solto} />
              </li>
            );
          }
          const ultimo = i === grupos.length - 1;
          const aberto = tudo || abertos.includes(i) || (running && ultimo);
          return (
            <li key={g.ancora} id={`trace-${g.ancora}`}>
              <button
                type="button"
                onClick={() => setAbertos((a) => (a.includes(i) ? a.filter((x) => x !== i) : [...a, i]))}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.02]"
              >
                <ChipNo node={g.node} ativo={running && ultimo} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">{resumo(g)}</span>
                <Edge nome={g.viaEdgeOut} />
                <span className="shrink-0 font-mono text-[11px] text-faint">
                  {g.duracao !== null ? fmtMs(g.duracao) : '…'}
                </span>
              </button>
              {aberto && g.filhos.length > 0 && (
                <div className="border-t border-line/70 bg-surface-2/40 px-3 py-2.5">
                  <p className="mb-2 text-[11px] text-faint">{NODE_DESC[g.node]}</p>
                  <Iteracoes grupo={g} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
