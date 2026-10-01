import {
  GRUPOS_VIAGEM,
  GRUPO_LABEL,
  MODAL_LABEL,
  type GrupoCusto,
  type GrupoViagem,
  type LinhaCusto,
  type ParametrosViagem,
  type ParadaViagem,
  type ResultadoViagem,
  type TrechoViagem,
  type ViagemSpec,
} from "./tipos";

// =============================================================================
// O MOTOR DE CUSTO DE VIAGEM — o dono do número no sistema.
//
// ── Por que a conta é DETERMINÍSTICA e a IA não calcula ────────────────────
// O orçamento é do ano que vem: não existe preço real para setembro de 2027, e
// nenhuma API devolve isso. Então a estimativa é inevitável — mas há duas
// formas de estimar, e elas não se equivalem:
//
//   • o modelo de linguagem diz "uns R$ 3.500" → ninguém sabe de onde veio, e
//     quando ele erra, erra com um número plausível que ninguém confere;
//   • a conta sai de PARÂMETROS que o admin controla → cada linha se explica,
//     e mudar a premissa muda o orçamento inteiro de forma previsível.
//
// Este módulo é o segundo caminho. A IA monta o ROTEIRO (quantos trechos, qual
// modal, quantas noites, quantos quartos) e conversa sobre isso; o valor sai
// daqui. É a mesma divisão do cartão de despesa no Planejamento: a IA propõe,
// o número é do sistema.
//
// ── Por que o preço informado VENCE ────────────────────────────────────────
// `precoTotal` > `precoPorPessoa` > cálculo por km. Quem já tem uma cotação em
// mãos não deve brigar com a estimativa — e é por essa porta que a cotação de
// COMPRA vai entrar depois, com preço real, sem reescrever o motor.
//
// Módulo PURO e testado. Sem acesso a banco, sem IA, sem rede.
// =============================================================================

const round2 = (n: number) => Math.round(n * 100) / 100;
const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

/** Soma defensiva: valor não finito vira 0 em vez de contaminar o total com NaN. */
function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function positivo(v: number | null | undefined): number {
  return Math.max(0, num(v));
}

interface Acumulador {
  linhas: Map<GrupoViagem, LinhaCusto[]>;
  premissas: string[];
}

function novoAcumulador(): Acumulador {
  const linhas = new Map<GrupoViagem, LinhaCusto[]>();
  for (const g of GRUPOS_VIAGEM) linhas.set(g, []);
  return { linhas, premissas: [] };
}

function lancar(acc: Acumulador, grupo: GrupoViagem, descricao: string, valor: number) {
  const v = round2(valor);
  if (v === 0) return;
  acc.linhas.get(grupo)!.push({ descricao, valor: v });
}

/**
 * Custo de UM trecho para o grupo todo.
 *
 * A ordem das fontes é a regra central: preço fechado, depois preço por pessoa,
 * depois a estimativa por quilômetro. Cada caminho devolve também a premissa
 * quando arbitrou algo — o diretor precisa distinguir cotado de arbitrado.
 */
function custoDoTrecho(
  trecho: TrechoViagem,
  pessoas: number,
  params: ParametrosViagem,
  acc: Acumulador,
): { valor: number; descricao: string } {
  const rota = `${trecho.de} → ${trecho.para}`;
  const modal = MODAL_LABEL[trecho.modal] ?? trecho.modal;

  if (num(trecho.precoTotal) > 0) {
    return { valor: positivo(trecho.precoTotal), descricao: `${modal} ${rota}: valor informado` };
  }
  if (num(trecho.precoPorPessoa) > 0) {
    const v = positivo(trecho.precoPorPessoa) * pessoas;
    return {
      valor: v,
      descricao: `${modal} ${rota}: ${brl(positivo(trecho.precoPorPessoa))} × ${pessoas} pessoa(s)`,
    };
  }

  const km = positivo(trecho.distanciaKm);
  if (km === 0) {
    acc.premissas.push(
      `Trecho ${rota} (${modal}) entrou com custo ZERO: sem preço informado e sem distância.`,
    );
    return { valor: 0, descricao: `${modal} ${rota}: sem preço e sem distância` };
  }

  if (trecho.modal === "carro" || trecho.modal === "van") {
    // Por VEÍCULO, não por pessoa — rodar com 1 ou 4 pessoas custa o mesmo.
    const veiculos = Math.max(1, Math.round(positivo(trecho.veiculos) || 1));
    const v = km * params.rsPorKm * veiculos;
    acc.premissas.push(
      `Trecho ${rota}: estimado por quilometragem (${km} km × ${brl(params.rsPorKm)}/km × ${veiculos} veículo(s)).`,
    );
    return {
      valor: v,
      descricao: `${modal} ${rota}: ${km} km × ${brl(params.rsPorKm)}/km × ${veiculos} veículo(s)`,
    };
  }

  if (trecho.modal === "onibus") {
    const v = km * params.tarifaOnibusKm * pessoas;
    acc.premissas.push(`Trecho ${rota}: passagem de ônibus estimada por quilometragem.`);
    return {
      valor: v,
      descricao: `${modal} ${rota}: ${km} km × ${brl(params.tarifaOnibusKm)}/km × ${pessoas} pessoa(s)`,
    };
  }

  // Avião e "outro" sem preço: a estimativa por km é GROSSEIRA e vai dito.
  const v = km * params.aviaoPorKmPessoa * pessoas;
  acc.premissas.push(
    `Trecho ${rota}: passagem aérea ESTIMADA por quilometragem, sem cotação. ` +
      `Confira antes de aprovar.`,
  );
  return {
    valor: v,
    descricao: `${modal} ${rota}: ${km} km × ${brl(params.aviaoPorKmPessoa)}/km × ${pessoas} pessoa(s) (estimado)`,
  };
}

function lancarTrecho(
  acc: Acumulador,
  trecho: TrechoViagem,
  pessoas: number,
  params: ParametrosViagem,
) {
  const { valor, descricao } = custoDoTrecho(trecho, pessoas, params, acc);
  lancar(acc, "passagem", descricao, valor);
  const pedagios = positivo(trecho.pedagios);
  if (pedagios > 0) {
    lancar(acc, "passagem", `Pedágios ${trecho.de} → ${trecho.para}`, pedagios);
  }
}

function lancarEstadia(
  acc: Acumulador,
  parada: ParadaViagem,
  quartos: number,
  params: ParametrosViagem,
) {
  const noites = Math.max(0, Math.round(num(parada.noites)));
  if (noites === 0) return;

  const diaria = positivo(parada.diariaHotel) || params.hotelDiariaPadrao;
  if (!positivo(parada.diariaHotel)) {
    acc.premissas.push(
      `Hospedagem em ${parada.cidade}: diária padrão de ${brl(params.hotelDiariaPadrao)}, sem hotel escolhido.`,
    );
  }
  lancar(
    acc,
    "hospedagem",
    `${parada.cidade}: ${noites} noite(s) × ${brl(diaria)} × ${quartos} quarto(s)`,
    noites * diaria * quartos,
  );

  const local = parada.transporteLocal;
  if (local && positivo(local.custoPorTrajeto) > 0 && positivo(local.trajetosPorDia) > 0) {
    // Os trajetos acontecem nos DIAS na cidade, que são as noites + o dia da
    // chegada. Usar só as noites perderia o deslocamento do último dia.
    const dias = noites + 1;
    const trajetos = Math.round(positivo(local.trajetosPorDia)) * dias;
    const destino = (local.destino ?? "").trim();
    lancar(
      acc,
      "transporte_local",
      `${parada.cidade}${destino ? ` (hotel ↔ ${destino})` : ""}: ${trajetos} trajeto(s) × ${brl(positivo(local.custoPorTrajeto))}`,
      trajetos * positivo(local.custoPorTrajeto),
    );
  }
}

/**
 * Calcula o custo da viagem inteira, aberto por grupo.
 *
 * ── A distribuição mensal ─────────────────────────────────────────────────
 * O custo inteiro cai no MÊS DA PARTIDA, mesmo quando a viagem atravessa a
 * virada do mês. É decisão, não simplificação preguiçosa: o orçamento compara
 * com o realizado da DRE, que é por regime de CAIXA, e passagem e hotel são
 * pagos antes de viajar. Ratear por noite jogaria para fevereiro um dinheiro
 * que saiu em janeiro.
 */
export function calcularViagem(spec: ViagemSpec, params: ParametrosViagem): ResultadoViagem {
  const acc = novoAcumulador();
  const pessoas = Math.max(1, Math.round(num(spec.pessoas)));
  const porQuarto = Math.max(1, Math.round(num(spec.pessoasPorQuarto) || 1));
  const quartos = Math.ceil(pessoas / porQuarto);

  const paradas = spec.paradas ?? [];
  const noites = paradas.reduce((a, p) => a + Math.max(0, Math.round(num(p.noites))), 0);
  // Dias de alimentação = noites + 1 (o dia da ida e o da volta contam).
  const dias = noites + 1;

  // ── Trechos: chegada de cada parada + a volta ──
  for (const parada of paradas) {
    if (parada.chegada) lancarTrecho(acc, parada.chegada, pessoas, params);
  }
  if (spec.volta) lancarTrecho(acc, spec.volta, pessoas, params);

  // ── Translado casa ↔ terminal ──
  const t = spec.translado;
  if (t && positivo(t.custoPorTrajeto) > 0 && positivo(t.trajetos) > 0) {
    const trajetos = Math.round(positivo(t.trajetos));
    lancar(
      acc,
      "translado",
      `Casa ↔ terminal: ${trajetos} trajeto(s) × ${brl(positivo(t.custoPorTrajeto))}`,
      trajetos * positivo(t.custoPorTrajeto),
    );
  }

  // ── Estadia e deslocamento local em cada parada ──
  for (const parada of paradas) lancarEstadia(acc, parada, quartos, params);

  // ── Alimentação ──
  lancar(
    acc,
    "alimentacao",
    `${dias} dia(s) × ${brl(params.diariaAlimentacao)} × ${pessoas} pessoa(s)`,
    dias * params.diariaAlimentacao * pessoas,
  );

  // ── Avulsos ──
  for (const o of spec.outros ?? []) {
    lancar(acc, "outros", (o.descricao ?? "").trim() || "Outro custo", num(o.valor));
  }

  const grupos: GrupoCusto[] = GRUPOS_VIAGEM.map((g) => {
    const linhas = acc.linhas.get(g)!;
    return {
      grupo: g,
      label: GRUPO_LABEL[g],
      linhas,
      total: round2(linhas.reduce((a, l) => a + l.valor, 0)),
    };
  }).filter((g) => g.linhas.length > 0);

  const total = round2(grupos.reduce((a, g) => a + g.total, 0));

  const meses = Array<number>(12).fill(0);
  const mes = mesDaData(spec.dataIda);
  if (mes != null) meses[mes - 1] = total;
  else acc.premissas.push("Sem data de partida: o custo não foi distribuído em nenhum mês.");

  return {
    grupos,
    total,
    meses,
    premissas: Array.from(new Set(acc.premissas)),
    noites,
    dias,
    quartos,
  };
}

/** Mês 1..12 de uma data ISO, ou null quando a data não serve. */
export function mesDaData(iso: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  if (!m) return null;
  const mes = Number(m[2]);
  return mes >= 1 && mes <= 12 ? mes : null;
}
