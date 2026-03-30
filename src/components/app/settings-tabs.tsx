"use client";

import { useState } from "react";

import { DreStructureManager } from "@/components/app/dre-structure-manager";
import { KpiAdminManager } from "@/components/app/kpi-admin-manager";
import { SettingsCompanies } from "@/components/app/settings-companies";
import { Button } from "@/components/ui/button";
import type { KpiDefinition } from "@/lib/kpi/calc";

interface SettingsTabsProps {
  companies: Array<{
    id: string;
    name: string;
    active: boolean;
    created_at: string;
    has_credentials: boolean;
  }>;
  dreAccounts: Array<{
    id: string;
    code: string;
    name: string;
    parent_id: string | null;
    level: number;
    type: "receita" | "despesa" | "calculado" | "misto";
    is_summary: boolean;
    formula: string | null;
    sort_order: number;
    active: boolean;
    mappings: Array<{
      id: string;
      code: string;
      name: string;
      company_id: string | null;
    }>;
  }>;
  kpis: KpiDefinition[];
  segmentId?: string | null;
}

type TabValue = "empresas" | "estrutura_dre" | "kpis";

export function SettingsTabs({ companies, dreAccounts, kpis, segmentId }: SettingsTabsProps) {
  const [tab, setTab] = useState<TabValue>("empresas");

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b pb-3">
        <Button
          type="button"
          variant={tab === "empresas" ? "default" : "outline"}
          onClick={() => setTab("empresas")}
        >
          Empresas
        </Button>
        <Button
          type="button"
          variant={tab === "estrutura_dre" ? "default" : "outline"}
          onClick={() => setTab("estrutura_dre")}
        >
          Estrutura DRE
        </Button>
        <Button
          type="button"
          variant={tab === "kpis" ? "default" : "outline"}
          onClick={() => setTab("kpis")}
        >
          KPIs
        </Button>
      </div>

      {tab === "empresas" ? (
        <SettingsCompanies initialCompanies={companies} segmentId={segmentId ?? null} />
      ) : tab === "estrutura_dre" ? (
        <DreStructureManager initialAccounts={dreAccounts} />
      ) : (
        <KpiAdminManager
          initialKpis={kpis}
          dreAccounts={dreAccounts.map((account) => ({
            code: account.code,
            name: account.name,
          }))}
        />
      )}
    </div>
  );
}
