import { redirect } from "next/navigation";

import { CaixaRealClient } from "@/components/caixa/caixa-real-client";
import { getCaixaUser } from "@/lib/caixa/auth";
import { listCaixaAccounts, lastCaixaUpdate } from "@/lib/caixa/queries";
import { todayBR } from "@/lib/ctrl/datetime";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function CaixaRealPage() {
  const user = await getCaixaUser();
  if (!user) redirect("/");

  // ── Por que service role, e não o client do usuário ──────────────────────
  // A listagem faz embed de `companies(name)`, e `companies` tem RLS por
  // vínculo em `user_company_access`. Um usuário com o módulo Caixa mas sem
  // vínculo nenhum veria os nomes vazios (ou perderia linhas no join), o que
  // contradiz a regra do módulo: quem tem Caixa vê TODAS as empresas, sem
  // recorte. Mesmo enquadramento das páginas /contratos, cujas policies também
  // não conhecem o módulo que passou a dar acesso a elas.
  //
  // O gate é o `getCaixaUser()` acima. As policies de caixa_* continuam
  // valendo para qualquer leitura feita com o client do usuário — são a
  // segunda linha de defesa, não a única.
  const db = createAdminClient();
  const [rows, lastUpdate] = await Promise.all([
    listCaixaAccounts(db),
    lastCaixaUpdate(db),
  ]);

  return <CaixaRealClient rows={rows} today={todayBR()} lastUpdate={lastUpdate} />;
}
