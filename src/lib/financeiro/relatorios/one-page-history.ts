import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// Helper compartilhado: grava o relatorio gerado na tabela `ai_reports` com
// type="one-page", escopado pelo `created_by`. Cada usuario so consegue
// listar/baixar os relatorios que ele mesmo gerou (filtragem aplicada nas
// rotas GET — ver one-page/history/route.ts).
//
// IMPORTANTE: usa `createAdminClient()` (service role) para o INSERT. A
// tabela `ai_reports` tem RLS habilitado e o client da sessao do usuario
// nao tem permissao de escrita direta. Mesmo padrao da rota legada
// `/api/intelligence/generate` que ja gravava nessa tabela.
//
// Best-effort: falha aqui NAO derruba a resposta principal — apenas loga e
// segue. O usuario recebe o relatorio normalmente; apenas perde o registro
// no historico.
// ============================================================================

export interface SaveOnePageHistoryArgs {
  userId: string;
  companyId: string;
  dateFrom: string;
  dateTo: string;
  // Payload completo da resposta (analysis + input + kpis + ...) — exatamente
  // o que o mapper consome para renderizar o componente visual. Permite
  // reidratar o relatorio futuro sem precisar regerar via IA.
  contentJson: Record<string, unknown>;
}

export async function saveOnePageHistory({
  userId,
  companyId,
  dateFrom,
  dateTo,
  contentJson,
}: SaveOnePageHistoryArgs): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("ai_reports").insert({
    type: "one-page",
    company_ids: [companyId],
    period_from: dateFrom,
    period_to: dateTo,
    content_json: contentJson,
    // `content_html` e NOT NULL na tabela (legado da rota /api/intelligence/
    // generate que produzia email HTML). One Page nao gera HTML — o visual e
    // renderizado client-side via React. Gravamos string vazia para
    // satisfazer a constraint sem armazenar markup falso.
    content_html: "",
    status: "saved",
    created_by: userId,
  });
  if (error) {
    // Loga mas nao throw — historico nao deve impedir o usuario de ver o
    // relatorio que ele acabou de gerar.
    // eslint-disable-next-line no-console
    console.error("[one-page] Falha ao salvar no historico:", error.message);
  }
}
