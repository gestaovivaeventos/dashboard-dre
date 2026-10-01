"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { SEM_ACESSO, SEM_ACESSO_ADMIN, getOrcamentoAdmin, getOrcamentoUser } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { metodoLabel, type OrcamentoMetodo } from "@/lib/orcamento/metodos";
import {
  ROTULO_DO_METODO,
  metodosConfiguraveis,
  recusaPorDado,
} from "@/lib/orcamento/metodos-visiveis";

// =============================================================================
// Quais TELAS do orçamento aparecem em cada empresa.
//
// Configuração GERAL do módulo (não por empresa): a tela lista as empresas e se
// marca o que aparece em cada uma. Fica nas Configurações gerais porque o valor
// dela é ver e ajustar VÁRIAS empresas de uma vez — é o mesmo critério que levou
// os índices para lá, e o oposto do que trouxe os grupos de despesa de volta
// para a configuração da empresa (lá o contexto fixo separava melhor).
//
// ── Grava-se o OCULTO ─────────────────────────────────────────────────────
// A tela mostra caixas do que aparece; desmarcar INSERE a exclusão, marcar
// APAGA. Tabela vazia = tudo visível, que é o comportamento de antes — ver
// `metodos-visiveis.ts`.
// =============================================================================

const PATH = "/orcamento";

type Supa = Awaited<ReturnType<typeof createClient>>;

function db() {
  return createAdminClientIfAvailable();
}

/**
 * Onde cada método guarda o que foi orçado.
 *
 * Serve só à trava: esconder a tela não apaga nada, então o que já estiver aqui
 * continuaria somando na Prévia e no Budget sem tela por onde abri-lo.
 *
 * `valor_fixo` e `media` dividem a ideia de "linha por categoria"; `pessoal` é o
 * quadro. Nenhuma consulta filtra ANO de propósito: a visibilidade é por empresa
 * (fato cadastral da unidade), então dado em qualquer exercício conta.
 */
const TABELA_DO_METODO: Record<string, string> = {
  pessoal: "orcamento_pessoal_colaboradores",
  media: "orcamento_media_categorias",
  valor_fixo: "orcamento_valor_fixo_categorias",
  planejamento_socios: "orcamento_planejamento_despesas",
  viagens: "orcamento_viagens",
};

export interface EmpresaMetodos {
  companyId: string;
  companyName: string;
  /** Chaves OCULTAS nesta empresa. */
  ocultos: string[];
  /** Quantos itens orçados cada método tem aqui (para a trava e o aviso). */
  dados: Record<string, number>;
}

export interface MetodosPorEmpresaResult {
  /** Métodos que a tela oferece para marcar — só os que têm tela. */
  metodos: Array<{ key: OrcamentoMetodo; label: string }>;
  items: EmpresaMetodos[];
  error?: string;
  needsMigration?: boolean;
}

/**
 * As empresas com o que está visível em cada uma.
 *
 * A contagem de dado é feita em CINCO consultas (uma por método), trazendo só
 * `company_id` e tabulando em memória — PostgREST não faz GROUP BY, e uma
 * consulta por empresa × método seriam dezenas de idas ao banco numa tela de
 * administração.
 */
export async function getMetodosPorEmpresa(): Promise<MetodosPorEmpresaResult> {
  const metodos = metodosConfiguraveis().map((key) => ({ key, label: metodoLabel(key) }));

  // Admin-only: é configuração geral do módulo, como os índices.
  const admin = await getOrcamentoAdmin();
  if (!admin) return { metodos, items: [], error: SEM_ACESSO_ADMIN };

  const supabase = (db() ?? (await createClient())) as Supa;

  const { data: empresas, error: empErr } = await supabase
    .from("companies")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (empErr) return { metodos, items: [], error: empErr.message };

  const { data: ocultosRows, error: ocErr } = await supabase
    .from("orcamento_metodos_ocultos")
    .select("company_id, metodo");
  if (ocErr) {
    if (isSchemaMissing(ocErr.message)) return { metodos, items: [], needsMigration: true };
    return { metodos, items: [], error: ocErr.message };
  }
  const ocultosPorEmpresa = new Map<string, string[]>();
  for (const r of (ocultosRows ?? []) as Array<Record<string, unknown>>) {
    const id = r.company_id as string;
    const lista = ocultosPorEmpresa.get(id) ?? [];
    lista.push(r.metodo as string);
    ocultosPorEmpresa.set(id, lista);
  }

  // Dado por empresa × método.
  const contagem = new Map<string, Record<string, number>>();
  await Promise.all(
    Object.entries(TABELA_DO_METODO).map(async ([metodo, tabela]) => {
      const { data } = await supabase.from(tabela).select("company_id");
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        const id = r.company_id as string;
        if (!id) continue;
        const atual = contagem.get(id) ?? {};
        atual[metodo] = (atual[metodo] ?? 0) + 1;
        contagem.set(id, atual);
      }
    }),
  );

  return {
    metodos,
    items: ((empresas ?? []) as Array<Record<string, unknown>>).map((c) => ({
      companyId: c.id as string,
      companyName: (c.name as string) ?? "",
      ocultos: ocultosPorEmpresa.get(c.id as string) ?? [],
      dados: contagem.get(c.id as string) ?? {},
    })),
  };
}

/**
 * Liga ou desliga uma tela numa empresa.
 *
 * Esconder método que já tem coisa orçada é RECUSADO, com o número à vista: a
 * tela esconde a PORTA, não o valor — ele continuaria na Prévia e no Budget sem
 * nenhum caminho por onde abri-lo, que é o pior resultado possível aqui.
 */
export async function setMetodoVisivel(
  companyId: string,
  metodo: string,
  visivel: boolean,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!companyId) return { error: "Empresa inválida." };
  if (!(metodosConfiguraveis() as string[]).includes(metodo)) {
    return { error: "Método inválido." };
  }

  const supabase = (db() ?? (await createClient())) as Supa;

  if (visivel) {
    // Marcar = tirar da lista de exclusões.
    const { error } = await supabase
      .from("orcamento_metodos_ocultos")
      .delete()
      .eq("company_id", companyId)
      .eq("metodo", metodo);
    if (error) {
      if (isSchemaMissing(error.message)) return { needsMigration: true };
      return { error: error.message };
    }
    revalidatePath(PATH);
    return { ok: true };
  }

  // ── Esconder: confere se há dado antes ──
  const tabela = TABELA_DO_METODO[metodo];
  if (tabela) {
    const { count } = await supabase
      .from(tabela)
      .select("company_id", { count: "exact", head: true })
      .eq("company_id", companyId);
    if ((count ?? 0) > 0) {
      const rotulo = ROTULO_DO_METODO[metodo];
      return {
        error: rotulo
          ? recusaPorDado(metodoLabel(metodo as OrcamentoMetodo), count ?? 0, rotulo)
          : `Este método já tem ${count} item(ns) orçado(s) nesta empresa.`,
      };
    }
  }

  const { error } = await supabase.from("orcamento_metodos_ocultos").insert({
    company_id: companyId,
    metodo,
    ocultado_por: admin.userId,
  });
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    // Já estava oculto (PK composta) — o resultado desejado já é o atual.
    if (error.code !== "23505") return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Chaves ocultas de UMA empresa — o que o hub e as rotas de método leem.
 *
 * Não é admin-only: o hub precisa disso para desenhar as caixas, e um gerente que
 * não pudesse ler veria o hub cheio e tomaria redirect ao clicar. Tabela ausente
 * devolve vazio (tudo visível) — a visibilidade não pode ser motivo de o módulo
 * parar de abrir.
 */
export async function getMetodosOcultos(
  companyId: string,
): Promise<{ ocultos: string[]; error?: string }> {
  if (!companyId) return { ocultos: [] };
  const user = await getOrcamentoUser();
  if (!user) return { ocultos: [], error: SEM_ACESSO };

  const supabase = (db() ?? (await createClient())) as Supa;
  const { data, error } = await supabase
    .from("orcamento_metodos_ocultos")
    .select("metodo")
    .eq("company_id", companyId);
  if (error) return { ocultos: [] };
  return {
    ocultos: ((data ?? []) as Array<Record<string, unknown>>).map((r) => r.metodo as string),
  };
}
