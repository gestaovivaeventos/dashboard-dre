"use client";

import { useState, useTransition } from "react";
import { Calendar } from "lucide-react";

type Ev = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
};

interface Props {
  events: Ev[];
  createEvent: (formData: FormData) => Promise<{ error?: string } | undefined>;
  toggleActive: (id: string, isActive: boolean) => Promise<{ error?: string } | undefined>;
}

export function EventosClient({ events, createEvent, toggleActive }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createEvent(formData);
      if (res?.error) setFeedback(res.error);
      else { setShowForm(false); setFeedback(null); (e.target as HTMLFormElement).reset(); }
    });
  }

  function handleToggle(id: string, isActive: boolean) {
    startTransition(async () => {
      const res = await toggleActive(id, isActive);
      if (res?.error) setFeedback(res.error);
    });
  }

  return (
    <div className="space-y-4">
      {feedback && (
        <div className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">{feedback}</div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
        >
          {showForm ? "Cancelar" : "+ Novo Evento"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <h3 className="text-sm font-semibold">Novo Evento</h3>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nome <span className="text-destructive">*</span></label>
            <input
              name="name"
              type="text"
              required
              placeholder="Ex: Festa Junina 2026"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Descrição</label>
            <textarea
              name="description"
              rows={2}
              placeholder="Descrição opcional..."
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {isPending ? "Criando..." : "Criar Evento"}
            </button>
          </div>
        </form>
      )}

      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Calendar className="mb-4 h-12 w-12 text-muted-foreground/40" />
          <h3 className="font-semibold">Nenhum evento cadastrado</h3>
          <p className="mt-1 text-sm text-muted-foreground">Crie eventos para vincular a requisições.</p>
        </div>
      ) : (
        <div className="rounded-lg border divide-y">
          {events.map((ev) => (
            <div key={ev.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{ev.name}</span>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${ev.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                    {ev.is_active ? "Ativo" : "Inativo"}
                  </span>
                </div>
                {ev.description && <p className="text-xs text-muted-foreground mt-0.5">{ev.description}</p>}
                <p className="text-xs text-muted-foreground mt-0.5">
                  Criado em {new Date(ev.created_at).toLocaleDateString("pt-BR")}
                </p>
              </div>
              <button
                onClick={() => handleToggle(ev.id, ev.is_active)}
                disabled={isPending}
                className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                  ev.is_active ? "hover:bg-red-50 hover:text-red-700 hover:border-red-300" : "hover:bg-green-50 hover:text-green-700 hover:border-green-300"
                }`}
              >
                {ev.is_active ? "Desativar" : "Ativar"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
