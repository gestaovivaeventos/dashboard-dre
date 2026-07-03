import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptSecret } from "@/lib/security/encryption";
import { CASE_COMPANY_ID } from "@/lib/case/constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

export interface OmieCreds {
  appKey: string;
  appSecret: string;
}

/**
 * Credenciais Omie (descriptografadas) da empresa Case Shows. Retorna null se a
 * empresa não tiver credenciais configuradas — o chamador decide como tratar.
 */
export async function getCaseOmieCreds(db: DB): Promise<OmieCreds | null> {
  const { data: company } = await db
    .from("companies")
    .select("omie_app_key, omie_app_secret")
    .eq("id", CASE_COMPANY_ID)
    .single();
  if (!company?.omie_app_key || !company?.omie_app_secret) return null;
  try {
    return {
      appKey: decryptSecret(company.omie_app_key),
      appSecret: decryptSecret(company.omie_app_secret),
    };
  } catch {
    return null;
  }
}
