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
 * A fatia é (categoria × setor), como nos outros métodos: sem um setor resolvido
 * não há fatia a fechar, então o bloco não aparece em "Todos os setores".
 */
export function ViagensFinalizar({
  companyId,
  year,
  setorId,
  setorNome,
  categorias,
  codigosEmUso,
  isAdmin,
  onMudou,
}: {
  companyId: string;
  year: number;
  setorId: string | null;
  setorNome: string;
  categorias: Array<{ categoryCode: string; categoryName: string }>;
  /** Categorias que têm viagem neste recorte — é por elas que se finaliza. */
  codigosEmUso: string[];
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

  if (!setorId || codigosEmUso.length === 0) return null;

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
