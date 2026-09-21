// Helper de cliente: pede ao servidor para puxar TODAS as categorias ativas do
// cadastro da Omie para omie_categories (endpoint POST /api/category-mapping/
// sync-omie). Usado pelas abas de Mapeamento (DRE e Fluxo de Caixa) no botão
// "Atualizar", para que uma categoria recém-criada na Omie apareça antes de ter
// qualquer lançamento.
export interface SyncOmieCategoriesResult {
  ok: boolean;
  count?: number;
  /** Quebra por empresa (empresa composta puxa do cadastro das origens). */
  companies?: Array<{ name: string; count: number }>;
  /** Aviso de sucesso parcial (uma origem falhou, outras ok). */
  warning?: string;
  error?: string;
}

export async function syncOmieCategories(
  companyId: string,
): Promise<SyncOmieCategoriesResult> {
  if (!companyId) return { ok: false, error: "Empresa nao selecionada." };
  try {
    const response = await fetch("/api/category-mapping/sync-omie", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    });
    const raw = await response.text();
    const payload = raw
      ? (JSON.parse(raw) as SyncOmieCategoriesResult)
      : null;
    if (!response.ok || !payload?.ok) {
      return {
        ok: false,
        error: payload?.error ?? "Falha ao sincronizar categorias da Omie.",
      };
    }
    return {
      ok: true,
      count: payload.count,
      companies: payload.companies,
      warning: payload.warning,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro de rede." };
  }
}

/** Descrição amigável do resultado para toast. */
export function describeSyncResult(res: SyncOmieCategoriesResult): string {
  if (res.companies && res.companies.length > 1) {
    return res.companies.map((c) => `${c.name}: ${c.count}`).join(" · ");
  }
  return `${res.count ?? 0} categoria(s) do cadastro da Omie.`;
}
