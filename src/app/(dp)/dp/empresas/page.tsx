import { redirect } from "next/navigation";

import { DpEmpresasClient } from "@/components/dp/empresas-client";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { getDpUser } from "@/lib/dp/auth";
import { origensParaMapear } from "@/lib/dp/empresa";
import { DpNaoInstaladoError, listDpColaboradores, listDpCompanies, listDpRegras } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function DpEmpresasPage() {
  const user = await getDpUser();
  if (!user) redirect("/");
  const db = createAdminClient();
  let loaded;
  try {
    loaded = await Promise.all([listDpColaboradores(db), listDpRegras(db), listDpCompanies(db)]);
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado />;
    throw error;
  }
  const [rows, regras, companies] = loaded;
  const origens = origensParaMapear(rows, regras);
  const semNada = rows.filter((r) => r.ativo && r.empresa.companyId === null && r.unidadeId === null && r.departamentoId === null);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Empresas (de-para da Sólides)</h1>
        <p className="text-sm text-ink-muted">
          A Sólides identifica a empresa pela unidade (razão social), que não coincide com os nomes do Control Hub.
          Defina uma vez por unidade; vale para todos os colaboradores dela.
        </p>
      </div>
      <DpEmpresasClient origens={origens} companies={companies} />
      {semNada.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-ink-primary">
            Sem unidade e sem departamento na Sólides
            <span className="ml-2 text-sm font-normal text-amber-700 dark:text-amber-400">{semNada.length}</span>
          </h2>
          <p className="text-sm text-ink-muted">
            Não há o que mapear aqui: o cadastro precisa ser completado na Sólides.
          </p>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {semNada.map((r) => (
              <li key={r.id} className="text-ink-primary">
                {r.nome}
                {r.cargoNome ? <span className="text-ink-muted"> · {r.cargoNome}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
