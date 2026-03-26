"use client";

import { FormEvent, useMemo, useState } from "react";
import { Loader2, MailPlus, Pencil, ShieldX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { UserRole } from "@/lib/supabase/types";

interface CompanyItem {
  id: string;
  name: string;
}

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  company_id: string | null;
  company_name: string | null;
  active: boolean;
}

interface UsersAdminManagerProps {
  initialUsers: UserItem[];
  companies: CompanyItem[];
}

export function UsersAdminManager({ initialUsers, companies }: UsersAdminManagerProps) {
  const [users, setUsers] = useState(initialUsers);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: "",
    name: "",
    role: "gestor_unidade" as UserRole,
    company_id: "",
  });

  const selectedEditUser = useMemo(
    () => users.find((user) => user.id === editUserId) ?? null,
    [editUserId, users],
  );

  const refresh = async () => {
    setLoading(true);
    const response = await fetch("/api/users", { cache: "no-store" });
    const payload = (await response.json()) as { users?: UserItem[]; error?: string };
    if (!response.ok || !payload.users) {
      setMessage(payload.error ?? "Falha ao carregar usuarios.");
      setLoading(false);
      return;
    }
    setUsers(payload.users);
    setLoading(false);
  };

  const inviteUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    const response = await fetch("/api/users/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.email,
        name: form.name,
        role: form.role,
        company_id: form.role === "gestor_unidade" ? form.company_id || null : null,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "Falha ao convidar usuario.");
      setLoading(false);
      return;
    }
    setInviteOpen(false);
    setForm({ email: "", name: "", role: "gestor_unidade", company_id: "" });
    await refresh();
    setLoading(false);
    setMessage("Convite enviado com sucesso.");
  };

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedEditUser) return;
    setLoading(true);
    const response = await fetch(`/api/users/${selectedEditUser.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        role: form.role,
        company_id: form.role === "gestor_unidade" ? form.company_id || null : null,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "Falha ao salvar usuario.");
      setLoading(false);
      return;
    }
    setEditUserId(null);
    await refresh();
    setLoading(false);
    setMessage("Usuario atualizado.");
  };

  const deactivate = async (userId: string) => {
    setLoading(true);
    const response = await fetch(`/api/users/${userId}`, { method: "DELETE" });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "Falha ao desativar usuario.");
      setLoading(false);
      return;
    }
    await refresh();
    setLoading(false);
    setMessage("Usuario desativado.");
  };

  const startEdit = (user: UserItem) => {
    setEditUserId(user.id);
    setForm({
      email: user.email,
      name: user.name ?? "",
      role: user.role,
      company_id: user.company_id ?? "",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Usuarios</h2>
        <Button type="button" onClick={() => setInviteOpen(true)}>
          <MailPlus className="mr-2 h-4 w-4" />
          Convidar Usuario
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gestao de Acesso</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-[1.3fr_1.7fr_140px_1.5fr_90px_220px] gap-2 rounded-md border bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-600">
            <span>Nome</span><span>E-mail</span><span>Perfil</span><span>Unidade Vinculada</span><span>Status</span><span>Acoes</span>
          </div>

          {users.map((user) => (
            <div key={user.id} className="grid grid-cols-[1.3fr_1.7fr_140px_1.5fr_90px_220px] items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <span>{user.name || "-"}</span>
              <span>{user.email}</span>
              <span>{user.role}</span>
              <span>{user.company_name || "-"}</span>
              <span className={user.active ? "text-green-700" : "text-red-700"}>{user.active ? "Ativo" : "Inativo"}</span>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => startEdit(user)}>
                  <Pencil className="mr-2 h-3 w-3" />
                  Editar
                </Button>
                <Button type="button" size="sm" variant="destructive" onClick={() => void deactivate(user.id)} disabled={!user.active}>
                  <ShieldX className="mr-2 h-3 w-3" />
                  Desativar
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button type="button" variant="outline" onClick={() => void refresh()} disabled={loading}>
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Atualizar
      </Button>

      {message ? <p className="rounded-md border bg-background px-3 py-2 text-sm">{message}</p> : null}

      {inviteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-xl">
            <CardHeader><CardTitle>Convidar Usuario</CardTitle></CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={inviteUser}>
                <Input placeholder="E-mail" type="email" value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} required />
                <Input placeholder="Nome" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} required />
                <select value={form.role} onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as UserRole }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="admin">admin</option>
                  <option value="gestor_hero">gestor_hero</option>
                  <option value="gestor_unidade">gestor_unidade</option>
                </select>
                {form.role === "gestor_unidade" ? (
                  <select value={form.company_id} onChange={(event) => setForm((prev) => ({ ...prev, company_id: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" required>
                    <option value="">Selecione a unidade</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>{company.name}</option>
                    ))}
                  </select>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancelar</Button>
                  <Button type="submit" disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Salvar</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {selectedEditUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-xl">
            <CardHeader><CardTitle>Editar Usuario</CardTitle></CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={saveEdit}>
                <Input placeholder="E-mail" type="email" value={form.email} disabled />
                <Input placeholder="Nome" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} required />
                <select value={form.role} onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as UserRole }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="admin">admin</option>
                  <option value="gestor_hero">gestor_hero</option>
                  <option value="gestor_unidade">gestor_unidade</option>
                </select>
                {form.role === "gestor_unidade" ? (
                  <select value={form.company_id} onChange={(event) => setForm((prev) => ({ ...prev, company_id: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" required>
                    <option value="">Selecione a unidade</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>{company.name}</option>
                    ))}
                  </select>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setEditUserId(null)}>Cancelar</Button>
                  <Button type="submit" disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Salvar</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
