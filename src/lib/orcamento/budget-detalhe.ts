// A abertura do ORÇADO no Budget: de linhas (conta × mês × despesa) para a
// lista que o drilldown mostra.
//
// O pedido foi explícito — "nesse drilldown pode aparecer apenas o nome da
// despesa" —, então aqui não há mês, conta nem origem: só nome e valor, somados
// no período pedido. Uma despesa mensal apareceria 12 vezes sem esta soma.
//
// Módulo PURO: a rota só busca e delega.

export interface LinhaDetalheOrcado {
  company_id: string;
  nome: string;
  valor: number | string;
}

export interface ItemOrcado {
  nome: string;
  valor: number;
}

/**
 * Soma as linhas por despesa e ordena da maior para a menor.
 *
 * `comEmpresa` acrescenta o nome da empresa ao rótulo — e só quando há mais de
 * uma no recorte. Com o Budget consolidado de várias empresas, duas despesas
 * homônimas de empresas diferentes somariam numa linha só e o leitor concluiria
 * que é uma despesa que custa o dobro.
 *
 * Valor vem do Postgres como `numeric`, que o PostgREST pode entregar em
 * string: converter aqui evita a concatenação silenciosa ("100" + "200").
 */
export function agruparDetalheOrcado(
  linhas: readonly LinhaDetalheOrcado[],
  nomeDaEmpresa: (id: string) => string,
  comEmpresa: boolean,
): ItemOrcado[] {
  const mapa = new Map<string, number>();
  for (const l of linhas) {
    const bruto = typeof l.valor === "number" ? l.valor : Number(l.valor);
    if (!Number.isFinite(bruto) || bruto === 0) continue;
    const empresa = comEmpresa ? nomeDaEmpresa(l.company_id) : "";
    const nome = (l.nome ?? "").trim() || "Sem nome";
    const chave = empresa ? `${nome} · ${empresa}` : nome;
    mapa.set(chave, (mapa.get(chave) ?? 0) + bruto);
  }
  return Array.from(mapa.entries())
    .map(([nome, valor]) => ({ nome, valor: Math.round(valor * 100) / 100 }))
    .filter((i) => i.valor !== 0)
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor) || a.nome.localeCompare(b.nome, "pt-BR"));
}
