"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { autorizarLeitura } from "@/lib/orcamento/auth";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { itemPropostaAtivo, PESSOAL_GRUPO } from "@/lib/orcamento/validacao";
import { periodicidadeLabel, serieItem, toPeriodicidade } from "@/lib/orcamento/planejamento-calc";
import { vinculoLabel } from "@/lib/orcamento/vinculos";
import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";
import type { AlvoTipo } from "@/lib/orcamento/trilha";

/**
 * LEITURA da tela de validação — separada de `validacao.ts` (as decisões) de
 * propósito: aqui não se escreve nada, e o arquivo é grande porque percorre as
 * quatro fontes de orçamento.
 *
 * Por que não reusar a Prévia: a Prévia entrega NÚMEROS para ler, agregados por
 * categoria. A validação precisa de ALVOS para decidir — o id do colaborador, o
 * índice do item dentro do jsonb da proposta, o id do contrato. Sem eles não há
 * o que cancelar nem o que travar.
 */

const db = () => createAdminClientIfAvailable();
const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface ValidacaoItem {
  /** Chave estável para React e para casar com a pendência da trilha. */
  chave: string;
  metodo: OrcamentoMetodo;
  alvoTipo: AlvoTipo;
  /** id da linha (pessoal, valor fixo, média). Nulo no planejamento. */
  alvoId: string | null;
  /** Posição do item dentro do jsonb da proposta (só planejamento). */
  indice: number | null;
  nome: string;
  detalhe: string | null;
  /** Valor anual orçado deste item. */
  totalAno: number;
  cancelado: boolean;
  canceladoMotivo: string | null;
  travado: boolean;
  /** A diretoria pode cancelar este item? (não em média/valor fixo) */
  podeCancelar: boolean;
  /** A diretoria pode alterar o valor direto? (hoje só no planejamento) */
  podeAlterarValor: boolean;
}

export interface ValidacaoCategoria {
  categoryCode: string;
  categoryName: string;
  metodo: OrcamentoMetodo;
  totalAno: number;
  itens: ValidacaoItem[];
}

export interface ValidacaoSetor {
  setorId: string | null;
  setorNome: string;
  totalAno: number;
  categorias: ValidacaoCategoria[];
}

export interface ValidacaoPendencia {
  id: string;
  alvoId: string | null;
  alvoRotulo: string | null;
  acao: string;
  motivo: string | null;
  autorPapel: string | null;
  createdAt: string;
}

export interface ValidacaoDados {
  setores: ValidacaoSetor[];
  totalAno: number;
  /** Total congelado no último envio, para comparar com o de agora. */
  propostoAno: number | null;
  /** Solicitações da diretoria e pedidos de liberação ainda em aberto. */
  pendencias: ValidacaoPendencia[];
}

export async function getValidacao(
  companyId: string,
  year: number,
): Promise<{ dados?: ValidacaoDados; error?: string }> {
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  const { data: setoresRows } = await supabase
    .from("orcamento_setores")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("year", year)
    .order("name");
  const nomeSetor = new Map((setoresRows ?? []).map((s) => [s.id as string, s.name as string]));

  const porSetor = new Map<string, Map<string, ValidacaoCategoria>>();
  const chaveSetor = (id: string | null) => id ?? "__sem_setor__";
  const addItem = (
    setorId: string | null,
    categoryCode: string,
    categoryName: string,
    metodo: OrcamentoMetodo,
    item: ValidacaoItem,
  ) => {
    const ks = chaveSetor(setorId);
    if (!porSetor.has(ks)) porSetor.set(ks, new Map());
    const cats = porSetor.get(ks)!;
    if (!cats.has(categoryCode)) {
      cats.set(categoryCode, { categoryCode, categoryName, metodo, totalAno: 0, itens: [] });
    }
    const cat = cats.get(categoryCode)!;
    cat.itens.push(item);
    // Item cancelado NÃO soma: o total da tela é o orçamento que vale hoje.
    if (!item.cancelado) cat.totalAno += item.totalAno;
  };

  // ── PESSOAL ──────────────────────────────────────────────────────────────
  // A referência da decisão é o SALÁRIO (é sobre ele que a diretoria discute),
  // não o custo com encargos que a Prévia calcula — a tela diz isso no rodapé,
  // para ninguém somar esta coluna esperando o número da DRE.
  const { data: colabs } = await supabase
    .from("orcamento_pessoal_colaboradores")
    .select(
      "id, setor_id, nome, cargo_atual, salario_atual, vinculo, cancelado_em, cancelado_motivo, diretoria_travado",
    )
    .eq("company_id", companyId)
    .eq("year", year)
    .order("nome", { ascending: true, nullsFirst: false });
  for (const c of colabs ?? []) {
    const salario = c.salario_atual == null ? 0 : Number(c.salario_atual);
    addItem((c.setor_id as string) ?? null, PESSOAL_GRUPO, "Despesas com pessoal", "pessoal", {
      chave: `colab:${c.id}`,
      metodo: "pessoal",
      alvoTipo: "colaborador",
      alvoId: c.id as string,
      indice: null,
      nome: (c.nome as string) || (c.cargo_atual as string) || "Colaborador",
      detalhe: [
        c.cargo_atual as string | null,
        vinculoLabel(c.vinculo as never),
        salario > 0 ? `${BRL(salario)}/mês` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      totalAno: salario * 12,
      cancelado: Boolean(c.cancelado_em),
      canceladoMotivo: (c.cancelado_motivo as string) ?? null,
      travado: Boolean(c.diretoria_travado),
      podeCancelar: true,
      podeAlterarValor: false,
    });
  }

  // ── PLANEJAMENTO (só a proposta CONFIRMADA é orçamento) ──────────────────
  const { data: psRows } = await supabase
    .from("orcamento_planejamento_socios")
    .select(
      "category_code, category_name, setor_id, proposta, proposta_confirmada, diretoria_travado",
    )
    .eq("company_id", companyId)
    .eq("year", year);
  for (const r of psRows ?? []) {
    if (r.proposta_confirmada !== true) continue;
    const p = (r.proposta ?? null) as { itens?: unknown } | null;
    const itens = Array.isArray(p?.itens) ? (p!.itens as Record<string, unknown>[]) : [];
    itens.forEach((it, i) => {
      const valor = Number(it.valorMensal ?? it.valor_mensal ?? 0);
      const mesInicio = Number(it.mesInicio ?? it.mes_inicio ?? 1);
      const fimRaw = it.mesFim ?? it.mes_fim;
      const periodicidade = toPeriodicidade(it.periodicidade);
      const serie = serieItem(
        valor,
        Number.isFinite(mesInicio) ? mesInicio : 1,
        periodicidade,
        fimRaw == null ? null : Number(fimRaw),
      );
      const descricao =
        typeof it.descricao === "string" && it.descricao.trim() !== ""
          ? it.descricao.trim()
          : "Item sem descrição";
      addItem(
        (r.setor_id as string) ?? null,
        r.category_code as string,
        (r.category_name as string) ?? (r.category_code as string),
        "planejamento_socios",
        {
          chave: `ps:${r.category_code}:${r.setor_id ?? "-"}:${i}`,
          metodo: "planejamento_socios",
          alvoTipo: "planejamento_item",
          alvoId: null,
          indice: i,
          nome: descricao,
          detalhe: `${BRL(valor)} ${periodicidadeLabel(periodicidade)}`,
          totalAno: serie.reduce((a, b) => a + b, 0),
          cancelado: !itemPropostaAtivo(it),
          canceladoMotivo: (it.cancelado_motivo as string) ?? null,
          // A trava do planejamento vive na categoria × setor: o item não tem
          // linha própria (é objeto dentro do jsonb).
          travado: Boolean(r.diretoria_travado),
          podeCancelar: true,
          podeAlterarValor: true,
        },
      );
    });
  }

  // ── MÉDIA ────────────────────────────────────────────────────────────────
  const { data: medias } = await supabase
    .from("orcamento_media_categorias")
    .select(
      "id, category_code, category_name, setor_id, media_valor, indice_key, diretoria_travado",
    )
    .eq("company_id", companyId)
    .eq("year", year);
  for (const m of medias ?? []) {
    const valor = m.media_valor == null ? 0 : Number(m.media_valor);
    if (valor === 0) continue;
    addItem(
      (m.setor_id as string) ?? null,
      m.category_code as string,
      (m.category_name as string) ?? (m.category_code as string),
      "media",
      {
        chave: `media:${m.id}`,
        metodo: "media",
        alvoTipo: "media_linha",
        alvoId: m.id as string,
        indice: null,
        nome: (m.category_name as string) ?? (m.category_code as string),
        detalhe: `${BRL(valor)}/mês${m.indice_key ? ` · corrigido por ${m.indice_key}` : " · sem correção"}`,
        totalAno: valor * 12,
        cancelado: false,
        canceladoMotivo: null,
        travado: Boolean(m.diretoria_travado),
        // Média e valor fixo são do administrador: a diretoria solicita, não
        // cancela nem altera (no máximo troca o índice, na própria tela).
        podeCancelar: false,
        podeAlterarValor: false,
      },
    );
  }

  // ── VALOR FIXO ───────────────────────────────────────────────────────────
  const { data: vfs } = await supabase
    .from("orcamento_valor_fixo_categorias")
    .select(
      "id, category_code, category_name, setor_id, descricao, valor_base, indice_key, diretoria_travado",
    )
    .eq("company_id", companyId)
    .eq("year", year);
  for (const v of vfs ?? []) {
    const base = v.valor_base == null ? 0 : Number(v.valor_base);
    if (base === 0) continue;
    addItem(
      (v.setor_id as string) ?? null,
      v.category_code as string,
      (v.category_name as string) ?? (v.category_code as string),
      "valor_fixo",
      {
        chave: `vf:${v.id}`,
        metodo: "valor_fixo",
        alvoTipo: "valor_fixo_contrato",
        alvoId: v.id as string,
        indice: null,
        nome:
          (v.descricao as string) || (v.category_name as string) || (v.category_code as string),
        detalhe: `${BRL(base)}/mês${v.indice_key ? ` · corrigido por ${v.indice_key}` : " · sem correção"}`,
        totalAno: base * 12,
        cancelado: false,
        canceladoMotivo: null,
        travado: Boolean(v.diretoria_travado),
        podeCancelar: false,
        podeAlterarValor: false,
      },
    );
  }

  // ── Saída, recortada pelos setores que quem olha enxerga ─────────────────
  const setores: ValidacaoSetor[] = [];
  for (const [ks, cats] of Array.from(porSetor.entries())) {
    const setorId = ks === "__sem_setor__" ? null : ks;
    // Construtor restrito: só os setores dele. `null` = enxerga todos.
    if (auth.setores !== null && (setorId === null || !auth.setores.includes(setorId))) continue;
    const categorias = Array.from(cats.values()).sort((a, b) =>
      a.categoryName.localeCompare(b.categoryName, "pt-BR"),
    );
    setores.push({
      setorId,
      setorNome: setorId ? nomeSetor.get(setorId) ?? "Setor" : "Sem setor",
      totalAno: categorias.reduce((acc, c) => acc + c.totalAno, 0),
      categorias,
    });
  }
  setores.sort((a, b) => a.setorNome.localeCompare(b.setorNome, "pt-BR"));

  const { data: versao } = await supabase
    .from("orcamento_versoes")
    .select("total_ano")
    .eq("company_id", companyId)
    .eq("year", year)
    .order("numero", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: pend } = await supabase
    .from("orcamento_alteracoes")
    .select("id, alvo_id, alvo_rotulo, acao, motivo, autor_papel, created_at")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("resolucao", "pendente")
    .order("created_at", { ascending: false });

  return {
    dados: {
      setores,
      totalAno: setores.reduce((acc, s) => acc + s.totalAno, 0),
      propostoAno: versao?.total_ano == null ? null : Number(versao.total_ano),
      pendencias: (pend ?? []).map((r) => ({
        id: r.id as string,
        alvoId: (r.alvo_id as string) ?? null,
        alvoRotulo: (r.alvo_rotulo as string) ?? null,
        acao: r.acao as string,
        motivo: (r.motivo as string) ?? null,
        autorPapel: (r.autor_papel as string) ?? null,
        createdAt: r.created_at as string,
      })),
    },
  };
}
