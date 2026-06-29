"use client";

import {
  Check,
  CheckCircle2,
  Loader2,
  MailPlus,
  Pencil,
  ShieldX,
  X,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

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

// ─── Types ──────────────────────────────────────────────────────────────────

type Profile =
  | "admin"
  | "contas_a_pagar"
  | "gerente"
  | "diretor"
  | "validador_contrato"
  | "solicitante"
  | "franqueado";

interface UserItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  profile: string;
  can_financeiro: boolean;
  can_compras: boolean;
  active: boolean;
  company_ids: string[];
  sector_ids: string[];
}

interface SimpleOption {
  id: string;
  name: string;
}

interface Props {
  initialUsers: UserItem[];
  companies: SimpleOption[];
  sectors: SimpleOption[];
}

const PROFILES: Array<{
  value: Profile;
  label: string;
  description: string;
}> = [
  {
    value: "admin",
    label: "Admin",
    description: "Apaga, edita e vê tudo. Vê todas as unidades automaticamente.",
  },
  {
    value: "contas_a_pagar",
    label: "Contas a Pagar",
    description: "Aprova requisições em Contas a Pagar e fornecedores.",
  },
  {
    value: "gerente",
    label: "Gerente",
    description: "Aprova requisições dos setores vinculados.",
  },
  {
    value: "diretor",
    label: "Diretor",
    description: "Aprova qualquer requisição (sem filtro de setor).",
  },
  {
    value: "validador_contrato",
    label: "Validador de Contrato",
    description: "Acesso isolado ao módulo de Validação de Contratos.",
  },
  {
    value: "solicitante",
    label: "Solicitante",
    description: "Cria requisições nos setores vinculados.",
  },
  {
    value: "franqueado",
    label: "Visão Financeira",
    description:
      "Visão restrita ao Financeiro (Dashboard, Fluxo de Caixa, Budget, KPIs, BI) das unidades atribuídas.",
  },
];

const PROFILE_LABEL: Record<string, string> = Object.fromEntries(
  PROFILES.map((p) => [p.value, p.label]),
);

const PROFILE_BADGE_CLASS: Record<string, string> = {
  admin: "bg-violet-100 text-violet-800 border-transparent",
  contas_a_pagar: "bg-sky-100 text-sky-800 border-transparent",
  gerente: "bg-blue-100 text-blue-800 border-transparent",
  diretor: "bg-emerald-100 text-emerald-800 border-transparent",
  validador_contrato: "bg-orange-100 text-orange-800 border-transparent",
  solicitante: "bg-slate-100 text-slate-800 border-transparent",
  franqueado: "bg-amber-100 text-amber-800 border-transparent",
};

// Whether the profile needs sector assignments
function profileNeedsSectors(p: Profile): boolean {
  return p === "gerente" || p === "solicitante";
}

// ─── Form state ─────────────────────────────────────────────────────────────

interface FormState {
  email: string;
  name: string;
  phone: string;
  position: string;
  profile: Profile;
  can_financeiro: boolean;
  can_compras: boolean;
  sector_ids: string[];
  company_ids: string[];
}

const emptyForm: FormState = {
  email: "",
  name: "",
  phone: "",
  position: "",
  profile: "solicitante",
  can_financeiro: true,
  can_compras: true,
  sector_ids: [],
  company_ids: [],
};

function userToForm(u: UserItem): FormState {
  return {
    email: u.email,
    name: u.name,
    phone: u.phone ?? "",
    position: u.position ?? "",
    profile: (u.profile as Profile) ?? "solicitante",
    can_financeiro: u.can_financeiro,
    can_compras: u.can_compras,
    sector_ids: [...u.sector_ids],
    company_ids: [...u.company_ids],
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function UsersAdminManager({ initialUsers, companies, sectors }: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const companyById = useMemo(
    () => new Map(companies.map((c) => [c.id, c.name])),
    [companies],
  );
  const sectorById = useMemo(() => new Map(sectors.map((s) => [s.id, s.name])), [sectors]);

  // Ordem alfabetica (pt-BR, ignora caixa/acentos), por nome ou e-mail quando
  // sem nome. Cobre o load inicial e os refetches apos convite/edicao.
  const sortedUsers = useMemo(
    () =>
      [...users].sort((a, b) =>
        (a.name?.trim() || a.email).localeCompare(b.name?.trim() || b.email, "pt-BR", {
          sensitivity: "base",
        }),
      ),
    [users],
  );

  function openInvite() {
    setForm(emptyForm);
    setError(null);
    setInviteOpen(true);
  }

  function openEdit(u: UserItem) {
    setForm(userToForm(u));
    setError(null);
    setEditing(u);
  }

  function closeAll() {
    if (loading) return;
    setInviteOpen(false);
    setEditing(null);
    setError(null);
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Validador de contrato: força sem módulos/setores/unidades
      if (key === "profile" && value === "validador_contrato") {
        next.can_financeiro = false;
        next.can_compras = false;
        next.sector_ids = [];
        next.company_ids = [];
      }
      // Admin: força módulos visíveis = true (atalho de UX)
      if (key === "profile" && value === "admin") {
        next.can_financeiro = true;
        next.can_compras = true;
        next.company_ids = []; // admin vê tudo, não precisa restringir
      }
      // Franqueado: só Financeiro, sem setores. Unidades obrigatórias.
      if (key === "profile" && value === "franqueado") {
        next.can_financeiro = true;
        next.can_compras = false;
        next.sector_ids = [];
      }
      // Sem Financeiro → limpa unidades
      if (key === "can_financeiro" && value === false) {
        next.company_ids = [];
      }
      return next;
    });
  }

  function toggleSector(id: string) {
    setForm((prev) => ({
      ...prev,
      sector_ids: prev.sector_ids.includes(id)
        ? prev.sector_ids.filter((s) => s !== id)
        : [...prev.sector_ids, id],
    }));
  }

  function toggleCompany(id: string) {
    setForm((prev) => ({
      ...prev,
      company_ids: prev.company_ids.includes(id)
        ? prev.company_ids.filter((c) => c !== id)
        : [...prev.company_ids, id],
    }));
  }

  async function refresh() {
    const res = await fetch("/api/users");
    if (!res.ok) return;
    const payload = (await res.json()) as {
      users: Array<{
        id: string;
        email: string;
        name: string;
        phone: string | null;
        position: string | null;
        profile: string;
        can_financeiro: boolean;
        can_compras: boolean;
        active: boolean;
        sectors: Array<{ id: string; name: string }>;
        companies: Array<{ id: string; name: string }>;
      }>;
    };
    setUsers(
      payload.users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        phone: u.phone ?? "",
        position: u.position ?? "",
        profile: u.profile,
        can_financeiro: u.can_financeiro,
        can_compras: u.can_compras,
        active: u.active,
        sector_ids: u.sectors.map((s) => s.id),
        company_ids: u.companies.map((c) => c.id),
      })),
    );
  }

  function validateForm(includesEmail: boolean): string | null {
    if (includesEmail && !form.email.trim()) return "Informe o e-mail.";
    if (!form.name.trim()) return "Informe o nome.";
    if (form.profile === "validador_contrato") {
      // Tudo OK — sem módulos/setores/unidades é o esperado
      return null;
    }
    if (!form.can_financeiro && !form.can_compras && form.profile !== "admin") {
      return "Marque ao menos um módulo (Financeiro ou Compras).";
    }
    if (profileNeedsSectors(form.profile) && form.sector_ids.length === 0) {
      return "Gerente e Solicitante precisam de pelo menos um setor.";
    }
    if (form.can_financeiro && form.profile !== "admin" && form.company_ids.length === 0) {
      return "Selecione pelo menos uma unidade pra acesso ao Financeiro.";
    }
    return null;
  }

  async function handleInviteSubmit(e: FormEvent) {
    e.preventDefault();
    const v = validateForm(true);
    if (v) {
      setError(v);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch("/api/users/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.email.trim(),
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        position: form.position.trim() || null,
        profile: form.profile,
        can_financeiro: form.can_financeiro,
        can_compras: form.can_compras,
        sector_ids: form.sector_ids,
        company_ids: form.company_ids,
      }),
    });
    setLoading(false);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(payload?.error ?? "Falha ao enviar convite.");
      return;
    }
    setInviteOpen(false);
    await refresh();
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const v = validateForm(false);
    if (v) {
      setError(v);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/users/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        position: form.position.trim() || null,
        profile: form.profile,
        can_financeiro: form.can_financeiro,
        can_compras: form.can_compras,
        sector_ids: form.sector_ids,
        company_ids: form.company_ids,
      }),
    });
    setLoading(false);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(payload?.error ?? "Falha ao salvar.");
      return;
    }
    setEditing(null);
    await refresh();
  }

  async function toggleActive(u: UserItem) {
    await fetch(`/api/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !u.active }),
    });
    await refresh();
  }

  async function deactivate(u: UserItem) {
    if (!confirm(`Desativar ${u.email}?`)) return;
    await fetch(`/api/users/${u.id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Usuários</h2>
          <p className="text-sm text-muted-foreground">
            Gerencie perfis, módulos visíveis, setores e unidades.
          </p>
        </div>
        <Button onClick={openInvite}>
          <MailPlus className="mr-2 h-4 w-4" />
          Convidar usuário
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome / Cargo</TableHead>
            <TableHead>Contato</TableHead>
            <TableHead>Perfil</TableHead>
            <TableHead>Módulos</TableHead>
            <TableHead>Setores</TableHead>
            <TableHead>Unidades</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedUsers.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                <div className="font-medium">{u.name || "—"}</div>
                {u.position && (
                  <div className="text-xs text-muted-foreground">{u.position}</div>
                )}
              </TableCell>
              <TableCell className="text-xs">
                <div className="text-muted-foreground">{u.email}</div>
                {u.phone && <div className="text-muted-foreground">{u.phone}</div>}
              </TableCell>
              <TableCell>
                <Badge className={PROFILE_BADGE_CLASS[u.profile] ?? "bg-slate-100 text-slate-800"}>
                  {PROFILE_LABEL[u.profile] ?? u.profile}
                </Badge>
              </TableCell>
              <TableCell className="text-xs">
                {u.profile === "validador_contrato"
                  ? "(isolado)"
                  : u.profile === "admin"
                  ? "Todos"
                  : [u.can_financeiro && "Financeiro", u.can_compras && "Compras"]
                      .filter(Boolean)
                      .join(", ") || "—"}
              </TableCell>
              <TableCell className="max-w-[180px] text-xs">
                {u.sector_ids.length === 0
                  ? "—"
                  : u.sector_ids
                      .map((id) => sectorById.get(id))
                      .filter(Boolean)
                      .join(", ")}
              </TableCell>
              <TableCell className="max-w-[180px] text-xs">
                {u.profile === "admin"
                  ? "Todas"
                  : u.company_ids.length === 0
                  ? "—"
                  : u.company_ids
                      .map((id) => companyById.get(id))
                      .filter(Boolean)
                      .join(", ")}
              </TableCell>
              <TableCell>
                <Badge
                  variant={u.active ? "default" : "outline"}
                  className={u.active ? "bg-emerald-500 text-white border-transparent" : ""}
                >
                  {u.active ? "Ativo" : "Inativo"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="inline-flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(u)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(u)}>
                    {u.active ? <ShieldX className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {users.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                Nenhum usuário cadastrado.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={(o) => !o && closeAll()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Convidar usuário</DialogTitle>
            <DialogDescription>
              Um convite por e-mail é enviado. O usuário define a senha no primeiro acesso.
            </DialogDescription>
          </DialogHeader>
          <UserForm
            form={form}
            error={error}
            includesEmail
            companies={companies}
            sectors={sectors}
            onChange={updateField}
            onToggleSector={toggleSector}
            onToggleCompany={toggleCompany}
            onSubmit={handleInviteSubmit}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInviteOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" form="user-form" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Enviar convite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && closeAll()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar usuário</DialogTitle>
            <DialogDescription>
              {editing?.email}
              {" — "}
              alterar perfil/módulos não envia novo convite, só atualiza o acesso.
            </DialogDescription>
          </DialogHeader>
          <UserForm
            form={form}
            error={error}
            includesEmail={false}
            companies={companies}
            sectors={sectors}
            onChange={updateField}
            onToggleSector={toggleSector}
            onToggleCompany={toggleCompany}
            onSubmit={handleEditSubmit}
          />
          <DialogFooter className="justify-between">
            {editing && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                onClick={() => editing && deactivate(editing)}
                disabled={loading}
              >
                Desativar
              </Button>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={loading}>
                Cancelar
              </Button>
              <Button type="submit" form="user-form" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Salvar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Inner form ─────────────────────────────────────────────────────────────

function UserForm({
  form,
  error,
  includesEmail,
  companies,
  sectors,
  onChange,
  onToggleSector,
  onToggleCompany,
  onSubmit,
}: {
  form: FormState;
  error: string | null;
  includesEmail: boolean;
  companies: SimpleOption[];
  sectors: SimpleOption[];
  onChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onToggleSector: (id: string) => void;
  onToggleCompany: (id: string) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const showSectors = profileNeedsSectors(form.profile);
  const showCompanies =
    form.can_financeiro && form.profile !== "admin" && form.profile !== "validador_contrato";
  const isValidator = form.profile === "validador_contrato";

  const profileDescription = useMemo(
    () => PROFILES.find((p) => p.value === form.profile)?.description ?? "",
    [form.profile],
  );

  return (
    <form id="user-form" onSubmit={onSubmit} className="space-y-4">
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {includesEmail && (
          <div className="space-y-1.5">
            <Label htmlFor="user-email">
              E-mail <span className="text-destructive">*</span>
            </Label>
            <Input
              id="user-email"
              type="email"
              required
              value={form.email}
              onChange={(e) => onChange("email", e.target.value)}
              placeholder="usuario@empresa.com"
            />
          </div>
        )}
        <div className={`space-y-1.5 ${includesEmail ? "" : "sm:col-span-2"}`}>
          <Label htmlFor="user-name">
            Nome completo <span className="text-destructive">*</span>
          </Label>
          <Input
            id="user-name"
            type="text"
            required
            value={form.name}
            onChange={(e) => onChange("name", e.target.value)}
            placeholder="Ex: Maria da Silva"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="user-position">Cargo</Label>
          <Input
            id="user-position"
            type="text"
            value={form.position}
            onChange={(e) => onChange("position", e.target.value)}
            placeholder="Ex: Gerente Comercial"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="user-phone">Telefone</Label>
          <Input
            id="user-phone"
            type="tel"
            value={form.phone}
            onChange={(e) => onChange("phone", e.target.value)}
            placeholder="(11) 99999-9999"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>
          Perfil <span className="text-destructive">*</span>
        </Label>
        <Select value={form.profile} onValueChange={(v) => onChange("profile", v as Profile)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROFILES.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{profileDescription}</p>
      </div>

      {!isValidator && form.profile !== "admin" && form.profile !== "franqueado" && (
        <div className="space-y-1.5">
          <Label>Módulos visíveis</Label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onChange("can_financeiro", !form.can_financeiro)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                form.can_financeiro
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-muted"
              }`}
            >
              {form.can_financeiro ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
              Financeiro
            </button>
            <button
              type="button"
              onClick={() => onChange("can_compras", !form.can_compras)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                form.can_compras
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-muted"
              }`}
            >
              {form.can_compras ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
              Compras
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Plataforma (Conexões, Usuários, Inteligência) é automática pra admin.
          </p>
        </div>
      )}

      {showSectors && (
        <div className="space-y-1.5">
          <Label>
            Setores <span className="text-destructive">*</span>
          </Label>
          <PillMultiSelect
            options={sectors}
            selected={form.sector_ids}
            onToggle={onToggleSector}
            emptyMessage="Nenhum setor cadastrado."
          />
        </div>
      )}

      {showCompanies && (
        <div className="space-y-1.5">
          <Label>
            Unidades (acesso ao Financeiro) <span className="text-destructive">*</span>
          </Label>
          <PillMultiSelect
            options={companies}
            selected={form.company_ids}
            onToggle={onToggleCompany}
            emptyMessage="Nenhuma empresa cadastrada."
          />
        </div>
      )}

      {form.profile === "admin" && (
        <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">
          Admin vê <strong>todas as unidades</strong> e tem acesso ao módulo Plataforma
          (Conexões, Usuários, Inteligência) automaticamente.
        </p>
      )}
      {isValidator && (
        <p className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800 dark:border-orange-900/40 dark:bg-orange-950/30 dark:text-orange-300">
          Validador de Contrato é um perfil <strong>isolado</strong>: só enxerga a tela de
          Validação de Contratos. Sem setores ou unidades.
        </p>
      )}
      {form.profile === "franqueado" && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
          O perfil Visão Financeira vê <strong>apenas</strong> o Financeiro das unidades selecionadas:
          Dashboard, Fluxo de Caixa, Budget e Forecast, KPIs e Business Intelligence.
          Sem acesso a Compras, Conexões, Mapeamento, Configurações ou Plataforma.
        </p>
      )}
    </form>
  );
}

function PillMultiSelect({
  options,
  selected,
  onToggle,
  emptyMessage,
}: {
  options: SimpleOption[];
  selected: string[];
  onToggle: (id: string) => void;
  emptyMessage: string;
}) {
  if (options.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = selected.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onToggle(opt.id)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? "border-primary bg-primary/10 text-primary"
                : "hover:bg-muted"
            }`}
          >
            {active && <Check className="h-3 w-3" />}
            {opt.name}
          </button>
        );
      })}
    </div>
  );
}
