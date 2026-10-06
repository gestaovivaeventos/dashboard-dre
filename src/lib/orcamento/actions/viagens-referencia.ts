"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { SEM_ACESSO_ADMIN, autorizarLeitura, getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { numDaLinha as num, textoDaLinha as texto } from "@/lib/viagens/colunas";
import { chaveNome } from "@/lib/viagens/plano";
import {
  destinosPendentes,
  indexarInformadas,
  type DestinoPendente,
  type ReferenciaInformada,
} from "@/lib/viagens/referencia-destino";
import { lerHistoricoParaCalculo } from "@/lib/orcamento/actions/viagens-historico";

// =============================================================================
// REFERÊNCIA DE DESTINO informada pela Controladoria.
//
// ── O fluxo que isto serve (decisão de 02/10/2026) ────────────────────────
// Viagem a destino sem histórico NÃO é bloqueada: é cadastrada, fica em zero com a
// pendência nomeada, e a Controladoria informa os valores depois. Daí duas coisas
// vivem aqui: a LISTA de pendências (o que pedir a ela) e a GRAVAÇÃO dos valores.
//
// ── A faixa por região saiu do caminho ───────────────────────────────────
// Ela daria um valor plausível e calaria o aviso — o oposto do pedido. As tabelas
// ficam no banco sem leitor; não as traga de volta ao cálculo.
// =============================================================================

const PATH = "/orcamento";

type Supa = Awaited<ReturnType<typeof createClient>>;

function db() {
  return createAdminClientIfAvailable();
}

const REF_COLS =
  "id, cidade, passagem_por_pessoa, diaria_por_quarto, modal, observacao, updated_at";

export interface LinhaReferencia extends ReferenciaInformada {
  id: string;
}

export interface ReferenciaSetup {
  /** O que a Controladoria já informou, por destino. */
  informadas: LinhaReferencia[];
  /** Destinos usados nas viagens do ano e sem número de onde partir. */
  pendentes: DestinoPendente[];
  isAdmin: boolean;
  error?: string;
  needsMigration?: boolean;
}

const VAZIO: ReferenciaSetup = { informadas: [], pendentes: [], isAdmin: false };

function daRow(r: Record<string, unknown>): LinhaReferencia {
  return {
    id: r.id as string,
    cidade: texto(r.cidade),
    passagemPorPessoa: num(r.passagem_por_pessoa),
    diariaPorQuarto: num(r.diaria_por_quarto),
    modal: texto(r.modal) || null,
    observacao: texto(r.observacao) || null,
    informadoEm: (r.updated_at as string | null) ?? null,
  };
}

/** Lê as referências informadas — o par de `lerHistoricoParaCalculo`. */
export async function lerReferenciasInformadas(
  supabase: Supa,
  companyId: string,
  year: number,
): Promise<Map<string, ReferenciaInformada>> {
  const { data, error } = await supabase
    .from("orcamento_viagem_referencia")
    .select(REF_COLS)
    .eq("company_id", companyId)
    .eq("year", year);
  // Tabela ausente devolve mapa vazio: a falta de migration não pode ser o motivo
  // de a grade parar de calcular o que ela já calculava.
  if (error || !data) return new Map();
  return indexarInformadas((data as unknown as Array<Record<string, unknown>>).map(daRow));
}

/**
 * As pendências do ano + o que já foi informado.
 *
 * Gate de LEITURA: o gestor precisa ver a pendência da linha dele (é como ele sabe
 * que tem de avisar alguém). Só a gravação é da Controladoria/admin.
 */
export async function getReferenciasViagem(
  companyId: string,
  year: number,
): Promise<ReferenciaSetup> {
  if (!companyId) return VAZIO;
  if (!isValidBudgetYear(year)) return { ...VAZIO, error: "Ano do orçamento inválido." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { ...VAZIO, error: auth.error };

  const { data, error } = await supabase
    .from("orcamento_viagem_referencia")
    .select(REF_COLS)
    .eq("company_id", companyId)
    .eq("year", year)
    .order("cidade");
  if (error) {
    if (isSchemaMissing(error.message)) {
      return { ...VAZIO, isAdmin: auth.user.isAdmin, needsMigration: true };
    }
    return { ...VAZIO, isAdmin: auth.user.isAdmin, error: error.message };
  }
  const informadas = (data as unknown as Array<Record<string, unknown>>).map(daRow);

  // ── As pendências saem das VIAGENS do ano ──
  // É a mesma conta que marca a linha na grade: uma fonte só, senão a lista diria
  // uma coisa e a tela outra.
  const { data: viagens } = await supabase
    .from("orcamento_viagens")
    .select("id, volta_modal")
    .eq("company_id", companyId)
    .eq("year", year);
  const ids = ((viagens ?? []) as Array<Record<string, unknown>>).map((v) => v.id as string);
  const modalDe = new Map(
    ((viagens ?? []) as Array<Record<string, unknown>>).map(
      (v) => [v.id as string, texto(v.volta_modal) || null] as const,
    ),
  );

  const linhas: Array<{
    destino: string;
    noites: number;
    modal: string | null;
    temPrecoProprio: boolean;
  }> = [];
  if (ids.length > 0) {
    const { data: paradas } = await supabase
      .from("orcamento_viagem_paradas")
      .select(
        "viagem_id, ordem, cidade, noites, chegada_modal, chegada_preco_pessoa, chegada_preco_total",
      )
      .in("viagem_id", ids)
      .order("ordem");
    for (const p of (paradas ?? []) as Array<Record<string, unknown>>) {
      const vid = p.viagem_id as string;
      linhas.push({
        destino: texto(p.cidade),
        noites: num(p.noites) ?? 0,
        modal: texto(p.chegada_modal) || modalDe.get(vid) || null,
        temPrecoProprio:
          (num(p.chegada_preco_pessoa) ?? 0) > 0 || (num(p.chegada_preco_total) ?? 0) > 0,
      });
    }
  }

  const historico = await lerHistoricoParaCalculo(supabase, companyId, year);
  const pendentes = destinosPendentes(
    linhas,
    historico?.refs ?? new Map(),
    indexarInformadas(informadas),
  );

  return { informadas, pendentes, isAdmin: auth.user.isAdmin };
}

/**
 * Grava (ou atualiza) a referência de um destino.
 *
 * INSERT/UPDATE explícito, nunca `upsert`: a chave única é índice por EXPRESSÃO
 * (`lower(btrim(cidade))`) e `ON CONFLICT (colunas)` não casa com ela — a mesma
 * pegadinha de `orcamento_grupo_escopo`.
 */
export async function salvarReferenciaViagem(
  companyId: string,
  year: number,
  input: {
    cidade: string;
    passagemPorPessoa?: number | null;
    diariaPorQuarto?: number | null;
    modal?: string | null;
    observacao?: string | null;
  },
): Promise<{ error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const cidade = texto(input.cidade);
  if (!cidade) return { error: "Informe a cidade." };

  const passagem = num(input.passagemPorPessoa);
  const diaria = num(input.diariaPorQuarto);
  if ((passagem ?? 0) < 0 || (diaria ?? 0) < 0) {
    return { error: "Os valores não podem ser negativos." };
  }
  if ((passagem ?? 0) === 0 && (diaria ?? 0) === 0) {
    // Gravar uma linha sem número nenhum tiraria o destino da lista de pendências
    // sem resolver nada — a Controladoria pensaria que informou.
    return { error: "Informe a passagem por pessoa, a diária por quarto, ou as duas." };
  }

  const supabase = (db() ?? (await createClient())) as Supa;
  const campos = {
    passagem_por_pessoa: (passagem ?? 0) > 0 ? passagem : null,
    diaria_por_quarto: (diaria ?? 0) > 0 ? diaria : null,
    modal: texto(input.modal) || null,
    observacao: texto(input.observacao) || null,
    updated_at: new Date().toISOString(),
    updated_by: admin.userId,
  };

  const { data: existente, error: lerErr } = await supabase
    .from("orcamento_viagem_referencia")
    .select("id, cidade")
    .eq("company_id", companyId)
    .eq("year", year);
  if (lerErr) {
    if (isSchemaMissing(lerErr.message)) return { needsMigration: true };
    return { error: lerErr.message };
  }
  const achado = ((existente ?? []) as Array<Record<string, unknown>>).find(
    (r) => chaveNome(texto(r.cidade)) === chaveNome(cidade),
  );

  const q = achado
    ? supabase.from("orcamento_viagem_referencia").update(campos).eq("id", achado.id as string)
    : supabase
        .from("orcamento_viagem_referencia")
        .insert({ company_id: companyId, year, cidade, ...campos });
  const { error } = await q;
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    // 23505 sobre o índice por expressão: alguém gravou o mesmo destino agora.
    if (error.code === "23505") return { error: "Este destino acabou de ser informado." };
    return { error: error.message };
  }

  revalidatePath(PATH);
  return {};
}

export async function removerReferenciaViagem(
  companyId: string,
  id: string,
): Promise<{ error?: string }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!companyId || !id) return { error: "Referência inválida." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const { error } = await supabase
    .from("orcamento_viagem_referencia")
    .delete()
    .eq("id", id)
    .eq("company_id", companyId);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return {};
}
