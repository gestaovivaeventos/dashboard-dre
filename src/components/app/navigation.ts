import { BarChart3, Cog, Link2, MapPinned, PieChart, Users } from "lucide-react";

import type { UserRole } from "@/lib/supabase/types";

export const NAV_ITEMS = [
  {
    title: "Dashboard (DRE)",
    href: "/dashboard",
    icon: PieChart,
    roles: ["admin", "gestor_hero", "gestor_unidade"] as UserRole[],
  },
  {
    title: "KPIs",
    href: "/kpis",
    icon: BarChart3,
    roles: ["admin", "gestor_hero", "gestor_unidade"] as UserRole[],
  },
  {
    title: "Conexoes",
    href: "/conexoes",
    icon: Link2,
    roles: ["admin", "gestor_hero"] as UserRole[],
  },
  {
    title: "Mapeamento",
    href: "/mapeamento",
    icon: MapPinned,
    roles: ["admin"] as UserRole[],
  },
  {
    title: "Configuracoes",
    href: "/configuracoes",
    icon: Cog,
    roles: ["admin"] as UserRole[],
  },
  {
    title: "Usuarios",
    href: "/usuarios",
    icon: Users,
    roles: ["admin"] as UserRole[],
  },
] as const;
