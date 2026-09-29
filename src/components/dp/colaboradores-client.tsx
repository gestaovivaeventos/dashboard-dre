"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { FilterTable, type FilterColumn } from "@/components/data-table/filter-table";
import type { FilterTableSnapshot } from "@/components/data-table/filter-logic";
import { formatDayBR } from "@/lib/ctrl/datetime";
import type { DpColaboradorRow } from "@/lib/dp/queries";

const SEM_EMPRESA = "Sem empresa";
const situacao = (r: DpColaboradorRow) => (r.ativo ? "Ativo" : "Desligado");

/**
 * Abre em "Ativo": o desligado continua no espelho (é histórico), mas somá-lo
 * ao quadro daria um número de gente que não existe. O chip do filtro fica à
 * vista e sai em um clique.
 */
const INITIAL: FilterTableSnapshot = { values: { situacao: ["Ativo"] }, ranges: {}, sortKey: "nome", sortDir: "asc" };

export function DpColaboradoresClient({ rows }: { rows: DpColaboradorRow[] }) {
  const [visible, setVisible] = useState<DpColaboradorRow[]>(() => rows.filter((r) => r.ativo));

  // Memoizado: a FilterTable recalcula tudo quando `columns` muda de identidade.
  const columns = useMemo<FilterColumn<DpColaboradorRow>[]>(
    () => [
      {
        key: "nome",
        label: "Nome",
        plain: (r) => r.nome,
        sortVal: (r) => r.nome.toLowerCase(),
        cell: (r) => (
          <Link href={`/dp/colaboradores/${r.id}`} className="font-medium text-ink-primary hover:underline">
            {r.nome}
          </Link>
        ),
      },
      {
        key: "empresa",
        label: "Empresa",
        plain: (r) => r.companyName ?? SEM_EMPRESA,
        sortVal: (r) => (r.companyName ?? "￿").toLowerCase(),
        cell: (r) =>
          r.companyName ?? <span className="text-amber-700 dark:text-amber-400">{SEM_EMPRESA}</span>,
      },
      {
        key: "departamento",
        label: "Departamento",
        plain: (r) => r.departamentoNome ?? "—",
        sortVal: (r) => (r.departamentoNome ?? "").toLowerCase(),
      },
      {
        key: "cargo",
        label: "Cargo",
        plain: (r) => r.cargoNome ?? "—",
        sortVal: (r) => (r.cargoNome ?? "").toLowerCase(),
      },
      {
        key: "contrato",
        label: "Contrato",
        plain: (r) => r.tipoContrato ?? "—",
        sortVal: (r) => r.tipoContrato ?? "",
      },
      {
        key: "admissao",
        label: "Admissão",
        plain: (r) => formatDayBR(r.dataAdmissao),
        sortVal: (r) => r.dataAdmissao ?? "",
      },
      {
        key: "situacao",
        label: "Situação",
        plain: situacao,
        sortVal: situacao,
        cell: (r) => (r.ativo ? "Ativo" : <span className="text-ink-muted">Desligado</span>),
      },
    ],
    [],
  );

  const semEmpresa = visible.filter((r) => !r.companyName).length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        {visible.length} de {rows.length} colaboradores na tela
        {semEmpresa > 0 && (
          <>
            {" · "}
            <Link href="/dp/empresas" className="text-amber-700 hover:underline dark:text-amber-400">
              {semEmpresa} sem empresa
            </Link>
          </>
        )}
      </p>
      <FilterTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onVisibleChange={setVisible}
        initialState={INITIAL}
        emptyMessage={
          rows.length === 0
            ? "Nenhum colaborador ainda. Use “Sincronizar agora” para trazer o cadastro da Sólides."
            : "Nenhum colaborador corresponde aos filtros."
        }
      />
    </div>
  );
}
