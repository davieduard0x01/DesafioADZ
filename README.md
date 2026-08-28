# DesafioADZ — Harness Agêntico para Gestores de Marketing

Desafio técnico AdzHub · Núcleo Fundacional · 2026.

**Tese:** harness híbrido — grafo de estados como espinha dorsal, loops ReAct dentro dos nós, camada de permissões deny-first, supercérebro como contexto de primeira classe.

- Paper: `paper/main.pdf`
- Demo: **https://desafio-adz-harness.vercel.app** (sem login; sem chave roda replay determinístico)
- Checklist de entrega: `docs/CHECKLIST.md`

## Rodar local

```bash
npm install
npm run dev
```

Abra http://localhost:3000 e cole sua `OPENROUTER_API_KEY` no campo da UI. A key fica apenas no `sessionStorage` do browser — não é persistida no servidor nem gravada em log. Sem key, a demo roda um replay determinístico rotulado como tal.

## Estrutura

```
paper/    LaTeX + main.pdf
docs/     estudo, arquitetura (ADRs), material de apoio do desafio, checklist
data/     mocks do supercérebro, Apps e APIs (dados fictícios)
src/      app (rotas + /api/chat), components (Palco, Chat, TraceView), harness (grafo, tools, permissões)
```

Todos os dados em `data/` são fictícios. Ver `data/README.md`.
