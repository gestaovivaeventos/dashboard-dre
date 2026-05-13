import { redirect } from "next/navigation";

import { readActiveSegmentSlug } from "@/lib/context/active-context";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesRedirect() {
  const slug = await readActiveSegmentSlug();
  redirect(slug ? `/s/${slug}/configuracoes` : "/home");
}
