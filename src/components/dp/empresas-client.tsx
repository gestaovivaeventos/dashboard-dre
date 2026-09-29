"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "@/components/ui/toaster";
import { salvarRegraEmpresa } from "@/lib/dp/actions";
import type { DpOrigemParaMapear } from "@/lib/dp/empresa";
import type { DpCompanyRef } from "@/lib/dp/queries";

/**
 * De-para Sólides → empresa. Uma linha por unidade (e por departamento de quem
 * não tem unidade); escolher a empresa grava na hora e vale para todos os
 * colaboradores daquela origem, inclusive os que entrarem depois.
 */
export function DpEmpresasClient({ origens, companies }: { origens: DpOrigemParaMapear[]; companies: DpCompanyRef[] }) {
  const unidades = origens.filter((o) => o.origem === "unidade");
  const departamentos = origens.filter((o) => o.origem === "departamento");
  return (
    <div className="space-y-6">
      <Bloco
        titulo="Unidades da Sólides"
        explicacao="A unidade é o que decide a empresa. Colaborador com unidade sem empresa definida fica como pendência — não cai no departamento."
        origens={unidades}
        companies={companies}
      />
      <Bloco
        titulo="Departamentos (só de quem está sem unidade)"
        explicacao="Usados apenas quando o colaborador não tem unidade na Sólides. Quando o DP completar o cadastro lá, a unidade passa a valer."
        origens={departamentos}
        companies={companies}
      />
    </div>
  );
}

function Bloco({
  titulo,
  explicacao,
  origens,
  companies,
}: {
  titulo: string;
  explicacao: string;
  origens: DpOrigemParaMapear[];
  companies: DpCompanyRef[];
}) {
  const pendentes = origens.filter((o) => !o.companyId && o.colaboradores > 0).length;
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold text-ink-primary">
          {titulo}
          {pendentes > 0 && (
            <span className="ml-2 text-sm font-normal text-amber-700 dark:text-amber-400">{pendentes} sem empresa</span>
          )}
        </h2>
        <p className="text-sm text-ink-muted">{explicacao}</p>
      </div>
      {origens.length === 0 ? (
        <p className="text-sm text-ink-muted">Nada para mapear.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-ink-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Na Sólides</th>
                <th className="px-3 py-2 text-right font-medium">Colaboradores ativos</th>
                <th className="px-3 py-2 font-medium">Empresa no Control Hub</th>
              </tr>
            </thead>
            <tbody>
              {origens.map((o) => (
                <Linha key={`${o.origem}:${o.solidesId}`} origem={o} companies={companies} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Linha({ origem, companies }: { origem: DpOrigemParaMapear; companies: DpCompanyRef[] }) {
  const [value, setValue] = useState(origem.companyId ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const onChange = (next: string) => {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const res = await salvarRegraEmpresa({
        origem: origem.origem,
        solidesId: origem.solidesId,
        solidesNome: origem.nome,
        companyId: next || null,
      });
      if (!res.ok) {
        setValue(previous);
        showToast({ title: "Não salvo", description: res.error, variant: "destructive" });
        return;
      }
      router.refresh();
    });
  };

  const pendente = !value && origem.colaboradores > 0;
  return (
    <tr className={`border-t border-border ${pendente ? "bg-amber-500/5" : ""}`}>
      <td className="px-3 py-2 text-ink-primary">{origem.nome}</td>
      <td className="px-3 py-2 text-right tabular-nums">{origem.colaboradores}</td>
      <td className="px-3 py-2">
        <select
          value={value}
          disabled={pending}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`Empresa de ${origem.nome}`}
          className="w-full max-w-xs rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-60"
        >
          <option value="">— sem empresa —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}
