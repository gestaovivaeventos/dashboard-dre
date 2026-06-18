import type { SupabaseClient } from "@supabase/supabase-js";
import type { Segment } from "@/lib/supabase/types";

/**
 * Resolve os segmentos que o usuário pode ver, na MESMA ordem de prioridade do
 * layout (app):
 *   1. admin → todos os segmentos ativos
 *   2. user_segment_access (acesso explícito por segmento)
 *   3. fallback: deriva os segmentos das empresas em user_company_access
 *
 * Sem o passo 3, um usuário com acesso só por EMPRESA (sem segment_access) fica
 * com `segments = []` nas telas DRE → `segmentId` nulo → a página carrega TODAS
 * as empresas e a agregação estoura o `statement_timeout` (8s do role
 * authenticated, agravado pelo overhead de RLS por linha). Admin nunca cai nisso
 * porque sempre tem um segmento default. Este helper alinha as páginas ao
 * comportamento do layout.
 */
export async function resolveUserSegments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  opts: { isAdmin: boolean; userId: string | null; companyIds: string[] },
): Promise<Segment[]> {
  if (opts.isAdmin) {
    const { data } = await supabase
      .from("segments")
      .select("id,name,slug,display_order,active")
      .eq("active", true)
      .order("display_order");
    return (data as Segment[]) ?? [];
  }

  if (!opts.userId) return [];

  const { data } = await supabase
    .from("user_segment_access")
    .select("segments(id,name,slug,display_order,active)")
    .eq("user_id", opts.userId);

  let segments = ((data ?? []) as unknown as Array<{ segments: Segment }>)
    .map((row) => row.segments)
    .filter((s) => s && s.active)
    .sort((a, b) => a.display_order - b.display_order);

  if (segments.length === 0 && opts.companyIds.length > 0) {
    const { data: companiesData } = await supabase
      .from("companies")
      .select("segment_id")
      .in("id", opts.companyIds)
      .eq("active", true);

    const segmentIds = Array.from(
      new Set(
        ((companiesData ?? []) as Array<{ segment_id: string | null }>)
          .map((c) => c.segment_id)
          .filter((s): s is string => !!s),
      ),
    );

    if (segmentIds.length > 0) {
      const { data: segData } = await supabase
        .from("segments")
        .select("id,name,slug,display_order,active")
        .in("id", segmentIds)
        .eq("active", true)
        .order("display_order");
      segments = (segData as Segment[]) ?? [];
    }
  }

  return segments;
}
