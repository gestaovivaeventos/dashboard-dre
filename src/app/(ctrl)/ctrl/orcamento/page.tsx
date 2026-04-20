import { DollarSign } from "lucide-react";

import { getCtrlUser } from "@/lib/ctrl/auth";
import { redirect } from "next/navigation";

export default async function OrcamentoPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  const allowedRoles = ["gerente", "diretor", "csc", "admin"] as const;
  if (!allowedRoles.includes(ctx.ctrlRole as typeof allowedRoles[number])) {
    redirect("/ctrl/requisicoes");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Orçamento</h1>
        <p className="text-muted-foreground">
          Controle orçamentário por setor e categoria de despesa
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <DollarSign className="mb-4 h-12 w-12 text-muted-foreground/40" />
        <h3 className="font-semibold">Em desenvolvimento</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          O módulo de orçamento estará disponível em breve.
        </p>
      </div>
    </div>
  );
}
