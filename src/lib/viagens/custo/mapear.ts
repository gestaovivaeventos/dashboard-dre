import { GRUPOS_VIAGEM, type ParametrosViagem, type ResultadoViagem, type ViagemSpec } from "./tipos";
import type { ModalTrecho, ParadaViagem, TrechoViagem } from "./tipos";

// =============================================================================
// A ponte entre as LINHAS do banco e o que o motor entende.
//
// Existe separada e testada porque é exatamente aqui que o defeito silencioso
// mora: uma coluna renomeada, um campo esquecido no mapeamento, e o custo sai
// MENOR sem erro nenhum — o motor calcula direitinho sobre um roteiro
// incompleto. Um teste que leva uma linha completa de ida e volta é o que
// impede isso de passar.
//
// Módulo PURO: não lê nem grava, só traduz.
// =============================================================================

/** Defaults — valem quando a empresa/ano ainda não tem parâmetros gravados. */
export const PARAMETROS_PADRAO: ParametrosViagem = {
  rsPorKm: 1.8,
  precoCombustivelLitro: 6.2,
  consumoKmLitro: 11,
  tarifaOnibusKm: 0.42,
  diariaAlimentacao: 80,
  hotelDiariaPadrao: 250,
  aviaoPorKmPessoa: 0.9,
};

const MODAIS: readonly ModalTrecho[] = ["carro", "onibus", "aviao", "van", "outro"];

function modal(v: unknown): ModalTrecho {
  return MODAIS.includes(v as ModalTrecho) ? (v as ModalTrecho) : "outro";
}

/** `numeric` do Postgres pode chegar como string pelo PostgREST. */
function n(v: unknown): number | null {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function parametrosDaLinha(row: Record<string, unknown> | null | undefined): ParametrosViagem {
  if (!row) return { ...PARAMETROS_PADRAO };
  return {
    rsPorKm: n(row.rs_por_km) ?? PARAMETROS_PADRAO.rsPorKm,
    precoCombustivelLitro: n(row.preco_combustivel_litro) ?? PARAMETROS_PADRAO.precoCombustivelLitro,
    consumoKmLitro: n(row.consumo_km_litro) ?? PARAMETROS_PADRAO.consumoKmLitro,
    tarifaOnibusKm: n(row.tarifa_onibus_km) ?? PARAMETROS_PADRAO.tarifaOnibusKm,
    diariaAlimentacao: n(row.diaria_alimentacao) ?? PARAMETROS_PADRAO.diariaAlimentacao,
    hotelDiariaPadrao: n(row.hotel_diaria_padrao) ?? PARAMETROS_PADRAO.hotelDiariaPadrao,
    aviaoPorKmPessoa: n(row.aviao_por_km_pessoa) ?? PARAMETROS_PADRAO.aviaoPorKmPessoa,
  };
}

/**
 * Monta o spec a partir da viagem e das paradas.
 *
 * As paradas vêm ORDENADAS aqui dentro, e não se confia na ordem do SELECT: o
 * roteiro é uma sequência, e Curitiba depois de Florianópolis daria trechos
 * diferentes com o mesmo total de noites — erro que passa despercebido.
 */
export function specDaViagem(
  viagem: Record<string, unknown>,
  paradasRaw: ReadonlyArray<Record<string, unknown>>,
): ViagemSpec {
  const origem = texto(viagem.origem);
  const paradasOrdenadas = [...(paradasRaw ?? [])].sort(
    (a, b) => (n(a.ordem) ?? 0) - (n(b.ordem) ?? 0),
  );

  const paradas: ParadaViagem[] = paradasOrdenadas.map((p, i) => {
    const chegada: TrechoViagem = {
      // Sem `chegada_de` gravado, a origem do 1º trecho é a origem da viagem e
      // a dos seguintes é a parada anterior — o roteiro não tem buraco.
      de: texto(p.chegada_de) || (i === 0 ? origem : texto(paradasOrdenadas[i - 1].cidade)),
      para: texto(p.cidade),
      modal: modal(p.chegada_modal),
      distanciaKm: n(p.chegada_distancia_km),
      precoPorPessoa: n(p.chegada_preco_pessoa),
      precoTotal: n(p.chegada_preco_total),
      pedagios: n(p.chegada_pedagios),
      veiculos: n(p.chegada_veiculos),
    };
    const trajetosDia = n(p.local_trajetos_dia);
    const custoTrajeto = n(p.local_custo_trajeto);
    return {
      cidade: texto(p.cidade),
      noites: n(p.noites) ?? 0,
      chegada,
      diariaHotel: n(p.diaria_hotel),
      transporteLocal:
        trajetosDia && custoTrajeto
          ? {
              trajetosPorDia: trajetosDia,
              custoPorTrajeto: custoTrajeto,
              destino: texto(p.local_destino) || null,
            }
          : null,
    };
  });

  const ultima = paradas.length > 0 ? paradas[paradas.length - 1].cidade : origem;
  const temVolta =
    viagem.volta_modal != null ||
    n(viagem.volta_distancia_km) != null ||
    n(viagem.volta_preco_pessoa) != null ||
    n(viagem.volta_preco_total) != null;

  const translCusto = n(viagem.translado_custo_trajeto);
  const translTrajetos = n(viagem.translado_trajetos);

  return {
    origem,
    dataIda: texto(viagem.data_ida),
    pessoas: n(viagem.pessoas) ?? 1,
    pessoasPorQuarto: n(viagem.pessoas_por_quarto) ?? 1,
    paradas,
    volta: temVolta
      ? {
          de: ultima,
          para: origem,
          modal: modal(viagem.volta_modal),
          distanciaKm: n(viagem.volta_distancia_km),
          precoPorPessoa: n(viagem.volta_preco_pessoa),
          precoTotal: n(viagem.volta_preco_total),
          pedagios: n(viagem.volta_pedagios),
          veiculos: n(viagem.volta_veiculos),
        }
      : null,
    translado:
      translCusto && translTrajetos
        ? { custoPorTrajeto: translCusto, trajetos: translTrajetos }
        : null,
    outros: lerOutros(viagem.outros),
  };
}

/** `outros` é jsonb livre — entra validado, nunca confiando no formato. */
export function lerOutros(v: unknown): Array<{ descricao: string; valor: number }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ descricao: string; valor: number }> = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const valor = n(o.valor);
    if (valor == null) continue;
    out.push({ descricao: texto(o.descricao) || "Outro custo", valor });
  }
  return out;
}

/**
 * As colunas do RETRATO, prontas para gravar.
 *
 * Guarda os PARÂMETROS junto do resultado, e isso não é redundância: sem eles o
 * retrato seria pela metade — daria para ver o número, não para reconstruí-lo
 * depois que o admin mudar a diária.
 */
export function retratoParaGravar(resultado: ResultadoViagem, params: ParametrosViagem) {
  return {
    custo_total: resultado.total,
    meses: resultado.meses,
    grupos: resultado.grupos,
    premissas: resultado.premissas,
    parametros: params,
    calculado_em: new Date().toISOString(),
  };
}

/** Os 12 meses do retrato gravado, para a Prévia. Formato ruim vira zeros. */
export function mesesDoRetrato(v: unknown): number[] {
  const zeros = Array<number>(12).fill(0);
  if (!Array.isArray(v)) return zeros;
  for (let i = 0; i < 12; i += 1) {
    const x = n(v[i]);
    if (x != null) zeros[i] = x;
  }
  return zeros;
}

/** Os grupos do retrato, já saneados — a tela não precisa desconfiar deles. */
export function gruposDoRetrato(
  v: unknown,
): Array<{ grupo: string; label: string; total: number; linhas: Array<{ descricao: string; valor: number }> }> {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const g of v) {
    if (!g || typeof g !== "object") continue;
    const o = g as Record<string, unknown>;
    const grupo = texto(o.grupo);
    if (!GRUPOS_VIAGEM.includes(grupo as (typeof GRUPOS_VIAGEM)[number])) continue;
    out.push({
      grupo,
      label: texto(o.label) || grupo,
      total: n(o.total) ?? 0,
      linhas: lerOutros(o.linhas).map((l) => ({ descricao: l.descricao, valor: l.valor })),
    });
  }
  return out;
}
