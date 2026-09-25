"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  Plus,
  Search,
  Tags,
  Upload,
  X,
} from "lucide-react";

import {
  adicionarGrupoNoNo,
  getGruposArvore,
  removerGrupoDoNo,
  replicarGruposDoNo,
  type GruposArvore,
} from "@/lib/orcamento/actions/grupos-arvore";
import { metodoLabel } from "@/lib/orcamento/metodos";
import { YearSelect } from "@/components/orcamento/year-select";
import { defaultBudgetYear } from "@/lib/orcamento/years";
import { cn } from "@/lib/utils";

const INPUT_CLS =
  "rounded-md border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const BTN_GHOST =
  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors";

interface CompanyOption {
  companyId: string;
  companyName: string;
}

/**
 * Cadastro dos grupos de despesa em ÁRVORE: empresa → setor → categoria →
 * grupos. Mesma sensação da Prévia, que é onde o resultado disto aparece.
 *
 * O que a tela edita é o ESCOPO (onde o grupo vale), não o grupo. O nome vive
 * uma vez por empresa: digitar "Publicidade" num segundo setor reaproveita o
 * MESMO registro, e é por isso que a Prévia compila os dois setores num
 * subnível só em vez de mostrar "Publicidade" duas vezes.
 */
export function GruposArvoreManager({ companies }: { companies: CompanyOption[] }) {
  const [companyId, setCompanyId] = useState<string>(companies[0]?.companyId ?? "");
  const [year, setYear] = useState<number>(defaultBudgetYear());
  const [arvore, setArvore] = useState<GruposArvore | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [novoEm, setNovoEm] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState("");
  // A árvore traz TODAS as categorias de despesa em TODOS os setores, então
  // ela é longa de propósito. Estes dois recortes são o que a torna utilizável.
  const [busca, setBusca] = useState("");
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<{
    criados: number;
    escopos: number;
    problemas: string[];
    aviso?: string;
  } | null>(null);
  const [soComGrupos, setSoComGrupos] = useState(false);

  const recarregar = useCallback(async () => {
    if (!companyId) {
      setArvore(null);
      return;
    }
    setCarregando(true);
    const res = await getGruposArvore(companyId, year);
    setCarregando(false);
    if (res.needsMigration) {
      setNeedsMigration(true);
      setArvore(null);
      return;
    }
    if (res.error) {
      setErro(res.error);
      setArvore(null);
      return;
    }
    setNeedsMigration(false);
    setErro(null);
    setArvore(res.data ?? null);
  }, [companyId, year]);

  useEffect(() => {
    void recarregar();
    setAbertos(new Set());
    setNovoEm(null);
  }, [recarregar]);

  function alternar(chave: string) {
    setAbertos((prev) => {
      const proxima = new Set(prev);
      if (proxima.has(chave)) proxima.delete(chave);
      else proxima.add(chave);
      return proxima;
    });
  }

  /** Categorias do setor depois da busca e do recorte "só com grupos". */
  function filtrar(categorias: GruposArvore["setores"][number]["categorias"]) {
    const q = busca.trim().toLocaleLowerCase("pt-BR");
    return categorias.filter((c) => {
      if (soComGrupos && c.grupos.length === 0) return false;
      if (!q) return true;
      return (
        c.categoryName.toLocaleLowerCase("pt-BR").includes(q) ||
        c.categoryCode.toLocaleLowerCase("pt-BR").includes(q) ||
        // Buscar pelo nome do grupo também: "onde foi que eu usei Publicidade?"
        c.grupos.some((g) => g.name.toLocaleLowerCase("pt-BR").includes(q))
      );
    });
  }

  async function importar(file: File) {
    setImportando(true);
    setErro(null);
    setResultado(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("companyId", companyId);
      form.append("year", String(year));
      const resp = await fetch("/api/orcamento/grupos/import", { method: "POST", body: form });
      const json = (await resp.json()) as {
        error?: string;
        criados?: number;
        escopos?: number;
        problemas?: string[];
        aviso?: string;
      };
      if (!resp.ok || json.error) {
        setErro(json.error ?? "N\u00e3o consegui importar a planilha.");
        return;
      }
      setResultado({
        criados: json.criados ?? 0,
        escopos: json.escopos ?? 0,
        problemas: json.problemas ?? [],
        aviso: json.aviso,
      });
      await recarregar();
    } catch {
      setErro("Falha ao enviar o arquivo.");
    } finally {
      setImportando(false);
    }
  }

  function run(acao: () => Promise<{ error?: string }>) {
    setErro(null);
    startTransition(async () => {
      const res = await acao();
      if (res?.error) {
        setErro(res.error);
        return;
      }
      await recarregar();
    });
  }

  if (needsMigration) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Migration pendente</p>
        <p className="mt-1 text-muted-foreground">
          A tabela de escopo dos grupos (<code>20260927120000</code>) ainda não foi aplicada.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Filtros ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-4">
        <div className="w-72 space-y-1.5">
          <label className="text-sm font-medium">Empresa</label>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            {companies.map((c) => (
              <option key={c.companyId} value={c.companyId}>
                {c.companyName}
              </option>
            ))}
          </select>
        </div>
        <div className="w-32 space-y-1.5">
          <label className="text-sm font-medium">Ano</label>
          <YearSelect value={year} onChange={setYear} />
        </div>
        <div className="flex items-center gap-2 pb-1">
          {/* O modelo vem com a grade de setores × categorias já preenchida: sem
              isso o admin copia os nomes à mão, e é aí que nasce o erro de
              digitação que faz a linha não casar. */}
          <a
            href={`/api/orcamento/grupos/template?companyId=${encodeURIComponent(
              companyId,
            )}&year=${year}`}
            className={BTN_GHOST + " border"}
            title="Planilha modelo com os setores e categorias desta empresa"
          >
            <Download className="h-3.5 w-3.5" /> Baixar modelo
          </a>
          <label
            className={cn(
              BTN_GHOST,
              "cursor-pointer border",
              importando && "pointer-events-none opacity-50",
            )}
            title="Setor | Categoria | Grupo"
          >
            {importando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Importar planilha
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                // Zera o input: escolher o MESMO arquivo de novo (depois de
                // corrigi-lo) precisa disparar o evento outra vez.
                e.target.value = "";
                if (f) void importar(f);
              }}
            />
          </label>
        </div>

        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium">Buscar categoria ou grupo</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nome ou código…"
              className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <input
            type="checkbox"
            checked={soComGrupos}
            onChange={(e) => setSoComGrupos(e.target.checked)}
            className="h-4 w-4"
          />
          Só as que já têm grupos
        </label>

        {arvore && arvore.amplos.length > 0 && (
          <p className="ml-auto max-w-sm text-xs text-muted-foreground">
            <strong>{arvore.amplos.length}</strong> grupo(s) do catálogo não estão presos a nenhum
            nó — eles continuam aparecendo em <strong>todas</strong> as categorias até serem
            colocados em algum lugar aqui.
          </p>
        )}
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {resultado && (
        <div
          className={cn(
            "space-y-1 rounded-lg border p-3 text-sm",
            resultado.problemas.length > 0
              ? "border-amber-500/40 bg-amber-500/5"
              : "border-emerald-500/40 bg-emerald-500/5",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">
              {resultado.aviso ??
                `${resultado.escopos} v\u00ednculo(s) cadastrado(s)` +
                  (resultado.criados > 0 ? ` \u00b7 ${resultado.criados} grupo(s) novo(s)` : "")}
            </p>
            <button onClick={() => setResultado(null)} className={BTN_GHOST}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {resultado.problemas.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                {resultado.problemas.length} linha(s) n\u00e3o entraram. Corrija e importe de novo \u2014 o
                que j\u00e1 entrou n\u00e3o duplica.
              </p>
              <ul className="max-h-40 list-disc space-y-0.5 overflow-auto pl-5 text-xs text-amber-800">
                {resultado.problemas.slice(0, 50).map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
              {resultado.problemas.length > 50 && (
                <p className="text-xs text-muted-foreground">
                  \u2026 e mais {resultado.problemas.length - 50}.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {carregando && !arvore ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : !arvore || arvore.setores.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Nenhum setor com categorias do Planejamento dos gestores em {year}. O método por categoria
          é definido no orçamento da empresa (Configuração › Método por categoria).
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {arvore.setores.map((setor) => {
            const chaveSetor = setor.setorId ?? "__sem_setor__";
            const abertoSetor = abertos.has(chaveSetor) || !arvore.orcaPorSetor;
            const categorias = filtrar(setor.categorias);
            const totalGrupos = categorias.reduce((a, c) => a + c.grupos.length, 0);
            // Busca que não casa nada neste setor esconde o setor inteiro — abrir
            // um nó vazio para descobrir que não tem nada é trabalho à toa.
            if (categorias.length === 0 && (busca.trim() || soComGrupos)) return null;
            return (
              <div key={chaveSetor}>
                {arvore.orcaPorSetor && (
                  <button
                    type="button"
                    onClick={() => alternar(chaveSetor)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/40"
                  >
                    {abertoSetor ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 font-semibold">{setor.setorNome}</span>
                    <span className="text-xs text-muted-foreground">
                      {categorias.length} categoria(s) · {totalGrupos} grupo(s)
                    </span>
                  </button>
                )}

                {abertoSetor && (
                  <div className={cn(arvore.orcaPorSetor && "border-t bg-muted/10")}>
                    {categorias.length === 0 ? (
                      <p className="px-4 py-3 pl-10 text-xs text-muted-foreground">
                        Nenhuma categoria de despesa mapeada para esta empresa.
                      </p>
                    ) : (
                      categorias.map((cat) => {
                        const chaveCat = `${chaveSetor}|${cat.categoryCode}`;
                        const abertaCat = abertos.has(chaveCat);
                        return (
                          <div key={chaveCat} className="border-b last:border-b-0">
                            <button
                              type="button"
                              onClick={() => alternar(chaveCat)}
                              className={cn(
                                "flex w-full items-center gap-2 py-2 pr-4 text-left hover:bg-muted/40",
                                arvore.orcaPorSetor ? "pl-10" : "pl-4",
                              )}
                            >
                              {abertaCat ? (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <span className="min-w-0 flex-1 truncate text-sm">
                                {cat.categoryName}
                              </span>
                              {/* Só o Planejamento dos gestores usa grupo. O rótulo
                                  evita o cadastro que nunca chega à entrevista —
                                  mas não impede: o método pode mudar depois. */}
                              <span
                                className={cn(
                                  "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                                  cat.metodo === "planejamento_socios"
                                    ? "bg-emerald-600/10 text-emerald-700"
                                    : "bg-muted text-muted-foreground",
                                )}
                                title={
                                  cat.metodo === "planejamento_socios"
                                    ? "Estes grupos chegam à entrevista do gestor."
                                    : "Hoje esta categoria não é orçada pelo Planejamento dos gestores — os grupos ficam guardados para quando for."
                                }
                              >
                                {cat.metodo ? metodoLabel(cat.metodo) : "sem método"}
                              </span>
                              <span
                                className={cn(
                                  "shrink-0 text-xs",
                                  cat.grupos.length === 0
                                    ? "text-amber-700"
                                    : "text-muted-foreground",
                                )}
                              >
                                {cat.grupos.length === 0
                                  ? "sem grupos"
                                  : `${cat.grupos.length} grupo(s)`}
                              </span>
                            </button>

                            {abertaCat && (
                              <div
                                className={cn(
                                  "space-y-2 py-2 pr-4",
                                  arvore.orcaPorSetor ? "pl-[3.75rem]" : "pl-10",
                                )}
                              >
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {cat.grupos.map((g) => (
                                    <span
                                      key={g.id}
                                      className={cn(
                                        "inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px]",
                                        !g.active && "opacity-50 line-through",
                                      )}
                                    >
                                      <Tags className="h-3 w-3 text-muted-foreground" />
                                      {g.name}
                                      <button
                                        type="button"
                                        onClick={() =>
                                          run(() =>
                                            removerGrupoDoNo({
                                              companyId,
                                              year,
                                              setorId: setor.setorId,
                                              categoryCode: cat.categoryCode,
                                              grupoId: g.id,
                                            }),
                                          )
                                        }
                                        disabled={isPending}
                                        title="Tirar este grupo desta categoria (o grupo continua no catálogo)"
                                        className="rounded-full p-0.5 hover:bg-muted"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </span>
                                  ))}

                                  {novoEm === chaveCat ? (
                                    <span className="inline-flex items-center gap-1">
                                      <input
                                        value={novoNome}
                                        onChange={(e) => setNovoNome(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Escape") setNovoEm(null);
                                          if (e.key === "Enter" && novoNome.trim()) {
                                            run(() =>
                                              adicionarGrupoNoNo({
                                                companyId,
                                                year,
                                                setorId: setor.setorId,
                                                categoryCode: cat.categoryCode,
                                                nome: novoNome,
                                              }),
                                            );
                                            setNovoNome("");
                                          }
                                        }}
                                        list="catalogo-grupos"
                                        autoFocus
                                        placeholder="Nome do grupo"
                                        className={INPUT_CLS + " w-44"}
                                      />
                                      <button
                                        onClick={() => setNovoEm(null)}
                                        className={BTN_GHOST}
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setNovoEm(chaveCat);
                                        setNovoNome("");
                                      }}
                                      disabled={isPending}
                                      className={BTN_GHOST}
                                    >
                                      <Plus className="h-3.5 w-3.5" /> Grupo
                                    </button>
                                  )}

                                  {/* Replicar: o caso comum é a mesma categoria
                                      ter os mesmos grupos em todos os setores. */}
                                  {arvore.orcaPorSetor &&
                                    cat.grupos.length > 0 &&
                                    arvore.setores.length > 1 && (
                                      <button
                                        onClick={() =>
                                          run(() =>
                                            replicarGruposDoNo({
                                              companyId,
                                              year,
                                              origemSetorId: setor.setorId,
                                              categoryCode: cat.categoryCode,
                                              // Todo setor tem todas as
                                              // categorias, então o destino é
                                              // simplesmente "os outros".
                                              destinoSetorIds: arvore.setores
                                                .filter(
                                                  (s) => s.setorId && s.setorId !== setor.setorId,
                                                )
                                                .map((s) => s.setorId as string),
                                            }),
                                          )
                                        }
                                        disabled={isPending}
                                        title="Usar estes mesmos grupos nesta categoria nos demais setores"
                                        className={BTN_GHOST}
                                      >
                                        <Copy className="h-3.5 w-3.5" /> Replicar nos outros setores
                                      </button>
                                    )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Sugestões de nome já usados na empresa — reaproveitar o mesmo registro
          é o que mantém o grupo único na hora de somar. */}
      <datalist id="catalogo-grupos">
        {(arvore?.catalogo ?? []).map((g) => (
          <option key={g.id} value={g.name} />
        ))}
      </datalist>
    </div>
  );
}
