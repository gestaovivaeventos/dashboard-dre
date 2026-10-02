"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Wand2 } from "lucide-react";

import { FilterTable, type FilterColumn } from "@/components/data-table/filter-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";
import {
  excluirCargo,
  excluirNivel,
  salvarCargo,
  salvarNivel,
  vincularCargosSolides,
  type DpCargoResult,
} from "@/lib/dp/actions-cargos";
import { ROTULO_ENQUADRAMENTO, type DpEnquadramentoStatus, type DpEstruturaCargo } from "@/lib/dp/cargos";
import type { DpCargoSolidesUso, DpCargosPagina, DpEnquadramentoRow } from "@/lib/dp/cargos-queries";
import { formatBRL } from "@/lib/orcamento/format";

/** "4.500,00", "4500", "4500.5" → número; vazio/ilegível → null. */
function parseValor(v: string): number | null {
  const s = v.replace(/R\$/i, "").replace(/\s/g, "");
  if (!s) return null;
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const inputCls = "rounded-md border border-input bg-background px-2 py-1 text-sm disabled:opacity-60";

function useAcao() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();
  const rodar = <T,>(fn: () => Promise<DpCargoResult<T>>, ok?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) showToast({ title: "Não salvo", description: res.error, variant: "destructive" });
      else if (ok) showToast({ title: ok, variant: "success" });
      router.refresh();
    });
  return { pending, rodar };
}

export function DpCargosClient({ companyId, companyName, pagina }: { companyId: string; companyName: string; pagina: DpCargosPagina }) {
  const pendentes = pagina.cargosSolides.filter((c) => !c.nivelId);
  return (
    <div className="space-y-6">
      <Estrutura companyId={companyId} companyName={companyName} estrutura={pagina.estrutura} />
      <DeParaSolides companyId={companyId} estrutura={pagina.estrutura} cargos={pagina.cargosSolides} pendentes={pendentes.length} />
      <Enquadramento rows={pagina.enquadramento} semCargo={pagina.semCargo} />
    </div>
  );
}

// ── 1. Estrutura ────────────────────────────────────────────────────────────

function Estrutura({ companyId, companyName, estrutura }: { companyId: string; companyName: string; estrutura: DpEstruturaCargo[] }) {
  const [novo, setNovo] = useState("");
  const { pending, rodar } = useAcao();
  const criar = () => {
    if (!novo.trim()) return;
    rodar(() => salvarCargo({ companyId, nome: novo }));
    setNovo("");
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Estrutura de cargos — {companyName}</CardTitle>
        <p className="text-sm text-ink-muted">Cada cargo tem seus níveis, e cada nível tem um salário.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criar()}
            placeholder="Novo cargo (ex.: Analista Comercial)"
            className={`${inputCls} w-72`}
            disabled={pending}
          />
          <button
            type="button"
            onClick={criar}
            disabled={pending || !novo.trim()}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1 text-sm font-medium hover:bg-surface-2 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" /> Adicionar cargo
          </button>
        </div>
        {estrutura.length === 0 ? (
          <p className="text-sm text-ink-muted">Nenhum cargo cadastrado nesta empresa ainda.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {estrutura.map((c) => (
              <CargoCard key={c.cargoId} companyId={companyId} cargo={c} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CargoCard({ companyId, cargo }: { companyId: string; cargo: DpEstruturaCargo }) {
  const [nome, setNome] = useState(cargo.cargoNome);
  const [novoNivel, setNovoNivel] = useState("");
  const [novoSalario, setNovoSalario] = useState("");
  const { pending, rodar } = useAcao();

  const renomear = () => {
    if (nome.trim() && nome.trim() !== cargo.cargoNome) rodar(() => salvarCargo({ companyId, id: cargo.cargoId, nome }));
  };
  const adicionar = () => {
    const salario = parseValor(novoSalario);
    if (!novoNivel.trim() || salario === null) return;
    rodar(() => salvarNivel({ companyId, cargoId: cargo.cargoId, nome: novoNivel, salario }));
    setNovoNivel("");
    setNovoSalario("");
  };
  const excluir = () => {
    if (window.confirm(`Excluir o cargo "${cargo.cargoNome}" e os ${cargo.niveis.length} nível(is) dele? Quem estava vinculado volta a ficar sem nível.`)) {
      rodar(() => excluirCargo({ companyId, id: cargo.cargoId }), "Cargo excluído");
    }
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onBlur={renomear}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className={`${inputCls} flex-1 font-medium`}
          disabled={pending}
          aria-label="Nome do cargo"
        />
        <button type="button" onClick={excluir} disabled={pending} className="rounded p-1 text-ink-muted hover:text-red-600" aria-label="Excluir cargo">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {cargo.niveis.map((n) => (
            <NivelLinha key={n.id} companyId={companyId} cargoId={cargo.cargoId} nivel={n} />
          ))}
          <tr>
            <td className="py-1 pr-2">
              <input value={novoNivel} onChange={(e) => setNovoNivel(e.target.value)} placeholder="Nível (ex.: Pleno I)" className={`${inputCls} w-full`} disabled={pending} />
            </td>
            <td className="py-1 pr-2">
              <input
                value={novoSalario}
                onChange={(e) => setNovoSalario(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && adicionar()}
                placeholder="Salário"
                inputMode="decimal"
                className={`${inputCls} w-32 text-right`}
                disabled={pending}
              />
            </td>
            <td className="py-1 text-right">
              <button
                type="button"
                onClick={adicionar}
                disabled={pending || !novoNivel.trim() || parseValor(novoSalario) === null}
                className="rounded p-1 text-ink-muted hover:text-ink-primary disabled:opacity-40"
                aria-label="Adicionar nível"
              >
                <Plus className="h-4 w-4" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function NivelLinha({ companyId, cargoId, nivel }: { companyId: string; cargoId: string; nivel: { id: string; nome: string; salario: number } }) {
  const [nome, setNome] = useState(nivel.nome);
  const [salario, setSalario] = useState(nivel.salario.toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
  const { pending, rodar } = useAcao();
  const salvar = () => {
    const v = parseValor(salario);
    if (!nome.trim() || v === null) return;
    if (nome.trim() === nivel.nome && Math.abs(v - nivel.salario) < 0.005) return;
    rodar(() => salvarNivel({ companyId, cargoId, id: nivel.id, nome, salario: v }));
  };
  return (
    <tr className="border-b border-border/60">
      <td className="py-1 pr-2">
        <input value={nome} onChange={(e) => setNome(e.target.value)} onBlur={salvar} className={`${inputCls} w-full`} disabled={pending} aria-label="Nome do nível" />
      </td>
      <td className="py-1 pr-2">
        <input
          value={salario}
          onChange={(e) => setSalario(e.target.value)}
          onBlur={salvar}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          inputMode="decimal"
          className={`${inputCls} w-32 text-right tabular-nums`}
          disabled={pending}
          aria-label="Salário do nível"
        />
      </td>
      <td className="py-1 text-right">
        <button
          type="button"
          onClick={() => window.confirm(`Excluir o nível "${nivel.nome}"?`) && rodar(() => excluirNivel({ companyId, cargoId, id: nivel.id }))}
          disabled={pending}
          className="rounded p-1 text-ink-muted hover:text-red-600"
          aria-label="Excluir nível"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

// ── 2. De-para Sólides → nível ──────────────────────────────────────────────

function DeParaSolides({
  companyId,
  estrutura,
  cargos,
  pendentes,
}: {
  companyId: string;
  estrutura: DpEstruturaCargo[];
  cargos: DpCargoSolidesUso[];
  pendentes: number;
}) {
  const { pending, rodar } = useAcao();
  const rotulo = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of estrutura) for (const n of c.niveis) m.set(n.id, `${c.cargoNome} — ${n.nome} (${formatBRL(n.salario)})`);
    return m;
  }, [estrutura]);
  const sugestoes = cargos.filter((c) => !c.nivelId && c.sugestaoNivelId);

  const gravar = (itens: Array<{ solidesCargoId: number; solidesCargoNome: string; nivelId: string | null }>, ok?: string) =>
    rodar(() => vincularCargosSolides({ companyId, itens }), ok);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Cargos da Sólides nesta empresa
              {pendentes > 0 && <span className="ml-2 text-sm font-normal text-amber-700 dark:text-amber-400">{pendentes} sem nível</span>}
            </CardTitle>
            <p className="text-sm text-ink-muted">
              Diga a qual nível da estrutura cada cargo da Sólides corresponde. Vale para todos desta empresa com aquele cargo.
            </p>
          </div>
          {sugestoes.length > 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                gravar(
                  sugestoes.map((s) => ({ solidesCargoId: s.solidesCargoId, solidesCargoNome: s.nome, nivelId: s.sugestaoNivelId })),
                  `${sugestoes.length} sugestão(ões) aplicada(s)`,
                )
              }
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-60"
            >
              <Wand2 className="h-4 w-4" /> Aplicar {sugestoes.length} sugestão(ões)
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {cargos.length === 0 ? (
          <p className="text-sm text-ink-muted">Nenhum colaborador ativo desta empresa tem cargo na Sólides.</p>
        ) : estrutura.length === 0 ? (
          <p className="text-sm text-ink-muted">Cadastre a estrutura acima para poder vincular os {cargos.length} cargos da Sólides.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-ink-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Cargo na Sólides</th>
                  <th className="py-2 pr-3 text-right font-medium">Pessoas</th>
                  <th className="py-2 font-medium">Nível na estrutura</th>
                </tr>
              </thead>
              <tbody>
                {cargos.map((c) => (
                  <tr key={c.solidesCargoId} className={`border-b border-border last:border-0 ${c.nivelId ? "" : "bg-amber-500/5"}`}>
                    <td className="py-1.5 pr-3 text-ink-primary">{c.nome}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{c.colaboradores}</td>
                    <td className="py-1.5">
                      <select
                        value={c.nivelId ?? ""}
                        disabled={pending}
                        onChange={(e) => gravar([{ solidesCargoId: c.solidesCargoId, solidesCargoNome: c.nome, nivelId: e.target.value || null }])}
                        className={`${inputCls} w-full max-w-md`}
                        aria-label={`Nível de ${c.nome}`}
                      >
                        <option value="">— sem nível —</option>
                        {estrutura.map((cg) => (
                          <optgroup key={cg.cargoId} label={cg.cargoNome}>
                            {cg.niveis.map((n) => (
                              <option key={n.id} value={n.id}>
                                {cg.cargoNome} — {n.nome} ({formatBRL(n.salario)})
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      {!c.nivelId && c.sugestaoNivelId && (
                        <p className="mt-0.5 text-xs text-ink-muted">Sugestão pelo nome: {rotulo.get(c.sugestaoNivelId)}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 3. Enquadramento ───────────────────────────────────────────────────────

const STATUS_ORDEM: DpEnquadramentoStatus[] = ["abaixo", "acima", "no_nivel", "sem_salario", "sem_vinculo", "sem_empresa"];

function Enquadramento({ rows, semCargo }: { rows: DpEnquadramentoRow[]; semCargo: number }) {
  const columns = useMemo<FilterColumn<DpEnquadramentoRow>[]>(
    () => [
      {
        key: "nome",
        label: "Nome",
        plain: (r) => r.nome,
        sortVal: (r) => r.nome.toLowerCase(),
        cell: (r) => (
          <Link href={`/dp/colaboradores/${r.colaboradorId}`} className="font-medium text-ink-primary hover:underline">
            {r.nome}
          </Link>
        ),
      },
      { key: "cargo", label: "Cargo na Sólides", plain: (r) => r.cargoSolides ?? "—", sortVal: (r) => (r.cargoSolides ?? "").toLowerCase() },
      { key: "nivel", label: "Nível", plain: (r) => r.nivelRotulo ?? "—", sortVal: (r) => (r.nivelRotulo ?? "").toLowerCase() },
      {
        key: "salario",
        label: "Salário",
        kind: "number",
        align: "right",
        plain: (r) => (r.salario === null ? "—" : formatBRL(r.salario)),
        sortVal: (r) => r.salario ?? -1,
        numeric: (r) => r.salario,
      },
      {
        key: "salarioNivel",
        label: "Salário do nível",
        kind: "number",
        align: "right",
        plain: (r) => (r.salarioNivel === null ? "—" : formatBRL(r.salarioNivel)),
        sortVal: (r) => r.salarioNivel ?? -1,
        numeric: (r) => r.salarioNivel,
      },
      {
        key: "diferenca",
        label: "Diferença",
        kind: "number",
        align: "right",
        plain: (r) =>
          r.enquadramento.diferenca === null
            ? "—"
            : `${formatBRL(r.enquadramento.diferenca)}${r.enquadramento.percentual === null ? "" : ` (${r.enquadramento.percentual > 0 ? "+" : ""}${r.enquadramento.percentual.toLocaleString("pt-BR")}%)`}`,
        sortVal: (r) => r.enquadramento.percentual ?? -9999,
        numeric: (r) => r.enquadramento.diferenca,
        cell: (r) => {
          const d = r.enquadramento.diferenca;
          if (d === null) return "—";
          const cor = r.enquadramento.status === "abaixo" ? "text-amber-700 dark:text-amber-400" : r.enquadramento.status === "acima" ? "text-sky-700 dark:text-sky-400" : "";
          const p = r.enquadramento.percentual;
          return (
            <span className={`tabular-nums ${cor}`}>
              {formatBRL(d)}
              {p !== null && ` (${p > 0 ? "+" : ""}${p.toLocaleString("pt-BR")}%)`}
            </span>
          );
        },
      },
      {
        key: "situacao",
        label: "Situação",
        plain: (r) => ROTULO_ENQUADRAMENTO[r.enquadramento.status],
        sortVal: (r) => STATUS_ORDEM.indexOf(r.enquadramento.status),
      },
    ],
    [],
  );

  const conta = new Map<DpEnquadramentoStatus, number>();
  for (const r of rows) conta.set(r.enquadramento.status, (conta.get(r.enquadramento.status) ?? 0) + 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Enquadramento</CardTitle>
        <p className="text-sm text-ink-muted">
          {STATUS_ORDEM.filter((s) => conta.get(s))
            .map((s) => `${conta.get(s)} ${ROTULO_ENQUADRAMENTO[s].toLowerCase()}`)
            .join(" · ") || "Nenhum colaborador ativo nesta empresa."}
          {semCargo > 0 && ` · ${semCargo} sem cargo na Sólides`}
        </p>
      </CardHeader>
      <CardContent>
        <FilterTable rows={rows} columns={columns} rowKey={(r) => r.colaboradorId} emptyMessage="Nenhum colaborador ativo nesta empresa." />
        <p className="mt-2 text-xs text-ink-muted">
          Salário é o cadastrado na Sólides; o do nível é o desta estrutura. Diferença de menos de R$ 1 conta como “no salário do
          nível”. Abaixo em âmbar, acima em azul.
        </p>
      </CardContent>
    </Card>
  );
}
