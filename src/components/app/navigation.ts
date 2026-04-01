import { BarChart3, Brain, Cog, MapPinned, PieChart, Settings, Users } from "lucide-react";

import type { UserRole } from "@/lib/supabase/types";

/** Sub-menu items that appear inside each segment */
export const SEGMENT_SUB_ITEMS = [
  {
    title: "Dashboard (DRE)",
    suffix: "/dashboard",
    icon: PieChart,
    roles: ["admin", "gestor_hero", "gestor_unidade"] as UserRole[],
  },
  {
    title: "KPIs",
    suffix: "/kpis",
    icon: BarChart3,
    roles: ["admin", "gestor_hero", "gestor_unidade"] as UserRole[],
  },
  {
    title: "Mapeamento",
    suffix: "/mapeamento",
    icon: MapPinned,
    roles: ["admin"] as UserRole[],
  },
  {
    title: "Configuracoes",
    suffix: "/configuracoes",
    icon: Cog,
    roles: ["admin"] as UserRole[],
  },
] as const;

/** Global items that appear at the bottom of the sidebar */
export const GLOBAL_NAV_ITEMS = [
  {
    title: "Painel Administrador",
    href: "/admin",
    icon: Settings,
    roles: ["admin"] as UserRole[],
  },
  {
    title: "Usuarios",
    href: "/usuarios",
    icon: Users,
    roles: ["admin"] as UserRole[],
  },
  {
    title: "Inteligencia",
    href: "/admin/inteligencia",
    icon: Brain,
    roles: ["admin"] as UserRole[],
  },
] as const;
