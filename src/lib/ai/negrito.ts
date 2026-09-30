// O `**negrito**` que a IA escreve por conta própria.
//
// Nenhum prompt do projeto pede markdown — o modelo usa mesmo assim, e muito:
// levantamento das conversas gravadas em 30/09/2026 achou 63 trechos entre
// asteriscos duplos (nomes de fornecedor, valores, nome da categoria) contra
// zero itálico, título, código, link ou tabela. Como a bolha renderiza texto
// puro, os asteriscos apareciam na tela.
//
// Por isso aqui só existe negrito: tratar o que o modelo REALMENTE emite, e não
// montar meio interpretador de markdown para casos que nunca aconteceram. Lista
// com "- " continua saindo como está — o `whitespace-pre-wrap` já a exibe em
// linhas, e um traço no começo da linha lê como marcador, não como defeito.
//
// Módulo PURO (sem "use client"): a regra é testável fora do navegador.

export interface TrechoTexto {
  texto: string;
  negrito: boolean;
}

/**
 * Parte o texto em trechos normais e em negrito, COMENDO os asteriscos.
 *
 * A implementação é um `split("**")` com alternância, e isso não é preguiça —
 * é o que dá o comportamento certo durante o STREAMING de graça. Enquanto a
 * resposta é digitada, o texto chega com o par ainda aberto
 * (`"...na categoria de **Capacit"`), e a alternância simplesmente deixa o
 * último trecho em negrito até o fim. O negrito vai "crescendo" com a digitação
 * em vez de a tela piscar `**` até o fechamento chegar.
 *
 * O mesmo vale para um `**` solto que o modelo nunca fecha: o texto sai em
 * negrito daí para a frente, sem asterisco à mostra. Entre exibir um erro do
 * modelo e exibir um asterisco perdido ao usuário, o pedido foi claro — os
 * asteriscos somem.
 *
 * Trecho vazio nunca é emitido, então `**` colado em `**` não vira nada.
 */
export function partirNegrito(texto: string | null | undefined): TrechoTexto[] {
  const t = texto ?? "";
  if (!t) return [];
  if (!t.includes("**")) return [{ texto: t, negrito: false }];

  const partes = t.split("**");
  const out: TrechoTexto[] = [];
  partes.forEach((parte, i) => {
    if (parte === "") return;
    out.push({ texto: parte, negrito: i % 2 === 1 });
  });
  return out;
}
