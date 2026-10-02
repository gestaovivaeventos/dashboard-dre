"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Globe, Loader2, TrendingDown, TrendingUp } from "lucide-react";

import {
  aplicarValorDaFaixa,
  calibrarFaixaViagem,
  getCalibragemFaixas,
  type CalibragemSetup,
} from "@/lib/orcamento/actions/viagens-calibragem";
import type { PropostaFaixa } from "@/lib/viagens/calibragem";
import { formatBRL } from "@/lib/orcamento/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * CALIBRAR AS FAIXAS com a web.
 *
 * ── Onde a busca de preço se paga ─────────────────────────────────────────
 * Cotar 50 viagens é 50 buscas de dezenas de segundos, e os destinos quase não se
 * repetem — nada amortiza. Cotar as ~10 faixas é 10 buscas que melhoram as 50
 * linhas de uma vez.
 *
 * ── UMA faixa por requisição, em sequência ────────────────────────────────
 * Dez buscas numa requisição estourariam o teto de 300s da Vercel e perderiam o
 * trabalho das nove que já voltaram. O padrão é o do Caixa: a tela chama uma por
 * uma, com progresso, e a falha de uma não custa as outras.
 *
 * ── O admin ACEITA faixa a faixa ──────────────────────────────────────────
 * A proposta aparece ao lado do valor atual, com as rotas e as fontes. Trocar
 * sozinho mudaria de uma vez o custo de todas as linhas que leem a faixa —
 * inclusive as que a diretoria já aprovou.
 */
export function ViagemFaixasCalibragem({
  companyId,
  year,
  onAplicado,
}: {
  companyId: string;
  year: number;
  /** A tela das faixas recarrega para mostrar o valor novo. */
  onAplicado: () => void;
}) {
  const [setup, setSetup] = useState<CalibragemSetup | null>(null);
  const [aberto, setAberto] = useState(false);
  const [buscando, setBuscando] = useState<string | null>(null);
  const [lote, setLote] = useState<{ feitas: number; total: number } | null>(null);
  const [propostas, setPropostas] = useState<Record<string, PropostaFaixa>>({});
  const [contexto, setContexto] = useState<Record<string, { rotas: string[]; quando: string | null }>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const res = await getCalibragemFaixas(companyId, year);
    if (res.error && !res.needsMigration) setErro(res.error);
    setSetup(res);
  }, [companyId, year]);

  useEffect(() => {
    if (aberto) void carregar();
  }, [aberto, carregar]);

  async function pesquisar(faixaId: string) {
    setBuscando(faixaId);
    setErros((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== faixaId)));
    const res = await calibrarFaixaViagem(companyId, year, faixaId);
    setBuscando(null);
    if (res.rotas) {
      setContexto((c) => ({ ...c, [faixaId]: { rotas: res.rotas!, quando: res.quando ?? null } }));
    }
    if (res.error || !res.proposta) {
      setErros((e) => ({ ...e, [faixaId]: res.error ?? "A busca não devolveu preço." }));
      return;
    }
    setPropostas((p) => ({ ...p, [faixaId]: res.proposta! }));
  }

  /** As prioritárias, uma após a outra. Sequencial de propósito: ver o teto acima. */
  async function pesquisarPrioritarias() {
    const alvos = (setup?.faixas ?? []).filter((f) => f.prioritaria).map((f) => f.id);
    if (alvos.length === 0) return;
    setLote({ feitas: 0, total: alvos.length });
    for (let i = 0; i < alvos.length; i += 1) {
      await pesquisar(alvos[i]);
      setLote({ feitas: i + 1, total: alvos.length });
    }
    setLote(null);
  }

  async function aplicar(faixaId: string, valor: number) {
    setAplicando(faixaId);
    const res = await aplicarValorDaFaixa(companyId, year, faixaId, valor);
    setAplicando(null);
    if (res.error) {
      setErros((e) => ({ ...e, [faixaId]: res.error! }));
      return;
    }
    setPropostas((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== faixaId)));
    onAplicado();
    void carregar();
  }

  if (!aberto) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setAberto(true)}>
        <Globe className="mr-2 h-4 w-4" />
        Calibrar com a web
      </Button>
    );
  }

  const faixas = setup?.faixas ?? [];
  const prioritarias = faixas.filter((f) => f.prioritaria).length;

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Calibrar com a web</p>
          <p className="text-xs text-muted-foreground">
            A pesquisa busca várias rotas de cada faixa e sugere a <strong>mediana</strong> — uma
            rota caríssima não arrasta a faixa que dezenas de linhas leem. A tarifa do ano que vem
            ainda não foi publicada: o que volta é o menor preço de hoje para aquelas rotas naquele
            mês. É referência, não cotação.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAberto(false)}>
          Fechar
        </Button>
      </div>

      {setup && setup.linhas === 0 && (
        <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          Nenhuma viagem orçada ainda. A pesquisa usa os destinos das linhas da grade para saber o
          que cotar em cada faixa — monte a grade primeiro.
        </p>
      )}

      {faixas.length > 0 && setup!.linhas > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void pesquisarPrioritarias()}
            disabled={Boolean(buscando) || prioritarias === 0}
          >
            {lote ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Pesquisando {lote.feitas + 1} de {lote.total}…
              </>
            ) : (
              <>
                <Globe className="mr-2 h-4 w-4" />
                Pesquisar as {prioritarias} que pesam
              </>
            )}
          </Button>
          <span className="text-xs text-muted-foreground">
            Cada busca leva algum tempo. Elas correm uma após a outra.
          </span>
        </div>
      )}

      {erro && <p className="text-xs text-red-600 dark:text-red-400">{erro}</p>}

      <div className="divide-y rounded-md border">
        {faixas.map((f) => {
          const p = propostas[f.id];
          const ctx = contexto[f.id];
          const rotas = ctx?.rotas ?? setup?.rotas[f.id] ?? [];
          const mes = setup?.meses[f.id] ?? null;
          const msg = erros[f.id];
          return (
            <div key={f.id} className="space-y-1.5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {f.nome}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {f.tipo === "passagem" ? "passagem" : "hospedagem"}
                    </span>
                    {f.prioritaria && (
                      <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-500">
                        pesa
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {f.linhas} linha(s) · {Math.round(f.peso * 100)}% do orçamento de viagens
                    {rotas.length > 0 && <> · {rotas.join(", ")}</>}
                    {mes != null && <> · pesquisa o mês {mes}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {/* O que a faixa carrega do orçamento: é o que justifica a busca. */}
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {formatBRL(f.total)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void pesquisar(f.id)}
                    disabled={buscando === f.id || Boolean(lote) || f.linhas === 0}
                  >
                    {buscando === f.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Globe className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>

              {msg && <p className="text-xs text-amber-700 dark:text-amber-500">{msg}</p>}

              {p && (
                <div className="space-y-1 rounded-md border bg-muted/30 p-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">
                      hoje {formatBRL(p.valorAtual)} →
                    </span>
                    <strong className="tabular-nums">
                      {p.valor == null ? "—" : formatBRL(p.valor)}
                    </strong>
                    {p.variacao != null && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 text-xs",
                          p.variacao > 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-emerald-700 dark:text-emerald-400",
                        )}
                      >
                        {p.variacao > 0 ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {(p.variacao > 0 ? "+" : "") + Math.round(p.variacao * 100)}%
                      </span>
                    )}
                    {p.valor != null && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={aplicando === f.id}
                        onClick={() => void aplicar(f.id, p.valor!)}
                      >
                        {aplicando === f.id ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Usar este valor
                      </Button>
                    )}
                  </div>
                  {p.amostras.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {p.amostras
                        .map((a) => `${a.cidade} ${formatBRL(a.valor)}${a.fonte ? ` (${a.fonte})` : ""}`)
                        .join(" · ")}
                    </p>
                  )}
                  {ctx?.quando && (
                    <p className="text-xs text-muted-foreground">Mês pesquisado: {ctx.quando}.</p>
                  )}
                  {p.fontes.length > 0 && (
                    <p className="truncate text-[11px] text-muted-foreground">
                      {p.fontes.slice(0, 4).join(" · ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Aceitar um valor <strong>não recalcula</strong> as viagens já salvas: cada uma guarda o
        cálculo que usou. Para adotar o número novo, abra a grade e salve a linha.
      </p>
    </div>
  );
}
