"use client";

import { createClient as createSupabaseClient } from "@/lib/supabase/client";

/** Limite por arquivo dos anexos de chamado. */
export const MAX_SUPPORT_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB

/** Bucket privado dos anexos de chamados. */
export const SUPPORT_ATTACHMENT_BUCKET = "support-attachments";

export interface SupportUpload {
  path: string;
  name: string;
  mime: string;
  size: number;
}

/**
 * Sobe um arquivo para o bucket de anexos de chamados e devolve os metadados.
 *
 * O path começa sempre pelo id do usuário — é o que as policies do bucket usam
 * para autorizar a escrita. A leitura é por URL assinada no servidor (service
 * role), então o admin consegue abrir o anexo de qualquer chamado.
 */
export async function uploadSupportAttachment(file: File): Promise<SupportUpload> {
  const supabase = createSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Sessão expirada — refaça o login.");
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const objectPath = `${userId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(SUPPORT_ATTACHMENT_BUCKET)
    .upload(objectPath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) throw error;
  return {
    path: objectPath,
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
  };
}
