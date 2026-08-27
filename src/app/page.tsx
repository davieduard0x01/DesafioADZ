'use client';

import { Chat, ChatHeader } from '@/components/Chat';
import { KeyField, MODELOS, useSessionState } from '@/components/KeyField';
import { Stage } from '@/components/Stage';
import { useTurn } from '@/components/useTurn';

/**
 * Legenda do fluxo — camada CONCEITUAL, tal como o blueprint da AdzHub desenhou.
 * A camada de EXECUÇÃO (quais nós do grafo rodaram, com passos usados e edge de
 * saída) vive nos chips do TraceView, dentro do chat. As duas coexistem de propósito.
 */
const FLUXO = [
  { label: 'Pedido do usuário', forte: false },
  { label: 'Raciocínio', forte: false },
  { label: 'Tool · ler dados', forte: false },
  { label: 'Raciocínio', forte: false },
  { label: 'Tool · agir', forte: false },
  { label: 'Resposta', forte: true },
] as const;

function LegendaFluxo() {
  return (
    <footer className="border-t border-line bg-bg px-5 py-3.5">
      <ul className="flex flex-wrap items-center justify-center gap-2">
        {FLUXO.map((p, i) => (
          <li
            key={i}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              p.forte ? 'border-accent bg-accent text-white' : 'border-accent-line bg-surface text-accent-ink'
            }`}
          >
            <svg aria-hidden viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="6" cy="6" r="4.6" />
              <path d="m4.2 6.1 1.3 1.3 2.4-2.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {p.label}
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-center text-[12px] leading-relaxed text-faint">
        intent → raciocínio → tool → observação → ação → resposta. O palco reflete o que o harness executou.
      </p>
    </footer>
  );
}

export default function Home() {
  const [apiKey, setApiKey] = useSessionState('adz.openrouter_key', '');
  const [model, setModel] = useSessionState('adz.model', MODELOS[0]);
  const { turns, artifacts, pending, status, erro, enviar, decidir, limpar } = useTurn(apiKey, model);

  return (
    <div className="flex min-h-dvh flex-col bg-bg lg:h-dvh lg:overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-surface px-5 py-2.5">
        <p className="text-[12px] text-muted">
          harness agêntico para gestores de marketing — grafo de estados, ReAct dentro dos nós, permissões deny-first
        </p>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-faint">
          <span>dados fictícios · conta Housewhey</span>
          {turns.length > 0 && (
            <button type="button" onClick={limpar} className="underline-offset-2 hover:text-ink hover:underline">
              limpar sessão
            </button>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col-reverse lg:flex-row">
        <section className="min-h-[55vh] border-t border-line lg:min-h-0 lg:w-[58%] lg:border-t-0 lg:border-r">
          <Stage artifacts={artifacts} />
        </section>

        <aside className="flex min-h-0 flex-col bg-surface lg:w-[42%]">
          <ChatHeader />
          <KeyField apiKey={apiKey} onApiKey={setApiKey} model={model} onModel={setModel} />
          <Chat
            turns={turns}
            pending={pending}
            status={status}
            erro={erro}
            replay={!apiKey}
            onEnviar={enviar}
            onDecidir={decidir}
          />
        </aside>
      </main>

      <LegendaFluxo />
    </div>
  );
}
