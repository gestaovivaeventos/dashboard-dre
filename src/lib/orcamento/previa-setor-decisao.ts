import {
  contarEstados,
  entraNoNumero,
  type ValidacaoAlvoTipo,
  type ValidacaoEstado,
} from "@/lib/orcamento/validacao-diretoria";
import type {
  PreviaSetorCategoria,
  PreviaSetorGrupo,
  PreviaSetorResumo,
} from "@/lib/orcamento/actions/planejamento-categoria";

// =============================================================================
// Aplicar uma decisão na prévia do setor SEM ir ao servidor.
//
// O diretor clica no ✓ e o número tem de mexer na hora. Esperar o round-trip
// fazia a tela parecer travada justamente no gesto mais repetido da validação
// — e, no Pessoal, a prévia sequer recarregava (a decisão acontece na linha do
// colaborador, que é um componente irmão do painel).
//
// A recontagem é feita aqui inteira, e não "só no item", porque o total de um
// grupo, o da categoria, o do setor e os contadores derivam todos do mesmo
// conjunto: mexer num e esquecer o outro deixaria a tela internamente
// inconsistente até o próximo refetch — pior do que não atualizar nada.
//
// É otimista, não substituto: quem chama continua recarregando do servidor em
// seguida, e o valor de lá prevalece. Aqui só se antecipa o que já se sabe.
// =============================================================================

export interface DecisaoAplicada {
  alvoTipo: ValidacaoAlvoTipo;
  alvoId: string;
  estado: ValidacaoEstado;
  comentario: string | null;
}

/**
 * Devolve a prévia com a decisão já refletida — item, grupo, categoria, total
 * do setor e contadores.
 *
 * O MESMO alvo pode aparecer em várias categorias (o colaborador entra em
 * Salários, Encargos e Benefícios), e todas são atualizadas: um ✓ aprova a
 * pessoa, não uma das linhas dela.
 */
export function aplicarDecisao(
  resumo: PreviaSetorResumo,
  decisao: DecisaoAplicada,
): PreviaSetorResumo {
  const alvo = `${decisao.alvoTipo}|${decisao.alvoId}`;
  // Dedupe dos contadores: o mesmo alvo em três categorias é UM item para
  // quem conta, senão a pendência sai triplicada.
  const vistos = new Set<string>();
  const estados: ValidacaoEstado[] = [];

  const categorias: PreviaSetorCategoria[] = resumo.categorias.map((cat) => {
    const grupos: PreviaSetorGrupo[] = cat.grupos.map((grupo) => {
      const itens = grupo.itens.map((item) => {
        const chave = item.alvoTipo && item.alvoId ? `${item.alvoTipo}|${item.alvoId}` : null;
        if (chave !== alvo) return item;
        return { ...item, estado: decisao.estado, comentario: decisao.comentario };
      });
      return {
        ...grupo,
        itens,
        totalAprovado: itens.reduce((a, i) => a + (entraNoNumero(i.estado) ? i.total : 0), 0),
      };
    });

    // Contagem por alvo, varrendo os itens JÁ atualizados.
    grupos.forEach((g) =>
      g.itens.forEach((i) => {
        const chave = i.alvoTipo && i.alvoId ? `${i.alvoTipo}|${i.alvoId}` : null;
        if (!chave || vistos.has(chave)) return;
        vistos.add(chave);
        estados.push(i.estado);
      }),
    );

    return {
      ...cat,
      grupos,
      // Categoria sem itens (a média antes de ter linha, por exemplo) não tem
      // de onde recalcular: mantém o que veio do servidor em vez de zerar.
      totalAprovado:
        grupos.length > 0
          ? grupos.reduce((a, g) => a + g.totalAprovado, 0)
          : cat.totalAprovado,
    };
  });

  return {
    ...resumo,
    categorias,
    totalAprovado: categorias.reduce((a, c) => a + c.totalAprovado, 0),
    contagem: estados.length > 0 ? contarEstados(estados) : resumo.contagem,
  };
}
