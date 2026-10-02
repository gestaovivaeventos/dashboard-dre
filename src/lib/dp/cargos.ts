// ============================================================================
// Cargos e salários do DP — regras puras e testadas: a chave de nome, a
// sugestão do de-para Sólides → linha da tabela e o enquadramento de cada pessoa.
// ============================================================================

/**
 * Forma normalizada de um nome (cargo, nível, cargo da Sólides): minúsculas,
 * sem acento, sem o "(a)" de gênero, espaço único. É a que leva o UNIQUE no
 * banco — "Analista  Comercial" e "analista comercial" são o mesmo cargo.
 */
export function chaveNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(a\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Uma linha da tabela salarial, no formato que a sugestão e o enquadramento usam. */
export interface DpLinhaSalarial {
  id: string;
  setor: string;
  cargo: string;
  step: string;
  salario: number;
}

/** "Cargo — Step" (ou só o cargo, quando não há step): como a linha aparece nos seletores. */
export function rotuloLinha(l: Pick<DpLinhaSalarial, "cargo" | "step">): string {
  return l.step.trim() ? `${l.cargo} — ${l.step}` : l.cargo;
}

/**
 * Linha sugerida para um cargo da Sólides, ou null. Só sugere quando há UM
 * candidato: o nome da Sólides é "cargo + step" ("Analista Comercial Pleno III"
 * = cargo "Analista Comercial" + step "Pleno III"), ou é o nome do cargo e ele
 * tem uma linha só. Dois candidatos (o mesmo cargo em dois setores, por
 * exemplo) = nenhuma sugestão: chutar entre eles enquadraria a pessoa no
 * salário errado sem ninguém perceber.
 */
export function sugerirLinha(nomeSolides: string, linhas: DpLinhaSalarial[]): string | null {
  const alvo = chaveNome(nomeSolides);
  if (!alvo) return null;
  const candidatos = new Set<string>();
  const porCargo = new Map<string, DpLinhaSalarial[]>();
  for (const l of linhas) {
    const cargo = chaveNome(l.cargo);
    porCargo.set(cargo, [...(porCargo.get(cargo) ?? []), l]);
    if (chaveNome(`${l.cargo} ${l.step}`) === alvo) candidatos.add(l.id);
  }
  const doCargo = porCargo.get(alvo) ?? [];
  if (doCargo.length === 1) candidatos.add(doCargo[0].id);
  return candidatos.size === 1 ? Array.from(candidatos)[0] : null;
}

export type DpEnquadramentoStatus =
  | "no_nivel"
  | "abaixo"
  | "acima"
  | "sem_salario"
  | "sem_vinculo"
  | "sem_empresa";

export const ROTULO_ENQUADRAMENTO: Record<DpEnquadramentoStatus, string> = {
  no_nivel: "No salário da tabela",
  abaixo: "Abaixo da tabela",
  acima: "Acima da tabela",
  sem_salario: "Sem salário na Sólides",
  sem_vinculo: "Cargo sem linha na tabela",
  sem_empresa: "Sem empresa definida",
};

/** Diferença menor que isto (em reais) conta como "no salário da tabela": arredondamento, não desvio. */
export const TOLERANCIA_REAIS = 1;

export interface DpEnquadramento {
  status: DpEnquadramentoStatus;
  /** Salário real − salário da tabela; null quando não há os dois. */
  diferenca: number | null;
  /** Diferença em % do salário da tabela; null quando não há os dois ou ele é zero. */
  percentual: number | null;
}

export function enquadrar(input: {
  temEmpresa: boolean;
  salario: number | null;
  salarioNivel: number | null;
}): DpEnquadramento {
  if (!input.temEmpresa) return { status: "sem_empresa", diferenca: null, percentual: null };
  if (input.salarioNivel === null) return { status: "sem_vinculo", diferenca: null, percentual: null };
  if (input.salario === null || input.salario <= 0) return { status: "sem_salario", diferenca: null, percentual: null };
  const diferenca = Math.round((input.salario - input.salarioNivel) * 100) / 100;
  const percentual = input.salarioNivel > 0 ? Math.round((diferenca / input.salarioNivel) * 1000) / 10 : null;
  const status: DpEnquadramentoStatus =
    Math.abs(diferenca) < TOLERANCIA_REAIS ? "no_nivel" : diferenca < 0 ? "abaixo" : "acima";
  return { status, diferenca, percentual };
}
