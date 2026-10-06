"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";
import { excluirCentroCusto, salvarCentroCusto, type DpCadastroResult } from "@/lib/dp/actions-cadastro";

interface Centro {
  id: string;
  codigo: string;
  nome: string;
  linhas: number;
  pessoas: number;
}

const inputCls = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm disabled:opacity-60";

function useAcao() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();
  const rodar = <T,>(fn: () => Promise<DpCadastroResult<T>>, ok?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) showToast({ title: "Não salvo", description: res.error, variant: "destructive" });
      else ok?.();
      router.refresh();
    });
  return { pending, rodar };
}

export function DpCentrosCustoClient({
  companyId,
  centros,
  semCentro,
  ativos,
}: {
  companyId: string;
  centros: Centro[];
  semCentro: number;
  ativos: number;
}) {
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const { pending, rodar } = useAcao();
  const criar = () => {
    if (!nome.trim()) return;
    rodar(
      () => salvarCentroCusto({ companyId, codigo, nome }),
      () => {
        setCodigo("");
        setNome("");
      },
    );
  };

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        {semCentro > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {semCentro} de {ativos} pessoa(s) ainda sem centro de custo — defina o padrão de cada linha na tabela salarial (Cargos e
            salários).
          </p>
        )}
        <table className="w-full text-sm">
          <thead className="text-left text-ink-muted">
            <tr className="border-b border-border">
              <th className="w-32 py-2 pr-2 font-medium">Código</th>
              <th className="py-2 pr-2 font-medium">Nome</th>
              <th className="w-28 py-2 pr-2 text-right font-medium">Linhas</th>
              <th className="w-24 py-2 pr-2 text-right font-medium">Pessoas</th>
              <th className="w-10 py-2" />
            </tr>
          </thead>
          <tbody>
            {centros.map((c) => (
              <LinhaCentro key={`${c.id}:${c.codigo}:${c.nome}`} companyId={companyId} centro={c} />
            ))}
            <tr>
              <td className="py-1 pr-2">
                <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Código" className={inputCls} disabled={pending} />
              </td>
              <td className="py-1 pr-2">
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && criar()}
                  placeholder="Nome do centro de custo"
                  className={inputCls}
                  disabled={pending}
                />
              </td>
              <td colSpan={3} className="py-1 text-right">
                <button
                  type="button"
                  onClick={criar}
                  disabled={pending || !nome.trim()}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" /> Adicionar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        {centros.length === 0 && <p className="text-sm text-ink-muted">Nenhum centro de custo cadastrado nesta empresa.</p>}
      </CardContent>
    </Card>
  );
}

function LinhaCentro({ companyId, centro }: { companyId: string; centro: Centro }) {
  const [codigo, setCodigo] = useState(centro.codigo);
  const [nome, setNome] = useState(centro.nome);
  const { pending, rodar } = useAcao();
  const salvar = () => {
    if (!nome.trim()) {
      setNome(centro.nome);
      return;
    }
    if (codigo.trim() !== centro.codigo || nome.trim() !== centro.nome) {
      rodar(() => salvarCentroCusto({ companyId, id: centro.id, codigo, nome }));
    }
  };
  const excluir = () => {
    const uso =
      centro.linhas || centro.pessoas
        ? `\n\n${centro.linhas} linha(s) da tabela e ${centro.pessoas} pessoa(s) usam este centro e ficarão sem centro de custo.`
        : "";
    if (window.confirm(`Excluir o centro de custo "${centro.nome}"?${uso}`)) rodar(() => excluirCentroCusto({ companyId, id: centro.id }));
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && e.currentTarget.blur();
  return (
    <tr className="border-b border-border/60">
      <td className="py-1 pr-2">
        <input value={codigo} onChange={(e) => setCodigo(e.target.value)} onBlur={salvar} onKeyDown={onKey} className={inputCls} disabled={pending} aria-label="Código" />
      </td>
      <td className="py-1 pr-2">
        <input value={nome} onChange={(e) => setNome(e.target.value)} onBlur={salvar} onKeyDown={onKey} className={inputCls} disabled={pending} aria-label="Nome" />
      </td>
      <td className="py-1 pr-2 text-right tabular-nums text-ink-muted">{centro.linhas || "—"}</td>
      <td className="py-1 pr-2 text-right tabular-nums text-ink-muted">{centro.pessoas || "—"}</td>
      <td className="py-1 text-right">
        <button type="button" onClick={excluir} disabled={pending} className="rounded p-1 text-ink-muted hover:text-red-600" aria-label="Excluir">
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}
