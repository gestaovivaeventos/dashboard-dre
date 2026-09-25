import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { getIndices } from "@/lib/orcamento/actions/indices";
import {
  CONFIG_GERAIS_SECOES,
  configGeraisHref,
  isConfigGeralSecao,
} from "@/lib/orcamento/workspace-tabs";
import { IndicesManager } from "@/components/orcamento/indices-manager";

export const dynamic = "force-dynamic";

function MigrationNotice({ migration }: { migration: string }) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
      <p className="font-medium">Migration pendente</p>
      <p className="mt-1 text-muted-foreground">
        A tabela desta tela ainda não foi aplicada no banco (
        <code className="rounded bg-muted px-1 py-0.5">{migration}</code>).
      </p>
    </div>
  );
}

// Seção das Configurações gerais. O guard admin está aqui e no layout da
// subárvore; o rótulo e a descrição vêm de CONFIG_GERAIS_SECOES, fonte única.
export default async function ConfiguracoesGeraisSecaoPage({
  params,
}: {
  params: { secao: string };
}) {
  if (!(await getOrcamentoAdmin())) redirect("/orcamento");
  if (!isConfigGeralSecao(params.secao)) notFound();

  const meta = CONFIG_GERAIS_SECOES.find((s) => s.slug === params.secao)!;

  const { items, error, needsMigration } = await getIndices();
  const body = needsMigration ? (
    <MigrationNotice migration="20260727150000_orcamento_indices" />
  ) : error ? (
    <p className="text-sm text-destructive">{error}</p>
  ) : (
    <IndicesManager initialItems={items ?? []} />
  );

  return (
    <div className="space-y-4">
      <Link
        href={configGeraisHref()}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Configurações gerais
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{meta.label}</h1>
        <p className="text-muted-foreground">{meta.desc}</p>
      </div>

      {params.secao === "indices" && (
        <p className="text-sm text-muted-foreground">
          Cada ano é congelado de forma independente — cadastrar um ano novo não altera os
          anteriores, então orçamentos já feitos não mudam.
        </p>
      )}

      {body}
    </div>
  );
}
