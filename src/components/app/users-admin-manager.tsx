"use client";

import { FormEvent, useMemo, useState } from "react";
import { Check, KeyRound, Loader2, MailPlus, Pencil, RefreshCw, ShieldX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UserRole } from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Role label map
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  gestor_hero: "Gestor Hero",
  gestor_unidade: "Gestor Unidade",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UsersAdminManager({ initialUsers, companies, segments = [] }: UsersAdminManagerProps) {
  const [users, setUsers] = useState(initialUsers);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Modal states
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  // Permissions
  const [selectedSegments, setSelectedSegments] = useState<string[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);

  // Form
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

  const companiesBySegment = useMemo(() => {
    const map = new Map<string, CompanyItem[]>();
    for (const seg of segments) {
      map.set(seg.id, companies.filter((c) => c.segment_id === seg.id));
    }
    return map;
  }, [companies, segments]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const showMessage = (text: string, type: "success" | "error" = "success") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/users", { cache: "no-store" });
      const payload = (await response.json()) as { users?: UserItem[]; error?: string };
      if (response.ok && payload.users) {
        setUsers(payload.users);
      } else {
        showMessage(payload.error ?? "Falha ao carregar usuarios.", "error");
      }
    } catch {
      showMessage("Erro de conexao ao carregar usuarios.", "error");
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Invite
  // ---------------------------------------------------------------------------

  const inviteUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
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
        showMessage(payload.error ?? "Falha ao convidar usuario.", "error");
        return;
      }
      setInviteOpen(false);
      setForm({ email: "", name: "", role: "gestor_unidade", company_id: "" });
      showMessage("Convite enviado com sucesso.");
      await refresh();
    } catch {
      showMessage("Erro de conexao ao convidar usuario.", "error");
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Edit
  // ---------------------------------------------------------------------------

  const startEdit = async (user: UserItem) => {
    setEditUserId(user.id);
    setForm({
      email: user.email,
      name: user.name ?? "",
      role: user.role,
      company_id: user.company_id ?? "",
    });
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

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedEditUser) return;
    setSaving(true);
    try {
      // For gestor_unidade, use the first selected company as the primary company_id
      const effectiveCompanyId =
        form.role === "gestor_unidade"
          ? form.company_id || selectedCompanies[0] || null
          : null;

      const response = await fetch(`/api/users/${selectedEditUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          role: form.role,
          company_id: effectiveCompanyId,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        showMessage(payload.error ?? "Falha ao salvar usuario.", "error");
        return;
      }

      // Save segment + company access (best-effort, don't block close)
      await Promise.allSettled([
        fetch("/api/segments/access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: selectedEditUser.id, segmentIds: selectedSegments }),
        }),
        fetch("/api/segments/companies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: selectedEditUser.id, companyIds: selectedCompanies }),
        }),
      ]);

      setEditUserId(null);
      showMessage("Usuario atualizado.");
      await refresh();
    } catch {
      showMessage("Erro de conexao ao salvar usuario.", "error");
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Other actions
  // ---------------------------------------------------------------------------

  const deactivate = async (userId: string) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        showMessage(payload.error ?? "Falha ao desativar usuario.", "error");
        return;
      }
      showMessage("Usuario desativado.");
      await refresh();
    } catch {
      showMessage("Erro de conexao.", "error");
    } finally {
      setSaving(false);
    }
  };

  const approve = async (userId: string) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        showMessage(payload.error ?? "Falha ao aprovar usuario.", "error");
        return;
      }
      showMessage("Usuario aprovado com sucesso.");
      await refresh();
    } catch {
      showMessage("Erro de conexao.", "error");
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resetPasswordUserId) return;
    setSaving(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: resetPasswordUserId, newPassword }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        showMessage(payload.error ?? "Falha ao redefinir senha.", "error");
        return;
      }
      setResetPasswordUserId(null);
      setNewPassword("");
      showMessage("Senha redefinida com sucesso.");
    } catch {
      showMessage("Erro de conexao.", "error");
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Segment / company toggles
  // ---------------------------------------------------------------------------

  const toggleSegment = (segmentId: string) => {
    setSelectedSegments((prev) => {
      if (prev.includes(segmentId)) {
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Usuarios</h2>
          <p className="text-sm text-muted-foreground">Gerencie acessos e permissoes do sistema.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button type="button" size="sm" onClick={() => setInviteOpen(true)}>
            <MailPlus className="mr-2 h-3.5 w-3.5" />
            Convidar
          </Button>
        </div>
      </div>

      {/* Toast message */}
      {message ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.type === "error"
              ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
              : "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {/* User table */}
      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuario</TableHead>
              <TableHead className="hidden sm:table-cell">Perfil</TableHead>
              <TableHead className="hidden md:table-cell">Segmentos</TableHead>
              <TableHead className="hidden lg:table-cell">Unidades</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Acoes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div>
                    <p className="font-medium">{user.name || "—"}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                    {ROLE_LABELS[user.role]}
                  </Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <span className="text-xs text-muted-foreground">
                    {user.role === "admin"
                      ? "Todos"
                      : user.segment_names?.length
                        ? user.segment_names.join(", ")
                        : "—"}
                  </span>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <span className="text-xs text-muted-foreground">
                    {user.role === "admin"
                      ? "Todas"
                      : user.company_names?.length
                        ? user.company_names.join(", ")
                        : "—"}
                  </span>
                </TableCell>
                <TableCell>
                  {user.active ? (
                    <Badge variant="outline" className="border-green-300 text-green-700 dark:border-green-800 dark:text-green-400">
                      Ativo
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400">
                      Pendente
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {!user.active ? (
                      <Button type="button" size="sm" variant="default" onClick={() => void approve(user.id)} disabled={saving}>
                        <Check className="mr-1 h-3 w-3" />
                        Aprovar
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="ghost" onClick={() => void startEdit(user)} title="Editar">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setResetPasswordUserId(user.id); setNewPassword(""); }} title="Redefinir senha">
                      <KeyRound className="h-3.5 w-3.5" />
                    </Button>
                    {user.active ? (
                      <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void deactivate(user.id)} disabled={saving} title="Desativar">
                        <ShieldX className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}

            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  Nenhum usuario cadastrado.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Invite dialog                                                       */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Convidar Usuario</DialogTitle>
            <DialogDescription>Um convite sera enviado por e-mail.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={inviteUser}>
            <div className="space-y-2">
              <Label htmlFor="invite-email">E-mail</Label>
              <Input id="invite-email" type="email" placeholder="usuario@empresa.com" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-name">Nome</Label>
              <Input id="invite-name" placeholder="Nome completo" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label>Perfil</Label>
              <Select value={form.role} onValueChange={(v) => setForm((p) => ({ ...p, role: v as UserRole }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="gestor_hero">Gestor Hero</SelectItem>
                  <SelectItem value="gestor_unidade">Gestor Unidade</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Enviar convite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* Edit dialog                                                         */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={!!selectedEditUser} onOpenChange={(open) => { if (!open) setEditUserId(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Usuario</DialogTitle>
            <DialogDescription>{selectedEditUser?.email}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={saveEdit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Nome</Label>
                <Input id="edit-name" placeholder="Nome completo" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label>Perfil</Label>
                <Select value={form.role} onValueChange={(v) => setForm((p) => ({ ...p, role: v as UserRole }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="gestor_hero">Gestor Hero</SelectItem>
                    <SelectItem value="gestor_unidade">Gestor Unidade</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Segment + Company permissions */}
            {segments.length > 0 && form.role !== "admin" ? (
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Permissoes por Segmento e Unidade</Label>
                <div className="space-y-2">
                  {segments.map((seg) => {
                    const segChecked = selectedSegments.includes(seg.id);
                    const segCompanies = companiesBySegment.get(seg.id) ?? [];

                    return (
                      <div key={seg.id} className="rounded-lg border p-3 space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                          <input
                            type="checkbox"
                            checked={segChecked}
                            onChange={() => toggleSegment(seg.id)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          {seg.name}
                        </label>

                        {segChecked && segCompanies.length > 0 ? (
                          <div className="ml-6 grid grid-cols-2 gap-1">
                            {segCompanies.map((comp) => (
                              <label key={comp.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent transition-colors">
                                <input
                                  type="checkbox"
                                  checked={selectedCompanies.includes(comp.id)}
                                  onChange={() => toggleCompany(comp.id)}
                                  className="h-4 w-4 rounded border-gray-300"
                                />
                                {comp.name}
                              </label>
                            ))}
                          </div>
                        ) : null}

                        {segChecked && segCompanies.length === 0 ? (
                          <p className="ml-6 text-xs text-muted-foreground">Nenhuma empresa neste segmento.</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditUserId(null)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* Reset password dialog                                               */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={!!resetPasswordUserId} onOpenChange={(open) => { if (!open) { setResetPasswordUserId(null); setNewPassword(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Redefinir Senha</DialogTitle>
            <DialogDescription>
              {users.find((u) => u.id === resetPasswordUserId)?.email}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={resetPassword}>
            <div className="space-y-2">
              <Label htmlFor="new-password">Nova senha</Label>
              <Input
                id="new-password"
                type="password"
                placeholder="Min. 6 caracteres"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResetPasswordUserId(null)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
