import { Building2 } from "lucide-react";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getSectors } from "@/lib/ctrl/actions/sectors";
import { redirect } from "next/navigation";

export default async function SetoresPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (!hasCtrlRole(ctx, "csc", "admin")) {
    redirect("/ctrl/requisicoes");
  }

  const { sectors, error } = await getSectors();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Setores</h1>
        <p className="text-muted-foreground">
          Setores organizacionais para categorização de requisições
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !sectors?.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Building2 className="mb-4 h-12 w-12 text-muted-foreground/40" />
          <h3 className="font-semibold">Nenhum setor cadastrado</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Cadastre setores para organizar as requisições de pagamento.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border divide-y">
          {sectors.map((sector) => (
            <div key={sector.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="font-medium">{sector.name}</p>
              </div>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                sector.active
                  ? "bg-green-100 text-green-800"
                  : "bg-gray-100 text-gray-500"
              }`}>
                {sector.active ? "Ativo" : "Inativo"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
