import { METODOS, type OrcamentoMetodo } from "@/lib/orcamento/metodos";
import { isWorkspaceTabBuilt } from "@/lib/orcamento/workspace-tabs";

// =============================================================================
// Quais TELAS do orçamento aparecem em cada empresa.
//
// ── A lista é de EXCLUSÕES ─────────────────────────────────────────────────
// Guarda-se o que está OCULTO, não o que está visível. Conjunto vazio = tudo
// aparece, em todas as empresas — então ligar o recurso não muda nada até alguém
// desmarcar algo, e método NOVO nasce visível em vez de escondido em todas as
// empresas até ser marcado uma por uma. Mesmo enquadramento de
// `company_excluded_projects` e do abre/fecha da Prévia (`linhasVisiveis`).
//
// A TELA de configuração mostra "o que aparece" (caixas marcadas) e desmarcar é
// que grava. A semântica da interface e a do armazenamento são opostas de
// propósito — é o que torna o recurso aditivo.
//
// ── Esconder é sobre a PORTA, não sobre o número ───────────────────────────
// Ocultar não exclui nada: o que já estiver orçado continua na Prévia e no
// Budget. É por isso que a action recusa ocultar método que tem dado naquela
// empresa — valor somando sem tela por onde abri-lo é o pior resultado possível.
// Esta regra não sabe contar dado; ela só responde "aparece ou não".
//
// Módulo PURO (cliente + servidor) e testado.
// =============================================================================

/** Chaves ocultas de uma empresa, como vêm da tabela. */
export type MetodosOcultos = ReadonlySet<string>;

export function ocultosDeLinhas(
  linhas: ReadonlyArray<{ metodo?: unknown }> | null | undefined,
): Set<string> {
  const s = new Set<string>();
  for (const l of linhas ?? []) {
    if (typeof l.metodo === "string" && l.metodo.trim() !== "") s.add(l.metodo.trim());
  }
  return s;
}

/** Este método aparece nesta empresa? */
export function metodoVisivelNaEmpresa(
  metodo: OrcamentoMetodo | string,
  ocultos: MetodosOcultos,
): boolean {
  return !ocultos.has(metodo);
}

/**
 * Os métodos que a empresa oferece — os que têm TELA, menos os ocultos.
 *
 * `isWorkspaceTabBuilt` entra aqui porque método sem tela não é uma escolha do
 * admin: ele não aparece em empresa nenhuma, e oferecê-lo na configuração seria
 * uma caixa que não muda nada.
 */
export function metodosDaEmpresa(ocultos: MetodosOcultos): OrcamentoMetodo[] {
  return METODOS.filter((m) => isWorkspaceTabBuilt(m.key) && !ocultos.has(m.key)).map((m) => m.key);
}

/** Métodos que a tela de configuração deve oferecer para marcar/desmarcar. */
export function metodosConfiguraveis(): OrcamentoMetodo[] {
  return METODOS.filter((m) => isWorkspaceTabBuilt(m.key)).map((m) => m.key);
}

export const METODO_OCULTO_NA_EMPRESA =
  "Este método de orçamento não está habilitado para esta empresa.";

/**
 * O nome do que cada método orça, para a recusa concordar.
 *
 * As DUAS formas vão escritas, e o gênero também: plural do português não se
 * deriva ("viagem" → "viagens", não "viagems"), e o particípio concorda —
 * viagens orçad**as**, colaboradores orçad**os**. Derivar aqui produziria
 * "3 viagem orçados", que é o que a primeira versão desta função fazia.
 */
export interface RotuloDoMetodo {
  singular: string;
  plural: string;
  genero: "m" | "f";
}

export const ROTULO_DO_METODO: Record<string, RotuloDoMetodo> = {
  pessoal: { singular: "colaborador", plural: "colaboradores", genero: "m" },
  media: { singular: "linha", plural: "linhas", genero: "f" },
  valor_fixo: { singular: "contrato", plural: "contratos", genero: "m" },
  planejamento_socios: { singular: "despesa", plural: "despesas", genero: "f" },
  viagens: { singular: "viagem", plural: "viagens", genero: "f" },
};

/**
 * Mensagem de recusa ao tentar OCULTAR um método que já tem coisa orçada.
 *
 * Nomeia o que existe em vez de só negar: "não dá" manda o admin procurar o
 * problema; "há 3 viagens orçadas aqui" diz o que fazer. O valor continuaria
 * somando na Prévia e no Budget sem tela por onde abri-lo, e é esse número órfão
 * que a trava evita — não a perda de dado, que não aconteceria.
 */
export function recusaPorDado(
  metodoLabel: string,
  quantos: number,
  rotulo: RotuloDoMetodo,
): string {
  const nome = quantos === 1 ? rotulo.singular : rotulo.plural;
  const participio = `orçad${rotulo.genero === "m" ? "o" : "a"}${quantos === 1 ? "" : "s"}`;
  return (
    `${metodoLabel} já tem ${quantos} ${nome} ${participio} nesta empresa. ` +
    `Esconder a tela não tira esse valor da Prévia nem do Budget — ele ficaria somando sem nenhuma ` +
    `tela por onde abri-lo. Remova o que foi orçado antes, ou deixe a tela visível.`
  );
}
