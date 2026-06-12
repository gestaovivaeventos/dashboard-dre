"use client";

import { useState } from "react";

import { CashFlowStructureManager, type CashFlowAccountItem } from "@/components/app/cash-flow-structure-manager";
import { DreStructureManager } from "@/components/app/dre-structure-manager";
import { KpiAdminManager } from "@/components/app/kpi-admin-manager";
import { SegmentSelector } from "@/components/app/segment-selector";
import { SettingsDepartments } from "@/components/app/settings-departments";
import { SettingsPartners } from "@/components/app/settings-partners";
import { Button } from "@/components/ui/button";
import type { KpiDefinition } from "@/lib/kpi/calc";
import type { Segment } from "@/lib/supabase/types";

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
      routed_to_company_id: string | null;
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
  segments?: Segment[];
  currentSegmentSlug?: string;
  // Empresas do sistema inteiro (cross-segment) - usado pelo "Copiar Plano de Contas"
  allCompanies?: Array<{ id: string; name: string }>;
}

type TabValue = "estrutura_dre" | "estrutura_fluxo_caixa" | "kpis" | "departamentos" | "socios";

export function SettingsTabs({
  companies,
  companiesWithDepartments,
  dreAccounts,
  cashFlowAccounts,
  kpis,
  segments,
  currentSegmentSlug,
  allCompanies,
}: SettingsTabsProps) {
  // A aba "Empresas" foi migrada para o novo Painel Administrador
  // (/s/<slug>/painel-administrador). As demais abas permanecem aqui.
  const [tab, setTab] = useState<TabValue>("estrutura_dre");

  return (
    <div className="space-y-4">
      {segments && segments.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-ink-secondary">Segmento:</span>
          <SegmentSelector segments={segments} activeSlug={currentSegmentSlug ?? null} />
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-b pb-3">
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

      {tab === "estrutura_dre" ? (
        <DreStructureManager
          initialAccounts={dreAccounts}
          companies={companies.map((c) => ({ id: c.id, name: c.name }))}
          allCompanies={allCompanies ?? companies.map((c) => ({ id: c.id, name: c.name }))}
        />
      ) : tab === "estrutura_fluxo_caixa" ? (
        <CashFlowStructureManager
          initialAccounts={cashFlowAccounts}
          companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        />
      ) : tab === "kpis" ? (
        <KpiAdminManager
          initialKpis={kpis}
          dreAccounts={dreAccounts.map((account) => ({ code: account.code, name: account.name }))}
        />
      ) : tab === "departamentos" ? (
        <SettingsDepartments
          companies={companiesWithDepartments}
          allCompanies={allCompanies ?? companies.map((c) => ({ id: c.id, name: c.name }))}
        />
      ) : (
        <SettingsPartners companies={companies.map((c) => ({ id: c.id, name: c.name }))} />
      )}
    </div>
  );
}
