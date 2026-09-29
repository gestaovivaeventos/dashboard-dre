"use server";

import { revalidatePath } from "next/cache";

import { DP_PATH } from "@/lib/auth/dp";
import { requireDpUser } from "@/lib/dp/auth";
import type { DpRegraOrigem } from "@/lib/dp/empresa";
import { runDpSolidesSync, type DpSyncResult } from "@/lib/dp/solides/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export type DpActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : "Erro inesperado." };
}

/** Botão "Sincronizar agora". */
export async function sincronizarSolides(): Promise<DpActionResult<DpSyncResult>> {
  try {
    const user = await requireDpUser();
    const result = await runDpSolidesSync(createAdminClient(), { trigger: "manual", userId: user.id });
    revalidatePath(DP_PATH, "layout");
    return result.ok ? { ok: true, data: result } : { ok: false, error: result.erro ?? "Falha na sincronização." };
  } catch (error) {
    return fail(error);
  }
}

/**
 * De-para Sólides → empresa. `companyId` null REMOVE a regra (o colaborador
 * volta para "sem empresa"). O nome da Sólides é guardado junto para a tela
 * continuar legível mesmo se a unidade/departamento sumir de lá.
 */
export async function salvarRegraEmpresa(input: {
  origem: DpRegraOrigem;
  solidesId: number;
  solidesNome: string;
  companyId: string | null;
}): Promise<DpActionResult> {
  try {
    const user = await requireDpUser();
    if (input.origem !== "unidade" && input.origem !== "departamento") throw new Error("Origem inválida.");
    if (!Number.isInteger(input.solidesId)) throw new Error("Código da Sólides inválido.");
    const admin = createAdminClient();

    if (input.companyId === null) {
      const { error } = await admin
        .from("dp_empresa_regras")
        .delete()
        .eq("origem", input.origem)
        .eq("solides_id", input.solidesId);
      if (error) throw new Error(error.message);
    } else {
      const { data: company } = await admin.from("companies").select("id").eq("id", input.companyId).maybeSingle();
      if (!company) throw new Error("Empresa não encontrada.");
      const { error } = await admin.from("dp_empresa_regras").upsert(
        {
          origem: input.origem,
          solides_id: input.solidesId,
          solides_nome: input.solidesNome.trim() || `${input.origem} ${input.solidesId}`,
          company_id: input.companyId,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "origem,solides_id" },
      );
      if (error) throw new Error(error.message);
    }
    revalidatePath(DP_PATH, "layout");
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}
