import type { RoteiroEditavel } from "@/lib/viagens/cartao";

// =============================================================================
// Aplicar os preços encontrados ao roteiro.
//
// ── Só preenche campo VAZIO ────────────────────────────────────────────────
// Mesma disciplina do OCR do Case e do cartão da IA: leitura é SUGESTÃO, e o que
// a pessoa digitou nunca é sobrescrito. Aqui isso pesa mais do que de costume —
// quem digitou um preço quase sempre tem a cotação na mão, e trocá-la por um
// "menor preço encontrado na web" rebaixaria o orçamento com aparência de
// pesquisa.
//
// ── A busca é referência, não cotação ─────────────────────────────────────
// Para uma viagem do ano que vem a tarifa ainda não foi publicada; o que se acha
// é o preço de hoje para a rota naquele mês. O motor não distingue um do outro
// (os dois chegam como "valor informado"), então quem distingue é quem confirma —
// e é por isso que isto devolve um RELATÓRIO do que mudaria, para a tela mostrar
// antes de aplicar.
//
// Módulo PURO e testado.
// =============================================================================

export interface PrecoDeTrecho {
  /** `p0`, `p1`, … para a chegada de cada parada; `volta` para o retorno. */
  id: string;
  precoPorPessoa: number;
  fonte: string | null;
}

export interface PrecoDeHotel {
  cidade: string;
  diaria: number;
  fonte: string | null;
}

export interface PropostaPrecos {
  trechos: PrecoDeTrecho[];
  hoteis: PrecoDeHotel[];
}

export interface AplicacaoPrecos {
  roteiro: RoteiroEditavel;
  /** O que de fato foi preenchido — vira a lista que a tela mostra. */
  aplicados: string[];
  /** O que veio na busca e NÃO foi usado, com o motivo. */
  ignorados: string[];
}

/** `p3` → 3; qualquer outra coisa → null. */
export function indiceDaParada(id: string): number | null {
  const m = /^p(\d+)$/.exec(id.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Já tem preço informado? `precoTotal` ou `precoPorPessoa` contam. */
function jaTemPreco(t: {
  chegadaPrecoPessoa?: number | null;
  chegadaPrecoTotal?: number | null;
}): boolean {
  return (t.chegadaPrecoPessoa ?? 0) > 0 || (t.chegadaPrecoTotal ?? 0) > 0;
}

/** Normaliza para comparar cidade: sem acento, sem caixa, sem espaço sobrando. */
function chaveCidade(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Aplica a proposta, preenchendo só o que está vazio.
 *
 * Devolve também o que ficou de fora e por quê: busca que "não fez nada" sem
 * dizer o motivo faz a pessoa clicar de novo achando que falhou.
 */
export function aplicarPrecos(
  atual: RoteiroEditavel,
  proposta: PropostaPrecos,
): AplicacaoPrecos {
  const paradas = atual.paradas.map((p) => ({ ...p }));
  const aplicados: string[] = [];
  const ignorados: string[] = [];

  let volta = {
    voltaPrecoPessoa: atual.voltaPrecoPessoa ?? null,
    voltaPrecoTotal: atual.voltaPrecoTotal ?? null,
  };

  for (const t of proposta.trechos) {
    if (!(t.precoPorPessoa > 0)) {
      ignorados.push(`${t.id}: preço inválido`);
      continue;
    }

    if (t.id.trim().toLowerCase() === "volta") {
      if (!atual.voltaModal) {
        ignorados.push("volta: a viagem não tem trecho de volta");
        continue;
      }
      if ((volta.voltaPrecoPessoa ?? 0) > 0 || (volta.voltaPrecoTotal ?? 0) > 0) {
        ignorados.push("volta: já tinha preço informado");
        continue;
      }
      volta = { ...volta, voltaPrecoPessoa: t.precoPorPessoa };
      aplicados.push(`Volta: R$ ${t.precoPorPessoa.toFixed(2)} por pessoa`);
      continue;
    }

    const i = indiceDaParada(t.id);
    if (i == null || i >= paradas.length) {
      ignorados.push(`${t.id}: trecho que não existe mais no roteiro`);
      continue;
    }
    const p = paradas[i];
    // Carro e van têm o R$/km da empresa: um preço de passagem ali seria outra
    // coisa, e sobrescrever a estimativa por km mudaria o método do trecho.
    if (p.chegadaModal === "carro" || p.chegadaModal === "van") {
      ignorados.push(`${p.cidade}: trecho de carro/van — o custo vem do R$/km`);
      continue;
    }
    if (jaTemPreco(p)) {
      ignorados.push(`${p.cidade}: já tinha preço informado`);
      continue;
    }
    p.chegadaPrecoPessoa = t.precoPorPessoa;
    aplicados.push(`${p.cidade}: R$ ${t.precoPorPessoa.toFixed(2)} por pessoa`);
  }

  for (const h of proposta.hoteis) {
    if (!(h.diaria > 0)) {
      ignorados.push(`${h.cidade}: diária inválida`);
      continue;
    }
    const alvo = paradas.find((p) => chaveCidade(p.cidade) === chaveCidade(h.cidade));
    if (!alvo) {
      ignorados.push(`${h.cidade}: cidade que não está no roteiro`);
      continue;
    }
    if ((alvo.noites ?? 0) <= 0) {
      ignorados.push(`${h.cidade}: sem noites no roteiro`);
      continue;
    }
    if ((alvo.diariaHotel ?? 0) > 0) {
      ignorados.push(`${h.cidade}: já tinha diária informada`);
      continue;
    }
    alvo.diariaHotel = h.diaria;
    aplicados.push(`${alvo.cidade}: diária de R$ ${h.diaria.toFixed(2)}`);
  }

  return { roteiro: { ...atual, ...volta, paradas }, aplicados, ignorados };
}
