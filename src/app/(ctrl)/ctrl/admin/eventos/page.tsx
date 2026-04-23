import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { createClient } from "@/lib/supabase/server";
import { createEvent, toggleEventActive } from "@/lib/ctrl/actions/events";
import { EventosClient } from "@/components/ctrl/eventos-client";

async function getEvents() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ctrl_events")
    .select("id, name, description, is_active, created_at")
    .order("name");
  if (error) return { error: error.message };
  return { events: data ?? [] };
}

export default async function EventosPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (!hasCtrlRole(ctx, "csc", "admin")) {
    redirect("/ctrl/requisicoes");
  }

  const { events = [], error } = await getEvents();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Eventos</h1>
        <p className="text-muted-foreground">Gerencie eventos vinculados a requisições</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <EventosClient events={events} createEvent={createEvent} toggleActive={toggleEventActive} />
    </div>
  );
}
