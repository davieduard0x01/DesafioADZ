'use client';

/**
 * Palco — canvas de artefatos (coluna esquerda).
 *
 * Um renderizador por variante de `StageArtifact`. O runtime decide o conteúdo;
 * aqui só se pinta. Nada é inferido: badge, flag de linha e nota de rodapé vêm
 * prontos do harness.
 */
import type {
  AgendaArtifact,
  BadgeTone,
  ColumnFormat,
  CreativeListArtifact,
  CreativeStatus,
  CtaDiffArtifact,
  DiagnosticArtifact,
  MetricsTableArtifact,
  StageArtifact,
} from '@/harness/types';

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * `percentual` é tratado como pontos percentuais (0,41 → "0,41%"), que é como os
 * datasets de CTR do Meta chegam. Ver nota de fronteira no relatório do ui-eng.
 */
function formatar(valor: string | number | null, formato: ColumnFormat): string {
  if (valor === null || valor === '') return '—';
  if (formato === 'texto') return String(valor);
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (Number.isNaN(n)) return String(valor);
  switch (formato) {
    case 'moeda_brl':
      return brl.format(n);
    case 'inteiro':
      return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
    case 'percentual':
      return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    case 'decimal_2':
      return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const TOM: Record<BadgeTone, string> = {
  neutro: 'border-line-strong text-muted',
  ok: 'border-ok/50 text-ok',
  atencao: 'border-warn/50 text-warn',
  critico: 'border-crit/50 text-crit',
};

const STATUS_TOM: Record<CreativeStatus, BadgeTone> = {
  ativo: 'ok',
  pausado: 'critico',
  em_aprovacao: 'atencao',
  proposto: 'neutro',
  reprovado: 'critico',
};

const STATUS_LABEL: Record<CreativeStatus, string> = {
  ativo: 'ativo',
  pausado: 'pausado',
  em_aprovacao: 'em aprovação',
  proposto: 'proposto',
  reprovado: 'reprovado',
};

const KIND_LABEL: Record<StageArtifact['kind'], string> = {
  metrics_table: 'tabela de métricas',
  creative_list: 'criativos',
  agenda: 'pauta',
  cta_diff: 'variações de CTA',
  diagnostic: 'diagnóstico',
};

function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none ${TOM[tone]}`}>{label}</span>
  );
}

/** Pula até o evento de trace que sustenta o artefato. */
function pularPara(id: string) {
  window.dispatchEvent(new CustomEvent<string>('trace-jump', { detail: id }));
}

// ---------------------------------------------------------------------------
// Renderizadores por variante
// ---------------------------------------------------------------------------

function TabelaMetricas({ a }: { a: MetricsTableArtifact }) {
  const marcadas = new Set(a.flaggedRows ?? []);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line-strong">
              {a.columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`whitespace-nowrap px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider ${
                    c.align === 'right' ? 'text-right' : 'text-left'
                  } ${c.highlight ? 'text-ink' : 'text-faint'}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {a.rows.map((linha, i) => (
              <tr
                key={i}
                className={`border-b border-line last:border-0 ${marcadas.has(i) ? 'bg-warn/[0.06]' : ''}`}
              >
                {a.columns.map((c) => (
                  <td
                    key={c.key}
                    className={`whitespace-nowrap px-2.5 py-1.5 ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${
                      c.highlight ? 'text-ink' : 'text-muted'
                    } ${c.format !== 'texto' ? 'font-mono text-[12px]' : ''}`}
                  >
                    {formatar(linha[c.key] ?? null, c.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {a.flaggedRows && a.flaggedRows.length > 0 && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-warn">
          {a.flaggedRows.length} linhas marcadas pela análise
        </p>
      )}
      {a.footnote && (
        <p className="mt-3 border-t border-dashed border-line-strong pt-2 text-[12px] leading-relaxed text-muted">
          <span className="font-mono text-[10px] uppercase tracking-wider text-faint">o que ficou de fora · </span>
          {a.footnote}
        </p>
      )}
    </>
  );
}

function ListaCriativos({ a }: { a: CreativeListArtifact }) {
  return (
    <ul className="space-y-2">
      {a.items.map((c) => (
        <li key={c.id} className="rounded border border-line bg-surface-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-ink">{c.nome}</span>
            <Badge label={STATUS_LABEL[c.status]} tone={STATUS_TOM[c.status]} />
            {c.badges.map((b, i) => (
              <Badge key={i} label={b.label} tone={b.tone} />
            ))}
            <span className="ml-auto font-mono text-[10px] text-faint">{c.campanha}</span>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">{c.copy}</p>
          <p className="mt-1 font-mono text-[11px] text-faint">CTA: {c.cta}</p>
          {c.metricas.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {c.metricas.map((m, i) => (
                <span key={i} className="font-mono text-[11px] text-muted">
                  <span className="text-faint">{m.label} </span>
                  {m.valor}
                </span>
              ))}
            </div>
          )}
          {c.motivo && <p className="mt-2 border-l-2 border-line-strong pl-2 text-[12px] text-muted">{c.motivo}</p>}
        </li>
      ))}
    </ul>
  );
}

function Pauta({ a }: { a: AgendaArtifact }) {
  const PRIO: Record<AgendaArtifact['blocos'][number]['itens'][number]['prioridade'], BadgeTone> = {
    alta: 'critico',
    media: 'atencao',
    baixa: 'neutro',
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line pb-2 font-mono text-[11px] text-muted">
        <span>
          <span className="text-faint">cliente </span>
          {a.cliente}
        </span>
        <span>
          <span className="text-faint">quando </span>
          {dataHora.format(new Date(a.quando))}
        </span>
        <span>
          <span className="text-faint">com </span>
          {a.participantes.join(', ')}
        </span>
      </div>
      <div className="mt-3 space-y-4">
        {a.blocos.map((bloco, i) => (
          <div key={i}>
            <h4 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">{bloco.titulo}</h4>
            <ul className="space-y-1.5">
              {bloco.itens.map((item, j) => (
                <li key={j} className="flex gap-2">
                  <Badge label={item.prioridade} tone={PRIO[item.prioridade]} />
                  <div className="min-w-0">
                    <p className="text-[13px] leading-relaxed text-ink">{item.texto}</p>
                    <p className="font-mono text-[10px] text-faint">
                      {item.origem}
                      {item.responsavel ? ` · ${item.responsavel}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {a.pendencias && a.pendencias.length > 0 && (
          <div className="rounded border border-warn/40 bg-warn/[0.06] p-2.5">
            <h4 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-warn">
              decisões pendentes — travam a conta
            </h4>
            <ul className="space-y-1.5">
              {a.pendencias.map((item, j) => (
                <li key={j}>
                  <p className="text-[13px] leading-relaxed text-ink">{item.texto}</p>
                  <p className="font-mono text-[10px] text-faint">
                    {item.origem}
                    {item.responsavel ? ` · ${item.responsavel}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

function DiffCta({ a }: { a: CtaDiffArtifact }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded border border-line bg-surface-2 p-3">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-faint">no ar hoje</p>
        <p className="text-[13px] leading-relaxed text-muted">{a.copyAtual}</p>
        <p className="mt-3 rounded border border-line-strong bg-surface-3 px-2 py-1 text-center font-mono text-[12px] text-muted line-through decoration-crit/70">
          {a.ctaAtual}
        </p>
        <p className="mt-2 font-mono text-[10px] text-faint">{a.criativoNome}</p>
      </div>
      <div className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-wider text-faint">
          propostas ({a.propostas.length}) — nada vai ao ar sem aprovação
        </p>
        {a.propostas.map((p, i) => (
          <div key={i} className="rounded border border-accent/35 bg-accent-soft/40 p-2.5">
            <p className="text-[13px] font-medium text-ink">{p.texto}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              <span className="font-mono text-[10px] uppercase tracking-wider text-faint">testa · </span>
              {p.hipotese}
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
              <span className="font-mono text-[10px] uppercase tracking-wider text-faint">porque · </span>
              {p.justificativa}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Diagnostico({ a }: { a: DiagnosticArtifact }) {
  const tomConfianca: Record<DiagnosticArtifact['confianca'], BadgeTone> = {
    alta: 'ok',
    media: 'atencao',
    baixa: 'critico',
  };
  return (
    <>
      <p className="font-mono text-[11px] text-faint">{a.pergunta}</p>
      <div className="mt-2 flex items-start gap-2">
        <p className="text-[15px] leading-snug text-ink">{a.veredito}</p>
      </div>
      <div className="mt-1.5">
        <Badge label={`confiança ${a.confianca}`} tone={tomConfianca[a.confianca]} />
      </div>

      <h4 className="mt-4 mb-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">causa-raiz</h4>
      <ul className="space-y-2">
        {a.causaRaiz.map((f, i) => (
          <li key={i} className="border-l-2 border-line-strong pl-2.5">
            <p className="text-[13px] leading-relaxed text-ink">{f.afirmacao}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{f.evidencia}</p>
            <p className="font-mono text-[10px] text-faint">{f.fonte}</p>
          </li>
        ))}
      </ul>

      <h4 className="mt-4 mb-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
        hipóteses testadas e descartadas
      </h4>
      <ul className="space-y-1">
        {a.descartadas.map((d, i) => (
          <li key={i} className="text-[12px] leading-relaxed text-muted">
            <span className="text-ink line-through decoration-line-strong">{d.hipotese}</span> — {d.porque}
          </li>
        ))}
      </ul>

      <h4 className="mt-4 mb-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">próximos passos</h4>
      <ul className="space-y-1.5">
        {a.proximosPassos.map((p, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink">{p.acao}</span>
            {p.dono && <span className="font-mono text-[10px] text-faint">{p.dono}</span>}
            {p.exigeConfirmacao && <Badge label="exige confirmação" tone="atencao" />}
          </li>
        ))}
      </ul>
    </>
  );
}

function Corpo({ a }: { a: StageArtifact }) {
  switch (a.kind) {
    case 'metrics_table':
      return <TabelaMetricas a={a} />;
    case 'creative_list':
      return <ListaCriativos a={a} />;
    case 'agenda':
      return <Pauta a={a} />;
    case 'cta_diff':
      return <DiffCta a={a} />;
    case 'diagnostic':
      return <Diagnostico a={a} />;
  }
}

function Cartao({ a }: { a: StageArtifact }) {
  return (
    <article className="rounded-md border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
        <h3 className="text-[14px] font-medium text-ink">{a.title}</h3>
        <span className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[10px] text-faint">
          {KIND_LABEL[a.kind]}
        </span>
        <span className="ml-auto font-mono text-[10px] text-faint">{dataHora.format(new Date(a.createdAt))}</span>
      </header>
      <div className="px-4 py-3">
        <Corpo a={a} />
        {a.evidence && a.evidence.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-faint">evidência</span>
            {a.evidence.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => pularPara(id)}
                title="Mostrar este evento no trace"
                className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[10px] text-muted hover:border-accent hover:text-accent"
              >
                {id}
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------

export function Stage({ artifacts }: { artifacts: readonly StageArtifact[] }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline gap-2 border-b border-line px-5 py-3">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">Palco</h2>
        <p className="text-[12px] text-faint">o que o agente produziu neste turno</p>
        {artifacts.length > 0 && (
          <span className="ml-auto font-mono text-[11px] text-faint">
            {artifacts.length} artefato{artifacts.length > 1 ? 's' : ''}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {artifacts.length === 0 ? (
          <div className="mx-auto max-w-md py-16">
            <p className="text-[15px] leading-relaxed text-muted">
              O Palco recebe o resultado estruturado do turno: tabela de métricas, lista de criativos, pauta de
              reunião, variações de CTA e diagnóstico.
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-faint">
              O chat à direita explica; aqui fica o que dá para levar para a reunião. Cada artefato aponta para os
              eventos do trace que o sustentam — clicar na evidência pula até a linha correspondente.
            </p>
            <p className="mt-6 font-mono text-[11px] text-faint">
              escolha um dos 4 pedidos sugeridos no chat para começar
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {artifacts.map((a) => (
              <Cartao key={a.id} a={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
