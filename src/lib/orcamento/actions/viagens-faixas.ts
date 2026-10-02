"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { SEM_ACESSO_ADMIN, autorizarLeitura, getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { textoDaLinha as texto, numDaLinha as num } from "@/lib/viagens/colunas";

// =============================================================================
// FAIXAS de custo de viagem — a tabela de referência do admin.
//
// Com ~50 viagens a destinos que quase não se repetem, cotar por viagem não
// amortiza nada e nem é preciso (só o mês, um ano à frente). O número vem destas
// ~10 linhas, curadas uma vez por ano, e é só aqui que a busca na web trabalha.
//
// ── Ler é de todo mundo, escrever é do admin ──────────────────────────────
// A grade precisa LER as faixas para mostrar o custo de cada linha; um gestor que
// não pudesse lê-las veria tudo zerado. Escrever é admin, pelo mesmo
// enquadramento dos encargos e do plano de cargos: quanto custa uma passagem para
// o Nordeste é premissa da empresa, não construção de quem pede a viagem.
// =============================================================================

const PATH = "/orcamento";

type Supa = Awaited<ReturnType<typeof createClient>>;

function db() {
  return createAdminClientIfAvailable();
}

export type TipoFaixa = "passagem" | "hospedagem";

export interface FaixaViagem {
  id: string;
  tipo: TipoFaixa;
  nome: string;
  valor: number;
  /** Só em `passagem`: o modal que a faixa pressupõe. */
  modal: string | null;
  ordem: number;
  ativo: boolean;
  /** Quantas viagens já apontam para esta faixa (aviso antes de desativar). */
  viagens: number;
}

/** Uma faixa como o MOTOR e a grade a consomem. */
export interface FaixaParaCalculo {
  nome: string;
  valor: number;
  modal: string | null;
  tipo: TipoFaixa;
}

export interface FaixasSetup {
  items: FaixaViagem[];
  isAdmin: boolean;
  error?: string;
  needsMigration?: boolean;
}

function linha(r: Record<string, unknown>): FaixaViagem {
  return {
    id: r.id as string,
    tipo: r.tipo === "hospedagem" ? "hospedagem" : "passagem",
    nome: texto(r.nome),
    valor: num(r.valor) ?? 0,
    modal: texto(r.modal) || null,
    ordem: num(r.ordem) ?? 0,
    ativo: r.ativo !== false,
    viagens: 0,
  };
}

/** As faixas da empresa × ano, com quantas viagens usam cada uma. */
export async function getFaixasViagem(companyId: string, year: number): Promise<FaixasSetup> {
  if (!companyId) return { items: [], isAdmin: false };
  if (!isValidBudgetYear(year)) {
    return { items: [], isAdmin: false, error: "Ano do orçamento inválido." };
  }

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { items: [], isAdmin: false, error: auth.error };

  const { data, error } = await supabase
    .from("orcamento_viagem_faixas")
    .select("id, tipo, nome, valor, modal, ordem, ativo")
    .eq("company_id", companyId)
    .eq("year", year)
    .order("tipo")
    .order("ordem")
    .order("nome");
  if (error) {
    if (isSchemaMissing(error.message)) return { items: [], isAdmin: false, needsMigration: true };
    return { items: [], isAdmin: false, error: error.message };
  }

  const items = ((data ?? []) as Array<Record<string, unknown>>).map(linha);

  // Uso por faixa, numa consulta só. É o aviso antes de desativar: faixa em uso
  // deixaria as viagens dela sem referência, e o custo delas iria a zero no
  // próximo recálculo.
  const { data: usos } = await supabase
    .from("orcamento_viagens")
    .select("faixa_passagem_id, faixa_hospedagem_id")
    .eq("company_id", companyId)
    .eq("year", year);
  const conta = new Map<string, number>();
  for (const u of (usos ?? []) as Array<Record<string, unknown>>) {
    for (const k of ["faixa_passagem_id", "faixa_hospedagem_id"] as const) {
      const id = u[k] as string | null;
      if (id) conta.set(id, (conta.get(id) ?? 0) + 1);
    }
  }
  for (const f of items) f.viagens = conta.get(f.id) ?? 0;

  return { items, isAdmin: auth.user.isAdmin };
}

/**
 * Faixas prontas para o MOTOR, indexadas por id.
 *
 * Fonte única para a grade (mostrar o custo) e para a gravação (calcular o
 * retrato). Resolvendo em dois lugares, a tela mostraria um número e o banco
 * guardaria outro.
 */
export async function lerFaixasParaCalculo(
  supabase: Supa,
  companyId: string,
  year: number,
): Promise<Map<string, FaixaParaCalculo>> {
  const mapa = new Map<string, FaixaParaCalculo>();
  const { data, error } = await supabase
    .from("orcamento_viagem_faixas")
    .select("id, tipo, nome, valor, modal, ativo")
    .eq("company_id", companyId)
    .eq("year", year);
  // Migration pendente devolve mapa vazio: o trecho entra zero DITO em premissa,
  // em vez de a tela inteira parar por causa de um cadastro que falta.
  if (error) return mapa;
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const nome = texto(r.nome);
    const valor = num(r.valor) ?? 0;
    // Faixa inativa continua valendo para quem JÁ a escolheu: desativar é parar
    // de oferecer, não zerar o orçamento de quem já a usou.
    if (!nome || valor <= 0) continue;
    mapa.set(r.id as string, {
      nome,
      valor,
      // O modal da faixa é o que a grade usa para derivar o trecho: "Capital
      // Nordeste" pressupõe avião, "até 300 km" pressupõe carro.
      modal: texto(r.modal) || null,
      tipo: r.tipo === "hospedagem" ? "hospedagem" : "passagem",
    });
  }
  return mapa;
}

export async function salvarFaixaViagem(
  companyId: string,
  year: number,
  input: {
    id?: string | null;
    tipo: TipoFaixa;
    nome: string;
    valor: number;
    modal?: string | null;
    ordem?: number;
    ativo?: boolean;
  },
): Promise<{ id?: string; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (!texto(input.nome)) return { error: "Dê um nome à faixa." };
  if (input.tipo !== "passagem" && input.tipo !== "hospedagem") {
    return { error: "Tipo de faixa inválido." };
  }
  const valor = num(input.valor) ?? 0;
  if (valor < 0) return { error: "O valor não pode ser negativo." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const campos = {
    company_id: companyId,
    year,
    tipo: input.tipo,
    nome: texto(input.nome),
    valor,
    modal: input.tipo === "passagem" ? texto(input.modal) || null : null,
    ordem: num(input.ordem) ?? 0,
    ativo: input.ativo ?? true,
    updated_at: new Date().toISOString(),
    updated_by: admin.userId,
  };

  const q = input.id
    ? supabase.from("orcamento_viagem_faixas").update(campos).eq("id", input.id).select("id")
    : supabase.from("orcamento_viagem_faixas").insert(campos).select("id");

  const { data, error } = await q.maybeSingle();
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    // Índice único por expressão (lower(btrim(nome))): 23505 é nome repetido,
    // inclusive com outra caixa ou espaço sobrando.
    if (error.code === "23505") return { error: "Já existe uma faixa com esse nome." };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { id: (data?.id as string) ?? input.id ?? undefined };
}

/**
 * Exclui uma faixa.
 *
 * Com viagem apontando para ela, RECUSA e manda desativar: `ON DELETE SET NULL`
 * deixaria as viagens sem referência, e o custo delas iria a ZERO no próximo
 * recálculo — orçamento que encolhe sem ninguém ter decidido nada.
 */
export async function removerFaixaViagem(
  companyId: string,
  year: number,
  faixaId: string,
): Promise<{ ok?: true; error?: string }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!faixaId) return { error: "Faixa inválida." };

  const supabase = (db() ?? (await createClient())) as Supa;
  for (const col of ["faixa_passagem_id", "faixa_hospedagem_id"] as const) {
    const { count } = await supabase
      .from("orcamento_viagens")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("year", year)
      .eq(col, faixaId);
    if ((count ?? 0) > 0) {
      return {
        error: `Há ${count} viagem(ns) usando esta faixa. Desative-a em vez de excluir — assim ela para de ser oferecida sem zerar o custo de quem já a escolheu.`,
      };
    }
  }

  const { error } = await supabase
    .from("orcamento_viagem_faixas")
    .delete()
    .eq("id", faixaId)
    .eq("company_id", companyId)
    .eq("year", year);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Semeia as faixas padrão de uma empresa × ano.
 *
 * O cadastro em branco é a maior barreira para começar: sem faixa nenhuma, toda
 * viagem sai zerada e o admin não sabe quais faixas inventar. Os nomes abaixo são
 * o recorte que cobre o Brasil para quem sai do Sudeste, com **valor zero** de
 * propósito — zero é dito em premissa ("SEM FAIXA"), enquanto um valor chutado
 * pareceria referência curada. O admin preenche os dez números.
 *
 * Idempotente: nome repetido é ignorado (não derruba o lote).
 */
export async function semearFaixasViagem(
  companyId: string,
  year: number,
): Promise<{ criadas?: number; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!companyId || !isValidBudgetYear(year)) return { error: "Empresa ou ano inválidos." };

  const padrao: Array<{ tipo: TipoFaixa; nome: string; modal: string | null; ordem: number }> = [
    { tipo: "passagem", nome: "Até 300 km (carro)", modal: "carro", ordem: 1 },
    { tipo: "passagem", nome: "300 a 800 km", modal: "onibus", ordem: 2 },
    { tipo: "passagem", nome: "Capital Sudeste", modal: "aviao", ordem: 3 },
    { tipo: "passagem", nome: "Capital Sul", modal: "aviao", ordem: 4 },
    { tipo: "passagem", nome: "Capital Centro-Oeste", modal: "aviao", ordem: 5 },
    { tipo: "passagem", nome: "Capital Nordeste", modal: "aviao", ordem: 6 },
    { tipo: "passagem", nome: "Capital Norte", modal: "aviao", ordem: 7 },
    { tipo: "passagem", nome: "Interior (voo + trecho terrestre)", modal: "aviao", ordem: 8 },
    { tipo: "hospedagem", nome: "Capital", modal: null, ordem: 1 },
    { tipo: "hospedagem", nome: "Interior", modal: null, ordem: 2 },
    { tipo: "hospedagem", nome: "Destino turístico", modal: null, ordem: 3 },
  ];

  const supabase = (db() ?? (await createClient())) as Supa;
  const { data: existentes, error: lerErr } = await supabase
    .from("orcamento_viagem_faixas")
    .select("tipo, nome")
    .eq("company_id", companyId)
    .eq("year", year);
  if (lerErr) {
    if (isSchemaMissing(lerErr.message)) return { needsMigration: true };
    return { error: lerErr.message };
  }
  const jaTem = new Set(
    ((existentes ?? []) as Array<Record<string, unknown>>).map(
      (r) => `${texto(r.tipo)}|${texto(r.nome).toLowerCase()}`,
    ),
  );

  // Dedupe por LEITURA, não por `ignoreDuplicates`: a chave é um índice por
  // EXPRESSÃO (lower(btrim(nome))), e `ON CONFLICT (colunas)` não casa com ela —
  // a mesma pegadinha de `orcamento_grupo_escopo`, que derrubava o lote inteiro.
  const faltam = padrao
    .filter((p) => !jaTem.has(`${p.tipo}|${p.nome.toLowerCase()}`))
    .map((p) => ({
      company_id: companyId,
      year,
      tipo: p.tipo,
      nome: p.nome,
      valor: 0,
      modal: p.modal,
      ordem: p.ordem,
      updated_by: admin.userId,
    }));
  if (faltam.length === 0) return { criadas: 0 };

  const { error } = await supabase.from("orcamento_viagem_faixas").insert(faltam);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { criadas: faltam.length };
}
