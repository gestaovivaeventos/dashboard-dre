"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  MailPlus,
  Pencil,
  ShieldAlert,
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
import {
  isOrcamentoEligibleProfile,
  type OrcamentoSetoresPorEmpresa,
} from "@/lib/auth/orcamento";
import { CTRL_ORG_ROLE_VALUES, type CtrlOrgRole } from "@/lib/ctrl/roles";
import {
  describeUserExceptions,
  findOrphanExceptionRules,
  NON_USER_RULES,
  type UserException,
} from "@/lib/auth/user-exceptions";

// ─── Types ──────────────────────────────────────────────────────────────────

type Profile =
  | "admin"
  | "contas_a_pagar"
  | "gerente"
  | "gerente_setor"
  | "diretor"
  | "validador_contrato"
  | "solicitante"
  | "franqueado"
  | "csc";

interface UserItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  profile: string;
  can_financeiro: boolean;
  can_compras: boolean;
  can_case: boolean;
  can_viagens: boolean;
  can_viagens_aprovar: boolean;
  can_contratos: boolean;
  can_caixa: boolean;
  can_orcamento: boolean;
  /** Setores do Orçamento POR EMPRESA (empresa → setores do Compras). */
  orcamento_setores: OrcamentoSetoresPorEmpresa;
  active: boolean;
  company_ids: string[];
  sector_ids: string[];
  /** Empresas do COMPRAS (multiempresa) concedidas — ctrl_user_orgs. */
  ctrl_org_ids: string[];
  /**
   * Papel do Compras POR EMPRESA (override de ctrl_user_orgs.role). empresa →
   * papel; AUSÊNCIA = usa o perfil global (comportamento de hoje). Só os 5
   * papéis do Compras, nunca 'admin'. Ver src/lib/ctrl/roles.ts.
   */
  ctrl_org_roles: Record<string, CtrlOrgRole>;
}

interface SimpleOption {
  id: string;
  name: string;
}

/** Setor do Compras com a empresa a que pertence (multiempresa). */
interface CtrlSectorOption extends SimpleOption {
  orgId: string | null;
}

/** Empresa do Compras (a "organização de compras"). */
interface CtrlOrgOption {
  id: string;
  nome: string;
  slug: string;
}

interface Props {
  initialUsers: UserItem[];
  companies: SimpleOption[];
  /** Setores do COMPRAS (`ctrl_sectors`) — alçada, Aprovações, lembrete. Com a empresa. */
  sectors: CtrlSectorOption[];
  /** Empresas do Compras (multiempresa) para conceder acesso por empresa. */
  ctrlOrgs: CtrlOrgOption[];
  /**
   * Setores do ORÇAMENTO por empresa, pelo NOME. Cadastro diferente do de
   * cima: o orçamento tem os próprios setores por empresa × ano, e nem todos
   * existem no Compras — metade desta base está assim.
   */
  orcamentoSetores: Record<string, string[]>;
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
    label: "Gerente Sócio",
    description:
      "Aprova requisições dos setores vinculados. Em Orçamento, vê o detalhamento de todos os setores.",
  },
  {
    value: "gerente_setor",
    label: "Gerente",
    description:
      "Mesmas permissões do Gerente Sócio, mas em Orçamento vê apenas as despesas dos setores vinculados a ele.",
  },
  {
    value: "diretor",
    label: "Diretor",
    description:
      "Aprova requisições. Selecione setores para restringir; sem setor, vê todos.",
  },
  {
    value: "validador_contrato",
    label: "Validador de Contrato",
    description:
      "Acesso isolado à Validação de Contratos. Para liberar a tela sem isolar o usuário, mantenha o perfil dele e marque o módulo Validação de Contratos.",
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
  {
    value: "csc",
    label: "CSC",
    description:
      "Mesmos acessos da Visão Financeira, mais a tela Validação Relatório (aceite dos relatórios BI mensais antes do envio aos gestores).",
  },
];

const PROFILE_LABEL: Record<string, string> = Object.fromEntries(
  PROFILES.map((p) => [p.value, p.label]),
);

const PROFILE_BADGE_CLASS: Record<string, string> = {
  admin: "bg-violet-100 text-violet-800 border-transparent",
  contas_a_pagar: "bg-sky-100 text-sky-800 border-transparent",
  gerente: "bg-blue-100 text-blue-800 border-transparent",
  gerente_setor: "bg-indigo-100 text-indigo-800 border-transparent",
  diretor: "bg-emerald-100 text-emerald-800 border-transparent",
  validador_contrato: "bg-orange-100 text-orange-800 border-transparent",
  solicitante: "bg-slate-100 text-slate-800 border-transparent",
  franqueado: "bg-amber-100 text-amber-800 border-transparent",
  csc: "bg-teal-100 text-teal-800 border-transparent",
};

// Whether the profile REQUIRES at least one sector (blocks save when empty).
// gerente_setor ("Gerente") depende do setor pra filtrar o Orçamento — sem
// setor ele não veria nada.
function profileNeedsSectors(p: Profile): boolean {
  return p === "gerente" || p === "gerente_setor" || p === "solicitante";
}

// Whether the sector picker is shown. Diretor pode selecionar setores
// (opcional): com setores => vê só esses; sem setores => vê todos (fallback
// em getRequests). Gerente/Solicitante são obrigatórios (profileNeedsSectors).
function profileShowsSectors(p: Profile): boolean {
  return profileNeedsSectors(p) || p === "diretor";
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
  can_case: boolean;
  /**
   * Viagens saiu de "Módulos visíveis" (o módulo não está em uso). Os dois
   * campos continuam no formulário só como PASSAGEM: carregam o valor atual do
   * usuário e o devolvem intacto no salvamento, pra que remover o botão não
   * apague o acesso de ninguém.
   */
  can_viagens: boolean;
  can_viagens_aprovar: boolean;
  can_contratos: boolean;
  can_caixa: boolean;
  can_orcamento: boolean;
  /**
   * Setores do Orçamento, POR EMPRESA. Separado de `sector_ids` de propósito:
   * aquele é o recorte do COMPRAS e não tem empresa (ver a migration
   * 20260929120000).
   */
  orcamento_setores: OrcamentoSetoresPorEmpresa;
  sector_ids: string[];
  company_ids: string[];
  /** Empresas do COMPRAS (multiempresa). */
  ctrl_org_ids: string[];
  /** Papel do Compras por empresa (override). Ausência = usa o perfil global. */
  ctrl_org_roles: Record<string, CtrlOrgRole>;
}

const emptyForm: FormState = {
  email: "",
  name: "",
  phone: "",
  position: "",
  profile: "solicitante",
  can_financeiro: true,
  can_compras: true,
  can_case: false,
  can_viagens: false,
  can_viagens_aprovar: false,
  can_contratos: false,
  can_caixa: false,
  can_orcamento: false,
  orcamento_setores: {},
  sector_ids: [],
  company_ids: [],
  ctrl_org_ids: [],
  ctrl_org_roles: {},
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
    can_case: u.can_case,
    can_viagens: u.can_viagens,
    can_viagens_aprovar: u.can_viagens_aprovar,
    can_contratos: u.can_contratos,
    can_caixa: u.can_caixa,
    can_orcamento: u.can_orcamento,
    orcamento_setores: Object.fromEntries(
      Object.entries(u.orcamento_setores ?? {}).map(([c, ids]) => [c, [...ids]]),
    ),
    sector_ids: [...u.sector_ids],
    company_ids: [...u.company_ids],
    ctrl_org_ids: [...(u.ctrl_org_ids ?? [])],
    ctrl_org_roles: { ...(u.ctrl_org_roles ?? {}) },
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function UsersAdminManager({
  initialUsers,
  companies,
  sectors,
  ctrlOrgs,
  orcamentoSetores,
}: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [inviteOpen, setInviteOpen] = useState(false);
  // Diálogo das regras nominais do código. `null` = fechado; string vazia =
  // aberto com todas; um id = aberto destacando aquele usuário.
  const [exceptionsFor, setExceptionsFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Filtros de conferência de permissões (client-side, sobre a lista carregada).
  const [filterName, setFilterName] = useState<string>("");
  const [filterContact, setFilterContact] = useState<string>("");
  const [filterProfile, setFilterProfile] = useState<string>("all");
  const [filterModule, setFilterModule] = useState<string>("all");
  const [filterSector, setFilterSector] = useState<string>("all");
  const [filterCompany, setFilterCompany] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const companyById = useMemo(
    () => new Map(companies.map((c) => [c.id, c.name])),
    [companies],
  );
  const sectorById = useMemo(() => new Map(sectors.map((s) => [s.id, s.name])), [sectors]);

  // Ordem alfabetica (pt-BR, ignora caixa/acentos), por nome ou e-mail quando
  // sem nome. Cobre o load inicial e os refetches apos convite/edicao.
  // Regras nominais (as que vivem no código, não no cadastro) por usuário.
  const exceptionsByUser = useMemo(() => {
    const map = new Map<string, UserException[]>();
    for (const u of users) {
      const list = describeUserExceptions({ id: u.id, email: u.email, name: u.name });
      if (list.length > 0) map.set(u.id, list);
    }
    return map;
  }, [users]);

  // Regras cujo e-mail/ID não existe mais na base — falham em silêncio.
  const orphanRules = useMemo(
    () => findOrphanExceptionRules(users.map((u) => ({ id: u.id, email: u.email }))),
    [users],
  );

  const sortedUsers = useMemo(
    () =>
      [...users].sort((a, b) =>
        (a.name?.trim() || a.email).localeCompare(b.name?.trim() || b.email, "pt-BR", {
          sensitivity: "base",
        }),
      ),
    [users],
  );

  // Aplica os filtros de conferência. Admin implica acesso universal a módulos e
  // unidades, então casa com qualquer filtro de módulo/unidade. Setor é vínculo
  // explícito (só gerente/solicitante), então não considera admin.
  const filteredUsers = useMemo(
    () => {
      const nameQuery = filterName.trim().toLowerCase();
      const contactQuery = filterContact.trim().toLowerCase();
      return sortedUsers.filter((u) => {
        if (nameQuery && !`${u.name} ${u.position}`.toLowerCase().includes(nameQuery))
          return false;
        if (contactQuery && !`${u.email} ${u.phone}`.toLowerCase().includes(contactQuery))
          return false;
        if (filterProfile !== "all" && u.profile !== filterProfile) return false;
        if (filterStatus !== "all" && u.active !== (filterStatus === "active")) return false;
        if (filterModule !== "all") {
          const isAdmin = u.profile === "admin";
          if (filterModule === "financeiro" && !(isAdmin || u.can_financeiro)) return false;
          if (filterModule === "compras" && !(isAdmin || u.can_compras)) return false;
          if (filterModule === "case" && !(isAdmin || u.can_case)) return false;
          if (filterModule === "contratos" && !(isAdmin || u.can_contratos)) return false;
          if (filterModule === "caixa" && !(isAdmin || u.can_caixa)) return false;
          if (filterModule === "orcamento" && !(isAdmin || u.can_orcamento)) return false;
        }
        if (filterSector !== "all" && !u.sector_ids.includes(filterSector)) return false;
        if (
          filterCompany !== "all" &&
          u.profile !== "admin" &&
          !u.company_ids.includes(filterCompany)
        )
          return false;
        return true;
      });
    },
    [
      sortedUsers,
      filterName,
      filterContact,
      filterProfile,
      filterModule,
      filterSector,
      filterCompany,
      filterStatus,
    ],
  );

  const hasActiveFilters =
    filterName.trim() !== "" ||
    filterContact.trim() !== "" ||
    filterProfile !== "all" ||
    filterModule !== "all" ||
    filterSector !== "all" ||
    filterCompany !== "all" ||
    filterStatus !== "all";

  function clearFilters() {
    setFilterName("");
    setFilterContact("");
    setFilterProfile("all");
    setFilterModule("all");
    setFilterSector("all");
    setFilterCompany("all");
    setFilterStatus("all");
  }

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
      // Validador de contrato: perfil isolado — só a Validação de Contratos,
      // sem os demais módulos, setores ou unidades.
      if (key === "profile" && value === "validador_contrato") {
        next.can_financeiro = false;
        next.can_compras = false;
        next.can_case = false;
        next.can_viagens = false;
        next.can_viagens_aprovar = false;
        next.can_contratos = true;
        // Ilha: o validador de contrato só enxerga /contratos, então o Caixa
        // não teria efeito nenhum (ver o gate em @/lib/auth/access).
        next.can_caixa = false;
        next.can_orcamento = false;
        next.sector_ids = [];
        next.company_ids = [];
        next.ctrl_org_ids = [];
        next.ctrl_org_roles = {};
      }
      // Admin: força módulos visíveis = true (atalho de UX). Admin já vê o Case
      // e a Validação de Contratos.
      if (key === "profile" && value === "admin") {
        next.can_financeiro = true;
        next.can_compras = true;
        next.company_ids = []; // admin vê tudo, não precisa restringir
      }
      // Franqueado e CSC (cópia funcional): só Financeiro, sem setores.
      // Unidades obrigatórias. `can_contratos` NÃO é zerado: a Validação de
      // Contratos é um módulo à parte, liberável pra qualquer perfil.
      if (key === "profile" && (value === "franqueado" || value === "csc")) {
        next.can_financeiro = true;
        next.can_compras = false;
        next.can_case = false;
        next.can_viagens = false;
        next.can_viagens_aprovar = false;
        next.sector_ids = [];
        next.ctrl_org_ids = [];
        next.ctrl_org_roles = {};
      }
      // Saiu do perfil isolado de validador → o módulo deixa de ser implícito
      // e volta a depender da marcação em "Módulos visíveis".
      if (key === "profile" && prev.profile === "validador_contrato" && value !== "validador_contrato") {
        next.can_contratos = false;
      }
      // Sem Viagens → não pode aprovar viagens
      if (key === "can_viagens" && value === false) {
        next.can_viagens_aprovar = false;
      }
      // Sem Financeiro → limpa unidades
      if (key === "can_financeiro" && value === false) {
        next.company_ids = [];
      }
      // Sem Compras → limpa as empresas do Compras (multiempresa). Escopo de um
      // módulo que a pessoa não tem voltaria a valer sozinho numa reconcessão.
      if (key === "can_compras" && value === false) {
        next.ctrl_org_ids = [];
        next.ctrl_org_roles = {};
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

  function toggleCtrlOrg(id: string) {
    setForm((prev) => {
      const removing = prev.ctrl_org_ids.includes(id);
      const nextOrgs = removing
        ? prev.ctrl_org_ids.filter((o) => o !== id)
        : [...prev.ctrl_org_ids, id];
      // Tirar uma empresa tira junto os setores dela (os setores são por
      // empresa): senão sobraria setor de uma empresa que a pessoa não acessa.
      const orgOf = new Map(sectors.map((s) => [s.id, s.orgId]));
      const nextSectors = prev.sector_ids.filter((sid) => {
        const org = orgOf.get(sid);
        return org == null || nextOrgs.includes(org);
      });
      // E tira o override de papel daquela empresa (não há onde editá-lo sem a
      // empresa; deixar pendurado gravaria papel numa empresa não concedida).
      const nextRoles = { ...prev.ctrl_org_roles };
      if (removing) delete nextRoles[id];
      return { ...prev, ctrl_org_ids: nextOrgs, sector_ids: nextSectors, ctrl_org_roles: nextRoles };
    });
  }

  // Papel do Compras numa empresa específica (override). role = null → volta a
  // "Usar o perfil" (remove a entrada), que é o padrão de hoje.
  function setCtrlOrgRole(orgId: string, role: CtrlOrgRole | null) {
    setForm((prev) => {
      const nextRoles = { ...prev.ctrl_org_roles };
      if (role == null) delete nextRoles[orgId];
      else nextRoles[orgId] = role;
      return { ...prev, ctrl_org_roles: nextRoles };
    });
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
        can_case: boolean;
        can_viagens: boolean;
        can_viagens_aprovar: boolean;
        can_contratos: boolean;
        can_caixa: boolean;
        can_orcamento: boolean;
        orcamento_setores?: OrcamentoSetoresPorEmpresa;
        active: boolean;
        sectors: Array<{ id: string; name: string }>;
        companies: Array<{ id: string; name: string }>;
        ctrl_org_ids?: string[];
        ctrl_org_roles?: Record<string, CtrlOrgRole>;
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
        can_case: u.can_case,
        can_viagens: u.can_viagens,
        can_viagens_aprovar: u.can_viagens_aprovar,
        can_contratos: u.can_contratos,
        can_caixa: u.can_caixa,
        can_orcamento: u.can_orcamento,
        orcamento_setores: u.orcamento_setores ?? {},
        active: u.active,
        sector_ids: u.sectors.map((s) => s.id),
        company_ids: u.companies.map((c) => c.id),
        ctrl_org_ids: u.ctrl_org_ids ?? [],
        ctrl_org_roles: u.ctrl_org_roles ?? {},
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
    if (
      !form.can_financeiro &&
      !form.can_compras &&
      !form.can_case &&
      !form.can_contratos &&
      !form.can_caixa &&
      !form.can_orcamento &&
      // Viagens saiu da tela, mas quem já tinha o módulo continua válido.
      !form.can_viagens &&
      form.profile !== "admin"
    ) {
      return "Marque ao menos um módulo (Financeiro, Compras, Case ou Validação de Contratos).";
    }
    // Multiempresa: quem tem o Compras precisa de pelo menos uma empresa — senão
    // o módulo abre vazio (as telas filtram pela empresa ativa). Admin vê todas;
    // validador é ilha.
    if (form.can_compras && form.profile !== "admin" && form.ctrl_org_ids.length === 0) {
      return "Selecione pelo menos uma empresa do Compras.";
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
        can_case: form.can_case,
        can_viagens: form.can_viagens,
        can_viagens_aprovar: form.can_viagens_aprovar,
        can_contratos: form.can_contratos,
        can_caixa: form.can_caixa,
        can_orcamento: form.can_orcamento,
        orcamento_setores: form.orcamento_setores,
        sector_ids: form.sector_ids,
        company_ids: form.company_ids,
        ctrl_org_ids: form.ctrl_org_ids,
        ctrl_org_roles: form.ctrl_org_roles,
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
        can_case: form.can_case,
        can_viagens: form.can_viagens,
        can_viagens_aprovar: form.can_viagens_aprovar,
        can_contratos: form.can_contratos,
        can_caixa: form.can_caixa,
        can_orcamento: form.can_orcamento,
        orcamento_setores: form.orcamento_setores,
        sector_ids: form.sector_ids,
        company_ids: form.company_ids,
        ctrl_org_ids: form.ctrl_org_ids,
        ctrl_org_roles: form.ctrl_org_roles,
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
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {filteredUsers.length} de {users.length}{" "}
            {users.length === 1 ? "usuário" : "usuários"}
          </span>
          {/* Vitrine das regras nominais: sem ela, um acordo fixo no código
              (alçada restrita, visão completa, roteamento) fica invisível pra
              quem administra os usuários. */}
          <Button
            variant="outline"
            onClick={() => setExceptionsFor("")}
            title="Regras especiais definidas no código"
          >
            <ShieldAlert className="mr-2 h-4 w-4 text-amber-600" />
            Regras especiais
            {exceptionsByUser.size > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">
                {exceptionsByUser.size}
              </span>
            )}
          </Button>
          <Button onClick={openInvite}>
            <MailPlus className="mr-2 h-4 w-4" />
            Convidar usuário
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="min-w-[180px]">
              <Input
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
                placeholder="Nome / Cargo"
                className="h-8"
              />
            </TableHead>
            <TableHead className="min-w-[180px]">
              <Input
                value={filterContact}
                onChange={(e) => setFilterContact(e.target.value)}
                placeholder="Contato"
                className="h-8"
              />
            </TableHead>
            <TableHead>
              <HeaderFilter
                value={filterProfile}
                onChange={setFilterProfile}
                title="Perfil"
                options={[
                  { value: "all", label: "Todos os perfis" },
                  ...PROFILES.map((p) => ({ value: p.value, label: p.label })),
                ]}
              />
            </TableHead>
            <TableHead>
              <HeaderFilter
                value={filterModule}
                onChange={setFilterModule}
                title="Módulo"
                options={[
                  { value: "all", label: "Todos os módulos" },
                  { value: "financeiro", label: "Financeiro" },
                  { value: "compras", label: "Compras" },
                  { value: "case", label: "Case" },
                  { value: "contratos", label: "Validação de Contratos" },
                  { value: "caixa", label: "Caixa" },
                  { value: "orcamento", label: "Orçamento" },
                ]}
              />
            </TableHead>
            <TableHead>
              <HeaderFilter
                value={filterSector}
                onChange={setFilterSector}
                title="Setor"
                options={[
                  { value: "all", label: "Todos os setores" },
                  ...sectors.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </TableHead>
            <TableHead>
              <HeaderFilter
                value={filterCompany}
                onChange={setFilterCompany}
                title="Unidade"
                options={[
                  { value: "all", label: "Todas as unidades" },
                  ...companies.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </TableHead>
            <TableHead>
              <HeaderFilter
                value={filterStatus}
                onChange={setFilterStatus}
                title="Status"
                options={[
                  { value: "all", label: "Todos os status" },
                  { value: "active", label: "Ativo" },
                  { value: "inactive", label: "Inativo" },
                ]}
              />
            </TableHead>
            <TableHead className="text-right">
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={clearFilters}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Limpar
                </Button>
              )}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredUsers.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">{u.name || "—"}</span>
                  {exceptionsByUser.has(u.id) && (
                    <button
                      type="button"
                      onClick={() => setExceptionsFor(u.id)}
                      title="Este usuário tem regras especiais definidas no código — clique para ver"
                      className="rounded p-0.5 text-amber-600 transition-colors hover:bg-amber-100 hover:text-amber-800"
                    >
                      <ShieldAlert className="h-3.5 w-3.5" />
                      <span className="sr-only">Ver regras especiais</span>
                    </button>
                  )}
                </div>
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
                  ? "Validação de Contratos (isolado)"
                  : u.profile === "admin"
                  ? "Todos"
                  : [
                      u.can_financeiro && "Financeiro",
                      u.can_compras && "Compras",
                      u.can_case && "Case",
                      u.can_contratos && "Validação de Contratos",
                      u.can_caixa && "Caixa",
                      u.can_orcamento && "Orçamento",
                      // Viagens não é mais atribuível, mas segue exibido pra
                      // quem ainda tem o módulo.
                      u.can_viagens && (u.can_viagens_aprovar ? "Viagens (aprova)" : "Viagens"),
                    ]
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
          {filteredUsers.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                {users.length === 0
                  ? "Nenhum usuário cadastrado."
                  : "Nenhum usuário encontrado com os filtros aplicados."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Regras nominais do código */}
      <ExceptionsDialog
        open={exceptionsFor !== null}
        focusUserId={exceptionsFor || null}
        users={sortedUsers}
        exceptionsByUser={exceptionsByUser}
        orphanRules={orphanRules}
        onClose={() => setExceptionsFor(null)}
      />

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={(o) => !o && closeAll()}>
        <DialogContent className="grid max-h-[85vh] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
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
            ctrlOrgs={ctrlOrgs}
            orcamentoSetores={orcamentoSetores}
            onChange={updateField}
            onToggleSector={toggleSector}
            onToggleCompany={toggleCompany}
            onToggleCtrlOrg={toggleCtrlOrg}
            onSetCtrlOrgRole={setCtrlOrgRole}
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
        <DialogContent className="grid max-h-[85vh] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
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
            ctrlOrgs={ctrlOrgs}
            orcamentoSetores={orcamentoSetores}
            onChange={updateField}
            onToggleSector={toggleSector}
            onToggleCompany={toggleCompany}
            onToggleCtrlOrg={toggleCtrlOrg}
            onSetCtrlOrgRole={setCtrlOrgRole}
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

// ─── Regras nominais (exceções fixas no código) ─────────────────────────────

function ExceptionsDialog({
  open,
  focusUserId,
  users,
  exceptionsByUser,
  orphanRules,
  onClose,
}: {
  open: boolean;
  /** Quando preenchido, mostra só este usuário (clique no ícone da linha). */
  focusUserId: string | null;
  users: UserItem[];
  exceptionsByUser: Map<string, UserException[]>;
  orphanRules: ReturnType<typeof findOrphanExceptionRules>;
  onClose: () => void;
}) {
  const listed = users.filter(
    (u) => exceptionsByUser.has(u.id) && (!focusUserId || u.id === focusUserId),
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-600" />
            Regras especiais
          </DialogTitle>
          <DialogDescription>
            Acordos de negócio que não têm campo de cadastro e vivem no código do sistema. Eles
            valem <strong>além</strong> do perfil e dos módulos marcados na edição do usuário —
            e só podem ser alterados por quem edita o código.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {listed.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum usuário com regra especial.
            </p>
          )}

          {listed.map((u) => (
            <div key={u.id} className="rounded-md border p-3">
              <div className="mb-2">
                <p className="text-sm font-semibold">{u.name || u.email}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
              <ul className="space-y-2.5">
                {(exceptionsByUser.get(u.id) ?? []).map((ex) => (
                  <li key={ex.key} className="border-l-2 border-amber-300 pl-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{ex.title}</span>
                      <Badge
                        variant="outline"
                        className={
                          ex.scope === "Compras"
                            ? "border-violet-200 bg-violet-50 text-violet-700"
                            : ex.scope === "Case"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-blue-200 bg-blue-50 text-blue-700"
                        }
                      >
                        {ex.scope}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{ex.detail}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                      {ex.source}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Só na visão geral: regras que não são por usuário e regras órfãs. */}
          {!focusUserId && (
            <>
              <div className="rounded-md border p-3">
                <p className="mb-2 text-sm font-semibold">Regras que não são por usuário</p>
                <ul className="space-y-2.5">
                  {NON_USER_RULES.map((rule) => (
                    <li key={rule.title} className="border-l-2 border-slate-300 pl-3">
                      <p className="text-sm font-medium">{rule.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{rule.detail}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                        {rule.source}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>

              {orphanRules.length > 0 && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900/40 dark:bg-red-950/30">
                  <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-red-800 dark:text-red-300">
                    <AlertTriangle className="h-4 w-4" />
                    Regras sem usuário correspondente
                  </p>
                  <p className="mb-2 text-xs text-red-800/90 dark:text-red-300/90">
                    Estas regras existem no código mas não casam com nenhum usuário — provavelmente
                    o e-mail mudou ou o cadastro foi recriado. Elas simplesmente <strong>deixam de
                    valer</strong>, sem erro visível. Avise quem cuida do código.
                  </p>
                  <ul className="space-y-1">
                    {orphanRules.map((rule) => (
                      <li key={rule.key} className="text-xs text-red-800 dark:text-red-300">
                        <strong>{rule.label}</strong> — {rule.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inner form ─────────────────────────────────────────────────────────────

function UserForm({
  form,
  error,
  includesEmail,
  companies,
  sectors,
  ctrlOrgs,
  orcamentoSetores,
  onChange,
  onToggleSector,
  onToggleCompany,
  onToggleCtrlOrg,
  onSetCtrlOrgRole,
  onSubmit,
}: {
  form: FormState;
  error: string | null;
  includesEmail: boolean;
  companies: SimpleOption[];
  sectors: CtrlSectorOption[];
  ctrlOrgs: CtrlOrgOption[];
  orcamentoSetores: Record<string, string[]>;
  onChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onToggleSector: (id: string) => void;
  onToggleCompany: (id: string) => void;
  onToggleCtrlOrg: (id: string) => void;
  onSetCtrlOrgRole: (orgId: string, role: CtrlOrgRole | null) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const showSectors = profileShowsSectors(form.profile);
  const sectorsRequired = profileNeedsSectors(form.profile);
  // Empresas do Compras (multiempresa): aparece para quem tem o módulo Compras
  // (menos admin, que vê todas por natureza, e o validador, que é ilha). É o que
  // define quais empresas a pessoa acessa no Compras. Com uma empresa só, o
  // seletor ainda aparece — é como o admin concede a Viva a um novo usuário.
  const showCtrlOrgs =
    form.can_compras && form.profile !== "admin" && form.profile !== "validador_contrato";
  const ctrlOrgOptions = ctrlOrgs.map((o) => ({ id: o.id, name: o.nome }));
  const orgNameById = new Map(ctrlOrgs.map((o) => [o.id, o.nome]));
  const multiOrg = form.ctrl_org_ids.length > 1;
  // Rótulos para o papel por empresa (reusa os labels da lista de perfis).
  const profileLabel = PROFILES.find((p) => p.value === form.profile)?.label ?? form.profile;
  const ctrlOrgRoleLabel = (r: CtrlOrgRole) =>
    PROFILES.find((p) => p.value === r)?.label ?? r;
  // Setores oferecidos = só os das empresas concedidas (sem empresa, nenhum).
  // Com mais de uma empresa, o nome do setor leva a empresa para não confundir
  // dois "Diretoria" de empresas diferentes.
  const sectorOptions = sectors
    .filter((s) => s.orgId != null && form.ctrl_org_ids.includes(s.orgId))
    .map((s) => ({
      id: s.id,
      name: multiOrg ? `${s.name} · ${orgNameById.get(s.orgId as string) ?? ""}` : s.name,
    }));
  // O Orçamento também se recorta por empresa (`podeVerEmpresa` lê
  // `user_company_access`), então o seletor precisa aparecer com ele marcado
  // mesmo sem Financeiro — um Gerente de Compras + Orçamento ficava sem
  // caminho para receber empresa nenhuma, e o painel do módulo abria vazio.
  const showCompanies =
    (form.can_financeiro || form.can_orcamento) &&
    form.profile !== "admin" &&
    form.profile !== "validador_contrato";
  const isValidator = form.profile === "validador_contrato";
  // Visão Financeira e CSC são só-Financeiro: não escolhem Compras/Case. Mas a
  // Validação de Contratos é um módulo independente, então a seção continua
  // aparecendo pra eles — só com esse botão.
  const isFinanceiroOnly = form.profile === "franqueado" || form.profile === "csc";
  // Admin já tem tudo; o Validador de Contrato É o módulo. Os demais escolhem.
  const showModules = !isValidator && form.profile !== "admin";

  const profileDescription = useMemo(
    () => PROFILES.find((p) => p.value === form.profile)?.description ?? "",
    [form.profile],
  );

  return (
    <form
      id="user-form"
      onSubmit={onSubmit}
      className="min-h-0 space-y-4 overflow-y-auto pr-1"
    >
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

      {showModules && (
        <div className="space-y-1.5">
          <Label>Módulos visíveis</Label>
          {/* Grid: "Validação de Contratos" é longo demais pra 4 colunas
              iguais numa linha só. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {!isFinanceiroOnly && (
            <>
            <button
              type="button"
              onClick={() => onChange("can_financeiro", !form.can_financeiro)}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${
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
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${
                form.can_compras
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-muted"
              }`}
            >
              {form.can_compras ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
              Compras
            </button>
            <button
              type="button"
              onClick={() => onChange("can_case", !form.can_case)}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${
                form.can_case
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-muted"
              }`}
            >
              {form.can_case ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
              Case
            </button>
            </>
            )}
            <button
              type="button"
              onClick={() => onChange("can_contratos", !form.can_contratos)}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${
                form.can_contratos
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-muted"
              }`}
            >
              {form.can_contratos ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
              Validação de Contratos
            </button>
            {/* Caixa: como a Validação de Contratos, é um módulo à parte,
                liberável em QUALQUER perfil (inclusive Visão Financeira e CSC,
                que escondem o resto da seção). Por isso fica fora do bloco
                !isFinanceiroOnly. */}
            <button
              type="button"
              onClick={() => onChange("can_caixa", !form.can_caixa)}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${
                form.can_caixa
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-muted"
              }`}
            >
              {form.can_caixa ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
              Caixa
            </button>
            {/* Orçamento: módulo à parte, como o Caixa — mas só aparece para os
                perfis em que ele faz efeito (admin, diretor, gerente, gerente
                de setor). Para um solicitante ou Visão Financeira a marcação
                não daria acesso nenhum (ver resolveOrcamentoPapel), e um botão
                que não faz nada é pior do que botão nenhum. */}
            {isOrcamentoEligibleProfile(form.profile) && (
              <button
                type="button"
                onClick={() => onChange("can_orcamento", !form.can_orcamento)}
                className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${
                  form.can_orcamento
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-muted"
                }`}
              >
                {form.can_orcamento ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                Orçamento
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {isFinanceiroOnly
              ? "Este perfil é fixo no Financeiro (sem Compras e sem Case). A Validação de Contratos e o Caixa são módulos à parte e podem ser liberados."
              : "Plataforma (Conexões, Usuários, Inteligência) é automática pra admin."}
          </p>
          {/* O botão Orçamento some para perfil não elegível, e sumir calado faz
              quem administra concluir que o módulo não existe — foi exatamente o
              que aconteceu em 28/09/2026. O motivo é real (marcar o módulo para
              um solicitante não daria acesso nenhum, ver `resolveOrcamentoPapel`),
              mas precisa estar escrito. */}
          {!isOrcamentoEligibleProfile(form.profile) && (
            <p className="text-xs text-muted-foreground">
              <strong>Orçamento</strong> não aparece acima porque o módulo não faz efeito
              neste perfil: quem constrói e valida orçamento é{" "}
              <strong>Diretor</strong>, <strong>Gerente Sócio</strong> ou{" "}
              <strong>Gerente</strong>. Troque o perfil para liberá-lo.
            </p>
          )}
          {form.can_caixa && (
            <p className="text-xs text-muted-foreground">
              O módulo <strong>Caixa</strong> mostra o saldo das contas correntes de{" "}
              <strong>todas as empresas</strong> — não depende das unidades
              selecionadas abaixo.
            </p>
          )}
          {form.can_orcamento && (
            <p className="text-xs text-muted-foreground">
              No <strong>Orçamento</strong>, o que a pessoa faz vem do perfil:{" "}
              {form.profile === "diretor"
                ? "Diretor valida o orçamento das unidades selecionadas abaixo."
                : form.profile === "gerente"
                  ? "Gerente Sócio vê a empresa inteira e edita os setores vinculados a ele."
                  : form.profile === "gerente_setor"
                    ? "Gerente monta o orçamento apenas dos setores vinculados a ele."
                    : "Admin acessa tudo, inclusive a configuração do módulo."}{" "}
              O recorte usa as <strong>unidades</strong> e os <strong>setores</strong>{" "}
              marcados abaixo.
            </p>
          )}
        </div>
      )}

      {showCtrlOrgs && (
        <div className="space-y-1.5">
          <Label>
            Empresas do Compras <span className="text-destructive">*</span>
          </Label>
          <PillMultiSelect
            options={ctrlOrgOptions}
            selected={form.ctrl_org_ids}
            onToggle={onToggleCtrlOrg}
            emptyMessage="Nenhuma empresa do Compras cadastrada."
          />
          <p className="text-xs text-muted-foreground">
            Define quais empresas a pessoa acessa no Compras. Os <strong>setores</strong> abaixo
            são escolhidos dentro das empresas marcadas aqui.
          </p>

          {/* Papel POR EMPRESA (override). Só aparece com empresa marcada. O
              padrão "Usar o perfil" grava NULL = segue o perfil global — não
              muda nada do que existe hoje. Ver src/lib/ctrl/roles.ts. */}
          {form.ctrl_org_ids.length > 0 && (
            <div className="mt-1 space-y-2 rounded-md border p-2.5">
              <p className="text-xs text-muted-foreground">
                Papel em cada empresa. O padrão <strong>“Usar o perfil”</strong> segue o
                perfil acima (<strong>{profileLabel}</strong>); escolha um papel diferente só
                se esta empresa precisar (ex.: Contas a Pagar numa, Solicitante na outra).
              </p>
              {form.ctrl_org_ids.map((orgId) => (
                <div key={orgId} className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm">{orgNameById.get(orgId) ?? orgId}</span>
                  <Select
                    value={form.ctrl_org_roles[orgId] ?? "__profile__"}
                    onValueChange={(v) =>
                      onSetCtrlOrgRole(orgId, v === "__profile__" ? null : (v as CtrlOrgRole))
                    }
                  >
                    <SelectTrigger className="h-8 w-56 shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__profile__">Usar o perfil ({profileLabel})</SelectItem>
                      {CTRL_ORG_ROLE_VALUES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ctrlOrgRoleLabel(r)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showSectors && (
        <div className="space-y-1.5">
          <Label>
            Setores {sectorsRequired && <span className="text-destructive">*</span>}
          </Label>
          <PillMultiSelect
            options={sectorOptions}
            selected={form.sector_ids}
            onToggle={onToggleSector}
            emptyMessage={
              form.ctrl_org_ids.length === 0
                ? "Marque uma empresa do Compras acima para ver os setores."
                : "Nenhum setor cadastrado nesta empresa."
            }
          />
          {form.profile === "diretor" && (
            <p className="text-xs text-muted-foreground">
              Selecione os setores para restringir as aprovações do diretor. Sem
              nenhum setor, ele aprova requisições de todos os setores.
            </p>
          )}
          {/* Até 29/09/2026 este campo também recortava o Orçamento, com
              significado OPOSTO ao do Compras — e sem empresa, o que dava o
              mesmo setor em todas elas. O Orçamento passou a ter cadastro
              próprio, por empresa, logo abaixo das Unidades. */}
          {form.can_orcamento && (
            <p className="text-xs text-muted-foreground">
              Este campo é do <strong>Compras</strong>. Os setores do{" "}
              <strong>Orçamento</strong> são escolhidos por unidade, mais abaixo.
            </p>
          )}
        </div>
      )}

      {showCompanies && (
        <div className="space-y-1.5">
          <Label>
            {form.can_financeiro ? "Unidades (acesso ao Financeiro)" : "Unidades"}{" "}
            <span className="text-destructive">*</span>
          </Label>
          <PillMultiSelect
            options={companies}
            selected={form.company_ids}
            onToggle={onToggleCompany}
            emptyMessage="Nenhuma empresa cadastrada."
          />
          {form.can_orcamento && (
            <p className="text-xs text-muted-foreground">
              O <strong>Orçamento</strong> também se recorta por unidade: a pessoa só
              alcança o orçamento das marcadas aqui.
            </p>
          )}
        </div>
      )}

      {/* Setor do orçamento é POR EMPRESA (migration 20260929120000). Vem depois
          das Unidades de propósito: ele oferece exatamente as que foram marcadas
          ali, e lido de cima para baixo o formulário conta a história certa —
          módulo, depois empresas, depois os setores de cada uma. */}
      {form.can_orcamento && (
        <div className="space-y-1.5">
          <Label>Setores do Orçamento, por unidade</Label>
          <OrcamentoSetoresPorEmpresaField
            companies={companies}
            setoresPorEmpresa={orcamentoSetores}
            companyIds={form.company_ids}
            value={form.orcamento_setores}
            onChange={(next) => onChange("orcamento_setores", next)}
          />
          <p className="text-xs text-muted-foreground">
            Quem constrói (Gerente) enxerga <strong>só estes setores</strong>; Gerente
            Sócio e Diretor leem a unidade inteira, mas editam apenas estes. Sem setor
            numa unidade, as telas do orçamento dela abrem vazias.
          </p>
        </div>
      )}

      {form.profile === "admin" && (
        <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">
          Admin vê <strong>todas as unidades</strong> e tem acesso ao módulo Plataforma
          (Conexões, Usuários, Inteligência) automaticamente — inclusive{" "}
          <strong>Orçamento</strong>, <strong>Caixa</strong> e{" "}
          <strong>Validação de Contratos</strong>. Por isso &ldquo;Módulos visíveis&rdquo;
          não aparece neste perfil: não há o que marcar.
        </p>
      )}
      {isValidator && (
        <p className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800 dark:border-orange-900/40 dark:bg-orange-950/30 dark:text-orange-300">
          Validador de Contrato é um perfil <strong>isolado</strong>: só enxerga a tela de
          Validação de Contratos. Sem setores ou unidades. Para dar essa tela a alguém
          <strong> sem</strong> isolar o acesso, mantenha o perfil atual do usuário e marque o
          módulo <strong>Validação de Contratos</strong> em &ldquo;Módulos visíveis&rdquo;.
        </p>
      )}
      {form.profile === "franqueado" && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
          O perfil Visão Financeira vê <strong>apenas</strong> o Financeiro das unidades selecionadas:
          Dashboard, Fluxo de Caixa, Budget e Forecast, KPIs e Business Intelligence.
          Sem acesso a Compras, Conexões, Mapeamento, Configurações ou Plataforma.
        </p>
      )}
      {form.profile === "csc" && (
        <p className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800 dark:border-teal-900/40 dark:bg-teal-950/30 dark:text-teal-300">
          O perfil CSC tem <strong>exatamente os mesmos acessos</strong> da Visão Financeira
          (Dashboard, Fluxo de Caixa, Budget e Forecast, KPIs e Business Intelligence das
          unidades selecionadas) e, além deles, a tela <strong>Validação Relatório</strong>,
          onde valida e envia os relatórios BI mensais aos gestores.
        </p>
      )}
    </form>
  );
}

// Filtro compacto embutido no cabeçalho da tabela. Quando nada está
// selecionado ("all"), o gatilho mostra apenas o título da coluna; ao escolher
// um valor, mostra o rótulo selecionado.
function HeaderFilter({
  value,
  onChange,
  title,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  title: string;
  options: Array<{ value: string; label: string }>;
}) {
  const selectedLabel =
    value === "all" ? null : options.find((o) => o.value === value)?.label ?? null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-full text-xs font-normal">
        <span className={selectedLabel ? "truncate" : "truncate text-muted-foreground"}>
          {selectedLabel ?? title}
        </span>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
            className={`inline-flex max-w-full items-center gap-1 break-words rounded-full border px-2.5 py-1 text-left text-xs font-medium transition-colors ${
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

/**
 * Setores do Orçamento, uma linha por EMPRESA.
 *
 * O recorte do módulo é por empresa desde 29/09/2026: a mesma pessoa pode
 * responder por Marketing na Sirena e por nada na Feat. Por isso a atribuição
 * não cabe no campo "Setores" de cima, que é do Compras e não tem empresa.
 *
 * As empresas oferecidas são as UNIDADES já marcadas no formulário — não uma
 * segunda lista. `user_company_access` é o que `podeVerEmpresa` lê, então
 * oferecer aqui uma empresa fora dali produziria setor num lugar que a pessoa
 * nem abre.
 *
 * Os setores oferecidos são os do ORÇAMENTO daquela empresa, não os do
 * Compras: o orçamento tem cadastro próprio (empresa × ano) e nem todo setor
 * dele existe como setor de compras — oferecer a lista do Compras deixava
 * metade dos setores desta base inatingível.
 */
function OrcamentoSetoresPorEmpresaField({
  companies,
  setoresPorEmpresa,
  companyIds,
  value,
  onChange,
}: {
  companies: SimpleOption[];
  /** Empresa → nomes dos setores do ORÇAMENTO dela (qualquer ano). */
  setoresPorEmpresa: Record<string, string[]>;
  companyIds: string[];
  value: OrcamentoSetoresPorEmpresa;
  onChange: (next: OrcamentoSetoresPorEmpresa) => void;
}) {
  const selecionadas = companies.filter((c) => companyIds.includes(c.id));

  function toggle(companyId: string, nome: string) {
    const atual = value[companyId] ?? [];
    const proxima = atual.includes(nome)
      ? atual.filter((n) => n !== nome)
      : [...atual, nome];
    const next = { ...value };
    // Empresa sem setor sai do mapa em vez de ficar com lista vazia: o que vai
    // para o banco é uma linha por (usuário, empresa, setor), e chave vazia
    // seria só ruído no payload.
    if (proxima.length === 0) delete next[companyId];
    else next[companyId] = proxima;
    onChange(next);
  }

  if (selecionadas.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Marque as <strong>unidades</strong> acima primeiro — os setores do orçamento são
        escolhidos dentro de cada uma.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {selecionadas.map((empresa) => {
        const marcados = value[empresa.id] ?? [];
        // Opções = os setores do ORÇAMENTO desta empresa. A chave do
        // PillMultiSelect é o próprio nome, porque é o nome que se grava.
        const opcoes = (setoresPorEmpresa[empresa.id] ?? []).map((nome) => ({
          id: nome,
          name: nome,
        }));
        return (
          <div key={empresa.id} className="rounded-md border p-2.5">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              {/* `min-w-0` + `break-words`: nome comprido de empresa não pode
                  empurrar a largura do cartão e criar rolagem horizontal. */}
              <span className="min-w-0 break-words text-sm font-medium">{empresa.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {marcados.length === 0 ? "nenhum setor" : `${marcados.length} setor(es)`}
              </span>
            </div>
            <PillMultiSelect
              options={opcoes}
              selected={marcados}
              onToggle={(nome) => toggle(empresa.id, nome)}
              emptyMessage="Esta unidade ainda não tem setores no orçamento — cadastre em Configuração › Setores dela."
            />
          </div>
        );
      })}
    </div>
  );
}
