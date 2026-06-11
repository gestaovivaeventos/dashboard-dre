import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { resolveAllowedCompanyIds } from "@/lib/dashboard/dre";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// GET /api/financeiro/documentos/[id]/download
//
// Gera uma URL assinada (bucket privado) para visualizar/baixar o documento e
// redireciona para ela. A autorizacao por empresa e validada no backend antes
// de assinar: o usuario so baixa documento de empresa que pode acessar.
// ============================================================================

const BUCKET = "company-documents";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile.can_financeiro) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("company_documents")
    .select("id, company_id, storage_path, file_name")
    .eq("id", params.id)
    .maybeSingle<{
      id: string;
      company_id: string;
      storage_path: string;
      file_name: string;
    }>();

  if (!doc) {
    return NextResponse.json({ error: "Documento nao encontrado." }, { status: 404 });
  }

  // Autorizacao por empresa: admin ve todas; demais apenas as liberadas.
  const allowed = await resolveAllowedCompanyIds(supabase, profile, [doc.company_id]);
  if (!allowed.includes(doc.company_id)) {
    return NextResponse.json({ error: "Sem acesso a este documento." }, { status: 403 });
  }

  const { data: signed, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, 60 * 5, { download: doc.file_name });

  if (error || !signed?.signedUrl) {
    return NextResponse.json(
      { error: "Nao foi possivel gerar o link do documento." },
      { status: 400 },
    );
  }

  return NextResponse.redirect(signed.signedUrl);
}
