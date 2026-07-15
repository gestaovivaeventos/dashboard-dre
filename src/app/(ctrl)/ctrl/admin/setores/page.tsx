import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getCadastros } from "@/lib/ctrl/actions/cadastros";
import { CadastroManager } from "@/components/ctrl/cadastro-manager";

export const dynamic = "force-dynamic";

export default async function SetoresPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (!hasCtrlRole(ctx, "admin")) {
    redirect("/ctrl/requisicoes");
  }

  const { items = [], error } = await getCadastros("sector");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Setores</h1>
        <p className="text-muted-foreground">
          Setores organizacionais para categorização de requisições. Renomeie, inative ou mescle
          setores preservando o histórico.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <CadastroManager
          entity="sector"
          items={items}
          labels={{ singular: "setor", plural: "setores" }}
        />
      )}
    </div>
  );
}
