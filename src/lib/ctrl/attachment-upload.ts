"use client";

import { createClient as createSupabaseClient } from "@/lib/supabase/client";

/** Limite por arquivo. Vale para anexos de requisição e de fornecedor. */
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB

/** Bucket único dos anexos do módulo Compras. */
export const ATTACHMENT_BUCKET = "ctrl-attachments";

/**
 * Sobe um arquivo para o bucket de anexos e devolve o object path.
 *
 * O path começa sempre pelo id do usuário — é o que as policies do bucket
 * usam para autorizar a escrita. A leitura é feita por URL assinada gerada no
 * servidor (service role), então quem tem visibilidade da requisição/do
 * fornecedor consegue abrir o anexo de outra pessoa.
 */
export async function uploadCtrlAttachment(file: File): Promise<string> {
  const supabase = createSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Sessão expirada — refaça o login.");
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const objectPath = `${userId}/${Date.now()}-${safeName}`;
  const { error: upErr } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(objectPath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) throw upErr;
  return objectPath;
}
