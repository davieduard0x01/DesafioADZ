'use client';

import { Chat } from '@/components/Chat';
import { KeyField, MODELOS, useSessionState } from '@/components/KeyField';
import { Stage } from '@/components/Stage';
import { useTurn } from '@/components/useTurn';


export default function Home() {
  const [apiKey, setApiKey] = useSessionState('adz.openrouter_key', '');
  const [model, setModel] = useSessionState('adz.model', MODELOS[0]);
  const { turns, artifacts, pending, status, erro, enviar, decidir, limpar } = useTurn(apiKey, model);

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-surface px-5 py-2.5">
        <h1 className="text-[14px] font-medium tracking-tight text-ink">AdzChat</h1>
        <p className="text-[12px] text-muted">
          harness agêntico para gestores de marketing — grafo de estados, ReAct dentro dos nós, permissões deny-first
        </p>
        <div className="ml-auto flex items-center gap-3 font-mono text-[10px] text-faint">
          <span>dados fictícios · conta Housewhey</span>
          {turns.length > 0 && (
            <button type="button" onClick={limpar} className="hover:text-ink">
              limpar sessão
            </button>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col-reverse lg:flex-row">
        <section className="min-h-[55vh] border-t border-line lg:min-h-0 lg:w-[58%] lg:border-t-0 lg:border-r">
          <Stage artifacts={artifacts} />
        </section>

        <aside className="flex min-h-0 flex-col lg:w-[42%]">
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
    </div>
  );
}
