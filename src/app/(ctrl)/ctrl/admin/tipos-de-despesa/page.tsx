import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getCadastros } from "@/lib/ctrl/actions/cadastros";
import { CadastroManager } from "@/components/ctrl/cadastro-manager";

export const dynamic = "force-dynamic";

export default async function TiposDeDespesaPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (!hasCtrlRole(ctx, "admin")) {
    redirect("/ctrl/requisicoes");
  }

  const { items = [], error } = await getCadastros("expense_type");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tipos de Despesa</h1>
        <p className="text-muted-foreground">
          Tipos de despesa usados nas requisições e no orçamento. Crie, renomeie, inative ou mescle
          tipos preservando o histórico. Tipos ausentes na planilha de orçamento são inativados
          automaticamente no upload.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <CadastroManager
          entity="expense_type"
          items={items}
          labels={{ singular: "tipo de despesa", plural: "tipos de despesa" }}
        />
      )}
    </div>
  );
}
