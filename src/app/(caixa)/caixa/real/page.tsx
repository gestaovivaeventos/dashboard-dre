import { redirect } from "next/navigation";

import { CaixaRealClient } from "@/components/caixa/caixa-real-client";
import { getCaixaUser } from "@/lib/caixa/auth";
import {
  getCaixaRealPrefs,
  getCaixaSyncAlert,
  listCaixaAccounts,
  lastCaixaUpdate,
} from "@/lib/caixa/queries";
import { listCaixaCompanyRefs } from "@/lib/caixa/sync";
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
  const [rows, lastUpdate, companies, syncAlert, savedPrefs] = await Promise.all([
    // Traz também as encerradas na Omie: a coluna Status as identifica e o
    // filtro da tela já abre em "Ativa". O histórico de saldo delas é fato e
    // some da vista se a consulta as descartar aqui.
    listCaixaAccounts(db, { includeInactive: true }),
    lastCaixaUpdate(db),
    // Lista do seletor de escopo das ações. Vem daqui, e não das linhas, para
    // que uma empresa com credencial e ainda sem nenhuma conta sincronizada
    // apareça — é justamente ela que precisa do "Sincronizar contas".
    listCaixaCompanyRefs(db),
    getCaixaSyncAlert(db),
    // Filtros que ESTE usuário deixou da última vez (user_preferences).
    getCaixaRealPrefs(db, user.id),
  ]);

  return (
    <CaixaRealClient
      rows={rows}
      companies={companies}
      today={todayBR()}
      lastUpdate={lastUpdate}
      syncAlert={syncAlert}
      savedPrefs={savedPrefs}
    />
  );
}
