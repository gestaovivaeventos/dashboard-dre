"use client";

import { useState } from "react";

import { CashFlowStructureManager, type CashFlowAccountItem } from "@/components/app/cash-flow-structure-manager";
import { DreStructureManager } from "@/components/app/dre-structure-manager";
import { KpiAdminManager } from "@/components/app/kpi-admin-manager";
import { SettingsCompanies } from "@/components/app/settings-companies";
import { SettingsDepartments } from "@/components/app/settings-departments";
import { SettingsPartners } from "@/components/app/settings-partners";
import { Button } from "@/components/ui/button";
import type { KpiDefinition } from "@/lib/kpi/calc";

interface SettingsTabsProps {
  companies: Array<{
    id: string;
    name: string;
    active: boolean;
    created_at: string;
    has_credentials: boolean;
    has_department_apportionment?: boolean;
  }>;
  companiesWithDepartments: Array<{
    id: string;
    name: string;
    active: boolean;
    has_credentials: boolean;
    has_department_apportionment: boolean;
    departments: Array<{
      id: string;
      omie_code: string;
      name: string;
      included: boolean;
      synced_at: string | null;
    }>;
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
  cashFlowAccounts: CashFlowAccountItem[];
  kpis: KpiDefinition[];
  segmentId?: string | null;
}

type TabValue = "empresas" | "estrutura_dre" | "estrutura_fluxo_caixa" | "kpis" | "departamentos" | "socios";

export function SettingsTabs({
  companies,
  companiesWithDepartments,
  dreAccounts,
  cashFlowAccounts,
  kpis,
  segmentId,
}: SettingsTabsProps) {
  const [tab, setTab] = useState<TabValue>("empresas");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b pb-3">
        <Button type="button" variant={tab === "empresas" ? "default" : "outline"} onClick={() => setTab("empresas")}>
          Empresas
        </Button>
        <Button type="button" variant={tab === "estrutura_dre" ? "default" : "outline"} onClick={() => setTab("estrutura_dre")}>
          Estrutura DRE
        </Button>
        <Button type="button" variant={tab === "estrutura_fluxo_caixa" ? "default" : "outline"} onClick={() => setTab("estrutura_fluxo_caixa")}>
          Estrutura Fluxo de Caixa
        </Button>
        <Button type="button" variant={tab === "kpis" ? "default" : "outline"} onClick={() => setTab("kpis")}>
          KPIs
        </Button>
        <Button type="button" variant={tab === "departamentos" ? "default" : "outline"} onClick={() => setTab("departamentos")}>
          Departamentos
        </Button>
        <Button type="button" variant={tab === "socios" ? "default" : "outline"} onClick={() => setTab("socios")}>
          Socios
        </Button>
      </div>

      {tab === "empresas" ? (
        <SettingsCompanies initialCompanies={companies} segmentId={segmentId ?? null} />
      ) : tab === "estrutura_dre" ? (
        <DreStructureManager initialAccounts={dreAccounts} />
      ) : tab === "estrutura_fluxo_caixa" ? (
        <CashFlowStructureManager initialAccounts={cashFlowAccounts} />
      ) : tab === "kpis" ? (
        <KpiAdminManager
          initialKpis={kpis}
          dreAccounts={dreAccounts.map((account) => ({ code: account.code, name: account.name }))}
        />
      ) : tab === "departamentos" ? (
        <SettingsDepartments companies={companiesWithDepartments} />
      ) : (
        <SettingsPartners companies={companies.map((c) => ({ id: c.id, name: c.name }))} />
      )}
    </div>
  );
}
