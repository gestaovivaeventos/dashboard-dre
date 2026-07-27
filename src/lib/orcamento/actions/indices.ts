"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import type { IndiceYear } from "@/lib/orcamento/indices";

const PATH = "/orcamento/configuracoes/indices";

/** Lista os índices de todos os anos (mais recente primeiro). */
export async function getIndices(): Promise<{
  items?: IndiceYear[];
  error?: string;
  needsMigration?: boolean;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { data, error } = await supabase
    .from("orcamento_indices")
    .select("year, ipca, igpm, salario_minimo")
    .order("year", { ascending: false });
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  return { items: (data ?? []) as IndiceYear[] };
}

interface IndiceValues {
  ipca: number | null;
  igpm: number | null;
  salarioMinimo: number | null;
}

/** Cria ou atualiza os índices de um ano. */
export async function upsertIndiceYear(year: number, values: IndiceValues) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { error: "Informe um ano válido (2000–2100)." };
  }
  for (const v of [values.ipca, values.igpm, values.salarioMinimo]) {
    if (v != null && !Number.isFinite(v)) {
      return { error: "Valor de índice inválido." };
    }
  }

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase.from("orcamento_indices").upsert(
    {
      year,
      ipca: values.ipca,
      igpm: values.igpm,
      salario_minimo: values.salarioMinimo,
      updated_by: admin.userId,
    },
    { onConflict: "year" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) {
      return { error: "Migration do módulo Orçamento (índices) ainda não aplicada." };
    }
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true as const };
}

/** Remove o registro de um ano (ex.: ano cadastrado por engano). */
export async function deleteIndiceYear(year: number) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase.from("orcamento_indices").delete().eq("year", year);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true as const };
}
