// ============================================================================
// A qual empresa do Control Hub o colaborador da Sólides pertence. Puro e
// testado; usado pela lista, pela ficha e pela tela de de-para — a regra tem de
// ser UMA, senão o mesmo colaborador aparece numa empresa numa tela e sem
// empresa na outra.
//
// Duas etapas, nesta ordem:
//  1. a UNIDADE da Sólides (é o campo feito para isso);
//  2. só quando a unidade está VAZIA, o DEPARTAMENTO — na Sólides deles o nome
//     segue "ÁREA - EMPRESA", e era a única pista para ~30% do quadro quando
//     o módulo nasceu.
//
// Unidade preenchida mas sem regra NÃO cai no departamento: seria esconder que
// falta mapear aquela unidade, e o departamento poderia apontar para outra
// empresa sem ninguém perceber.
// ============================================================================

export type DpRegraOrigem = "unidade" | "departamento";

export interface DpEmpresaRegra {
  origem: DpRegraOrigem;
  solidesId: number;
  companyId: string;
}

export interface DpColaboradorOrigem {
  unidadeId: number | null;
  departamentoId: number | null;
}

export type DpEmpresaResolvida =
  | { companyId: string; via: DpRegraOrigem }
  | { companyId: null; motivo: "unidade_sem_regra" | "departamento_sem_regra" | "sem_unidade_nem_departamento" };

export type DpRegrasIndex = Map<string, string>;

const chave = (origem: DpRegraOrigem, id: number) => `${origem}:${id}`;

export function indexarRegras(regras: DpEmpresaRegra[]): DpRegrasIndex {
  const idx: DpRegrasIndex = new Map();
  for (const r of regras) idx.set(chave(r.origem, r.solidesId), r.companyId);
  return idx;
}

export function resolverEmpresa(c: DpColaboradorOrigem, idx: DpRegrasIndex): DpEmpresaResolvida {
  if (c.unidadeId !== null) {
    const companyId = idx.get(chave("unidade", c.unidadeId));
    return companyId ? { companyId, via: "unidade" } : { companyId: null, motivo: "unidade_sem_regra" };
  }
  if (c.departamentoId !== null) {
    const companyId = idx.get(chave("departamento", c.departamentoId));
    return companyId ? { companyId, via: "departamento" } : { companyId: null, motivo: "departamento_sem_regra" };
  }
  return { companyId: null, motivo: "sem_unidade_nem_departamento" };
}

export const MOTIVO_SEM_EMPRESA: Record<Extract<DpEmpresaResolvida, { companyId: null }>["motivo"], string> = {
  unidade_sem_regra: "Unidade da Sólides sem empresa definida no de-para",
  departamento_sem_regra: "Sem unidade na Sólides, e o departamento não tem empresa no de-para",
  sem_unidade_nem_departamento: "Sem unidade e sem departamento na Sólides",
};

export interface DpOrigemParaMapear {
  origem: DpRegraOrigem;
  solidesId: number;
  nome: string;
  /** Colaboradores ATIVOS que dependem desta regra para ter empresa. */
  colaboradores: number;
  companyId: string | null;
}

/**
 * O que a tela de de-para lista: toda unidade vista nos colaboradores e todo
 * departamento que é usado por alguém SEM unidade (os outros não decidem nada
 * e só alongariam a tela), mais as regras já gravadas mesmo sem colaborador.
 */
export function origensParaMapear(
  colaboradores: Array<DpColaboradorOrigem & { unidadeNome: string | null; departamentoNome: string | null; ativo: boolean }>,
  regras: Array<DpEmpresaRegra & { solidesNome: string }>,
): DpOrigemParaMapear[] {
  const idx = indexarRegras(regras);
  const out = new Map<string, DpOrigemParaMapear>();
  const add = (origem: DpRegraOrigem, id: number, nome: string, conta: boolean) => {
    const k = chave(origem, id);
    const cur = out.get(k) ?? { origem, solidesId: id, nome, colaboradores: 0, companyId: idx.get(k) ?? null };
    if (conta) cur.colaboradores += 1;
    out.set(k, cur);
  };
  for (const c of colaboradores) {
    if (c.unidadeId !== null) add("unidade", c.unidadeId, c.unidadeNome ?? `Unidade ${c.unidadeId}`, c.ativo);
    else if (c.departamentoId !== null) {
      add("departamento", c.departamentoId, c.departamentoNome ?? `Departamento ${c.departamentoId}`, c.ativo);
    }
  }
  for (const r of regras) add(r.origem, r.solidesId, r.solidesNome, false);
  return Array.from(out.values()).sort(
    (a, b) =>
      (a.origem === b.origem ? 0 : a.origem === "unidade" ? -1 : 1) ||
      Number(a.companyId !== null) - Number(b.companyId !== null) ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );
}
