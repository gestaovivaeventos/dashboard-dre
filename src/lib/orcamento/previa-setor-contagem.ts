import { contarEstados, type ContagemValidacao } from "@/lib/orcamento/validacao-diretoria";
import type { PreviaSetorCategoria } from "@/lib/orcamento/actions/planejamento-categoria";
import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";

// =============================================================================
// A contagem da faixa da prévia do setor, recortada no MÉTODO da tela.
//
// A prévia do setor lista o orçamento INTEIRO do setor, de qualquer método —
// é de propósito, o diretor percorre a mesma lista abrindo por qualquer porta.
// Mas a faixa de números em cima dela era lida como "o que falta NESTA tela", e
// não era isso que ela dizia: na tela de Despesas com pessoal ela somava também
// as linhas de média, valor fixo e planejamento do setor.
//
// O caso real que revelou (empresa × 2027, 29/09/2026): a faixa mostrava
// "33 a verificar · 10 aprovadas · 2 reprovadas" com 10 colaboradores no
// quadro, 3 aprovados e 1 reprovado. As 10 eram 3 colaboradores + 7 despesas
// do Planejamento; as 2 eram 1 colaborador + 1 do Planejamento.
//
// A dedupe por alvo continua valendo e é indispensável: o mesmo colaborador
// aparece em Salários, Encargos, Benefícios, Férias e 13º, e o ✓ dele é um só.
//
// Módulo PURO — a contagem é derivada de `categorias`, que é a MESMA estrutura
// que a atualização otimista (`aplicarDecisao`) mantém. Assim o número da faixa
// se move no clique junto com o resto, sem um segundo caminho para divergir.
// =============================================================================

/**
 * Conta os itens de um método, sem repetir o mesmo alvo.
 *
 * `metodo` ausente = todos os métodos (a contagem do setor inteiro).
 */
export function contarPorMetodo(
  categorias: readonly PreviaSetorCategoria[],
  metodo?: OrcamentoMetodo,
): ContagemValidacao {
  const vistos = new Set<string>();
  const estados: Parameters<typeof contarEstados>[0][number][] = [];
  for (const cat of categorias) {
    if (metodo && cat.metodo !== metodo) continue;
    for (const grupo of cat.grupos) {
      for (const item of grupo.itens) {
        // Item sem alvo não é decidível (a média sem linha gravada, por
        // exemplo) — não entra numa contagem de "o que falta decidir".
        if (!item.alvoTipo || !item.alvoId) continue;
        const chave = `${item.alvoTipo}|${item.alvoId}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        estados.push(item.estado);
      }
    }
  }
  return contarEstados(estados);
}

/**
 * Como nomear o que está sendo contado, por método.
 *
 * Sem o substantivo a faixa mostraria "6 a verificar" ao lado de uma lista com
 * 45 itens — um número que não casa com nada à vista. Dizendo "6 colaboradores
 * a verificar", o recorte fica explícito e a lista continua sendo o setor
 * inteiro, como deve ser.
 *
 * `genero` existe porque o texto concorda: colaboradores **aprovados**,
 * despesas **aprovadas**.
 */
export interface ContagemRotulo {
  plural: string;
  genero: "m" | "f";
}

export const ROTULO_POR_METODO: Partial<Record<OrcamentoMetodo, ContagemRotulo>> = {
  pessoal: { plural: "colaboradores", genero: "m" },
  media: { plural: "categorias", genero: "f" },
  valor_fixo: { plural: "contratos", genero: "m" },
  planejamento_socios: { plural: "despesas", genero: "f" },
};

/** Sufixo do particípio: "aprovad" + `os` / `as`. */
export function sufixo(rotulo?: ContagemRotulo): "os" | "as" {
  return rotulo?.genero === "m" ? "os" : "as";
}
