// Filtro de setor das telas de pessoal. Três estados distintos convivem, e o
// null do banco só cobre um deles — daí o sentinela:
//
//   null            → empresa NÃO orça por setor: quadro único, setor_id IS NULL
//   SETOR_TODOS     → empresa orça por setor, mas se quer o consolidado dela
//   "<uuid>"        → um setor específico
//
// Módulo "puro" (sem "use server"): importável por client e server.

export const SETOR_TODOS = "todos";

/** true quando o valor pede o consolidado da empresa (sem filtrar setor). */
export function isTodosSetores(setorId: string | null | undefined): boolean {
  return setorId === SETOR_TODOS;
}

/** Setor específico, ou null quando é quadro único ou consolidado. */
export function setorEspecifico(setorId: string | null | undefined): string | null {
  return setorId && setorId !== SETOR_TODOS ? setorId : null;
}

// ─── Agrupamento por setor (a visão "Todos os setores") ─────────────────────
// Ver TODO MUNDO numa tela só, mas com cada setor separado — não um monte
// indistinguível. Sem isto, o consolidado mostra os colaboradores em sequência
// e nada diz de quem é cada um.

export interface ComSetor {
  setorId: string | null;
}

export interface GrupoDeSetor<T> {
  setorId: string | null;
  /** Nome do setor, ou o rótulo do balde quando a linha não tem setor. */
  nome: string;
  itens: T[];
}

/** Linhas sem setor: existem (quadro migrado, empresa que passou a orçar por
 * setor) e não podem sumir da tela só por não terem dono. */
export const SEM_SETOR_LABEL = "Sem setor";

/**
 * Agrupa por setor, em ordem alfabética pt-BR, com "Sem setor" por ÚLTIMO —
 * mesma convenção do balde "Sem grupo" (ver grupos.ts): é dívida visível, não
 * um setor de verdade, e misturá-lo na ordem alfabética o faria passar por um.
 *
 * Setor que não está no cadastro recebido (inativado depois de alguém ser
 * alocado nele) mantém as linhas visíveis sob o id, em vez de descartá-las.
 */
export function agruparPorSetor<T extends ComSetor>(
  itens: readonly T[],
  setores: readonly { id: string; name: string }[],
): GrupoDeSetor<T>[] {
  const nomePorId = new Map(setores.map((s) => [s.id, s.name]));
  const mapa = new Map<string, GrupoDeSetor<T>>();

  itens.forEach((item) => {
    const id = item.setorId ?? null;
    const chave = id ?? "__sem_setor__";
    let bucket = mapa.get(chave);
    if (!bucket) {
      bucket = {
        setorId: id,
        nome: id ? (nomePorId.get(id) ?? "Setor sem cadastro") : SEM_SETOR_LABEL,
        itens: [],
      };
      mapa.set(chave, bucket);
    }
    bucket.itens.push(item);
  });

  return Array.from(mapa.values()).sort((a, b) => {
    if (a.setorId === null && b.setorId !== null) return 1;
    if (b.setorId === null && a.setorId !== null) return -1;
    return a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
  });
}
