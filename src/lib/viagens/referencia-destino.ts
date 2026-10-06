import { chaveNome } from "@/lib/viagens/plano";
import type { FaixaReferencia } from "@/lib/viagens/custo/tipos";
import type { ReferenciaHistorico } from "@/lib/viagens/historico";

// =============================================================================
// DESTINO SEM HISTÓRICO: a pendência, e o valor que a Controladoria informa
// (02/10/2026).
//
// ── A regra, nas palavras de quem pediu ───────────────────────────────────
// "Avisar que esse destino não possui dados de histórico registrados e que deve ser
// informado ao responsável da Controladoria para que as informações sejam inputadas
// no sistema. Isso não impede que o usuário cadastre o orçamento da viagem, só que
// eu vou colocar os valores depois."
//
// Três consequências, e nenhuma delas é detalhe:
//
//  1. NÃO BLOQUEIA. A viagem é cadastrada, entra na grade e na fila do diretor; o
//     que falta é o número, não o cadastro.
//  2. NÃO ESTIMA. Zero com pendência nomeada — e é por isso que a FAIXA por região
//     saiu do caminho do cálculo. Um plano B regional daria à viagem um valor
//     plausível e CALARIA o aviso, que é exatamente o contrário do pedido.
//  3. A pendência tem DONO e ENDEREÇO. Dizer "sem dados" sem dizer o que fazer
//     devolve o problema a quem não pode resolvê-lo: quem preenche a grade não
//     define preço de passagem.
//
// ── Por que o reajuste não se aplica ao valor informado ──────────────────
// O percentual por grupo corrige um número de 2026 para 2027. O informado já é um
// número do ano do orçamento, digitado agora — reajustá-lo o inflaria duas vezes.
//
// Módulo PURO e testado.
// =============================================================================

export interface ReferenciaInformada {
  cidade: string;
  /** R$ por pessoa, SÓ IDA. `null` = esta metade ainda não foi informada. */
  passagemPorPessoa: number | null;
  /** R$ por quarto por noite. */
  diariaPorQuarto: number | null;
  modal: string | null;
  /** De onde veio o número (cotação de agência, site). Vai para a premissa. */
  observacao: string | null;
  informadoEm: string | null;
}

/** Indexa pelo nome normalizado — "São Luís" e "sao luis" são o mesmo destino. */
export function indexarInformadas(
  lista: readonly ReferenciaInformada[],
): Map<string, ReferenciaInformada> {
  const out = new Map<string, ReferenciaInformada>();
  for (const r of lista) {
    const cidade = (r.cidade ?? "").trim();
    if (!cidade) continue;
    out.set(chaveNome(cidade), r);
  }
  return out;
}

function positivo(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function rotulo(ref: ReferenciaInformada): string {
  const partes = [`informado pela Controladoria para ${ref.cidade}`];
  if (ref.observacao) partes.push(ref.observacao);
  else if (ref.informadoEm) partes.push(ref.informadoEm.slice(0, 10).split("-").reverse().join("/"));
  return partes.length > 1 ? `${partes[0]} (${partes.slice(1).join(", ")})` : partes[0];
}

/**
 * A passagem informada, no formato que o motor consome.
 *
 * `origem: "informada"` para a premissa usar o verbo certo: quem valida precisa
 * distinguir número OBSERVADO (histórico) de número que alguém informou.
 */
export function passagemInformada(
  ref: ReferenciaInformada | undefined | null,
): FaixaReferencia | null {
  if (!ref || positivo(ref.passagemPorPessoa) === 0) return null;
  return {
    nome: rotulo(ref),
    valor: positivo(ref.passagemPorPessoa),
    origem: "informada",
  };
}

export function hospedagemInformada(
  ref: ReferenciaInformada | undefined | null,
): FaixaReferencia | null {
  if (!ref || positivo(ref.diariaPorQuarto) === 0) return null;
  return {
    nome: rotulo(ref),
    valor: positivo(ref.diariaPorQuarto),
    origem: "informada",
  };
}

/** Uma linha de viagem, do ponto de vista de "tem dado de custo?". */
export interface LinhaParaPendencia {
  destino: string;
  noites: number;
  /** Modal da ida. Carro e van não precisam de passagem: lá vale km × R$/km. */
  modal: string | null;
  /** A linha já tem preço de passagem digitado? Então não falta nada. */
  temPrecoProprio?: boolean;
}

export interface DestinoPendente {
  cidade: string;
  cidadeChave: string;
  /** Em quantas viagens do ano este destino aparece. */
  viagens: number;
  faltaPassagem: boolean;
  faltaHospedagem: boolean;
}

/**
 * Os destinos cujas viagens não têm de onde tirar número.
 *
 * É a lista que a Controladoria recebe para preencher, e a mesma conta que marca a
 * linha na grade — uma fonte só, senão a tela diria uma coisa e a lista outra.
 *
 * O que NÃO entra, e por quê:
 *  - carro e van não precisam de passagem (km × R$/km é o custo deles);
 *  - bate-volta (sem noite) não precisa de diária;
 *  - linha com preço digitado não precisa de nada — quem tem a cotação em mão já
 *    resolveu;
 *  - destino cuja metade existe aparece só pela metade que falta. Dá para saber a
 *    diária de uma cidade e não a passagem, e cobrar as duas seria pedir à
 *    Controladoria trabalho que ela já fez.
 */
export function destinosPendentes(
  linhas: readonly LinhaParaPendencia[],
  historico: ReadonlyMap<string, ReferenciaHistorico>,
  informadas: ReadonlyMap<string, ReferenciaInformada>,
): DestinoPendente[] {
  const porChave = new Map<string, DestinoPendente>();

  for (const l of linhas) {
    const cidade = (l.destino ?? "").trim();
    if (!cidade) continue;
    const k = chaveNome(cidade);

    const h = historico.get(k);
    const i = informadas.get(k);

    const temPassagem =
      positivo(h?.passagemPorPessoa) > 0 || positivo(i?.passagemPorPessoa) > 0;
    const temDiaria = positivo(h?.diariaPorQuarto) > 0 || positivo(i?.diariaPorQuarto) > 0;

    const porVeiculo = l.modal === "carro" || l.modal === "van";
    const faltaPassagem = !temPassagem && !porVeiculo && !l.temPrecoProprio;
    const faltaHospedagem = !temDiaria && l.noites > 0;

    if (!faltaPassagem && !faltaHospedagem) continue;

    const atual = porChave.get(k);
    porChave.set(k, {
      cidade: atual?.cidade ?? cidade,
      cidadeChave: k,
      viagens: (atual?.viagens ?? 0) + 1,
      faltaPassagem: (atual?.faltaPassagem ?? false) || faltaPassagem,
      faltaHospedagem: (atual?.faltaHospedagem ?? false) || faltaHospedagem,
    });
  }

  // Mais viagens primeiro: é o destino que, preenchido, move mais o orçamento.
  return Array.from(porChave.values()).sort(
    (a, b) => b.viagens - a.viagens || a.cidade.localeCompare(b.cidade, "pt-BR"),
  );
}

/**
 * A frase que a tela mostra. Nomeia o que falta E quem resolve.
 *
 * "Sem dados" sozinho devolve o problema a quem não pode resolvê-lo — quem monta a
 * grade não define preço de passagem.
 */
export function avisoDoPendente(p: DestinoPendente): string {
  const falta =
    p.faltaPassagem && p.faltaHospedagem
      ? "passagem e diária"
      : p.faltaPassagem
        ? "passagem"
        : "diária";
  return (
    `${p.cidade} não tem histórico de viagem registrado (falta ${falta}). ` +
    "A viagem pode ser cadastrada normalmente; avise a Controladoria para informar " +
    "os valores, e o custo passa a aparecer."
  );
}
