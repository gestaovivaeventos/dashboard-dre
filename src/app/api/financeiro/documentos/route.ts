import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { resolveAllowedCompanyIds } from "@/lib/dashboard/dre";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// /api/financeiro/documentos
//
// GET    ?companyId=<id>  → lista os documentos anexos da empresa.
// POST   (multipart)      → upload de um documento (admin apenas).
// DELETE ?id=<id>         → exclui um documento (admin apenas).
//
// Regras de seguranca (validadas SEMPRE no backend, nao so no front):
//   - Pre-requisito: acesso ao modulo Financeiro (can_financeiro).
//   - Autorizacao por empresa via resolveAllowedCompanyIds: admin ve todas;
//     demais perfis (ex.: franqueado) apenas as de user_company_access.
//   - Documentos de uma empresa nunca sao retornados na consulta de outra:
//     toda query/insert e amarrada ao company_id.
//   - Upload e exclusao exigem perfil admin.
// ============================================================================

const BUCKET = "company-documents";

// Limite de 25 MB por arquivo (relatorios/planilhas costumam ser pequenos).
const MAX_FILE_SIZE = 25 * 1024 * 1024;

// Tipos aceitos. Validamos por extensao (o MIME pode vir vazio em alguns
// navegadores) e tambem pelo content-type quando disponivel.
const ALLOWED_EXTENSIONS = new Set(["pdf", "xls", "xlsx", "csv"]);
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);

interface DocumentRow {
  id: string;
  company_id: string;
  file_name: string;
  file_type: string | null;
  storage_path: string;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// ─── GET: lista documentos da empresa ──────────────────────────────────────
export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile.can_financeiro) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const companyId = new URL(request.url).searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId obrigatorio." }, { status: 400 });
  }

  const allowed = await resolveAllowedCompanyIds(supabase, profile, [companyId]);
  if (!allowed.includes(companyId)) {
    return NextResponse.json({ error: "Sem acesso a esta empresa." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("company_documents")
    .select(
      "id, company_id, file_name, file_type, storage_path, size_bytes, uploaded_by, uploaded_by_name, created_at",
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const documents = (data as DocumentRow[] | null) ?? [];
  return NextResponse.json({ documents });
}

// ─── POST: upload de documento (admin apenas) ──────────────────────────────
export async function POST(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas administradores podem enviar documentos." },
      { status: 403 },
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Envio invalido." }, { status: 400 });
  }

  const companyId = form.get("companyId");
  const file = form.get("file");

  if (typeof companyId !== "string" || !companyId) {
    return NextResponse.json(
      { error: "Empresa obrigatoria para o upload." },
      { status: 400 },
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo obrigatorio." }, { status: 400 });
  }

  // Vinculo obrigatorio: a empresa precisa existir.
  const admin = createAdminClient();
  const { data: company } = await admin
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle<{ id: string }>();
  if (!company) {
    return NextResponse.json({ error: "Empresa nao encontrada." }, { status: 404 });
  }

  // Validacao de tipo e tamanho.
  const ext = extensionOf(file.name);
  const mime = file.type || "";
  if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_MIME.has(mime)) {
    return NextResponse.json(
      { error: "Tipo nao permitido. Envie PDF ou planilha Excel (.xls/.xlsx/.csv)." },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "Arquivo excede o limite de 25 MB." },
      { status: 400 },
    );
  }

  // Caminho do objeto namespaced por empresa — garante separacao fisica.
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const storagePath = `${companyId}/${Date.now()}-${safeName}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, Buffer.from(arrayBuffer), {
      contentType: mime || "application/octet-stream",
      upsert: false,
    });
  if (upErr) {
    return NextResponse.json(
      { error: `Falha ao armazenar o arquivo: ${upErr.message}` },
      { status: 400 },
    );
  }

  const { data: inserted, error: insErr } = await admin
    .from("company_documents")
    .insert({
      company_id: companyId,
      file_name: file.name,
      file_type: mime || ext || null,
      storage_path: storagePath,
      size_bytes: file.size,
      uploaded_by: user.id,
      uploaded_by_name: profile.name ?? profile.email ?? null,
    })
    .select(
      "id, company_id, file_name, file_type, storage_path, size_bytes, uploaded_by, uploaded_by_name, created_at",
    )
    .single();

  if (insErr) {
    // Best-effort: remove o objeto orfao se o insert falhou.
    await admin.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json({ error: insErr.message }, { status: 400 });
  }

  return NextResponse.json({ document: inserted }, { status: 201 });
}

// ─── DELETE: exclui documento (admin apenas) ───────────────────────────────
export async function DELETE(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas administradores podem excluir documentos." },
      { status: 403 },
    );
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id obrigatorio." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("company_documents")
    .select("id, storage_path")
    .eq("id", id)
    .maybeSingle<{ id: string; storage_path: string }>();

  if (!doc) {
    return NextResponse.json({ error: "Documento nao encontrado." }, { status: 404 });
  }

  await admin.storage.from(BUCKET).remove([doc.storage_path]);

  const { error } = await admin.from("company_documents").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
