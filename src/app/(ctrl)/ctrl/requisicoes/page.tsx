import { FileText, Plus } from "lucide-react";

import { getCtrlUser } from "@/lib/ctrl/auth";
import { getRequests } from "@/lib/ctrl/actions/requests";
import { redirect } from "next/navigation";

export default async function RequisicoesPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  const { requests, error } = await getRequests();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Requisições</h1>
          <p className="text-muted-foreground">
            {ctx.ctrlRole === "solicitante"
              ? "Suas requisições de pagamento"
              : "Todas as requisições"}
          </p>
        </div>
        <a
          href="/ctrl/requisicoes/nova"
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="mr-2 h-4 w-4" />
          Nova Requisição
        </a>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !requests?.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <FileText className="mb-4 h-12 w-12 text-muted-foreground/40" />
          <h3 className="font-semibold">Nenhuma requisição</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie sua primeira requisição de pagamento.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Título</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Criado em</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-muted-foreground">
                    #{req.request_number}
                  </td>
                  <td className="px-4 py-3 font-medium">{req.title}</td>
                  <td className="px-4 py-3">
                    {new Intl.NumberFormat("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    }).format(req.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={req.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(req.created_at).toLocaleDateString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pendente:                    { label: "Pendente",            className: "bg-yellow-100 text-yellow-800" },
    aprovado:                    { label: "Aprovado",            className: "bg-green-100 text-green-800" },
    rejeitado:                   { label: "Rejeitado",           className: "bg-red-100 text-red-800" },
    aguardando_complementacao:   { label: "Complementação",      className: "bg-blue-100 text-blue-800" },
    estornado:                   { label: "Estornado",           className: "bg-gray-100 text-gray-800" },
    agendado:                    { label: "Agendado",            className: "bg-purple-100 text-purple-800" },
    travado:                     { label: "Travado",             className: "bg-orange-100 text-orange-800" },
    inativado_csc:               { label: "Inativado",           className: "bg-gray-100 text-gray-500" },
    aguardando_aprovacao_fornecedor: { label: "Aguard. Fornec.", className: "bg-indigo-100 text-indigo-800" },
  };
  const config = map[status] ?? { label: status, className: "bg-gray-100 text-gray-800" };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${config.className}`}>
      {config.label}
    </span>
  );
}
