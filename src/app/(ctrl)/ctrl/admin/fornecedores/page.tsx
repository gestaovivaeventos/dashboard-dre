import { Truck } from "lucide-react";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getSuppliers } from "@/lib/ctrl/actions/suppliers";
import { redirect } from "next/navigation";

export default async function FornecedoresPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (!hasCtrlRole(ctx, "csc", "admin", "aprovacao_fornecedor")) {
    redirect("/ctrl/requisicoes");
  }

  const { suppliers, error } = await getSuppliers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Fornecedores</h1>
        <p className="text-muted-foreground">
          Gestão de fornecedores aprovados para pagamento
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !suppliers?.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Truck className="mb-4 h-12 w-12 text-muted-foreground/40" />
          <h3 className="font-semibold">Nenhum fornecedor cadastrado</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Adicione fornecedores para habilitar requisições de pagamento.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">CNPJ/CPF</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Criado em</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">{s.cnpj_cpf ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(s.created_at).toLocaleDateString("pt-BR")}
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
    aprovado: { label: "Aprovado", className: "bg-green-100 text-green-800" },
    rejeitado: { label: "Rejeitado", className: "bg-red-100 text-red-800" },
    pendente: { label: "Pendente", className: "bg-yellow-100 text-yellow-800" },
  };
  const config = map[status] ?? { label: status, className: "bg-gray-100 text-gray-800" };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${config.className}`}>
      {config.label}
    </span>
  );
}
