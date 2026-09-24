"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Loader2, ListChecks } from "lucide-react";

import {
  getPlanejamentoCategorias,
  getPlanejamentoSetores,
  type PlanejamentoCategoriaCard,
  type PlanejamentoSetorOption,
} from "@/lib/orcamento/actions/planejamento";
import { formatBRL } from "@/lib/orcamento/format";
import { planejamentoCategoriaHref } from "@/lib/orcamento/workspace-tabs";
import { SetorFiltroMulti } from "@/components/orcamento/setor-filtro-multi";
import { cn } from "@/lib/utils";

/**
 * Landing do Planejamento dos gestores: filtro de setores no topo, uma caixa
 * por CATEGORIA embaixo. Clicar na caixa abre a tela de montagem.
 *
 * O card é por categoria (não por categoria × setor): com vários setores
 * marcados, "Marketing" aparece uma vez só, somando os setores escolhidos, e o
 * rodapé do card mostra a quebra. O setor de cada despesa é escolhido dentro da
 * montagem — é lá que o modelo "cada despesa pertence a UM setor" se aplica.
 */
export function PlanejamentoLista({
  companyId,
  year,
}: {
  companyId: string;
  year: number;
}) {
  const [setores, setSetores] = useState<PlanejamentoSetorOption[]>([]);
  const [orcaPorSetor, setOrcaPorSetor] = useState(false);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [cards, setCards] = useState<PlanejamentoCategoriaCard[]>([]);
  const [carregandoSetores, setCarregandoSetores] = useState(true);
  const [carregandoCards, setCarregandoCards] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  // ── Setores (uma vez por empresa × ano) ───────────────────────────────────
  useEffect(() => {
    let vivo = true;
    setCarregandoSetores(true);
    void getPlanejamentoSetores(companyId, year).then((res) => {
      if (!vivo) return;
      setCarregandoSetores(false);
      if (res.needsMigration) {
        setNeedsMigration(true);
        return;
      }
      if (res.error) {
        setErro(res.error);
        return;
      }
      setOrcaPorSetor(res.orcaPorSetor);
      setSetores(res.items);
      // Abre com TUDO marcado: a tela vazia na primeira visita parece defeito,
      // e o gestor costuma ter poucos setores. Quem tem muitos filtra a partir
      // daí. (A seleção não é lembrada entre visitas — se isso incomodar, o
      // lugar é `user_preferences`, a mesma tabela que o Caixa usa.)
      setSelecionados(res.items.map((s) => s.id));
    });
    return () => {
      vivo = false;
    };
  }, [companyId, year]);

  // ── Categorias (recarrega a cada mudança do filtro) ───────────────────────
  const recarregarCards = useCallback(async () => {
    if (needsMigration) return;
    // Empresa que não orça por setor não tem filtro: a consulta ignora a lista.
    if (orcaPorSetor && selecionados.length === 0) {
      setCards([]);
      return;
    }
    setCarregandoCards(true);
    const res = await getPlanejamentoCategorias(companyId, year, selecionados);
    setCarregandoCards(false);
    if (res.needsMigration) {
      setNeedsMigration(true);
      return;
    }
    if (res.error) {
      setErro(res.error);
      setCards([]);
      return;
    }
    setErro(null);
    setCards(res.items ?? []);
  }, [companyId, year, selecionados, orcaPorSetor, needsMigration]);

  useEffect(() => {
    if (carregandoSetores) return;
    void recarregarCards();
  }, [carregandoSetores, recarregarCards]);

  const totais = useMemo(
    () => ({
      orcado: cards.reduce((a, c) => a + c.totalOrcado, 0),
      anterior: cards.reduce((a, c) => a + (c.realizadoAnterior ?? 0), 0),
      despesas: cards.reduce((a, c) => a + c.despesas, 0),
    }),
    [cards],
  );

  if (needsMigration) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Migration pendente</p>
        <p className="mt-1 text-muted-foreground">
          As tabelas do Planejamento dos gestores ainda não foram aplicadas no banco.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Filtro ─────────────────────────────────────────────────────────── */}
      {orcaPorSetor && (
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-muted/20 p-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Setores</label>
            {carregandoSetores ? (
              <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </div>
            ) : (
              <SetorFiltroMulti
                setores={setores}
                selecionados={selecionados}
                onChange={setSelecionados}
              />
            )}
          </div>

          {cards.length > 0 && (
            <dl className="flex flex-wrap items-end gap-5 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Categorias</dt>
                <dd className="font-semibold tabular-nums">{cards.length}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Despesas orçadas</dt>
                <dd className="font-semibold tabular-nums">{totais.despesas}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Gasto em {year - 1}</dt>
                <dd className="font-semibold tabular-nums text-muted-foreground">
                  {formatBRL(totais.anterior || null)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Orçado {year}</dt>
                <dd className="font-semibold tabular-nums">{formatBRL(totais.orcado)}</dd>
              </div>
            </dl>
          )}
        </div>
      )}

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {!carregandoSetores && orcaPorSetor && setores.length === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">Nenhum setor disponível para você nesta empresa.</p>
            <p className="mt-1 text-muted-foreground">
              Os setores do orçamento chegam até você pelo vínculo com o módulo Compras. Se você
              deveria ver algum aqui, peça ao administrador para conferir o campo{" "}
              <strong>Setor no Compras</strong> no cadastro de setores.
            </p>
          </div>
        </div>
      )}

      {/* ── Cards ──────────────────────────────────────────────────────────── */}
      {carregandoCards ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando categorias…
        </div>
      ) : orcaPorSetor && selecionados.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Nenhum setor selecionado. Escolha ao menos um no filtro acima.
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Nenhuma categoria é orçada por esta via nos setores escolhidos. O administrador define
          isso em <strong>Configuração › Método por categoria</strong>.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.categoryCode}
              href={planejamentoCategoriaHref(companyId, year, card.categoryCode)}
              className="group flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-emerald-500/40 hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold" title={card.categoryName}>
                    {card.categoryName}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {card.dreLineCode} · {card.dreLineName}
                  </p>
                </div>
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Gasto em {year - 1}</dt>
                  <dd className="tabular-nums text-muted-foreground">
                    {formatBRL(card.realizadoAnterior)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Orçado {year}</dt>
                  <dd className="font-semibold tabular-nums">{formatBRL(card.totalOrcado)}</dd>
                </div>
              </dl>

              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <ListChecks className="h-3.5 w-3.5" />
                  {card.despesas} despesa(s)
                </span>
                {!card.basePronta && (
                  <span
                    title="A base do ano anterior ainda não foi finalizada pelo administrador em todos os setores desta categoria."
                    className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700"
                  >
                    <AlertTriangle className="h-3 w-3" /> base pendente
                  </span>
                )}
              </div>

              {/* Quebra por setor: é o que diz de onde vem o total do card
                  quando há mais de um setor marcado no filtro. */}
              {orcaPorSetor && card.setores.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {card.setores.map((s) => (
                    <li
                      key={s.setorId ?? "sem"}
                      className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                    >
                      <span className="truncate">{s.setorNome}</span>
                      <span className={cn("tabular-nums", s.total === 0 && "opacity-60")}>
                        {formatBRL(s.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
