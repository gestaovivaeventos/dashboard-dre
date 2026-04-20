import { CheckSquare } from "lucide-react";

import { getCtrlUser } from "@/lib/ctrl/auth";
import { getRequests } from "@/lib/ctrl/actions/requests";
import { redirect } from "next/navigation";

export default async function AprovacoesPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  const { requests, error } = await getRequests({ status: "pendente" });
  const pending = requests ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Aprovações</h1>
        <p className="text-muted-foreground">
          {pending.length} requisição(ões) aguardando aprovação
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !pending.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <CheckSquare className="mb-4 h-12 w-12 text-muted-foreground/40" />
          <h3 className="font-semibold">Nenhuma aprovação pendente</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Todas as requisições foram processadas.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border divide-y">
          {pending.map((req) => (
            <div key={req.id} className="flex items-center justify-between p-4">
              <div className="space-y-0.5">
                <p className="font-medium">
                  #{req.request_number} — {req.title}
                </p>
                <p className="text-sm text-muted-foreground">
                  {new Intl.NumberFormat("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  }).format(req.amount)}
                  {" · "}
                  {new Date(req.created_at).toLocaleDateString("pt-BR")}
                </p>
              </div>
              <div className="flex gap-2">
                <form action={async () => {
                  "use server";
                  const { updateRequestStatus } = await import("@/lib/ctrl/actions/requests");
                  await updateRequestStatus(req.id, "aprovado");
                }}>
                  <button
                    type="submit"
                    className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 transition-colors"
                  >
                    Aprovar
                  </button>
                </form>
                <form action={async () => {
                  "use server";
                  const { updateRequestStatus } = await import("@/lib/ctrl/actions/requests");
                  await updateRequestStatus(req.id, "rejeitado");
                }}>
                  <button
                    type="submit"
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                  >
                    Rejeitar
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
