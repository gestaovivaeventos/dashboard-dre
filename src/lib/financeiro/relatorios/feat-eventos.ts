import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// Camada gerencial EXCLUSIVA da Feat Produções para o One Page Report.
//
// Lê a tabela `company_feat_projetos` (cadastrada no Painel Administrador) e
// produz, ATÉ a data de referência do relatório (mês/ano de `dateTo`):
//   - Resultado total previsto e realizado acumulados;
//   - Resultado realizado e previsto agrupados por tipo de evento;
//   - Número de eventos REALIZADOS (fechamento = "Realizado") por tipo;
//   - Contagem de eventos em aberto / previstos e não realizados / realizados.
//
// É um COMPLEMENTO gerencial: não toca DRE, Fluxo de Caixa, Omie nem Sheets, e
// só é invocado para a empresa Feat Produções (gate no caller, por template).
// "Até a data de referência" = todos os projetos com (ano < anoRef) OU
// (ano = anoRef E mês <= mesRef) — acumulado desde o início, sem piso inferior.
// ============================================================================

// Tipos de evento canônicos (mesma whitelist da tabela/admin). A ordem define a
// ordem das barras nos gráficos.
const TIPOS_EVENTO = ["Corporativo", "Show", "Licitação"] as const;

const FECHAMENTO_REALIZADO = "Realizado";
const FECHAMENTO_EM_ABERTO = "Em aberto";
const FECHAMENTO_NAO_REALIZADO = "Evento previsto e não realizado";

interface ProjetoRow {
  year: number;
  month: number;
  projeto: string | null;
  tipo_evento: string | null;
  resultado_previsto: number | string | null;
  resultado_realizado: number | string | null;
  fechamento: string | null;
}

export interface FeatEventoEmAberto {
  projeto: string;
  resultadoPrevisto: number;
}

export interface FeatEventoResultadoTipo {
  tipo: string;
  previsto: number;
  realizado: number;
}

export interface FeatEventoContagemTipo {
  tipo: string;
  quantidade: number;
}

// Dados para renderização do quadro exclusivo no One Page Report (preview/PDF).
export interface FeatEventosPayload {
  referenciaLabel: string;
  totalPrevisto: number;
  totalRealizado: number;
  resultadoPorTipo: FeatEventoResultadoTipo[];
  // Apenas eventos com fechamento "Realizado".
  numeroEventosRealizadosPorTipo: FeatEventoContagemTipo[];
  eventosEmAberto: number;
  eventosNaoRealizados: number;
  eventosRealizados: number;
  // ── Bloco "Fechamentos em aberto" ──────────────────────────────────────────
  // Lista dos eventos com fechamento "Em aberto" até a referência (nome +
  // resultado previsto), a soma do previsto em aberto e a PROJEÇÃO gerencial:
  //   resultado acumulado ATUAL (Resultado do Exercício acumulado do DRE, o
  //   mesmo valor da Acumulado do Ano) + soma do previsto em aberto.
  // É estimativa orçamentária, NÃO resultado realizado.
  eventosEmAbertoDetalhe: FeatEventoEmAberto[];
  previstoEmAbertoTotal: number;
  // Base da projeção: Resultado do Exercício acumulado do DRE (não a soma do
  // realizado dos eventos). Repetido aqui para o quadro exibir a base usada.
  resultadoAcumuladoAtual: number;
  resultadoAcumuladoProjetado: number;
  // Resultado do Exercício acumulado ORÇADO do DRE (Acumulado do Ano > Resultado
  // previsto) e o % de atingimento da projeção sobre ele. Null quando não há
  // orçamento acumulado (não dá pra calcular o %).
  resultadoAcumuladoPrevistoOrcamento: number | null;
  percentualAtingimentoProjecao: number | null;
}

// Resumo enviado à IA (subconjunto numérico do payload acima).
export interface FeatEventosResumoIA {
  referencia: string;
  total_previsto_ate_referencia: number;
  total_realizado_ate_referencia: number;
  resultado_por_tipo: Array<{
    tipo: string;
    previsto: number;
    realizado: number;
  }>;
  eventos_realizados_por_tipo: Array<{ tipo: string; quantidade: number }>;
  eventos_em_aberto: number;
  eventos_previstos_nao_realizados: number;
  eventos_realizados: number;
  // Detalhe dos eventos em aberto + projeção gerencial (não é resultado realizado).
  eventos_em_aberto_detalhe: Array<{
    projeto: string;
    resultado_previsto: number;
  }>;
  previsto_em_aberto_total: number;
  // Base da projeção = Resultado do Exercício acumulado do DRE (NÃO a soma do
  // realizado dos eventos). Mesmo valor da Acumulado do Ano > Resultado.
  resultado_acumulado_atual: number;
  resultado_acumulado_projetado: number;
  // Resultado acumulado ORÇADO + % de atingimento da projeção sobre o orçado.
  resultado_acumulado_previsto_orcamento: number | null;
  percentual_atingimento_projecao: number | null;
}

export interface FeatEventosResult {
  payload: FeatEventosPayload;
  resumoIA: FeatEventosResumoIA;
}

function toNumber(v: number | string | null): number {
  if (v === null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * Constrói o bloco de eventos da Feat Produções acumulado até (refYear, refMonth).
 * Retorna `null` quando não há nenhum projeto até a referência — assim o quadro
 * e o contexto da IA simplesmente não aparecem (evita "buraco" visual vazio).
 */
export async function buildFeatEventos(
  supabase: SupabaseClient,
  companyId: string,
  refYear: number,
  refMonth: number,
  referenciaLabel: string,
  // Resultado do Exercício acumulado do DRE até a referência (Jan→dateTo),
  // base da projeção gerencial. É o MESMO número do bloco "Acumulado do Ano >
  // Resultado" / do Resultado acumulado do Dashboard DRE — NÃO a soma do
  // realizado dos eventos (que é outro conceito).
  resultadoAcumuladoAtual: number,
  // Resultado do Exercício acumulado ORÇADO do DRE (Acumulado do Ano > Resultado
  // previsto). Usado para o % de atingimento da projeção. Null quando ausente.
  resultadoAcumuladoOrcado: number | null,
): Promise<FeatEventosResult | null> {
  const { data, error } = await supabase
    .from("company_feat_projetos")
    .select(
      "year, month, projeto, tipo_evento, resultado_previsto, resultado_realizado, fechamento",
    )
    .eq("company_id", companyId)
    .lte("year", refYear);

  if (error) {
    // Falha de leitura não deve derrubar o relatório inteiro — apenas omite o
    // quadro gerencial (comportamento seguro/incremental).
    return null;
  }

  const rows = ((data ?? []) as ProjetoRow[]).filter(
    (r) => r.year < refYear || (r.year === refYear && r.month <= refMonth),
  );
  if (rows.length === 0) return null;

  let totalPrevisto = 0;
  let totalRealizado = 0;
  let eventosEmAberto = 0;
  let eventosNaoRealizados = 0;
  let eventosRealizados = 0;
  let previstoEmAbertoTotal = 0;
  const eventosEmAbertoDetalhe: FeatEventoEmAberto[] = [];

  const previstoPorTipo = new Map<string, number>();
  const realizadoPorTipo = new Map<string, number>();
  const realizadosCountPorTipo = new Map<string, number>();
  TIPOS_EVENTO.forEach((t) => {
    previstoPorTipo.set(t, 0);
    realizadoPorTipo.set(t, 0);
    realizadosCountPorTipo.set(t, 0);
  });

  for (const r of rows) {
    const previsto = toNumber(r.resultado_previsto);
    const realizado = toNumber(r.resultado_realizado);
    totalPrevisto += previsto;
    totalRealizado += realizado;

    // Só agrupa por tipo quando o tipo é um dos canônicos (ignora nulos/avulsos).
    const tipo = r.tipo_evento;
    const isCanon = (TIPOS_EVENTO as readonly string[]).includes(tipo ?? "");
    if (isCanon && tipo) {
      previstoPorTipo.set(tipo, (previstoPorTipo.get(tipo) ?? 0) + previsto);
      realizadoPorTipo.set(tipo, (realizadoPorTipo.get(tipo) ?? 0) + realizado);
    }

    switch (r.fechamento) {
      case FECHAMENTO_REALIZADO:
        eventosRealizados += 1;
        if (isCanon && tipo) {
          realizadosCountPorTipo.set(
            tipo,
            (realizadosCountPorTipo.get(tipo) ?? 0) + 1,
          );
        }
        break;
      case FECHAMENTO_EM_ABERTO:
        eventosEmAberto += 1;
        previstoEmAbertoTotal += previsto;
        eventosEmAbertoDetalhe.push({
          projeto: (r.projeto ?? "").trim() || "(sem nome)",
          resultadoPrevisto: round2(previsto),
        });
        break;
      case FECHAMENTO_NAO_REALIZADO:
        eventosNaoRealizados += 1;
        break;
      default:
        break;
    }
  }

  const resultadoPorTipo: FeatEventoResultadoTipo[] = TIPOS_EVENTO.map((t) => ({
    tipo: t,
    previsto: round2(previstoPorTipo.get(t) ?? 0),
    realizado: round2(realizadoPorTipo.get(t) ?? 0),
  }));

  const numeroEventosRealizadosPorTipo: FeatEventoContagemTipo[] =
    TIPOS_EVENTO.map((t) => ({
      tipo: t,
      quantidade: realizadosCountPorTipo.get(t) ?? 0,
    }));

  // Projeção gerencial: Resultado do Exercício acumulado do DRE (base já
  // exibida no relatório/dashboard) + soma do previsto dos eventos em aberto.
  // NÃO é resultado realizado — depende da conclusão dos fechamentos.
  const totalRealizadoRounded = round2(totalRealizado);
  const resultadoAcumuladoAtualRounded = round2(resultadoAcumuladoAtual);
  const previstoEmAbertoRounded = round2(previstoEmAbertoTotal);
  const resultadoAcumuladoProjetado = round2(
    resultadoAcumuladoAtualRounded + previstoEmAbertoRounded,
  );

  // % de atingimento da projeção sobre o resultado acumulado ORÇADO do DRE.
  // Null quando não há orçamento acumulado (ou é zero) — evita divisão inválida.
  const orcadoRounded =
    resultadoAcumuladoOrcado === null ? null : round2(resultadoAcumuladoOrcado);
  const percentualAtingimentoProjecao =
    orcadoRounded !== null && orcadoRounded !== 0
      ? round2((resultadoAcumuladoProjetado / orcadoRounded) * 100)
      : null;

  const payload: FeatEventosPayload = {
    referenciaLabel,
    totalPrevisto: round2(totalPrevisto),
    totalRealizado: totalRealizadoRounded,
    resultadoPorTipo,
    numeroEventosRealizadosPorTipo,
    eventosEmAberto,
    eventosNaoRealizados,
    eventosRealizados,
    eventosEmAbertoDetalhe,
    previstoEmAbertoTotal: previstoEmAbertoRounded,
    resultadoAcumuladoAtual: resultadoAcumuladoAtualRounded,
    resultadoAcumuladoProjetado,
    resultadoAcumuladoPrevistoOrcamento: orcadoRounded,
    percentualAtingimentoProjecao,
  };

  // Limita a lista enviada à IA para não inflar tokens; o quadro visual lista
  // todos. Quando há mais que o teto, a IA ainda recebe os totais corretos.
  const IA_MAX_EVENTOS = 15;
  const resumoIA: FeatEventosResumoIA = {
    referencia: referenciaLabel,
    total_previsto_ate_referencia: payload.totalPrevisto,
    total_realizado_ate_referencia: totalRealizadoRounded,
    resultado_por_tipo: resultadoPorTipo,
    eventos_realizados_por_tipo: numeroEventosRealizadosPorTipo,
    eventos_em_aberto: eventosEmAberto,
    eventos_previstos_nao_realizados: eventosNaoRealizados,
    eventos_realizados: eventosRealizados,
    eventos_em_aberto_detalhe: eventosEmAbertoDetalhe
      .slice(0, IA_MAX_EVENTOS)
      .map((e) => ({
        projeto: e.projeto,
        resultado_previsto: e.resultadoPrevisto,
      })),
    previsto_em_aberto_total: previstoEmAbertoRounded,
    resultado_acumulado_atual: resultadoAcumuladoAtualRounded,
    resultado_acumulado_projetado: resultadoAcumuladoProjetado,
    resultado_acumulado_previsto_orcamento: orcadoRounded,
    percentual_atingimento_projecao: percentualAtingimentoProjecao,
  };

  return { payload, resumoIA };
}
