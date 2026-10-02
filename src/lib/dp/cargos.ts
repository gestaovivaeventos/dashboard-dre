// ============================================================================
// Cargos e salários do DP — regras puras e testadas: a chave de nome, a
// sugestão do de-para Sólides → nível e o enquadramento de cada pessoa.
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

export interface DpEstruturaCargo {
  cargoId: string;
  cargoNome: string;
  niveis: Array<{ id: string; nome: string; salario: number }>;
}

/**
 * Nível sugerido para um cargo da Sólides, ou null. Só sugere quando há UM
 * candidato: o nome da Sólides é "cargo + nível" ("Analista Comercial Pleno III"
 * = cargo "Analista Comercial" + nível "Pleno III"), ou é o nome do cargo e ele
 * tem um nível só. Dois candidatos = nenhuma sugestão: chutar entre eles
 * enquadraria a pessoa no salário errado sem ninguém perceber.
 */
export function sugerirNivel(nomeSolides: string, estrutura: DpEstruturaCargo[]): string | null {
  const alvo = chaveNome(nomeSolides);
  if (!alvo) return null;
  const candidatos = new Set<string>();
  for (const c of estrutura) {
    const cargo = chaveNome(c.cargoNome);
    for (const n of c.niveis) {
      if (chaveNome(`${c.cargoNome} ${n.nome}`) === alvo) candidatos.add(n.id);
    }
    if (cargo === alvo && c.niveis.length === 1) candidatos.add(c.niveis[0].id);
  }
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
  no_nivel: "No salário do nível",
  abaixo: "Abaixo do nível",
  acima: "Acima do nível",
  sem_salario: "Sem salário na Sólides",
  sem_vinculo: "Cargo sem nível definido",
  sem_empresa: "Sem empresa definida",
};

/** Diferença menor que isto (em reais) conta como "no salário do nível": arredondamento, não desvio. */
export const TOLERANCIA_REAIS = 1;

export interface DpEnquadramento {
  status: DpEnquadramentoStatus;
  /** Salário real − salário do nível; null quando não há os dois. */
  diferenca: number | null;
  /** Diferença em % do salário do nível; null quando não há os dois ou o nível é zero. */
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
