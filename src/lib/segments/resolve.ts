import { createClient } from "@/lib/supabase/server";
import type { Segment, UserProfile } from "@/lib/supabase/types";

/**
 * Resolves a segment by slug and checks if the user has access.
 * Returns the segment or null if not found / not authorized.
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

  // Check user_segment_access
  const { data: access } = await supabase
    .from("user_segment_access")
    .select("id")
    .eq("user_id", profile.id)
    .eq("segment_id", segment.id)
    .maybeSingle<{ id: string }>();

  return access ? segment : null;
}
