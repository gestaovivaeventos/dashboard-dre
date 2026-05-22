import { createClient } from "@/lib/supabase/server";
import type { Segment, UserProfile } from "@/lib/supabase/types";

/**
 * Resolves a segment by slug and checks if the user has access.
 * Returns the segment or null if not found / not authorized.
 *
 * Access via duas fontes (ambas valem):
 *   1) user_segment_access — vinculo explícito (gestor_unidade legado)
 *   2) user_company_access — se o user tem QUALQUER empresa nesse segmento,
 *      ele pode ver o segmento (franqueado, novos perfis com vinculo
 *      apenas por unidade)
 */
export async function resolveSegment(
  slug: string,
  profile: UserProfile | null,
): Promise<Segment | null> {
  if (!profile) return null;

  const supabase = await createClient();
  const { data: segment } = await supabase
    .from("segments")
    .select("id,name,slug,display_order,active")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle<Segment>();

  if (!segment) return null;

  // Admin has access to all segments
  if (profile.role === "admin") return segment;

  // Source 1: explicit segment access
  const { data: segAccess } = await supabase
    .from("user_segment_access")
    .select("id")
    .eq("user_id", profile.id)
    .eq("segment_id", segment.id)
    .maybeSingle<{ id: string }>();

  if (segAccess) return segment;

  // Source 2: implicit via company assignments. Se o user tem alguma das
  // empresas do segmento em user_company_access, libera o segmento.
  if (profile.company_ids && profile.company_ids.length > 0) {
    const { data: companies } = await supabase
      .from("companies")
      .select("id")
      .eq("segment_id", segment.id)
      .in("id", profile.company_ids)
      .limit(1);
    if (companies && companies.length > 0) return segment;
  }

  return null;
}
