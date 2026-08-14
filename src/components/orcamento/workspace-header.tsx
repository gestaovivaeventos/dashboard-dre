"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { workspaceHubHref, workspaceConfigHref } from "@/lib/orcamento/workspace-tabs";

/**
 * Cabeçalho do workspace do orçamento. Empresa e ano são FIXOS (texto, sem
 * seletor): a empresa/ano escolhidos no painel seguem o analista, e trocar de
 * empresa/ano se faz voltando ao painel (a seta). Assim o orçamento não é
 * preenchido na empresa errada por um dropdown esquecido.
 *
 * Adaptativo pela rota (segmentos após `/empresa/[companyId]/[ano]`):
 *  - HUB da empresa (as "caixas"): empresa · ano em destaque; "voltar" → painel.
 *  - módulo (pessoal/media): só "voltar" → hub. Trocar de método é pelo hub de
 *    caixas (sem abas de módulo no topo — decisão da usuária 14/08/2026).
 *  - sub-hub de Configuração: "voltar" → hub (as caixas de config navegam).
 *  - seção de Configuração: só "voltar" → sub-hub (trocar de seção é pelas
 *    caixas do sub-hub, sem abas no topo — decisão da usuária 14/08/2026).
 * Nunca há bloco de empresa/ano com dropdown, nem abas de navegação.
 */
export function WorkspaceHeader({
  companyName,
  companyId,
  year,
}: {
  companyName: string;
  companyId: string;
  year: number;
}) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  // ["orcamento","empresa",companyId,ano, ...rest]
  const rest = segments.slice(4);

  const isHub = rest.length === 0;
  const isConfigArea = rest[0] === "config";
  const isConfigSubHub = isConfigArea && rest.length === 1;
  const isModule = !isHub && !isConfigArea;

  // Destino e rótulo do "voltar".
  let backHref = "/orcamento";
  let backLabel = "Painel do orçamento";
  if (isModule || isConfigSubHub) {
    backHref = workspaceHubHref(companyId, year);
    backLabel = `Orçamento de ${companyName} · ${year}`;
  } else if (isConfigArea) {
    backHref = workspaceConfigHref(companyId, year);
    backLabel = `Configuração de ${companyName}`;
  }

  return (
    <div className="space-y-4">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {backLabel}
      </Link>

      {/* Empresa · ano em destaque — só no hub da empresa, sempre texto fixo. */}
      {isHub && (
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{companyName}</h1>
          <p className="text-muted-foreground">Orçamento {year}</p>
        </div>
      )}
    </div>
  );
}
