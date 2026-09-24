"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import {
  autorizarEscrita,
  autorizarLeitura,
  podeEscreverNoSetor,
  SEM_ACESSO_SETOR,
} from "@/lib/orcamento/auth";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { registrarAlteracao } from "@/lib/orcamento/actions/trilha";
import { workspaceTabHref } from "@/lib/orcamento/workspace-tabs";
import type { AlvoTipo, TrilhaAcao, TrilhaResolucao } from "@/lib/orcamento/trilha";

/**
 * O RETORNO: o que a diretoria fez, na visão de quem montou o orçamento.
 *
 * É a terceira etapa do ciclo, e a razão de a trilha existir. A tela de
 * validação mostra o orçamento COM as decisões já aplicadas; aqui o construtor
 * vê o movimento — de quanto para quanto, por quê, e o que ainda depende dele.
 *
 * Recorte: os setores DELE (admin e diretoria veem tudo). A fase filtrada é
 * `validacao`, porque é o que a diretoria decidiu — a linha do tempo, que mostra
 * o ciclo inteiro, é outra leitura (`getTrilha`).
 */

const db = () => createAdminClientIfAvailable();
const PATH = "/orcamento";

export interface RetornoEntrada {
  id: string;
  createdAt: string;
  setorId: string | null;
  setorNome: string | null;
  categoryCode: string | null;
  metodo: string | null;
  alvoTipo: AlvoTipo;
  alvoId: string | null;
  alvoRotulo: string | null;
  acao: TrilhaAcao;
  motivo: string | null;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  /** O item continua travado AGORA (não é o estado de quando a decisão saiu). */
  travadoAgora: boolean;
  /** Pendência: solicitação da diretoria ou pedido de liberação em aberto. */
  resolucao: TrilhaResolucao | null;
  autorNome: string | null;
  /** Rota da tela que produziu o item, para o construtor ir ajustar. */
  href: string | null;
  /** O construtor já marcou ciente nesta entrada? */
  ciente: boolean;
}

export interface RetornoDados {
  entradas: RetornoEntrada[];
  /** Total congelado quando o orçamento saiu das mãos dos construtores. */
  propostoAno: number | null;
  /** Total congelado na conclusão, quando já houver. */
  finalAno: number | null;
  /** Quantas entradas ainda esperam algo do construtor. */
  pendentes: number;
  travados: number;
}

export async function getRetorno(
  companyId: string,
  year: number,
): Promise<{ dados?: RetornoDados; error?: string }> {
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  let q = supabase
    .from("orcamento_alteracoes")
    .select(
      "id, created_at, setor_id, category_code, metodo, alvo_tipo, alvo_id, alvo_rotulo, acao, " +
        "motivo, antes, depois, resolucao, autor_papel, " +
        "autor:users!orcamento_alteracoes_autor_id_fkey(name, email), " +
        "setor:orcamento_setores(name)",
    )
    .eq("company_id", companyId)
    .eq("year", year)
    // Só o que a DIRETORIA decidiu. O que o próprio construtor fez durante a
    // construção está na linha do tempo, não aqui — misturar tornaria o retorno
    // uma lista de tudo, e o que ele precisa é "o que mudou por decisão de
    // outra pessoa".
    .eq("fase", "validacao")
    .order("created_at", { ascending: false });

  if (auth.setores !== null) {
    if (auth.setores.length === 0) return { dados: vazio() };
    q = q.in("setor_id", auth.setores);
  }

  const { data, error } = await q;
  if (error) {
    // Migration ausente: o retorno simplesmente não tem o que mostrar.
    return { dados: vazio() };
  }

  type Row = {
    id: string;
    created_at: string;
    setor_id: string | null;
    category_code: string | null;
    metodo: string | null;
    alvo_tipo: string;
    alvo_id: string | null;
    alvo_rotulo: string | null;
    acao: string;
    motivo: string | null;
    antes: Record<string, unknown> | null;
    depois: Record<string, unknown> | null;
    resolucao: string | null;
    autor_papel: string | null;
    autor: { name: string | null; email: string | null } | null;
    setor: { name: string | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  // Quem já foi marcado como ciente. A marca é outra entrada da trilha, com o
  // mesmo alvo — não uma coluna: assim o "ciente" também fica auditável (quem e
  // quando), que é a razão de a trilha existir.
  const { data: cientes } = await supabase
    .from("orcamento_alteracoes")
    .select("alvo_id, alvo_rotulo, created_at")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("acao", "marcou_ciente");
  const cienteDe = new Set(
    ((cientes ?? []) as Array<{ alvo_id: string | null; alvo_rotulo: string | null }>).map(
      (c) => c.alvo_id ?? `rotulo:${c.alvo_rotulo ?? ""}`,
    ),
  );

  // Estado de trava AGORA, por alvo. A decisão pode ter travado e a diretoria
  // já ter liberado depois — a tela tem de mostrar o estado atual, não o
  // histórico, senão o construtor tenta editar o que ainda está travado (ou
  // pede liberação do que já foi liberado).
  const travadoAgora = await lerTravas(supabase, companyId, year, rows);

  const entradas: RetornoEntrada[] = rows.map((r) => {
    const chaveCiente = r.alvo_id ?? `rotulo:${r.alvo_rotulo ?? ""}`;
    return {
      id: r.id,
      createdAt: r.created_at,
      setorId: r.setor_id,
      setorNome: r.setor?.name ?? null,
      categoryCode: r.category_code,
      metodo: r.metodo,
      alvoTipo: r.alvo_tipo as AlvoTipo,
      alvoId: r.alvo_id,
      alvoRotulo: r.alvo_rotulo,
      acao: r.acao as TrilhaAcao,
      motivo: r.motivo,
      antes: r.antes,
      depois: r.depois,
      travadoAgora: r.alvo_id
        ? travadoAgora.has(r.alvo_id)
        : r.category_code
          ? travadoAgora.has(`ps:${r.category_code}:${r.setor_id ?? "-"}`)
          : false,
      resolucao: r.resolucao as TrilhaResolucao | null,
      autorNome: r.autor?.name ?? r.autor?.email ?? null,
      href: r.metodo ? workspaceTabHref(companyId, year, r.metodo) : null,
      ciente: cienteDe.has(chaveCiente),
    };
  });

  const { data: versoes } = await supabase
    .from("orcamento_versoes")
    .select("tipo, total_ano, numero")
    .eq("company_id", companyId)
    .eq("year", year)
    .order("numero", { ascending: true });
  const construcao = (versoes ?? []).find((v) => v.tipo === "construcao");
  const final = [...(versoes ?? [])].reverse().find((v) => v.tipo === "final");

  return {
    dados: {
      entradas,
      propostoAno: construcao?.total_ano == null ? null : Number(construcao.total_ano),
      finalAno: final?.total_ano == null ? null : Number(final.total_ano),
      pendentes: entradas.filter((e) => e.resolucao === "pendente").length,
      travados: entradas.filter((e) => e.travadoAgora).length,
    },
  };
}

function vazio(): RetornoDados {
  return { entradas: [], propostoAno: null, finalAno: null, pendentes: 0, travados: 0 };
}

/** Itens travados agora, por id (linhas) e por chave categoria×setor (planejamento). */
async function lerTravas(
  supabase: NonNullable<ReturnType<typeof db>> | Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  year: number,
  rows: Array<{ alvo_tipo: string; alvo_id: string | null }>,
): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = (tipo: string) =>
    rows.filter((r) => r.alvo_tipo === tipo && r.alvo_id).map((r) => r.alvo_id as string);

  const tabelas: Array<[string, string]> = [
    ["colaborador", "orcamento_pessoal_colaboradores"],
    ["valor_fixo_contrato", "orcamento_valor_fixo_categorias"],
    ["media_linha", "orcamento_media_categorias"],
    // O planejamento entrou aqui em 23/09/2026: a despesa virou linha e tem
    // `diretoria_travado` próprio, como os demais alvos.
    ["planejamento_item", "orcamento_planejamento_despesas"],
  ];
  for (const [tipo, tabela] of tabelas) {
    const lista = ids(tipo);
    if (lista.length === 0) continue;
    const { data } = await supabase
      .from(tabela)
      .select("id, diretoria_travado")
      .in("id", lista);
    for (const r of data ?? []) {
      if (r.diretoria_travado) out.add(r.id as string);
    }
  }

  // O ramo especial do planejamento saiu daqui: a trava morava na linha
  // categoria × setor (por falta de linha do item) e por isso a chave era
  // `ps:<categoria>:<setor>`, que travava a categoria inteira de uma vez.
  // Agora cada despesa carrega a própria trava e cai no laço genérico acima.
  return out;
}

/**
 * "Vi e entendi" — não muda nada no orçamento, só registra que a decisão foi
 * lida. Existe porque a alternativa é o gestor descobrir o corte no total e não
 * saber qual item mudou; com a marca, a lista do retorno esvazia conforme ele
 * percorre.
 */
export async function marcarCiente(
  alteracaoId: string,
): Promise<{ ok?: true; error?: string }> {
  if (!alteracaoId) return { error: "Alteração inválida." };

  const supabase = db() ?? (await createClient());
  const { data: alt, error: lerErr } = await supabase
    .from("orcamento_alteracoes")
    .select("company_id, year, setor_id, category_code, metodo, alvo_tipo, alvo_id, alvo_rotulo")
    .eq("id", alteracaoId)
    .maybeSingle();
  if (lerErr) return { error: lerErr.message };
  if (!alt) return { error: "Alteração não encontrada." };

  const companyId = alt.company_id as string;
  const year = Number(alt.year);
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  if (!podeEscreverNoSetor(auth.setores, (alt.setor_id as string) ?? null)) {
    return { error: SEM_ACESSO_SETOR };
  }

  await registrarAlteracao({
    companyId,
    year,
    cicloId: auth.cicloId,
    categoryCode: (alt.category_code as string) ?? null,
    setorId: (alt.setor_id as string) ?? null,
    alvoTipo: (alt.alvo_tipo as AlvoTipo) ?? "categoria_setor",
    alvoId: (alt.alvo_id as string) ?? null,
    alvoRotulo: (alt.alvo_rotulo as string) ?? null,
    acao: "marcou_ciente",
    fase: auth.fase,
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Quantas pendências do Orçamento esperam ESTE usuário, em todas as empresas e
 * anos que ele alcança. Alimenta o contador do menu.
 *
 * Conta o que tem dono definido: solicitação da diretoria e pedido de liberação
 * em aberto. Item travado NÃO entra — travado é estado, não tarefa; contá-lo
 * faria o número nunca zerar e o contador perderia o sentido.
 *
 * Acessório: qualquer erro (migration ausente, sem service role) devolve 0 —
 * o menu não pode quebrar por causa de um número.
 */
export async function contarPendenciasOrcamento(): Promise<number> {
  try {
    const { getOrcamentoUser } = await import("@/lib/orcamento/auth");
    const user = await getOrcamentoUser();
    if (!user) return 0;

    const supabase = db();
    if (!supabase) return 0;

    let q = supabase
      .from("orcamento_alteracoes")
      .select("id", { count: "exact", head: true })
      .eq("resolucao", "pendente");

    // O construtor responde solicitações; a diretoria responde pedidos de
    // liberação. Cada um vê o que é dele.
    if (user.papel === "validador") {
      q = q.eq("acao", "contestou");
    } else if (user.papel !== "admin") {
      q = q.eq("acao", "solicitou");
    }

    if (user.companyIds !== "todas") {
      if (user.companyIds.length === 0) return 0;
      q = q.in("company_id", user.companyIds);
    }

    const { count } = await q;
    return count ?? 0;
  } catch {
    return 0;
  }
}
