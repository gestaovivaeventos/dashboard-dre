import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  indexarRegras,
  resolverEmpresa,
  type DpEmpresaRegra,
  type DpEmpresaResolvida,
  type DpRegraOrigem,
} from "@/lib/dp/empresa";
import type { DpCampoRastreado, DpEventoTipo } from "@/lib/dp/historico";
import type { DpIndicadorEntrada } from "@/lib/dp/indicadores";
import type { DpEndereco } from "@/lib/dp/solides/parse";

// Leituras das telas do DP. Todas com o admin client DEPOIS de getDpUser():
// mesmo enquadramento do Caixa — quem tem o módulo vê o grupo inteiro, e o
// embed/lookup de `companies` sob a RLS do usuário depende de vínculo por
// empresa, que não é a regra daqui. A RLS de dp_* (dp_has_access) segue como
// segunda linha para qualquer leitura com o client do usuário.

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * As tabelas do DP ainda não existem no banco (migration 20260929160000 não
 * aplicada). As páginas pegam este erro e explicam o que falta — em produção o
 * Next esconde a mensagem de erro de Server Component, e a pessoa só veria um
 * código sem saber o que fazer.
 */
export class DpNaoInstaladoError extends Error {
  constructor() {
    super("As tabelas do Departamento Pessoal ainda não foram criadas no banco.");
    this.name = "DpNaoInstaladoError";
  }
}

function check(error: { code?: string; message: string } | null, what: string): void {
  if (!error) return;
  // PGRST205: tabela fora do schema cache do PostgREST; 42P01: tabela inexistente.
  if (error.code === "PGRST205" || error.code === "42P01") throw new DpNaoInstaladoError();
  throw new Error(`${what}: ${error.message}`);
}

export interface DpCompanyRef {
  id: string;
  name: string;
}

export interface DpColaboradorRow {
  id: string;
  solidesId: number;
  nome: string;
  cpf: string | null;
  email: string | null;
  unidadeId: number | null;
  unidadeNome: string | null;
  departamentoId: number | null;
  departamentoNome: string | null;
  cargoNome: string | null;
  tipoContrato: string | null;
  dataAdmissao: string | null;
  dataDesligamento: string | null;
  gestorNome: string | null;
  ativo: boolean;
  desligadoDetectadoEm: string | null;
  empresa: DpEmpresaResolvida;
  companyName: string | null;
}

export interface DpColaboradorFichaRow extends DpColaboradorRow {
  salario: number | null;
  endereco: DpEndereco | null;
  fichaSincronizadaEm: string | null;
  sincronizadoEm: string;
}

export interface DpSyncRun {
  id: string;
  trigger: "cron" | "manual";
  status: "running" | "ok" | "erro";
  startedAt: string;
  finishedAt: string | null;
  lista: number | null;
  fichasErro: number;
  novos: number;
  desligados: number;
  reativados: number;
  erro: string | null;
}

const LIST_COLUMNS =
  "id, solides_id, nome, cpf, email, unidade_id, unidade_nome, departamento_id, departamento_nome, cargo_nome, " +
  "tipo_contrato, data_admissao, data_desligamento, gestor_nome, ativo, desligado_detectado_em";

export async function listDpCompanies(db: AdminClient): Promise<DpCompanyRef[]> {
  const { data, error } = await db.from("companies").select("id, name").eq("active", true).order("name");
  if (error) throw new Error(`companies: ${error.message}`);
  return (data ?? []) as DpCompanyRef[];
}

export async function listDpRegras(db: AdminClient): Promise<Array<DpEmpresaRegra & { solidesNome: string }>> {
  const { data, error } = await db.from("dp_empresa_regras").select("origem, solides_id, solides_nome, company_id");
  check(error, "dp_empresa_regras");
  return (data ?? []).map((r) => ({
    origem: r.origem as DpRegraOrigem,
    solidesId: Number(r.solides_id),
    solidesNome: String(r.solides_nome),
    companyId: String(r.company_id),
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(r: any, idx: ReturnType<typeof indexarRegras>, names: Map<string, string>): DpColaboradorRow {
  const unidadeId = r.unidade_id === null ? null : Number(r.unidade_id);
  const departamentoId = r.departamento_id === null ? null : Number(r.departamento_id);
  const empresa = resolverEmpresa({ unidadeId, departamentoId }, idx);
  return {
    id: r.id,
    solidesId: Number(r.solides_id),
    nome: r.nome,
    cpf: r.cpf,
    email: r.email,
    unidadeId,
    unidadeNome: r.unidade_nome,
    departamentoId,
    departamentoNome: r.departamento_nome,
    cargoNome: r.cargo_nome,
    tipoContrato: r.tipo_contrato,
    dataAdmissao: r.data_admissao,
    dataDesligamento: r.data_desligamento,
    gestorNome: r.gestor_nome,
    ativo: Boolean(r.ativo),
    desligadoDetectadoEm: r.desligado_detectado_em,
    empresa,
    companyName: empresa.companyId ? names.get(empresa.companyId) ?? null : null,
  };
}

async function contexto(db: AdminClient) {
  const [regras, companies] = await Promise.all([listDpRegras(db), listDpCompanies(db)]);
  return { idx: indexarRegras(regras), names: new Map(companies.map((c) => [c.id, c.name])) };
}

export async function listDpColaboradores(db: AdminClient): Promise<DpColaboradorRow[]> {
  const [{ data, error }, ctx] = await Promise.all([
    db.from("dp_colaboradores").select(LIST_COLUMNS).order("nome"),
    contexto(db),
  ]);
  check(error, "dp_colaboradores");
  return (data ?? []).map((r) => toRow(r, ctx.idx, ctx.names));
}

export async function getDpColaborador(db: AdminClient, id: string): Promise<DpColaboradorFichaRow | null> {
  const [{ data, error }, ctx] = await Promise.all([
    db
      .from("dp_colaboradores")
      .select(`${LIST_COLUMNS}, salario, endereco, ficha_sincronizada_em, sincronizado_em`)
      .eq("id", id)
      .maybeSingle(),
    contexto(db),
  ]);
  check(error, "dp_colaboradores");
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = data as any;
  return {
    ...toRow(r, ctx.idx, ctx.names),
    salario: r.salario === null ? null : Number(r.salario),
    endereco: r.endereco ?? null,
    fichaSincronizadaEm: r.ficha_sincronizada_em,
    sincronizadoEm: r.sincronizado_em,
  };
}

export async function lastDpSyncRun(db: AdminClient): Promise<DpSyncRun | null> {
  const { data, error } = await db
    .from("dp_sync_runs")
    .select("id, trigger, status, started_at, finished_at, colaboradores_lista, fichas_erro, novos, desligados, reativados, erro")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  check(error, "dp_sync_runs");
  if (!data) return null;
  return {
    id: data.id,
    trigger: data.trigger,
    status: data.status,
    startedAt: data.started_at,
    finishedAt: data.finished_at,
    lista: data.colaboradores_lista,
    fichasErro: data.fichas_erro,
    novos: data.novos,
    desligados: data.desligados,
    reativados: data.reativados,
    erro: data.erro,
  };
}

// ── Histórico e acessos (migration 20261001160000) ──────────────────────────
// Recurso acessório: tabela ausente vira `null` ("não instalado") em vez de
// derrubar a ficha ou a Visão geral, que funcionam sem ele.

export interface DpEventoRow {
  id: string;
  solidesId: number;
  tipo: DpEventoTipo;
  campo: DpCampoRastreado | null;
  valorAnterior: unknown;
  valorNovo: unknown;
  detectadoEm: string;
}

export interface DpEventoRecente extends DpEventoRow {
  colaboradorId: string | null;
  nome: string | null;
}

export interface DpAcessoRow {
  createdAt: string;
  userName: string | null;
  userEmail: string | null;
}

function ausente(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEvento(r: any): DpEventoRow {
  return {
    id: r.id,
    solidesId: Number(r.solides_id),
    tipo: r.tipo,
    campo: r.campo,
    valorAnterior: r.valor_anterior,
    valorNovo: r.valor_novo,
    detectadoEm: r.detectado_em,
  };
}

const EVENTO_COLUMNS = "id, solides_id, tipo, campo, valor_anterior, valor_novo, detectado_em";

export async function listDpEventosDoColaborador(db: AdminClient, solidesId: number): Promise<DpEventoRow[] | null> {
  const { data, error } = await db
    .from("dp_colaborador_eventos")
    .select(EVENTO_COLUMNS)
    .eq("solides_id", solidesId)
    .order("detectado_em", { ascending: false })
    .limit(200);
  if (ausente(error)) return null;
  check(error, "dp_colaborador_eventos");
  return (data ?? []).map(toEvento);
}

export async function listDpEventosRecentes(db: AdminClient, desdeIso: string, limit = 50): Promise<DpEventoRecente[] | null> {
  const { data, error } = await db
    .from("dp_colaborador_eventos")
    .select(`${EVENTO_COLUMNS}, dp_colaboradores(id, nome)`)
    .gte("detectado_em", desdeIso)
    .order("detectado_em", { ascending: false })
    .limit(limit);
  if (ausente(error)) return null;
  check(error, "dp_colaborador_eventos");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => {
    const colab = Array.isArray(r.dp_colaboradores) ? r.dp_colaboradores[0] : r.dp_colaboradores;
    return { ...toEvento(r), colaboradorId: colab?.id ?? null, nome: colab?.nome ?? null };
  });
}

export async function listDpAcessos(db: AdminClient, colaboradorId: string, limit = 20): Promise<DpAcessoRow[] | null> {
  const { data, error } = await db
    .from("dp_acessos")
    .select("created_at, users(name, email)")
    .eq("colaborador_id", colaboradorId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (ausente(error)) return null;
  check(error, "dp_acessos");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    return { createdAt: r.created_at, userName: u?.name ?? null, userEmail: u?.email ?? null };
  });
}

/**
 * Registra a abertura de uma ficha. Melhor esforço: falhar aqui não impede a
 * leitura (a ficha é de quem tem a concessão; travar a tela por causa do
 * registro tiraria o DP do ar a cada instabilidade), mas o erro vai ao log.
 */
export async function registrarAcessoFicha(db: AdminClient, userId: string, colaboradorId: string): Promise<void> {
  const { error } = await db.from("dp_acessos").insert({ user_id: userId, colaborador_id: colaboradorId, acao: "ficha" });
  if (error && !ausente(error)) console.error("[dp] registrar acesso falhou:", error.message);
}

/**
 * Entradas dos indicadores, com SALÁRIO. Consulta separada da lista de
 * propósito: a lista vai para o navegador (componente client), e levar o
 * salário de cada pessoa até lá só para somar seria expor o dado individual
 * sem necessidade. Esta roda no servidor e só os totais saem da página.
 */
export async function listDpIndicadorEntradas(db: AdminClient): Promise<DpIndicadorEntrada[]> {
  const [{ data, error }, ctx] = await Promise.all([
    db
      .from("dp_colaboradores")
      .select("ativo, unidade_id, departamento_id, tipo_contrato, salario, data_admissao, data_desligamento, desligado_detectado_em"),
    contexto(db),
  ]);
  check(error, "dp_colaboradores");
  return (data ?? []).map((r) => {
    const empresa = resolverEmpresa(
      {
        unidadeId: r.unidade_id === null ? null : Number(r.unidade_id),
        departamentoId: r.departamento_id === null ? null : Number(r.departamento_id),
      },
      ctx.idx,
    );
    return {
      ativo: Boolean(r.ativo),
      companyName: empresa.companyId ? ctx.names.get(empresa.companyId) ?? null : null,
      tipoContrato: r.tipo_contrato,
      salario: r.salario === null ? null : Number(r.salario),
      dataAdmissao: r.data_admissao,
      dataDesligamento: r.data_desligamento,
      desligadoDetectadoEm: r.desligado_detectado_em,
    };
  });
}
