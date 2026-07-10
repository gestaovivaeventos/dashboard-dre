// Regras de roteamento de aprovação (overrides de negócio).
//
// Estes IDs são acordos de negócio explícitos, não dados derivados — por isso
// ficam fixos no código. Mudaram? Atualize aqui.
//
// Vive num módulo próprio (sem "use server") para ser compartilhado entre a
// server action (createRequest) e a UI (badges de aprovação): ambos precisam
// concordar sobre "quem vai direto ao diretor". Antes, o createRequest embutia
// esse roteamento no `approval_tier` (marcando nível 3), o que fazia a tela
// rotular como "Fora do orçamento" requisições que estavam dentro do orçamento.

export const APPROVAL_ROUTING = {
  // Requisições deste solicitante pulam o gerente e nascem aguardando o diretor.
  directorOnly: {
    requesterId: "45a367ad-695e-4758-b033-470483758b4c",
    directorId: "f159c959-55c2-4cc9-a1e4-acc4b2ab69c3",
  },
  // Tipo de despesa cuja etapa de gerente é direcionada a este gerente.
  expenseTypeManager: {
    expenseTypeId: "7233530b-fb16-441d-a22c-9611ddedf1ab", // Capacitações e Treinamentos
    managerId: "bcacac55-230e-447c-bb7c-c0ff63ce18ee",
  },
  // Setor cujas requisições vão sempre direto ao diretor, mesmo com orçamento
  // aprovado (pula o gerente). Notifica todos os diretores.
  directorSector: {
    sectorId: "306ef9b3-7895-446d-b9d3-5537942627b2", // Diretoria
  },
} as const;

/**
 * Uma requisição é roteada direto ao diretor (pulando o gerente) por REGRA —
 * setor Diretoria ou solicitante especial —, independente do orçamento. Isso é
 * diferente de estar "fora do orçamento" (que é o `approval_tier === 'nivel_3'`
 * vindo do cálculo de saldo).
 */
export function isForcedDirectorRouting(input: {
  sector_id?: string | null;
  created_by?: string | null;
}): boolean {
  return (
    input.sector_id === APPROVAL_ROUTING.directorSector.sectorId ||
    input.created_by === APPROVAL_ROUTING.directorOnly.requesterId
  );
}
