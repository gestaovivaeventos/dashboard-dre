import Link from "next/link";
import { ArrowRight, Percent, Tags, type LucideIcon } from "lucide-react";

import { CONFIG_GERAIS_SECOES, configGeraisSecaoHref } from "@/lib/orcamento/workspace-tabs";

// Ícone por seção (rótulo/descrição vêm de CONFIG_GERAIS_SECOES, fonte única).
const SECAO_ICON: Record<string, LucideIcon> = {
  indices: Percent,
  grupos: Tags,
};

/**
 * Hub das Configurações gerais do módulo — caixas para cada seção.
 *
 * Espelha o `ConfigHub` da empresa, um nível acima. A diferença de escopo é o
 * que separa os dois: aqui ficam os ajustes que valem para TODAS as empresas
 * (os índices) e os que precisam da empresa como FILTRO, não como contexto fixo
 * (os grupos de despesa, cuja árvore começa escolhendo a empresa).
 */
export function ConfigGeraisHub() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {CONFIG_GERAIS_SECOES.map((s) => {
        const Icon = SECAO_ICON[s.slug] ?? Tags;
        return (
          <Link
            key={s.slug}
            href={configGeraisSecaoHref(s.slug)}
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
  );
}
