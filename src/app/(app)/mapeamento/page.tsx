import { redirect } from "next/navigation";

import { readActiveSegmentSlug } from "@/lib/context/active-context";

export const dynamic = "force-dynamic";

export default async function MapeamentoRedirect() {
  const slug = await readActiveSegmentSlug();
  redirect(slug ? `/s/${slug}/mapeamento` : "/home");
}
