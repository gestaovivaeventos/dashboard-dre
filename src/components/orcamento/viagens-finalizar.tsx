"use client";

import { useCallback, useEffect, useState } from "react";

import { getFinalizacoes } from "@/lib/orcamento/actions/finalizacao";
import { finalizacaoDe, indexarFinalizacoes, type Finalizacao } from "@/lib/orcamento/finalizacao";
import { BotaoFinalizar } from "@/components/orcamento/botao-finalizar";

/**
 * O bloco FINALIZAR da tela de viagens.
 *
 * Vivia dentro da lista; saiu para um componente próprio quando a grade virou a
 * tela principal — a alternativa era duplicá-lo ou engordar a grade, que já
 * carrega 50 linhas editáveis.
 *
 * A fatia é (categoria × setor), como nos outros métodos.
 *
 * ── Setor NULO e "Todos os setores" são coisas DIFERENTES (07/10/2026) ──────
 * O bloco testava só `!setorId` e sumia nos dois casos. Mas `null` cobre dois
 * estados que `setor-filtro.ts` já separava para o Pessoal:
 *
 *   empresa NÃO orça por setor  → a fatia é (categoria, ∅) e FECHA normalmente
 *   "Todos os setores"          → a visão cruza setores; não há UMA fatia a fechar
 *
 * Conflá-los deixava a empresa que não orça por setor **sem nenhum caminho** para
 * finalizar viagem — o valor ficava na Prévia e nunca chegava ao Budget, sem nada
 * na tela dizendo por quê. Por isso entra `orcaPorSetor`, e o caso que de fato
 * bloqueia passa a ser DITO em vez de sumir.
 */
export function ViagensFinalizar({
  companyId,
  year,
  setorId,
  setorNome,
  categorias,
  codigosEmUso,
  orcaPorSetor,
  isAdmin,
  onMudou,
}: {
  companyId: string;
  year: number;
  /** Setor da fatia. `null` = a empresa não orça por setor OU é a visão "Todos". */
  setorId: string | null;
  setorNome: string;
  categorias: Array<{ categoryCode: string; categoryName: string }>;
  /** Categorias que têm viagem neste recorte — é por elas que se finaliza. */
  codigosEmUso: string[];
  /** A empresa orça por setor? É o que distingue `null` de "Todos os setores". */
  orcaPorSetor: boolean;
  isAdmin: boolean;
  onMudou: () => void;
}) {
  const [finalizacoes, setFinalizacoes] = useState<Finalizacao[]>([]);

  const carregar = useCallback(async () => {
    const r = await getFinalizacoes(companyId, year);
    setFinalizacoes(r.items ?? []);
  }, [companyId, year]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Sem viagem no recorte não há fatia: nada a fechar, e um bloco vazio só ocupa
  // espaço na tela que já carrega 50 linhas.
  if (codigosEmUso.length === 0) return null;

  // A visão cruza setores: fechar daqui publicaria fatia de setor que o admin não
  // está olhando. Dizer isso é melhor que sumir — some era o que fazia procurar
  // defeito num botão que a tela só não tinha como oferecer.
  if (orcaPorSetor && !setorId) {
    return (
      <div className="rounded-lg border p-4">
        <p className="text-sm font-semibold">Finalizar</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Escolha um setor no topo da tela. A fatia que se fecha é (categoria × setor), e em
          &ldquo;Todos os setores&rdquo; não há uma só para publicar no Budget.
        </p>
      </div>
    );
  }

  const indice = indexarFinalizacoes(finalizacoes);

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <p className="text-sm font-semibold">Finalizar</p>
      <p className="text-xs text-muted-foreground">
        Fecha a categoria neste setor e publica no Budget o que a diretoria aprovou. Depois de
        finalizar, ninguém edita — nem o administrador — até reabrir.
      </p>
      <div className="divide-y">
        {codigosEmUso.map((code) => {
          const nome = categorias.find((c) => c.categoryCode === code)?.categoryName ?? code;
          return (
            <div key={code} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm">{nome}</span>
              <BotaoFinalizar
                companyId={companyId}
                year={year}
                metodo="viagens"
                categoryCode={code}
                setorId={setorId}
                rotulo={`${nome} · ${setorNome}`}
                finalizacao={finalizacaoDe(indice, {
                  metodo: "viagens",
                  categoryCode: code,
                  setorId,
                })}
                isAdmin={isAdmin}
                onMudou={() => {
                  void carregar();
                  onMudou();
                }}
                compacto
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
