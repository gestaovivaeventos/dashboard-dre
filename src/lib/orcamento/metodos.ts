import type { OrcamentoPapel } from "@/lib/supabase/types";

// Métodos de construção do orçamento ("produtores"). Cada categoria de despesa
// de uma empresa é orçada por UM método. Módulo puro (client + server).

export type OrcamentoMetodo =
  | "pessoal"
  | "media"
  | "valor_fixo"
  | "planejamento_socios"
  | "viagens_ve"
  | "marketing_ve"
  | "endomarketing_ve";

export interface MetodoMeta {
  key: OrcamentoMetodo;
  label: string;
  /** Métodos específicos de VE (Viva Eventos) — telas construídas depois. */
  ve: boolean;
}

export const METODOS: readonly MetodoMeta[] = [
  { key: "pessoal", label: "Despesas com pessoal", ve: false },
  { key: "media", label: "Média com correção de índices", ve: false },
  { key: "valor_fixo", label: "Valor fixo com correção de índices", ve: false },
  { key: "planejamento_socios", label: "Planejamento dos gestores", ve: false },
  { key: "viagens_ve", label: "Viagens (VE)", ve: true },
  { key: "marketing_ve", label: "Campanhas de marketing (VE)", ve: true },
  { key: "endomarketing_ve", label: "Endomarketing (VE)", ve: true },
] as const;

const METODO_KEYS = new Set<string>(METODOS.map((m) => m.key));

export function isOrcamentoMetodo(value: unknown): value is OrcamentoMetodo {
  return typeof value === "string" && METODO_KEYS.has(value);
}

export function metodoLabel(key: OrcamentoMetodo): string {
  return METODOS.find((m) => m.key === key)?.label ?? key;
}

/**
 * Métodos AINDA EM VALIDAÇÃO — visíveis só para administradores.
 *
 * VAZIO desde 29/09/2026: o Planejamento dos gestores saiu daqui e chegou a
 * gerentes e diretores (pedido do dono do projeto — ele é justamente o método
 * feito para o gestor preencher). Quem constrói segue recortado pelos setores
 * dele; o que saiu foi a trava do MÉTODO, não o escopo.
 *
 * O mecanismo fica de pé para o próximo método em prova: pôr a chave aqui
 * esconde a caixa do hub e redireciona as rotas. É o único lugar — o hub, a
 * lista e a tela de montagem leem daqui, e nenhum deles repete a regra.
 */
export const METODOS_EM_VALIDACAO: ReadonlySet<OrcamentoMetodo> = new Set<OrcamentoMetodo>();

/** O método aparece para este usuário? Admin vê tudo. */
export function metodoVisivelPara(key: OrcamentoMetodo, isAdmin: boolean): boolean {
  return isAdmin || !METODOS_EM_VALIDACAO.has(key);
}

/**
 * Métodos de CORREÇÃO POR ÍNDICE — média do realizado e valor fixo.
 *
 * Os dois partem de um número que o gestor não define (o realizado do ano
 * anterior, o contrato) e são corrigidos por índice. Quem os mantém é a
 * administração; o gestor lê, para enxergar o conjunto do setor dele, mas não
 * mexe.
 */
const METODOS_POR_INDICE: ReadonlySet<OrcamentoMetodo> = new Set<OrcamentoMetodo>([
  "media",
  "valor_fixo",
]);

/**
 * Este papel pode EDITAR este método?
 *
 * Regra de 29/09/2026: **gerente e gerente sócio não editam nada em Média e
 * Valor fixo** — nem o valor, nem o índice, nem os contratos. Eles constroem
 * Pessoal e Planejamento dos gestores, dentro dos setores deles.
 *
 * Só responde pelo PAPEL. O recorte por SETOR continua valendo por cima
 * (`podeEscreverNoSetor`): poder editar o método não é poder editar a linha de
 * qualquer setor.
 */
export function podeEditarMetodo(papel: OrcamentoPapel, metodo: OrcamentoMetodo): boolean {
  if (!METODOS_POR_INDICE.has(metodo)) return true;
  return papel !== "construtor" && papel !== "construtor_amplo";
}
