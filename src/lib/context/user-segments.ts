import type { SupabaseClient } from "@supabase/supabase-js";
import type { Segment } from "@/lib/supabase/types";

/**
 * Resolve os segmentos que o usuário pode ver, na MESMA ordem de prioridade do
 * layout (app):
 *   1. admin → todos os segmentos ativos
 *   2. UNIÃO de user_segment_access (acesso explícito por segmento) com os
 *      segmentos derivados das empresas em user_company_access.
 *
 * A união (não fallback) é essencial: um usuário pode ter 1 acesso explícito
 * por segmento (ex.: Dataforte) E várias empresas em OUTROS segmentos via
 * user_company_access. Tratar as empresas como fallback "só quando não há
 * segment_access" escondia todos os demais segmentos — o seletor da DRE ficava
 * preso no único segmento explícito. Alinha com `resolveSegment` (segments/
 * resolve.ts), que já libera o segmento por qualquer uma das duas fontes.
 *
 * Também cobre o caso de acesso só por EMPRESA (sem segment_access): sem os
 * segmentos derivados, `segments = []` → `segmentId` nulo → a página carrega
 * TODAS as empresas e a agregação estoura o `statement_timeout`.
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

  // Fonte 1: acesso explícito por segmento.
  const { data } = await supabase
    .from("user_segment_access")
    .select("segments(id,name,slug,display_order,active)")
    .eq("user_id", opts.userId);

  const explicitSegments = ((data ?? []) as unknown as Array<{ segments: Segment }>)
    .map((row) => row.segments)
    .filter((s): s is Segment => Boolean(s && s.active));

  // Fonte 2: segmentos derivados das empresas em user_company_access.
  const companyDerivedSegments: Segment[] = [];
  if (opts.companyIds.length > 0) {
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
        .eq("active", true);
      companyDerivedSegments.push(...((segData as Segment[]) ?? []));
    }
  }

  // UNIÃO das duas fontes, deduplicada por id e ordenada por display_order.
  const byId = new Map<string, Segment>();
  for (const s of [...explicitSegments, ...companyDerivedSegments]) {
    if (s && s.active) byId.set(s.id, s);
  }

  return Array.from(byId.values()).sort((a, b) => a.display_order - b.display_order);
}
