import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Landmark,
  SlidersHorizontal,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { CONFIG_SECOES, workspaceConfigSecaoHref } from "@/lib/orcamento/workspace-tabs";

// Ícone por seção (rótulo/descrição vêm de CONFIG_SECOES, fonte única).
const SECAO_ICON: Record<string, LucideIcon> = {
  "orcar-por-setor": SlidersHorizontal,
  setores: Building2,
  "categoria-metodo": Workflow,
  "plano-cargos": Users,
  "empresa-encargos": Building2,
  encargos: Landmark,
};

/**
 * Sub-hub de Configuração da empresa: caixas para cada seção de config POR
 * EMPRESA. Espelha o hub de módulos, um nível abaixo. Os "Índices de correção"
 * (globais) NÃO entram aqui — vivem em Configurações gerais.
 */
export function ConfigHub({ companyId, year }: { companyId: string; year: number }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Configuração do orçamento</h2>
        <p className="text-sm text-muted-foreground">
          Ajustes desta empresa para o orçamento {year}. Os índices de correção, por serem globais,
          ficam em Configurações gerais.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CONFIG_SECOES.map((s) => {
          const Icon = SECAO_ICON[s.slug] ?? SlidersHorizontal;
          return (
            <Link
              key={s.slug}
              href={workspaceConfigSecaoHref(companyId, year, s.slug)}
              className="group flex min-h-[8.5rem] flex-col rounded-xl border bg-card p-5 transition-colors hover:border-emerald-500/40 hover:bg-muted/40"
            >
              <div className="flex items-start justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600 dark:text-emerald-400">
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="mt-3">
                <div className="font-semibold">{s.label}</div>
                <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
