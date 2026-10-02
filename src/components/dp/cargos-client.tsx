"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Percent, Plus, Search, Trash2, Upload, Wand2, X } from "lucide-react";

import { FilterTable, type FilterColumn } from "@/components/data-table/filter-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";
import {
  aplicarReajuste,
  criarLinha,
  excluirLinha,
  importarTabela,
  moverLinha,
  ordenarTabela,
  salvarLinha,
  vincularCargosSolides,
  type DpCargoResult,
  type DpImportacaoResultado,
} from "@/lib/dp/actions-cargos";
import { chaveNome, rotuloLinha, ROTULO_ENQUADRAMENTO, type DpEnquadramentoStatus } from "@/lib/dp/cargos";
import type { DpCargoSolidesUso, DpCargosPagina, DpEnquadramentoRow, DpReajusteRow, DpTabelaLinha } from "@/lib/dp/cargos-queries";
import { formatDateTimeBR } from "@/lib/ctrl/datetime";
import { lerPercentual, lerSalario, previaReajuste } from "@/lib/dp/tabela-salarial";
import { formatBRL } from "@/lib/orcamento/format";

const inputCls = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm disabled:opacity-60";
const botaoCls =
  "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-surface-2 disabled:opacity-60";

const fmtSalario = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function useAcao() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();
  const rodar = <T,>(fn: () => Promise<DpCargoResult<T>>, ok?: (d: T) => string | null) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) showToast({ title: "Não salvo", description: res.error, variant: "destructive" });
      else {
        const msg = ok?.(res.data);
        if (msg) showToast({ title: msg, variant: "success" });
      }
      router.refresh();
    });
  return { pending, rodar, showToast, router, start };
}

export function DpCargosClient({ companyId, companyName, pagina }: { companyId: string; companyName: string; pagina: DpCargosPagina }) {
  return (
    <div className="space-y-6">
      <TabelaSalarial companyId={companyId} companyName={companyName} tabela={pagina.tabela} reajustes={pagina.reajustes} />
      <DeParaSolides companyId={companyId} tabela={pagina.tabela} cargos={pagina.cargosSolides} />
      <Enquadramento rows={pagina.enquadramento} semCargo={pagina.semCargo} />
    </div>
  );
}

// ── 1. Tabela salarial ──────────────────────────────────────────────────────

function TabelaSalarial({
  companyId,
  companyName,
  tabela,
  reajustes,
}: {
  companyId: string;
  companyName: string;
  tabela: DpTabelaLinha[];
  reajustes: DpReajusteRow[];
}) {
  const { pending, rodar, showToast, router, start } = useAcao();
  const [busca, setBusca] = useState("");
  const [percentual, setPercentual] = useState("");
  const [importacao, setImportacao] = useState<DpImportacaoResultado | null>(null);
  /** Onde a linha nova está sendo digitada: depois de qual id (null = fim). undefined = nenhuma. */
  const [rascunhoDepoisDe, setRascunhoDepoisDe] = useState<string | null | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtrando = busca.trim().length > 0;
  const visiveis = useMemo(() => {
    const q = chaveNome(busca);
    if (!q) return tabela;
    return tabela.filter((l) => chaveNome(`${l.setor} ${l.cargo} ${l.step}`).includes(q));
  }, [tabela, busca]);

  const aplicar = () => {
    const lido = lerPercentual(percentual);
    if ("erro" in lido) {
      showToast({ title: "Reajuste não aplicado", description: lido.erro, variant: "destructive" });
      return;
    }
    const p = previaReajuste(
      tabela.map((l) => l.salario),
      lido.ok,
    );
    const ok = window.confirm(
      `Reajustar em ${lido.ok.toLocaleString("pt-BR")}% os ${p.linhas} salários da tabela de ${companyName}?\n\n` +
        `Soma da tabela: ${formatBRL(p.antes)} → ${formatBRL(p.depois)}.\n\nO reajuste fica registrado e não tem desfazer automático.`,
    );
    if (!ok) return;
    rodar(
      () => aplicarReajuste({ companyId, percentual }),
      (d) => {
        setPercentual("");
        return `Reajuste de ${d.percentual.toLocaleString("pt-BR")}% aplicado em ${d.linhas} salários`;
      },
    );
  };

  const importar = (file: File) => {
    const form = new FormData();
    form.set("companyId", companyId);
    form.set("file", file);
    start(async () => {
      const res = await importarTabela(form);
      if (!res.ok) showToast({ title: "Planilha não importada", description: res.error, variant: "destructive" });
      else {
        setImportacao(res.data);
        showToast({ title: "Planilha importada", variant: "success" });
      }
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  };

  const ultimo = reajustes[0];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Tabela salarial — {companyName}</CardTitle>
        <p className="text-sm text-ink-muted">
          Setor, cargo, step e salário. Todas as células são editáveis e salvam ao sair do campo.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Barra de ações */}
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/dp/tabela-salarial/modelo?companyId=${companyId}`} className={botaoCls}>
            <Download className="h-4 w-4" /> Baixar modelo
          </a>
          <button type="button" className={botaoCls} disabled={pending} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> Importar planilha
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])}
          />
          <div className="mx-1 h-6 w-px bg-border" />
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <input
                value={percentual}
                onChange={(e) => setPercentual(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && aplicar()}
                inputMode="decimal"
                placeholder="Reajuste"
                className="w-28 rounded-md border border-input bg-background py-1.5 pl-2 pr-7 text-right text-sm"
                aria-label="Percentual de reajuste"
                disabled={pending || tabela.length === 0}
              />
              <Percent className="pointer-events-none absolute right-2 top-2 h-3.5 w-3.5 text-ink-muted" />
            </div>
            <button type="button" className={botaoCls} disabled={pending || tabela.length === 0 || !percentual.trim()} onClick={aplicar}>
              Aplicar a todos
            </button>
          </div>
          <div className="mx-1 h-6 w-px bg-border" />
          <button
            type="button"
            className={botaoCls}
            disabled={pending || tabela.length < 2}
            onClick={() => rodar(() => ordenarTabela({ companyId }), () => "Tabela ordenada por setor, cargo e step")}
          >
            <ArrowUpDown className="h-4 w-4" /> Ordenar A–Z
          </button>
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-ink-muted" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar setor, cargo ou step"
              className="w-60 rounded-md border border-input bg-background py-1.5 pl-7 pr-2 text-sm"
            />
          </div>
        </div>

        {ultimo && (
          <p className="text-xs text-ink-muted">
            Último reajuste: {ultimo.percentual.toLocaleString("pt-BR")}% em {formatDateTimeBR(ultimo.aplicadoEm)}
            {ultimo.aplicadoPor ? ` por ${ultimo.aplicadoPor}` : ""} — {ultimo.linhas} salários, soma {formatBRL(ultimo.totalAntes)} →{" "}
            {formatBRL(ultimo.totalDepois)}.
          </p>
        )}

        {importacao && (
          <div className="rounded-md border border-border bg-surface-2/50 p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="text-ink-primary">
                Importação: {importacao.inseridas} linha(s) nova(s), {importacao.atualizadas} salário(s) atualizado(s),{" "}
                {importacao.iguais} sem mudança.
                {importacao.foraDaPlanilha > 0 &&
                  ` ${importacao.foraDaPlanilha} linha(s) da tabela não estavam na planilha e foram mantidas — exclua à mão se não valem mais.`}
              </p>
              <button type="button" onClick={() => setImportacao(null)} className="text-ink-muted hover:text-ink-primary" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            {importacao.problemas.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-amber-800 dark:text-amber-300">
                {importacao.problemas.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-left text-ink-muted">
              <tr className="border-b border-border">
                <th className="w-16 py-2 pr-2 font-medium" />
                <th className="py-2 pr-2 font-medium">Setor</th>
                <th className="py-2 pr-2 font-medium">Cargo</th>
                <th className="w-36 py-2 pr-2 font-medium">Step</th>
                <th className="w-36 py-2 pr-2 text-right font-medium">Salário</th>
                <th className="w-20 py-2 pr-2 text-right font-medium" title="Ativos desta empresa vinculados a esta linha">
                  Pessoas
                </th>
                <th className="w-16 py-2" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l, i) => (
                <FragmentoLinha
                  key={`${l.id}:${l.setor}:${l.cargo}:${l.step}:${l.salario}`}
                  companyId={companyId}
                  linha={l}
                  primeira={i === 0}
                  ultima={i === visiveis.length - 1}
                  podeMover={!filtrando}
                  rascunhoAqui={rascunhoDepoisDe === l.id}
                  abrirRascunho={() => setRascunhoDepoisDe(l.id)}
                  fecharRascunho={() => setRascunhoDepoisDe(undefined)}
                />
              ))}
              {rascunhoDepoisDe === null && (
                <LinhaNova companyId={companyId} depoisDeId={null} fechar={() => setRascunhoDepoisDe(undefined)} />
              )}
              {visiveis.length === 0 && rascunhoDepoisDe === undefined && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-ink-muted">
                    {tabela.length === 0 ? "Tabela vazia. Importe a planilha ou adicione a primeira linha." : "Nenhuma linha corresponde à busca."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between">
          <button type="button" className={botaoCls} disabled={pending} onClick={() => setRascunhoDepoisDe(null)}>
            <Plus className="h-4 w-4" /> Adicionar linha
          </button>
          <span className="text-xs text-ink-muted">
            {filtrando ? `${visiveis.length} de ${tabela.length} linhas` : `${tabela.length} linha(s)`}
            {filtrando && " · para mover linhas, limpe a busca"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function FragmentoLinha(props: {
  companyId: string;
  linha: DpTabelaLinha;
  primeira: boolean;
  ultima: boolean;
  podeMover: boolean;
  rascunhoAqui: boolean;
  abrirRascunho: () => void;
  fecharRascunho: () => void;
}) {
  return (
    <>
      <LinhaEditavel {...props} />
      {props.rascunhoAqui && <LinhaNova companyId={props.companyId} depoisDeId={props.linha.id} fechar={props.fecharRascunho} />}
    </>
  );
}

function LinhaEditavel({
  companyId,
  linha,
  primeira,
  ultima,
  podeMover,
  abrirRascunho,
}: {
  companyId: string;
  linha: DpTabelaLinha;
  primeira: boolean;
  ultima: boolean;
  podeMover: boolean;
  abrirRascunho: () => void;
}) {
  const [setor, setSetor] = useState(linha.setor);
  const [cargo, setCargo] = useState(linha.cargo);
  const [step, setStep] = useState(linha.step);
  const [salario, setSalario] = useState(fmtSalario(linha.salario));
  const { pending, rodar, showToast } = useAcao();

  const salvar = () => {
    const v = lerSalario(salario);
    if (v === null || v < 0) {
      showToast({ title: "Salário inválido", description: "Use um valor como 3.500,00.", variant: "destructive" });
      setSalario(fmtSalario(linha.salario));
      return;
    }
    if (!cargo.trim()) {
      showToast({ title: "Cargo obrigatório", variant: "destructive" });
      setCargo(linha.cargo);
      return;
    }
    const mudou =
      setor.trim() !== linha.setor || cargo.trim() !== linha.cargo || step.trim() !== linha.step || Math.abs(v - linha.salario) >= 0.005;
    if (mudou) rodar(() => salvarLinha({ companyId, id: linha.id, setor, cargo, step, salario: v }));
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && e.currentTarget.blur();

  return (
    <tr className="border-b border-border/60">
      <td className="py-1 pr-2">
        <div className="flex">
          <button
            type="button"
            disabled={pending || !podeMover || primeira}
            onClick={() => rodar(() => moverLinha({ companyId, id: linha.id, direcao: "cima" }))}
            className="rounded p-1 text-ink-muted hover:text-ink-primary disabled:opacity-30"
            aria-label="Subir linha"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={pending || !podeMover || ultima}
            onClick={() => rodar(() => moverLinha({ companyId, id: linha.id, direcao: "baixo" }))}
            className="rounded p-1 text-ink-muted hover:text-ink-primary disabled:opacity-30"
            aria-label="Descer linha"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
      <td className="py-1 pr-2">
        <input value={setor} onChange={(e) => setSetor(e.target.value)} onBlur={salvar} onKeyDown={onKey} className={inputCls} disabled={pending} aria-label="Setor" />
      </td>
      <td className="py-1 pr-2">
        <input value={cargo} onChange={(e) => setCargo(e.target.value)} onBlur={salvar} onKeyDown={onKey} className={inputCls} disabled={pending} aria-label="Cargo" />
      </td>
      <td className="py-1 pr-2">
        <input value={step} onChange={(e) => setStep(e.target.value)} onBlur={salvar} onKeyDown={onKey} className={inputCls} disabled={pending} aria-label="Step" />
      </td>
      <td className="py-1 pr-2">
        <input
          value={salario}
          onChange={(e) => setSalario(e.target.value)}
          onBlur={salvar}
          onKeyDown={onKey}
          inputMode="decimal"
          className={`${inputCls} text-right tabular-nums`}
          disabled={pending}
          aria-label="Salário"
        />
      </td>
      <td className="py-1 pr-2 text-right tabular-nums text-ink-muted">{linha.pessoas || "—"}</td>
      <td className="py-1">
        <div className="flex justify-end">
          <button type="button" onClick={abrirRascunho} disabled={pending} className="rounded p-1 text-ink-muted hover:text-ink-primary" aria-label="Inserir linha abaixo" title="Inserir linha abaixo">
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const aviso = linha.pessoas > 0 ? `\n\n${linha.pessoas} pessoa(s) estão vinculadas a ela e ficarão sem linha na tabela.` : "";
              if (window.confirm(`Excluir a linha "${rotuloLinha(linha)}"?${aviso}`)) rodar(() => excluirLinha({ companyId, id: linha.id }));
            }}
            className="rounded p-1 text-ink-muted hover:text-red-600"
            aria-label="Excluir linha"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function LinhaNova({ companyId, depoisDeId, fechar }: { companyId: string; depoisDeId: string | null; fechar: () => void }) {
  const [setor, setSetor] = useState("");
  const [cargo, setCargo] = useState("");
  const [step, setStep] = useState("");
  const [salario, setSalario] = useState("");
  const { pending, rodar, showToast } = useAcao();
  const salvar = () => {
    const v = lerSalario(salario);
    if (!cargo.trim() || v === null || v < 0) {
      showToast({ title: "Preencha o cargo e o salário", variant: "destructive" });
      return;
    }
    rodar(() => criarLinha({ companyId, setor, cargo, step, salario: v, depoisDeId }), () => {
      fechar();
      return null;
    });
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") salvar();
    if (e.key === "Escape") fechar();
  };
  return (
    <tr className="border-b border-border/60 bg-sky-500/5">
      <td className="py-1 pr-2 text-xs text-ink-muted">nova</td>
      <td className="py-1 pr-2">
        <input autoFocus value={setor} onChange={(e) => setSetor(e.target.value)} onKeyDown={onKey} placeholder="Setor" className={inputCls} disabled={pending} />
      </td>
      <td className="py-1 pr-2">
        <input value={cargo} onChange={(e) => setCargo(e.target.value)} onKeyDown={onKey} placeholder="Cargo" className={inputCls} disabled={pending} />
      </td>
      <td className="py-1 pr-2">
        <input value={step} onChange={(e) => setStep(e.target.value)} onKeyDown={onKey} placeholder="Step" className={inputCls} disabled={pending} />
      </td>
      <td className="py-1 pr-2">
        <input value={salario} onChange={(e) => setSalario(e.target.value)} onKeyDown={onKey} placeholder="0,00" inputMode="decimal" className={`${inputCls} text-right`} disabled={pending} />
      </td>
      <td />
      <td className="py-1">
        <div className="flex justify-end gap-1">
          <button type="button" onClick={salvar} disabled={pending} className="rounded px-2 py-1 text-xs font-medium text-ink-primary hover:bg-surface-2">
            Salvar
          </button>
          <button type="button" onClick={fechar} disabled={pending} className="rounded p-1 text-ink-muted hover:text-ink-primary" aria-label="Cancelar">
            <X className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── 2. De-para Sólides → linha da tabela ────────────────────────────────────

function DeParaSolides({ companyId, tabela, cargos }: { companyId: string; tabela: DpTabelaLinha[]; cargos: DpCargoSolidesUso[] }) {
  const { pending, rodar } = useAcao();
  const rotulo = useMemo(
    () => new Map(tabela.map((l) => [l.id, `${l.setor ? `${l.setor} · ` : ""}${rotuloLinha(l)} (${formatBRL(l.salario)})`])),
    [tabela],
  );
  // Opções agrupadas por setor, na ordem da tabela.
  const grupos = useMemo(() => {
    const m = new Map<string, DpTabelaLinha[]>();
    for (const l of tabela) m.set(l.setor || "Sem setor", [...(m.get(l.setor || "Sem setor") ?? []), l]);
    return Array.from(m);
  }, [tabela]);
  const pendentes = cargos.filter((c) => !c.linhaId).length;
  const sugestoes = cargos.filter((c) => !c.linhaId && c.sugestaoLinhaId);

  const gravar = (itens: Array<{ solidesCargoId: number; solidesCargoNome: string; linhaId: string | null }>, ok?: string) =>
    rodar(() => vincularCargosSolides({ companyId, itens }), () => ok ?? null);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Cargos da Sólides nesta empresa
              {pendentes > 0 && <span className="ml-2 text-sm font-normal text-amber-700 dark:text-amber-400">{pendentes} sem linha</span>}
            </CardTitle>
            <p className="text-sm text-ink-muted">
              A qual linha da tabela cada cargo da Sólides corresponde. Vale para todos desta empresa com aquele cargo.
            </p>
          </div>
          {sugestoes.length > 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                gravar(
                  sugestoes.map((s) => ({ solidesCargoId: s.solidesCargoId, solidesCargoNome: s.nome, linhaId: s.sugestaoLinhaId })),
                  `${sugestoes.length} sugestão(ões) aplicada(s)`,
                )
              }
              className={botaoCls}
            >
              <Wand2 className="h-4 w-4" /> Aplicar {sugestoes.length} sugestão(ões)
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {cargos.length === 0 ? (
          <p className="text-sm text-ink-muted">Nenhum colaborador ativo desta empresa tem cargo na Sólides.</p>
        ) : tabela.length === 0 ? (
          <p className="text-sm text-ink-muted">Monte a tabela acima para poder vincular os {cargos.length} cargos da Sólides.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-ink-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Cargo na Sólides</th>
                  <th className="py-2 pr-3 text-right font-medium">Pessoas</th>
                  <th className="py-2 font-medium">Linha da tabela</th>
                </tr>
              </thead>
              <tbody>
                {cargos.map((c) => (
                  <tr key={c.solidesCargoId} className={`border-b border-border last:border-0 ${c.linhaId ? "" : "bg-amber-500/5"}`}>
                    <td className="py-1.5 pr-3 text-ink-primary">{c.nome}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{c.colaboradores}</td>
                    <td className="py-1.5">
                      <select
                        value={c.linhaId ?? ""}
                        disabled={pending}
                        onChange={(e) => gravar([{ solidesCargoId: c.solidesCargoId, solidesCargoNome: c.nome, linhaId: e.target.value || null }])}
                        className="w-full max-w-lg rounded-md border border-input bg-background px-2 py-1 text-sm"
                        aria-label={`Linha da tabela para ${c.nome}`}
                      >
                        <option value="">— sem linha —</option>
                        {grupos.map(([setor, ls]) => (
                          <optgroup key={setor} label={setor}>
                            {ls.map((l) => (
                              <option key={l.id} value={l.id}>
                                {rotuloLinha(l)} ({formatBRL(l.salario)})
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      {!c.linhaId && c.sugestaoLinhaId && (
                        <p className="mt-0.5 text-xs text-ink-muted">Sugestão pelo nome: {rotulo.get(c.sugestaoLinhaId)}</p>
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

function textoDiferenca(r: DpEnquadramentoRow): string {
  const d = r.enquadramento.diferenca;
  if (d === null) return "—";
  const p = r.enquadramento.percentual;
  return `${formatBRL(d)}${p === null ? "" : ` (${p > 0 ? "+" : ""}${p.toLocaleString("pt-BR")}%)`}`;
}

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
      { key: "linha", label: "Linha da tabela", plain: (r) => r.linhaRotulo ?? "—", sortVal: (r) => (r.linhaRotulo ?? "").toLowerCase() },
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
        key: "salarioTabela",
        label: "Salário da tabela",
        kind: "number",
        align: "right",
        plain: (r) => (r.salarioTabela === null ? "—" : formatBRL(r.salarioTabela)),
        sortVal: (r) => r.salarioTabela ?? -1,
        numeric: (r) => r.salarioTabela,
      },
      {
        key: "diferenca",
        label: "Diferença",
        kind: "number",
        align: "right",
        plain: textoDiferenca,
        sortVal: (r) => r.enquadramento.percentual ?? -9999,
        numeric: (r) => r.enquadramento.diferenca,
        cell: (r) => {
          const cor =
            r.enquadramento.status === "abaixo"
              ? "text-amber-700 dark:text-amber-400"
              : r.enquadramento.status === "acima"
                ? "text-sky-700 dark:text-sky-400"
                : "";
          return <span className={`tabular-nums ${cor}`}>{textoDiferenca(r)}</span>;
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
          Salário é o cadastrado na Sólides; o da tabela é o da linha vinculada. Diferença de menos de R$ 1 conta como “no salário da
          tabela”. Abaixo em âmbar, acima em azul.
        </p>
      </CardContent>
    </Card>
  );
}
