import {
  BarChart3,
  Bell,
  Brain,
  Calendar,
  CheckSquare,
  Cog,
  DollarSign,
  FileText,
  MapPinned,
  PieChart,
  Receipt,
  Settings,
  Target,
  Truck,
  Users,
  Wallet,
} from "lucide-react";

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
    icon: Settings,
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
    icon: Settings,
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
