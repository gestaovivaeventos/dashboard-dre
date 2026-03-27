"use client";

import { FormEvent, useMemo, useState } from "react";
import { Check, KeyRound, Loader2, MailPlus, Pencil, ShieldX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { UserRole } from "@/lib/supabase/types";

interface CompanyItem {
  id: string;
  name: string;
  segment_id: string | null;
}

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  company_id: string | null;
  company_name: string | null;
  active: boolean;
  segment_names?: string[];
  company_names?: string[];
}

interface SegmentItem {
  id: string;
  name: string;
}

interface UsersAdminManagerProps {
  initialUsers: UserItem[];
  companies: CompanyItem[];
  segments?: SegmentItem[];
}

export function UsersAdminManager({ initialUsers, companies, segments = [] }: UsersAdminManagerProps) {
  const [users, setUsers] = useState(initialUsers);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [selectedSegments, setSelectedSegments] = useState<string[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
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

  /** Companies grouped by segment for the permission UI */
  const companiesBySegment = useMemo(() => {
    const map = new Map<string, CompanyItem[]>();
    for (const seg of segments) {
      map.set(seg.id, companies.filter((c) => c.segment_id === seg.id));
    }
    return map;
  }, [companies, segments]);

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

    // Save segment access
    await fetch("/api/segments/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: selectedEditUser.id,
        segmentIds: selectedSegments,
      }),
    });

    // Save company access
    await fetch("/api/segments/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: selectedEditUser.id,
        companyIds: selectedCompanies,
      }),
    });

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

  const approve = async (userId: string) => {
    setLoading(true);
    setMessage(null);
    const response = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "Falha ao aprovar usuario.");
      setLoading(false);
      return;
    }
    await refresh();
    setLoading(false);
    setMessage("Usuario aprovado com sucesso.");
  };

  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resetPasswordUserId) return;
    setLoading(true);
    setMessage(null);
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: resetPasswordUserId, newPassword }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "Falha ao redefinir senha.");
      setLoading(false);
      return;
    }
    setResetPasswordUserId(null);
    setNewPassword("");
    setLoading(false);
    setMessage("Senha redefinida com sucesso.");
  };

  const startEdit = async (user: UserItem) => {
    setEditUserId(user.id);
    setForm({
      email: user.email,
      name: user.name ?? "",
      role: user.role,
      company_id: user.company_id ?? "",
    });
    // Load segment + company access in parallel
    try {
      const [segRes, compRes] = await Promise.all([
        fetch(`/api/segments/access?userId=${user.id}`),
        fetch(`/api/segments/companies?userId=${user.id}`),
      ]);
      const segPayload = (await segRes.json()) as { segmentIds?: string[] };
      const compPayload = (await compRes.json()) as { companyIds?: string[] };
      setSelectedSegments(segPayload.segmentIds ?? []);
      setSelectedCompanies(compPayload.companyIds ?? []);
    } catch {
      setSelectedSegments([]);
      setSelectedCompanies([]);
    }
  };

  const toggleSegment = (segmentId: string) => {
    setSelectedSegments((prev) => {
      if (prev.includes(segmentId)) {
        // Remove segment and all its companies
        const segCompanyIds = (companiesBySegment.get(segmentId) ?? []).map((c) => c.id);
        setSelectedCompanies((prevComp) => prevComp.filter((id) => !segCompanyIds.includes(id)));
        return prev.filter((id) => id !== segmentId);
      }
      return [...prev, segmentId];
    });
  };

  const toggleCompany = (companyId: string) => {
    setSelectedCompanies((prev) =>
      prev.includes(companyId) ? prev.filter((id) => id !== companyId) : [...prev, companyId],
    );
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
          <div className="grid grid-cols-[1fr_1.3fr_110px_1fr_1fr_80px_1fr] gap-2 rounded-md border bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-600">
            <span>Nome</span><span>E-mail</span><span>Perfil</span><span>Segmentos</span><span>Unidades</span><span>Status</span><span>Acoes</span>
          </div>

          {users.map((user) => (
            <div key={user.id} className="grid grid-cols-[1fr_1.3fr_110px_1fr_1fr_80px_1fr] items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <span>{user.name || "-"}</span>
              <span className="truncate">{user.email}</span>
              <span>{user.role}</span>
              <span className="text-xs text-muted-foreground">
                {user.role === "admin" ? "Todos" : (user.segment_names?.length ? user.segment_names.join(", ") : "-")}
              </span>
              <span className="text-xs text-muted-foreground">
                {user.role === "admin" ? "Todas" : (user.company_names?.length ? user.company_names.join(", ") : "-")}
              </span>
              <span className={user.active ? "text-green-700" : "text-amber-600 font-medium"}>{user.active ? "Ativo" : "Pendente"}</span>
              <div className="flex flex-wrap gap-1">
                {!user.active ? (
                  <Button type="button" size="sm" variant="default" onClick={() => void approve(user.id)} disabled={loading}>
                    <Check className="mr-1 h-3 w-3" />
                    Aprovar
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="outline" onClick={() => void startEdit(user)}>
                  <Pencil className="mr-1 h-3 w-3" />
                  Editar
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setResetPasswordUserId(user.id); setNewPassword(""); }}>
                  <KeyRound className="mr-1 h-3 w-3" />
                  Senha
                </Button>
                {user.active ? (
                  <Button type="button" size="sm" variant="destructive" onClick={() => void deactivate(user.id)} disabled={loading}>
                    <ShieldX className="mr-1 h-3 w-3" />
                    Desativar
                  </Button>
                ) : null}
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

      {/* Invite modal */}
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
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancelar</Button>
                  <Button type="submit" disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Salvar</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Edit modal */}
      {selectedEditUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader><CardTitle>Editar Usuario</CardTitle></CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={saveEdit}>
                <Input placeholder="E-mail" type="email" value={form.email} disabled />
                <Input placeholder="Nome" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} required />
                <select value={form.role} onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as UserRole }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="admin">admin</option>
                  <option value="gestor_hero">gestor_hero</option>
                  <option value="gestor_unidade">gestor_unidade</option>
                </select>

                {/* Segment + Company permissions (non-admin only) */}
                {segments.length > 0 && form.role !== "admin" ? (
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold">Permissoes por Segmento e Unidade</legend>
                    {segments.map((seg) => {
                      const segChecked = selectedSegments.includes(seg.id);
                      const segCompanies = companiesBySegment.get(seg.id) ?? [];

                      return (
                        <div key={seg.id} className="rounded-md border p-3 space-y-2">
                          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                            <input
                              type="checkbox"
                              checked={segChecked}
                              onChange={() => toggleSegment(seg.id)}
                              className="rounded"
                            />
                            {seg.name}
                          </label>

                          {segChecked && segCompanies.length > 0 ? (
                            <div className="ml-6 grid grid-cols-2 gap-1">
                              {segCompanies.map((comp) => (
                                <label key={comp.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm cursor-pointer hover:bg-accent">
                                  <input
                                    type="checkbox"
                                    checked={selectedCompanies.includes(comp.id)}
                                    onChange={() => toggleCompany(comp.id)}
                                    className="rounded"
                                  />
                                  {comp.name}
                                </label>
                              ))}
                            </div>
                          ) : null}

                          {segChecked && segCompanies.length === 0 ? (
                            <p className="ml-6 text-xs text-muted-foreground">Nenhuma empresa cadastrada neste segmento.</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </fieldset>
                ) : null}

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setEditUserId(null)}>Cancelar</Button>
                  <Button type="submit" disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Salvar</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Reset password modal */}
      {resetPasswordUserId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Redefinir Senha</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                {users.find((u) => u.id === resetPasswordUserId)?.email}
              </p>
              <form className="space-y-3" onSubmit={resetPassword}>
                <Input
                  type="password"
                  placeholder="Nova senha (min. 6 caracteres)"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  minLength={6}
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setResetPasswordUserId(null)}>Cancelar</Button>
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
