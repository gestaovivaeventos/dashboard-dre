"use client";

import { useCallback, useEffect, useState } from "react";

import {
  getPreviaSetor,
  type PreviaSetorResumo,
} from "@/lib/orcamento/actions/planejamento-categoria";
import { setorEspecifico } from "@/lib/orcamento/setor-filtro";
import { PlanejamentoPreviaSetor } from "@/components/orcamento/planejamento-previa-setor";
import { aplicarDecisao, type DecisaoAplicada } from "@/lib/orcamento/previa-setor-decisao";
import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";

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
  decisaoExterna,
  metodoContagem,
}: {
  companyId: string;
  year: number;
  /** Aceita o sentinela "todos os setores"; é normalizado aqui. */
  setorId: string | null;
  setorNome?: string;
  /**
   * Decisão tomada FORA deste painel — no Pessoal ela acontece na linha do
   * colaborador, que é um componente irmão. Sem isto a prévia abaixo ficava
   * parada até alguém sair e voltar da tela.
   *
   * `seq` é o que dispara: duas decisões idênticas seguidas (aprovar, desfazer,
   * aprovar) têm o mesmo conteúdo e precisam valer as duas.
   */
  decisaoExterna?: DecisaoAplicada & { seq: number };
  /**
   * Método da tela que abriu o painel — recorta a faixa de números nele. A
   * LISTA segue mostrando o setor inteiro, que é o desenho.
   */
  metodoContagem?: OrcamentoMetodo;
}) {
  const [resumo, setResumo] = useState<PreviaSetorResumo | null>(null);
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    // NÃO acende `carregando` aqui: ele nasce `true` e cai na primeira carga.
    // Reacendê-lo a cada ✓ faria a prévia piscar "Calculando…" por cima de um
    // resumo que já está correto na tela (a decisão foi antecipada).
    const res = await getPreviaSetor(companyId, year, setorEspecifico(setorId), "");
    setCarregando(false);
    if (res.data) setResumo(res.data);
  }, [companyId, year, setorId]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  // Decisão de fora: antecipa na tela e confirma com o servidor em seguida.
  const seq = decisaoExterna?.seq ?? 0;
  useEffect(() => {
    if (!decisaoExterna || seq === 0) return;
    setResumo((atual) => (atual ? aplicarDecisao(atual, decisaoExterna) : atual));
    void recarregar();
    // Só `seq` nas deps: o objeto é recriado a cada render do pai e reentraria
    // em laço. A sequência é quem diz que houve decisão NOVA.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  return (
    <PlanejamentoPreviaSetor
      resumo={resumo}
      carregando={carregando}
      setorNome={setorNome}
      year={year}
      companyId={companyId}
      onDecidiu={recarregar}
      metodoContagem={metodoContagem}
    />
  );
}
