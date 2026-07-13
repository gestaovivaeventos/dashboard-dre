// Natureza de despesa para colorir a variacao (VAR%) em telas Previsto x
// Realizado / comparativos.
//
// Nao basta olhar `type === 'despesa'`: grupos totalizadores como
// "Custos com os Servicos Prestados" / "Despesas Diretas" (code 5) sao
// cadastrados como `calculado` COM formula (ex.: "5.1+...+5.7-5.8+5.9+5.10") —
// a formula existe para embutir a subtracao de receitas ressarciveis (5.8)
// dentro do grupo de custos. Ou seja, o `type=calculado` desses grupos e
// proposital e nao pode ser alterado no banco sem mexer no calculo. Ainda
// assim, semanticamente eles SAO despesa: realizado acima do previsto e ruim.
//
// Aqui inferimos a natureza de linhas `calculado`/`misto` a partir dos filhos:
// se predominam despesas -> a linha e tratada como despesa (cor invertida).
// Linhas-resultado (Receita Liquida, Lucro, Resultado) sao `calculado` SEM
// filhos -> natureza neutra (leitura normal, maior = melhor). Linhas realmente
// mistas (ex.: "Emprestimos e Mutuos": 1 entrada / 1 saida) tambem ficam
// neutras. Chaveia so na estrutura do plano, entao vale para toda empresa.

type MinimalAccount = { id: string; parent_id: string | null; type: string };
type Nature = "despesa" | "receita" | "neutral";

// Retorna o conjunto de ids de linhas que devem ser coloridas como DESPESA
// (relacao inversa: realizado > previsto = vermelho). Deve receber a lista
// COMPLETA de linhas do plano — inclusive as recolhidas — senao um grupo cujos
// filhos estejam colapsados perderia a inferencia.
export function computeExpenseRowIds(rows: ReadonlyArray<MinimalAccount>): Set<string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const childrenByParent = new Map<string | null, MinimalAccount[]>();
  for (const r of rows) {
    const siblings = childrenByParent.get(r.parent_id) ?? [];
    siblings.push(r);
    childrenByParent.set(r.parent_id, siblings);
  }

  const cache = new Map<string, Nature>();
  const natureOf = (id: string, stack: Set<string>): Nature => {
    const cached = cache.get(id);
    if (cached) return cached;
    if (stack.has(id)) return "neutral"; // guarda contra ciclos na estrutura
    const row = byId.get(id);
    if (!row) return "neutral";
    if (row.type === "despesa") return set(id, "despesa");
    if (row.type === "receita") return set(id, "receita");
    // calculado / misto -> deriva dos filhos
    const kids = childrenByParent.get(id) ?? [];
    if (kids.length === 0) return set(id, "neutral"); // linha-resultado / folha calculada
    stack.add(id);
    let despesa = 0;
    let receita = 0;
    for (const kid of kids) {
      const nature = natureOf(kid.id, stack);
      if (nature === "despesa") despesa += 1;
      else if (nature === "receita") receita += 1;
    }
    stack.delete(id);
    return set(id, despesa > receita ? "despesa" : receita > despesa ? "receita" : "neutral");
  };
  const set = (id: string, nature: Nature): Nature => {
    cache.set(id, nature);
    return nature;
  };

  const ids = new Set<string>();
  for (const row of rows) {
    if (natureOf(row.id, new Set()) === "despesa") ids.add(row.id);
  }
  return ids;
}
