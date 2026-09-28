// =============================================================================
// A atribuição de setor do Orçamento casa por NOME dentro da empresa.
//
// Por que não pelo id da linha: `orcamento_setores` é por empresa × ANO, então
// um id vale para um ano só e a atribuição teria de ser refeita todo janeiro.
// Por que não pelo setor do Compras: a ponte `ctrl_sector_id` é opcional (há
// setor de orçamento que não existe no Compras) e `cloneSetores` não a leva
// para o ano seguinte — o escopo se desfaria sozinho a cada clone.
//
// O NOME é a identidade que o sistema JÁ usa para atravessar anos: o próprio
// `cloneSetores` casa por `lower(trim(name))` para não duplicar. Esta é a
// mesma normalização, num lugar só, porque ela vale em três pontos (gravar,
// resolver o escopo e diagnosticar a tela vazia) e divergir em qualquer um
// deles dá escopo silenciosamente errado.
// =============================================================================

/**
 * Chave de comparação de um nome de setor.
 *
 * Minúsculas e espaços aparados, como o clone entre anos. NÃO tira acento: os
 * setores são cadastrados à mão por empresa e "Gestão" × "Gestao" são nomes
 * diferentes que mereceriam ser corrigidos no cadastro, não silenciosamente
 * fundidos aqui.
 */
export function chaveSetorNome(nome: string): string {
  return (nome ?? "").trim().toLowerCase();
}

/** O que a resolução precisa saber de cada setor cadastrado no ano. */
export interface SetorDoAno {
  id: string;
  name: string;
}

/**
 * Ids de `orcamento_setores` (deste ano) que correspondem aos nomes atribuídos
 * ao usuário nesta empresa.
 *
 * Nome atribuído que não existe no ano some sem erro — é o caso normal de um
 * setor que ainda não foi clonado para o ano novo, e a tela de escopo vazio
 * explica o que houve. Falhar para o lado de esconder é deliberado.
 */
export function setoresDoAnoAtribuidos(
  nomesAtribuidos: readonly string[],
  setoresDoAno: readonly SetorDoAno[],
): string[] {
  if (nomesAtribuidos.length === 0) return [];
  const chaves = new Set(nomesAtribuidos.map(chaveSetorNome));
  return setoresDoAno.filter((s) => chaves.has(chaveSetorNome(s.name))).map((s) => s.id);
}

/**
 * Tira repetição por chave, preservando a grafia da PRIMEIRA ocorrência.
 *
 * A tela oferece os nomes de todos os anos da empresa somados (a atribuição é
 * year-agnostic), e o mesmo setor aparece uma vez por ano clonado. Sem isto o
 * seletor mostraria "Marketing" quatro vezes.
 */
export function nomesUnicos(nomes: readonly string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const nome of nomes) {
    const chave = chaveSetorNome(nome);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(nome.trim());
  }
  return saida;
}
