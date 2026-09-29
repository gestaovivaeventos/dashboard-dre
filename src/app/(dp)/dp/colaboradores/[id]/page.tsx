import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTimeBR, formatDayBR } from "@/lib/ctrl/datetime";
import { getDpUser } from "@/lib/dp/auth";
import { MOTIVO_SEM_EMPRESA } from "@/lib/dp/empresa";
import { DpNaoInstaladoError, getDpColaborador } from "@/lib/dp/queries";
import { formatBRL } from "@/lib/orcamento/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatCpf(cpf: string | null): string {
  if (!cpf || cpf.length !== 11) return "—";
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

function formatCep(cep: string | null): string | null {
  return cep && cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : null;
}

export default async function DpColaboradorPage({ params }: { params: { id: string } }) {
  const user = await getDpUser();
  if (!user) redirect("/");
  if (!UUID.test(params.id)) notFound();

  let c;
  try {
    c = await getDpColaborador(createAdminClient(), params.id);
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado />;
    throw error;
  }
  if (!c) notFound();

  const end = c.endereco;
  const enderecoLinhas = end
    ? [
        [end.logradouro, end.numero].filter(Boolean).join(", "),
        [end.complemento, end.bairro].filter(Boolean).join(" · "),
        [end.cidade, end.uf].filter(Boolean).join(" / "),
        formatCep(end.cep),
      ].filter((l): l is string => Boolean(l))
    : [];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/dp/colaboradores" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink-primary">
        <ArrowLeft className="h-4 w-4" /> Colaboradores
      </Link>

      <div>
        <h1 className="text-xl font-semibold text-ink-primary">{c.nome}</h1>
        <p className="text-sm text-ink-muted">
          {[c.cargoNome, c.companyName].filter(Boolean).join(" · ") || "—"}
          {!c.ativo && " · Desligado"}
        </p>
      </div>

      {!c.companyName && c.empresa.companyId === null && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          {MOTIVO_SEM_EMPRESA[c.empresa.motivo]}.{" "}
          <Link href="/dp/empresas" className="underline">
            Ver de-para
          </Link>
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Vínculo</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <Campo label="Empresa" value={c.companyName} />
              <Campo label="Unidade (Sólides)" value={c.unidadeNome} />
              <Campo label="Departamento" value={c.departamentoNome} />
              <Campo label="Cargo" value={c.cargoNome} />
              <Campo label="Contrato" value={c.tipoContrato} />
              <Campo label="Gestor" value={c.gestorNome} />
              <Campo label="Admissão" value={formatDayBR(c.dataAdmissao)} />
              {(!c.ativo || c.dataDesligamento) && (
                <Campo
                  label="Desligamento"
                  value={
                    c.dataDesligamento
                      ? formatDayBR(c.dataDesligamento)
                      : `saiu da Sólides em ${formatDateTimeBR(c.desligadoDetectadoEm)}`
                  }
                />
              )}
              <Campo label="Salário" value={c.salario === null ? "não informado na Sólides" : formatBRL(c.salario)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pessoal</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <Campo label="CPF" value={formatCpf(c.cpf)} />
              <Campo label="E-mail" value={c.email} />
              <dt className="text-ink-muted">Endereço</dt>
              <dd className="text-ink-primary">
                {enderecoLinhas.length > 0 ? enderecoLinhas.map((l) => <div key={l}>{l}</div>) : "—"}
              </dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-ink-muted">
        Dados bancários, documentos e filiação ficam só na Sólides. Ficha lida da Sólides em{" "}
        {formatDateTimeBR(c.fichaSincronizadaEm ?? c.sincronizadoEm)}.
      </p>
    </div>
  );
}

function Campo({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink-primary">{value || "—"}</dd>
    </>
  );
}
