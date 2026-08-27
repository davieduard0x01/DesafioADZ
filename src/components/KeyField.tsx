'use client';

/**
 * Chave do OpenRouter + seletor de modelo.
 *
 * Regra de segurança do desafio, implementada aqui:
 *  - a chave vive em `sessionStorage` (morre ao fechar a aba), nunca em localStorage;
 *  - só sai daqui no header `OPENROUTER_KEY_HEADER` da chamada a /api/chat;
 *  - sem chave, a UI declara modo replay de forma permanente, não como notinha.
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import { OPENROUTER_KEY_HEADER } from '@/harness/types';

/**
 * Estado persistido em `sessionStorage`.
 * Usa `useSyncExternalStore` para não divergir entre SSR e hidratação — e cai para
 * um espelho em memória quando o browser bloqueia o storage.
 */
const ouvintes = new Set<() => void>();
const memoria = new Map<string, string>();

function assinar(cb: () => void) {
  ouvintes.add(cb);
  return () => {
    ouvintes.delete(cb);
  };
}

function ler(chave: string): string | null {
  const local = memoria.get(chave);
  if (local !== undefined) return local;
  try {
    return sessionStorage.getItem(chave);
  } catch {
    return null;
  }
}

function escrever(chave: string, valor: string) {
  memoria.set(chave, valor);
  try {
    if (valor) sessionStorage.setItem(chave, valor);
    else sessionStorage.removeItem(chave);
  } catch {
    /* storage bloqueado: segue só em memória, nesta aba */
  }
  ouvintes.forEach((cb) => cb());
}

export function useSessionState(chave: string, inicial: string): [string, (v: string) => void] {
  const valor = useSyncExternalStore(
    assinar,
    () => ler(chave) ?? inicial,
    () => inicial,
  );
  const definir = useCallback((novo: string) => escrever(chave, novo), [chave]);
  return [valor, definir];
}

export const MODELOS = ['anthropic/claude-sonnet-4.5', 'openai/gpt-4.1', 'google/gemini-2.5-pro'] as const;

interface Props {
  readonly apiKey: string;
  readonly onApiKey: (v: string) => void;
  readonly model: string;
  readonly onModel: (v: string) => void;
}

export function KeyField({ apiKey, onApiKey, model, onModel }: Props) {
  const [visivel, setVisivel] = useState(false);
  const outro = !(MODELOS as readonly string[]).includes(model);
  const aoVivo = apiKey.trim().length > 0;

  return (
    <section className="border-b border-line bg-surface">
      <div
        className={`flex items-center gap-2 px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider ${
          aoVivo ? 'bg-accent-soft text-accent' : 'bg-warn/[0.1] text-warn'
        }`}
      >
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${aoVivo ? 'bg-accent' : 'bg-warn'}`} />
        {aoVivo ? (
          <span>modo ao vivo · chamando {model} pelo OpenRouter</span>
        ) : (
          <span>modo replay · roteiro determinístico gravado, sem LLM e sem chave</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <label htmlFor="openrouter-key" className="font-mono text-[11px] text-muted">
          chave OpenRouter
        </label>
        <div className="flex min-w-[220px] flex-1 items-center rounded border border-line-strong bg-bg focus-within:border-accent">
          <input
            id="openrouter-key"
            type={visivel ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => onApiKey(e.target.value)}
            placeholder="sk-or-v1-…  (opcional: sem ela o app roda em replay)"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 font-mono text-[12px] text-ink outline-none placeholder:text-faint"
          />
          <button
            type="button"
            onClick={() => setVisivel((v) => !v)}
            className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-faint hover:text-ink"
          >
            {visivel ? 'ocultar' : 'mostrar'}
          </button>
          {apiKey && (
            <button
              type="button"
              onClick={() => onApiKey('')}
              className="border-l border-line-strong px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-faint hover:text-crit"
            >
              limpar
            </button>
          )}
        </div>

        <label htmlFor="modelo" className="font-mono text-[11px] text-muted">
          modelo
        </label>
        <select
          id="modelo"
          value={outro ? '__outro' : model}
          onChange={(e) => onModel(e.target.value === '__outro' ? '' : e.target.value)}
          className="rounded border border-line-strong bg-bg px-2 py-1.5 font-mono text-[12px] text-ink outline-none focus:border-accent"
        >
          {MODELOS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          <option value="__outro">outro slug…</option>
        </select>
        {outro && (
          <input
            aria-label="Slug do modelo no OpenRouter"
            value={model}
            onChange={(e) => onModel(e.target.value)}
            placeholder="provedor/modelo"
            spellCheck={false}
            className="w-48 rounded border border-line-strong bg-bg px-2 py-1.5 font-mono text-[12px] text-ink outline-none focus:border-accent placeholder:text-faint"
          />
        )}
      </div>

      <p className="px-4 pb-2.5 text-[11px] leading-relaxed text-faint">
        A chave fica apenas nesta aba do navegador (<span className="font-mono">sessionStorage</span>, apagada ao
        fechar) e viaja só no header <span className="font-mono">{OPENROUTER_KEY_HEADER}</span> de cada chamada a{' '}
        <span className="font-mono">/api/chat</span>. Não é lida de variável de ambiente, não é persistida no servidor
        e não aparece em log nem no trace.
      </p>
    </section>
  );
}
