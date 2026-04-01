"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader2, Trash2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Contact {
  id: string;
  company_id: string;
  name: string;
  email: string;
  role_label: string | null;
}

interface ContactsManagerProps {
  companyId: string;
  companyName: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContactsManager({ companyId, companyName }: ContactsManagerProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ name: "", email: "", role_label: "" });

  // Load contacts on mount and when companyId changes
  useEffect(() => {
    if (!companyId) return;
    void loadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const loadContacts = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/intelligence/contacts?companyId=${encodeURIComponent(companyId)}`);
      const payload = (await response.json()) as { contacts?: Contact[]; error?: string };
      if (response.ok && payload.contacts) {
        setContacts(payload.contacts);
      } else {
        setError(payload.error ?? "Falha ao carregar contatos.");
      }
    } catch {
      setError("Erro de conexao ao carregar contatos.");
    } finally {
      setLoading(false);
    }
  };

  const addContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/intelligence/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          name: form.name,
          email: form.email,
          role_label: form.role_label || null,
        }),
      });
      const payload = (await response.json()) as { contact?: Contact; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Falha ao adicionar contato.");
        return;
      }
      setDialogOpen(false);
      setForm({ name: "", email: "", role_label: "" });
      await loadContacts();
    } catch {
      setError("Erro de conexao ao adicionar contato.");
    } finally {
      setSaving(false);
    }
  };

  const deleteContact = async (id: string) => {
    setDeleting(id);
    setError(null);
    try {
      const response = await fetch(`/api/intelligence/contacts/${id}`, { method: "DELETE" });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Falha ao remover contato.");
        return;
      }
      setContacts((prev) => prev.filter((c) => c.id !== id));
    } catch {
      setError("Erro de conexao ao remover contato.");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">
          Contatos para envio — {companyName}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDialogOpen(true)}
        >
          <UserPlus className="mr-1.5 h-3.5 w-3.5" />
          Adicionar
        </Button>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Carregando contatos...
        </div>
      ) : contacts.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">
          Nenhum contato cadastrado para esta empresa.
        </p>
      ) : (
        <ul className="divide-y rounded border bg-background text-sm">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex items-center justify-between px-3 py-2">
              <div>
                <span className="font-medium">{contact.name}</span>
                <span className="ml-2 text-muted-foreground">{contact.email}</span>
                {contact.role_label ? (
                  <span className="ml-2 text-xs text-muted-foreground">({contact.role_label})</span>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => void deleteContact(contact.id)}
                disabled={deleting === contact.id}
                title="Remover contato"
              >
                {deleting === contact.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Add contact dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar Contato</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={addContact}>
            <div className="space-y-2">
              <Label htmlFor="contact-name">Nome</Label>
              <Input
                id="contact-name"
                placeholder="Nome completo"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-email">E-mail</Label>
              <Input
                id="contact-email"
                type="email"
                placeholder="contato@empresa.com"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-role">Cargo (opcional)</Label>
              <Input
                id="contact-role"
                placeholder="Ex.: Diretor Financeiro"
                value={form.role_label}
                onChange={(e) => setForm((p) => ({ ...p, role_label: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Adicionar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
