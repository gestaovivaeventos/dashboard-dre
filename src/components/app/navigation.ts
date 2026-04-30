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
} from "lucide-react";

import type { DreRole, CtrlRole } from "@/lib/supabase/types";

/** Sub-menu items dentro de cada segmento DRE */
export const SEGMENT_SUB_ITEMS = [
  {
    title: "Dashboard (DRE)",
    suffix: "/dashboard",
    icon: PieChart,
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

/** Items globais do módulo DRE */
export const GLOBAL_NAV_ITEMS = [
  {
    title: "Painel Administrador",
    href: "/admin",
    icon: Settings,
    roles: ["admin"] as DreRole[],
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
] as const;

/** Items do módulo Controladoria — visíveis quando ctrlRole != null */
export const CTRL_NAV_ITEMS = [
  {
    title: "Requisições",
    href: "/ctrl/requisicoes",
    icon: FileText,
    roles: ["solicitante", "gerente", "diretor", "csc", "contas_a_pagar", "admin"] as CtrlRole[],
  },
  {
    title: "Aprovações",
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
    title: "Orçamento",
    href: "/ctrl/orcamento",
    icon: DollarSign,
    roles: ["gerente", "diretor", "csc", "admin"] as CtrlRole[],
  },
  {
    title: "Relatórios",
    href: "/ctrl/relatorios",
    icon: BarChart3,
    roles: ["gerente", "diretor", "csc", "contas_a_pagar", "admin"] as CtrlRole[],
  },
  {
    title: "Notificações",
    href: "/ctrl/notificacoes",
    icon: Bell,
    roles: ["solicitante", "gerente", "diretor", "csc", "contas_a_pagar", "admin"] as CtrlRole[],
  },
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
