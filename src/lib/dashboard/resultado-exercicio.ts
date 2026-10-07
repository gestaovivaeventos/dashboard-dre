// Qual conta do DRE é o "Resultado do Exercício" que alimenta o Fluxo de Caixa.
//
// O Fluxo não calcula resultado: lê a conta de resultado do DRE (mesmo motor do
// Dashboard) e soma o caixa a partir dela — Caixa Gerado, Caixa Final e o Saldo
// Inicial do mês seguinte saem dali. Por padrão é o code "11", que é onde ele
// está no plano global e em quase todos os planos próprios. Três empresas são
// exceção, por motivos diferentes:
//
//  - Spot e Express: os planos delas (idênticos) vão até o code 15 e NÃO TÊM
//    code 11 — o resultado é o 15 (12-13-14). Com o padrão, a linha saía ZERO
//    e o caixa calculado a partir dela ficava errado sem aviso nenhum.
//    Reportado em 07/10/2026; conferido contra produção que só estas duas, entre
//    as 22 empresas com plano próprio, não têm o code 11.
//  - SGX: tem code 11, mas ele é o "Resultado 2 - Locação + Operacional"; o
//    produto quer o "Resultado 4 - Locação + Operacional + Projetos" (code 15).
//
// É a mesma informação que o template do BI de cada uma já carrega
// (`resultCode` / `historicoAccountCode`). Identificadas por ID (estável a
// renomeação); o nome é só para leitura.
//
// Ao criar um plano próprio cujo resultado não esteja no code 11, a empresa
// entra aqui — senão o Fluxo dela mostra o resultado zerado.

import { DRE_RESULTADO_EXERCICIO_CODE } from "@/lib/dashboard/dre";

export const RESULTADO_EXERCICIO_CODE_POR_EMPRESA: ReadonlyArray<{
  companyId: string;
  /** Só para leitura humana — a comparação é pelo ID. */
  companyName: string;
  code: string;
}> = [
  { companyId: "8ddc1c4a-42d6-473a-b17d-1eeae821d18d", companyName: "SGX", code: "15" },
  { companyId: "682e2a01-9f45-4cdf-839e-2ae17dac028d", companyName: "Spot", code: "15" },
  { companyId: "36e5e164-f5ca-4498-9771-ab0999b977d6", companyName: "Express", code: "15" },
];

function codeDaEmpresa(companyId: string): string {
  return (
    RESULTADO_EXERCICIO_CODE_POR_EMPRESA.find((r) => r.companyId === companyId)?.code ??
    DRE_RESULTADO_EXERCICIO_CODE
  );
}

/**
 * Code da conta de resultado para o conjunto de empresas somado na tela.
 *
 * Uma empresa: o code dela. Várias (consolidado): o code comum a todas; se
 * divergirem, o padrão "11". O consolidado Spot + Express usa o 15 — os planos
 * das duas são idênticos, então o plano mesclado por código (`scopeDreAccounts`)
 * tem o 15 com a fórmula certa. Misturar planos cujo resultado mora em codes
 * diferentes não tem conta única correta; mantém-se o padrão de antes.
 */
export function resultadoExercicioCodeFor(companyIds: readonly string[]): string {
  const codes = Array.from(new Set(companyIds.map(codeDaEmpresa)));
  return codes.length === 1 ? codes[0] : DRE_RESULTADO_EXERCICIO_CODE;
}
