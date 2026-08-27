/**
 * As 2 tools de ESCRITA. Efeito simulado EM MEMÓRIA — os JSONs de `data/` nunca
 * são alterados. Só executam a partir do nó `act`, e só depois do gate (a trava
 * está em `permissions.ts`; aqui está o preview e o efeito).
 *
 * O preview é escrito para o gestor de marketing: nome do anúncio, gasto e
 * resultado do período; nome do destinatário e o texto INTEGRAL da mensagem.
 * Id cru sem rótulo não vai para a tela.
 */
import { asJson, criativos, supercerebro } from '../datasets';
import type { ActionPreview, Json } from '../types';
import { SEMANA_ATUAL } from './aggregate';
import { ToolFailure, type ToolPayload } from './read';

type Args = Record<string, Json>;

/** `ToolDef.buildPreview` recebe `Json`; aqui vira o mapa de argumentos com segurança. */
export function asArgs(bruto: Json): Args {
  return bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
}

/** Efeito simulado do turno. ponytail: memória de processo, some no restart. */
const pausados = new Set<string>();
const enviados: { messageId: string; destinatarioId: string; mensagem: string; enviadoEm: string }[] = [];

export function estadoSimulado(): { pausados: string[]; enviados: typeof enviados } {
  return { pausados: [...pausados], enviados: [...enviados] };
}
export function limparEstadoSimulado(): void {
  pausados.clear();
  enviados.length = 0;
}

const brl = (n: number): string => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function idsDeAnuncio(args: Args): string[] {
  const v = args['adIds'];
  const brutos = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : [];
  if (!brutos.length) throw new ToolFailure('bad_args', 'Argumento `adIds` é obrigatório: a lista de anúncios a pausar.');
  return brutos;
}

function acharCriativo(ref: string) {
  return criativos().criativos.find((c) => c.id === ref || c.nome === ref);
}

function acharPessoa(id: string) {
  return supercerebro().nodes.find((n) => n.id === id || n.label.toLowerCase() === id.toLowerCase());
}

// --- previews ---------------------------------------------------------------

export function previewPauseAds(args: Args): ActionPreview {
  const ids = Array.isArray(args['adIds']) ? args['adIds'].filter((x): x is string => typeof x === 'string') : [];
  const motivo = typeof args['motivo'] === 'string' ? args['motivo'] : '';
  const itens = ids.map((ref) => {
    const c = acharCriativo(ref);
    if (!c) return { label: `Anúncio ${ref} (não encontrado no catálogo de criativos)`, detalhe: 'Vou reportar como falha se você confirmar.' };
    const s4 = c.metricas_por_semana.find((s) => s.semana.startsWith('S4'));
    const detalhe = s4
      ? `${brl(s4.spend)} de ${SEMANA_ATUAL.from.slice(8)}/${SEMANA_ATUAL.from.slice(5, 7)} a ${SEMANA_ATUAL.to.slice(8)}/${SEMANA_ATUAL.to.slice(5, 7)} · ${s4.conversions} conversões · CPA ${brl(s4.cpa)} · CTR ${s4.ctr.toFixed(2).replace('.', ',')}% · frequência ${s4.frequency.toFixed(1).replace('.', ',')}`
      : 'Sem métricas na semana atual.';
    return { label: `${c.nome} — CTA "${c.cta}" (${c.campanha})`, detalhe };
  });
  return {
    titulo: `Pausar ${ids.length} anúncio(s) no Meta Ads`,
    itens,
    impacto: 'Os anúncios param de entregar imediatamente e o orçamento realoca para os demais do conjunto.',
    reversivel: true,
    comoDesfazer: 'Reativar pelo gerenciador do Meta ou me pedir aqui no chat.',
    seNegada: motivo
      ? `Nada é pausado. Eu mantenho a análise (${motivo}) e sigo entregando as recomendações para você decidir depois.`
      : 'Nada é pausado. Eu sigo e entrego a análise e as variações de CTA para você decidir depois.',
  };
}

export function previewSendWhatsapp(args: Args): ActionPreview {
  const destinatarioId = typeof args['destinatarioId'] === 'string' ? args['destinatarioId'] : '';
  const mensagem = typeof args['mensagem'] === 'string' ? args['mensagem'] : '';
  const pessoa = acharPessoa(destinatarioId);
  const nome = pessoa?.label ?? destinatarioId ?? 'destinatário desconhecido';
  const papel = pessoa?.props?.papel ? ` (${String(pessoa.props.papel)})` : '';
  return {
    titulo: `Enviar WhatsApp para ${nome}${papel}`,
    itens: [
      { label: `Destinatário: ${nome}${papel}`, detalhe: pessoa ? `id ${pessoa.id}` : 'Destinatário não encontrado no supercérebro.' },
      { label: 'Texto integral da mensagem', detalhe: mensagem || '(mensagem vazia)' },
    ],
    impacto: 'A mensagem sai agora, em seu nome, para o WhatsApp dessa pessoa.',
    reversivel: false,
    seNegada: 'Nada é enviado. Eu deixo o texto pronto aqui no chat para você copiar, ajustar e mandar quando quiser.',
  };
}

// --- execução (só a partir do `act`) ---------------------------------------

export function pause_ads(args: Args): ToolPayload {
  const ids = idsDeAnuncio(args);
  const motivo = typeof args['motivo'] === 'string' ? args['motivo'] : 'sem motivo declarado';
  const ok: string[] = [];
  const falharam: { id: string; erro: string }[] = [];
  for (const ref of ids) {
    const c = acharCriativo(ref);
    if (!c) {
      falharam.push({ id: ref, erro: 'Anúncio não encontrado na conta.' });
      continue;
    }
    if (c.status !== 'ativo') {
      falharam.push({ id: ref, erro: `Anúncio está com status "${c.status}" e não pode ser pausado.` });
      continue;
    }
    pausados.add(c.id);
    ok.push(c.nome);
  }
  return {
    data: asJson({ pausados: ok, falharam, motivo, simulado: true }),
    summary: `${ok.length} anúncio(s) pausado(s) no Meta Ads${falharam.length ? ` · ${falharam.length} falha(s)` : ''}. (efeito simulado no protótipo)`,
    source: 'meta_ads (write simulado)',
  };
}

export function send_whatsapp(args: Args): ToolPayload {
  const destinatarioId = typeof args['destinatarioId'] === 'string' ? args['destinatarioId'] : '';
  const mensagem = typeof args['mensagem'] === 'string' ? args['mensagem'] : '';
  if (!destinatarioId) throw new ToolFailure('bad_args', 'Argumento `destinatarioId` é obrigatório.');
  if (!mensagem.trim()) throw new ToolFailure('bad_args', 'Argumento `mensagem` é obrigatório e não pode ser vazio.');
  const pessoa = acharPessoa(destinatarioId);
  if (!pessoa) throw new ToolFailure('not_found', `Não achei "${destinatarioId}" no supercérebro. Não envio mensagem para destinatário que não sei quem é.`);
  const enviadoEm = new Date().toISOString();
  const messageId = `wamid.SIM-${enviados.length + 1}`;
  enviados.push({ messageId, destinatarioId: pessoa.id, mensagem, enviadoEm });
  return {
    data: asJson({ enviadoEm, messageId, destinatario: pessoa.label, simulado: true }),
    summary: `Mensagem enviada para ${pessoa.label}. (efeito simulado no protótipo)`,
    source: 'whatsapp (write simulado)',
  };
}
