import {
  BarChart3,
  Bell,
  Brain,
  Calendar,
  CheckSquare,
  Cog,
  DollarSign,
  FileCheck,
  FileText,
  LayoutDashboard,
  MapPinned,
  PieChart,
  Plug,
  Receipt,
  Target,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { CtrlRole, DreRole } from "@/lib/supabase/types";

/**
 * DRE module items rendered per active segment.
 * The href is built at render time as `/s/<active-slug><suffix>`.
 */
export const DRE_SEGMENT_DAILY_ITEMS = [
  {
    title: "Dashboard",
    suffix: "/dashboard",
    icon: PieChart,
    roles: ["admin", "gestor_hero", "gestor_unidade"] as DreRole[],
  },
  {
    title: "Fluxo de Caixa",
    suffix: "/fluxo-de-caixa",
    icon: Wallet,
    roles: ["admin", "gestor_hero", "gestor_unidade"] as DreRole[],
  },
  {
    title: "Budget e Forecast",
    suffix: "/budget-forecast",
    icon: Target,
    roles: ["admin", "gestor_hero", "gestor_unidade"] as DreRole[],
  },
  {
    title: "KPIs",
    suffix: "/kpis",
    icon: BarChart3,
    roles: ["admin", "gestor_hero", "gestor_unidade"] as DreRole[],
  },
] as const;

export const DRE_SEGMENT_ADMIN_ITEMS = [
  {
    title: "Mapeamento",
    suffix: "/mapeamento",
    icon: MapPinned,
    roles: ["admin"] as DreRole[],
  },
  {
    title: "Configuracoes",
    suffix: "/configuracoes",
    icon: Cog,
    roles: ["admin"] as DreRole[],
  },
] as const;

export const DRE_GLOBAL_ADMIN_ITEMS = [
  {
    title: "Conexoes",
    href: "/conexoes",
    icon: Plug,
    roles: ["admin", "gestor_hero"] as DreRole[],
  },
  {
    title: "Usuarios",
    href: "/usuarios",
    icon: Users,
    roles: ["admin"] as DreRole[],
  },
  {
    title: "Inteligencia",
    href: "/admin/inteligencia",
    icon: Brain,
    roles: ["admin"] as DreRole[],
  },
  {
    title: "Painel Administrador",
    href: "/admin",
    icon: LayoutDashboard,
    roles: ["admin"] as DreRole[],
  },
] as const;

export const CTRL_DAILY_ITEMS = [
  {
    title: "Requisicoes",
    href: "/ctrl/requisicoes",
    icon: FileText,
    roles: ["solicitante", "gerente", "diretor", "csc", "contas_a_pagar", "admin"] as CtrlRole[],
  },
  {
    title: "Aprovacoes",
    href: "/ctrl/aprovacoes",
    icon: CheckSquare,
    roles: ["gerente", "diretor", "csc", "contas_a_pagar", "admin"] as CtrlRole[],
  },
  {
    title: "Contas a Pagar",
    href: "/ctrl/contas-a-pagar",
    icon: Receipt,
    roles: ["gerente", "diretor", "csc", "contas_a_pagar", "admin"] as CtrlRole[],
  },
  {
    title: "Orcamento",
    href: "/ctrl/orcamento",
    icon: DollarSign,
    roles: ["gerente", "diretor", "csc", "admin"] as CtrlRole[],
  },
  {
    title: "Relatorios",
    href: "/ctrl/relatorios",
    icon: BarChart3,
    roles: ["gerente", "diretor", "csc", "contas_a_pagar", "admin"] as CtrlRole[],
  },
  {
    title: "Notificacoes",
    href: "/ctrl/notificacoes",
    icon: Bell,
    roles: ["solicitante", "gerente", "diretor", "csc", "contas_a_pagar", "admin"] as CtrlRole[],
  },
] as const;

export const CTRL_ADMIN_ITEMS = [
  {
    title: "Fornecedores",
    href: "/ctrl/admin/fornecedores",
    icon: Truck,
    roles: ["csc", "admin", "aprovacao_fornecedor"] as CtrlRole[],
  },
  {
    title: "Eventos",
    href: "/ctrl/admin/eventos",
    icon: Calendar,
    roles: ["csc", "admin"] as CtrlRole[],
  },
] as const;

/**
 * v2 navigation — domain-based groups.
 *
 * The sidebar renders these groups top-to-bottom. Each group is shown only if at
 * least one of its items is accessible to the current user. Item visibility:
 *  - `dreRoles` listed → user's `dreRole` must be in the list
 *  - `ctrlRoles` listed → user's `ctrlRoles` must intersect
 *  - both listed → either check passes (union semantics)
 *
 * Segment-scoped items render as `/s/<active-slug><suffix>` at render time;
 * global items use `href` as-is.
 *
 * This is the canonical structure. The legacy `DRE_*` / `CTRL_*` exports above
 * are kept temporarily for the v1 NavLinks and will be removed in a later phase.
 */
export type NavScope = "segment" | "global";

export interface NavItem {
  key: string;
  title: string;
  icon: LucideIcon;
  scope: NavScope;
  /** For segment-scoped items: appended to `/s/<slug>`. Ignored when scope is global. */
  suffix?: string;
  /** For global items: absolute path. Ignored when scope is segment. */
  href?: string;
  dreRoles?: readonly DreRole[];
  ctrlRoles?: readonly CtrlRole[];
}

export type NavGroupId = "financeiro" | "compras" | "plataforma";

export interface NavGroup {
  id: NavGroupId;
  label: string;
  items: readonly NavItem[];
}

const ALL_DRE_ROLES: readonly DreRole[] = ["admin", "gestor_hero", "gestor_unidade"];

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "financeiro",
    label: "FINANCEIRO",
    items: [
      { key: "fin-dashboard", title: "Dashboard", icon: PieChart, scope: "segment", suffix: "/dashboard", dreRoles: ALL_DRE_ROLES },
      { key: "fin-fluxo", title: "Fluxo de Caixa", icon: Wallet, scope: "segment", suffix: "/fluxo-de-caixa", dreRoles: ALL_DRE_ROLES },
      { key: "fin-budget", title: "Budget e Forecast", icon: Target, scope: "segment", suffix: "/budget-forecast", dreRoles: ALL_DRE_ROLES },
      { key: "fin-kpis", title: "KPIs", icon: BarChart3, scope: "segment", suffix: "/kpis", dreRoles: ALL_DRE_ROLES },
      { key: "fin-map", title: "Mapeamento", icon: MapPinned, scope: "segment", suffix: "/mapeamento", dreRoles: ["admin"] },
      { key: "fin-config", title: "Configuracoes", icon: Cog, scope: "segment", suffix: "/configuracoes", dreRoles: ["admin"] },
    ],
  },
  {
    id: "compras",
    label: "COMPRAS",
    items: [
      { key: "ct-req", title: "Requisicoes", icon: FileText, scope: "global", href: "/ctrl/requisicoes", ctrlRoles: ["solicitante", "gerente", "diretor", "csc", "contas_a_pagar", "admin"] },
      { key: "ct-apr", title: "Aprovacoes", icon: CheckSquare, scope: "global", href: "/ctrl/aprovacoes", ctrlRoles: ["gerente", "diretor", "csc", "contas_a_pagar", "admin"] },
      { key: "ct-cap", title: "Contas a Pagar", icon: Receipt, scope: "global", href: "/ctrl/contas-a-pagar", ctrlRoles: ["gerente", "diretor", "csc", "contas_a_pagar", "admin"] },
      { key: "ct-orc", title: "Orcamento", icon: DollarSign, scope: "global", href: "/ctrl/orcamento", ctrlRoles: ["gerente", "diretor", "csc", "admin"] },
      { key: "ct-rel", title: "Relatorios", icon: BarChart3, scope: "global", href: "/ctrl/relatorios", ctrlRoles: ["gerente", "diretor", "csc", "contas_a_pagar", "admin"] },
      { key: "ct-forn", title: "Fornecedores", icon: Truck, scope: "global", href: "/ctrl/admin/fornecedores", ctrlRoles: ["csc", "admin", "aprovacao_fornecedor"] },
      { key: "ct-evt", title: "Eventos", icon: Calendar, scope: "global", href: "/ctrl/admin/eventos", ctrlRoles: ["csc", "admin"] },
    ],
  },
  {
    id: "plataforma",
    label: "PLATAFORMA",
    items: [
      { key: "pf-contratos", title: "Validacao de Contratos", icon: FileCheck, scope: "global", href: "/contratos", dreRoles: ["admin", "gestor_hero"] },
      { key: "pf-conex", title: "Conexoes", icon: Plug, scope: "global", href: "/conexoes", dreRoles: ["admin", "gestor_hero"] },
      { key: "pf-users", title: "Usuarios", icon: Users, scope: "global", href: "/usuarios", dreRoles: ["admin"] },
      { key: "pf-intel", title: "Inteligencia", icon: Brain, scope: "global", href: "/admin/inteligencia", dreRoles: ["admin"] },
      { key: "pf-painel", title: "Painel Administrador", icon: LayoutDashboard, scope: "global", href: "/admin", dreRoles: ["admin"] },
    ],
  },
] as const;
