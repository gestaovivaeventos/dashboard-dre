// Observação dos títulos A RECEBER do contrato Case na Omie. Quem baixa o
// recebimento lê só a Omie, então a observação carrega o contrato inteiro:
// identificação (nº, fundo, evento, atrações — obrigatórios), o cronograma de
// recebimento, o que sai para atrações/fornecedores, as comissões e o BV que
// fica com a Case. Puro: recebe os dados já carregados.

import { fmtBRL, fmtDate } from "@/lib/case/format";

export interface ObsTitulo {
  leg: "receber_custodia" | "receber_servicos" | "pagar_custodia";
  parcela_numero: number;
  parcela_total: number;
  vencimento: string;
  valor: number;
  /** Nome de quem recebe o pagamento (atração/fornecedor); só a pagar. */
  parceiro?: string | null;
  /** rider_camarim | comissao_externa | comissao_rider; ausente = atração. */
  fornecedor_tipo?: string | null;
}

export interface ObsContrato {
  contract_number: number;
  fundo: string;
  event_name: string | null;
  event_date: string | null;
  show_time: string | null;
  local_name: string | null;
  local_city: string | null;
  atracoes: string[];
  valor_atracao_cliente: number;
  valor_rider: number;
  valor_camarim: number;
  valor_extras: number;
  titulos: ObsTitulo[];
}

const LEG_RECEBER: Record<string, string> = {
  receber_custodia: "Custódia",
  receber_servicos: "Serviços/BV",
};

const TIPO_PAGAR: Record<string, string> = {
  rider_camarim: "Rider/Camarim",
  comissao_externa: "Comissão Comercial - Externa",
  comissao_rider: "Comissão Comercial - Rider",
};

const isComissao = (tipo: string | null | undefined) => tipo === "comissao_externa" || tipo === "comissao_rider";

const round2 = (n: number) => Math.round(n * 100) / 100;

function porVencimento(a: ObsTitulo, b: ObsTitulo) {
  return a.vencimento.localeCompare(b.vencimento) || a.parcela_numero - b.parcela_numero;
}

/** Soma por parceiro+tipo, preservando a ordem da primeira aparição. */
function agruparPagar(titulos: ObsTitulo[]) {
  const grupos = new Map<string, { nome: string; tipo: string | null; total: number; parcelas: ObsTitulo[] }>();
  for (const t of titulos) {
    const nome = t.parceiro?.trim() || "—";
    const chave = `${t.fornecedor_tipo ?? "atracao"}|${nome}`;
    const g = grupos.get(chave) ?? { nome, tipo: t.fornecedor_tipo ?? null, total: 0, parcelas: [] };
    g.total = round2(g.total + Number(t.valor));
    g.parcelas.push(t);
    grupos.set(chave, g);
  }
  return Array.from(grupos.values());
}

const parcelasTexto = (ps: ObsTitulo[]) =>
  ps.length > 1 ? ` (${[...ps].sort(porVencimento).map((p) => `${fmtDate(p.vencimento)} ${fmtBRL(p.valor)}`).join("; ")})` : ` venc. ${fmtDate(ps[0].vencimento)}`;

export function buildObservacaoReceber(c: ObsContrato, titulo: ObsTitulo): string {
  const linhas: string[] = [];

  linhas.push(
    `Contrato Case nº ${c.contract_number} — parcela ${titulo.parcela_numero}/${titulo.parcela_total} (${LEG_RECEBER[titulo.leg] ?? titulo.leg})`,
  );
  linhas.push(`Fundo: ${c.fundo.trim() || "—"}`);
  const quando = [fmtDate(c.event_date) || "data a definir", c.show_time?.trim() ? `às ${c.show_time.trim()}` : ""].filter(Boolean).join(" ");
  const onde = [c.local_name, c.local_city].map((s) => s?.trim()).filter(Boolean).join(", ");
  linhas.push(`Evento: ${c.event_name?.trim() || "—"} — ${quando}${onde ? ` — ${onde}` : ""}`);
  linhas.push(`Atrações: ${c.atracoes.length > 0 ? c.atracoes.join(", ") : "—"}`);

  const extras = [
    c.valor_rider > 0 ? `rider ${fmtBRL(c.valor_rider)}` : "",
    c.valor_camarim > 0 ? `camarim ${fmtBRL(c.valor_camarim)}` : "",
    c.valor_extras > 0 ? `extras ${fmtBRL(c.valor_extras)}` : "",
  ].filter(Boolean);
  linhas.push(`Valor do contrato: ${fmtBRL(c.valor_atracao_cliente)}${extras.length ? ` + ${extras.join(", ")}` : ""}`);

  const receber = c.titulos.filter((t) => t.leg !== "pagar_custodia").sort(porVencimento);
  const pagar = c.titulos.filter((t) => t.leg === "pagar_custodia");
  const totalReceber = round2(receber.reduce((a, t) => a + Number(t.valor), 0));
  const totalPagar = round2(pagar.reduce((a, t) => a + Number(t.valor), 0));

  if (receber.length > 0) {
    linhas.push("");
    linhas.push(`RECEBIMENTOS (total ${fmtBRL(totalReceber)}):`);
    for (const t of receber) {
      linhas.push(`- ${t.parcela_numero}/${t.parcela_total} ${LEG_RECEBER[t.leg] ?? t.leg}: ${fmtBRL(t.valor)} venc. ${fmtDate(t.vencimento)}`);
    }
  }

  const grupos = agruparPagar(pagar);
  const pagamentos = grupos.filter((g) => !isComissao(g.tipo));
  const comissoes = grupos.filter((g) => isComissao(g.tipo));

  if (pagamentos.length > 0) {
    linhas.push("");
    linhas.push("PAGAMENTOS:");
    for (const g of pagamentos) {
      const rotulo = g.tipo ? `${TIPO_PAGAR[g.tipo] ?? g.tipo} — ${g.nome}` : `Atração ${g.nome}`;
      linhas.push(`- ${rotulo}: ${fmtBRL(g.total)}${parcelasTexto(g.parcelas)}`);
    }
  }

  // Mesma conta do lancarBvContract: BV = tudo que entra − tudo que sai.
  // Sem nenhuma saída cadastrada o número seria o contrato inteiro, então omite.
  if (pagar.length > 0) {
    linhas.push("");
    linhas.push("COMISSÕES / BV:");
    for (const g of comissoes) {
      linhas.push(`- ${TIPO_PAGAR[g.tipo ?? ""] ?? g.tipo} — ${g.nome}: ${fmtBRL(g.total)}${parcelasTexto(g.parcelas)}`);
    }
    linhas.push(`- BV Case (recebido − saídas): ${fmtBRL(round2(totalReceber - totalPagar))}`);
  }

  return linhas.join("\n");
}
