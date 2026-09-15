import { getSupportAdmins, getTickets } from "@/lib/support/actions";
import { ChamadosClient } from "@/components/app/chamados-client";
import type { SupportAdmin } from "@/lib/support/types";

export default async function ChamadosPage() {
  const res = await getTickets();
  // Admins precisam da lista de responsáveis (dropdown + filtro).
  let admins: SupportAdmin[] = [];
  if ("ok" in res && res.isAdmin) {
    const a = await getSupportAdmins();
    if ("ok" in a) admins = a.admins;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Chamados</h1>
        <p className="text-muted-foreground">
          Abra chamados de melhoria ou bug do sistema. Você acompanha os seus; a
          equipe cuida a partir daqui.
        </p>
      </div>

      {"error" in res ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {res.error}
        </p>
      ) : (
        <ChamadosClient initialTickets={res.tickets} isAdmin={res.isAdmin} admins={admins} />
      )}
    </div>
  );
}
