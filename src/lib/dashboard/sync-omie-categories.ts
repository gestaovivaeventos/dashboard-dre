// Helper de cliente: pede ao servidor para puxar TODAS as categorias ativas do
// cadastro da Omie para omie_categories (endpoint POST /api/category-mapping/
// sync-omie). Usado pelas abas de Mapeamento (DRE e Fluxo de Caixa) no botão
// "Atualizar", para que uma categoria recém-criada na Omie apareça antes de ter
// qualquer lançamento.
export async function syncOmieCategories(
  companyId: string,
): Promise<{ ok: boolean; count?: number; error?: string }> {
  if (!companyId) return { ok: false, error: "Empresa nao selecionada." };
  try {
    const response = await fetch("/api/category-mapping/sync-omie", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    });
    const raw = await response.text();
    const payload = raw
      ? (JSON.parse(raw) as { ok?: boolean; count?: number; error?: string })
      : null;
    if (!response.ok || !payload?.ok) {
      return {
        ok: false,
        error: payload?.error ?? "Falha ao sincronizar categorias da Omie.",
      };
    }
    return { ok: true, count: payload.count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro de rede." };
  }
}
