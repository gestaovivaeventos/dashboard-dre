"use server";

import { revalidatePath } from "next/cache";

import { requireCtrlRole } from "@/lib/ctrl/auth";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { reconcilePaidRequests } from "@/lib/ctrl/reconcile-payments";

// Ação manual: consulta o Omie e marca como "Pago" as requisições cujo título já
// foi efetivamente baixado (pago). Botão "Atualizar pagamentos" na tela de
// Requisições / Contas a Pagar. Restrita a quem opera pagamentos.
export async function refreshPaymentStatuses(companyId?: string) {
  await requireCtrlRole("contas_a_pagar", "csc", "diretor", "admin");

  const supabase = createAdminClientIfAvailable();
  if (!supabase) return { error: "Cliente administrativo indisponível." };

  try {
    const result = await reconcilePaidRequests(
      supabase,
      companyId ? { companyId } : {},
    );
    revalidatePath("/ctrl/requisicoes");
    revalidatePath("/ctrl/contas-a-pagar");
    return { ok: true as const, ...result };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Falha ao atualizar o status de pagamento no Omie.",
    };
  }
}
