/**
 * Constantes de apresentação da interface.
 *
 * O roteiro de replay NÃO vive mais aqui: sem chave, a UI manda `replay: true` para
 * `/api/chat` e o servidor devolve o mesmo trace do runtime. Uma fonte de verdade só.
 */
import type { NodeName } from '@/harness/types';

export interface PromptSugerido {
  readonly texto: string;
  readonly nota: string;
}

export const PROMPTS: readonly PromptSugerido[] = [
  { texto: 'Pause os criativos com CTA ruim e proponha 3 variações.', nota: 'passa pelo gate de permissão' },
  { texto: 'Por que caíram as vendas da Ômega 3 essa semana?', nota: 'diagnóstico com hipóteses descartadas' },
  { texto: 'Monta a pauta da reunião de amanhã com a Housewhey.', nota: 'usa a linha do tempo do supercérebro' },
  { texto: 'Cruza gasto do Meta com leads do CRM por utm_content e me diz o que está caro.', nota: 'cruzamento entre duas fontes' },
];

export const NODE_DESC: Record<NodeName, string> = {
  interpret: 'resolve intenção e entidades no supercérebro',
  plan: 'decide quais dados o pedido exige',
  fetch: 'loop ReAct de leitura',
  reason: 'loop ReAct de análise',
  compact: 'resume observações para caber no orçamento',
  gate: 'avalia permissão e interrompe o turno',
  act: 'executa a ação já confirmada',
  respond: 'redige a resposta e monta os artefatos',
  errorHandler: 'retry com backoff ou degradação explícita',
};
