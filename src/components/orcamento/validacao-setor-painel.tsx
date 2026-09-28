"use client";

import { useCallback, useEffect, useState } from "react";

import {
  getPreviaSetor,
  type PreviaSetorResumo,
} from "@/lib/orcamento/actions/planejamento-categoria";
import { setorEspecifico } from "@/lib/orcamento/setor-filtro";
import { PlanejamentoPreviaSetor } from "@/components/orcamento/planejamento-previa-setor";

/**
 * A prévia do SETOR como painel avulso — a porta da validação dentro de cada
 * tela de método.
 *
 * É a MESMA tela em que a diretoria decide na montagem do Planejamento, e é
 * compartilhada de propósito: o diretor percorre as linhas que o gestor montou,
 * em vez de uma tela consolidada à parte (uma dessas existiu no modelo antigo e
 * foi removida por duplicar a Prévia).
 *
 * Mostra TODAS as categorias orçadas do setor, de qualquer método — então
 * abri-la pelo Pessoal ou pela Média dá a mesma lista. A tela de onde ela é
 * aberta decide só o setor.
 *
 * Carrega por conta própria porque o aprovado muda a cada clique e as telas de
 * método não conhecem a Prévia.
 */
export function ValidacaoSetorPainel({
  companyId,
  year,
  setorId,
  setorNome = "",
}: {
  companyId: string;
  year: number;
  /** Aceita o sentinela "todos os setores"; é normalizado aqui. */
  setorId: string | null;
  setorNome?: string;
}) {
  const [resumo, setResumo] = useState<PreviaSetorResumo | null>(null);
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    const res = await getPreviaSetor(companyId, year, setorEspecifico(setorId), "");
    setCarregando(false);
    if (res.data) setResumo(res.data);
  }, [companyId, year, setorId]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  return (
    <PlanejamentoPreviaSetor
      resumo={resumo}
      carregando={carregando}
      setorNome={setorNome}
      year={year}
      companyId={companyId}
      onDecidiu={recarregar}
    />
  );
}
