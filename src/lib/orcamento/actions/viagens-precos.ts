"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { SEM_ACESSO, autorizarLeitura } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import {
  PARADA_COLS,
  modalDaLinha as modal,
  numDaLinha as num,
  textoDaLinha as texto,
} from "@/lib/viagens/colunas";
import {
  buscarPrecos,
  mesAno,
  type CidadeParaCotar,
  type TrechoParaCotar,
} from "@/lib/viagens/precos/buscar";
import type { PropostaPrecos } from "@/lib/viagens/precos/aplicar";

// =============================================================================
// "Buscar preços" — a cotação que substituiu os parâmetros de passagem e hotel.
//
// Até 01/10/2026 havia R$/km de avião e de ônibus e uma diária de hotel padrão.
// Estava errado: são preços de MERCADO, com sazonalidade grande, e um valor por km
// não distingue janeiro de julho. Saía plausível e ninguém o reconstruía.
//
// ── Isto NÃO grava nada ────────────────────────────────────────────────────
// Devolve uma PROPOSTA; a tela a aplica ao rascunho preenchendo só campo vazio
// (`aplicarPrecos`) e gravar continua sendo "Salvar e calcular". Mesma disciplina
// do cartão da IA: leitura é sugestão, o que a pessoa digitou não é sobrescrito.
//
// ── O limite, que a tela precisa repetir ao usuário ────────────────────────
// Para uma viagem do ano que vem a tarifa ainda NÃO FOI PUBLICADA — não existe na
// web nem em API nenhuma. O que volta é o menor preço encontrado hoje para aquela
// rota naquele mês, com a fonte. É referência boa; não é cotação.
// =============================================================================

type Supa = Awaited<ReturnType<typeof createClient>>;

function db() {
  return createAdminClientIfAvailable();
}

export interface BuscaPrecosResult {
  proposta?: PropostaPrecos;
  fontes?: string[];
  /** Mês pesquisado, para a tela dizer sobre o que é o preço. */
  quando?: string | null;
  /** Nada havia a cotar (roteiro só de carro e sem noites). */
  nadaACotar?: boolean;
  error?: string;
}

/**
 * Pesquisa os preços do roteiro desta viagem.
 *
 * Gate de LEITURA, não de escrita: a busca não grava no orçamento. Mas ela gasta
 * token, então o recorte por empresa e por setor vale — não é caminho para
 * alguém disparar pesquisa sobre viagem que nem enxerga.
 */
export async function buscarPrecosDaViagem(
  companyId: string,
  year: number,
  viagemId: string,
): Promise<BuscaPrecosResult> {
  if (!companyId || !viagemId) return { error: "Viagem inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  const { data: row, error } = await supabase
    .from("orcamento_viagens")
    .select("id, setor_id, origem, data_ida, volta_modal")
    .eq("id", viagemId)
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (error) {
    if (isSchemaMissing(error.message)) return { error: "Migration das viagens pendente." };
    return { error: error.message };
  }
  if (!row) return { error: "Viagem não encontrada." };
  const setorDaViagem = (row.setor_id as string | null) ?? null;
  if (auth.setores !== null && (!setorDaViagem || !auth.setores.includes(setorDaViagem))) {
    return { error: SEM_ACESSO };
  }

  const { data: pRows } = await supabase
    .from("orcamento_viagem_paradas")
    .select(PARADA_COLS)
    .eq("viagem_id", viagemId)
    .order("ordem");
  const paradas = (pRows ?? []) as unknown as Array<Record<string, unknown>>;

  const origem = texto(row.origem);
  const trechos: TrechoParaCotar[] = [];
  const cidades: CidadeParaCotar[] = [];
  let anterior = "";

  for (let i = 0; i < paradas.length; i += 1) {
    const p = paradas[i];
    const cidade = texto(p.cidade);
    const m = modal(p.chegada_modal);
    const jaTemPreco =
      (num(p.chegada_preco_pessoa) ?? 0) > 0 || (num(p.chegada_preco_total) ?? 0) > 0;

    // Só o que precisa de cotação entra na pergunta: carro/van têm o R$/km da
    // empresa, e trecho já cotado não se pesquisa (a tela nem o sobrescreveria).
    if ((m === "aviao" || m === "onibus") && !jaTemPreco) {
      trechos.push({
        id: `p${i}`,
        de: texto(p.chegada_de) || anterior || origem,
        para: cidade,
        modal: m,
      });
    }

    const noites = num(p.noites) ?? 0;
    if (noites > 0 && (num(p.diaria_hotel) ?? 0) <= 0) {
      cidades.push({ cidade, noites });
    }
    anterior = cidade;
  }

  // A volta, quando é de avião/ônibus e ainda não tem preço.
  const voltaModal = row.volta_modal == null ? null : modal(row.volta_modal);
  if (voltaModal === "aviao" || voltaModal === "onibus") {
    const { data: voltaRow } = await supabase
      .from("orcamento_viagens")
      .select("volta_preco_pessoa, volta_preco_total")
      .eq("id", viagemId)
      .maybeSingle();
    const temPreco =
      (num((voltaRow as Record<string, unknown> | null)?.volta_preco_pessoa) ?? 0) > 0 ||
      (num((voltaRow as Record<string, unknown> | null)?.volta_preco_total) ?? 0) > 0;
    if (!temPreco && paradas.length > 0) {
      trechos.push({
        id: "volta",
        de: texto(paradas[paradas.length - 1].cidade),
        para: origem,
        modal: voltaModal,
      });
    }
  }

  const quando = mesAno((row.data_ida as string | null) ?? null);
  if (trechos.length === 0 && cidades.length === 0) {
    return { nadaACotar: true, quando };
  }

  const res = await buscarPrecos({ trechos, cidades, quando });
  if (!res.ok) return { error: res.error };

  return {
    proposta: {
      trechos: res.data.trechos.map((t) => ({
        id: t.id,
        precoPorPessoa: t.preco_por_pessoa,
        fonte: t.fonte,
      })),
      hoteis: res.data.hoteis.map((h) => ({
        cidade: h.cidade,
        diaria: h.diaria,
        fonte: h.fonte,
      })),
    },
    fontes: res.fontes,
    quando,
  };
}
