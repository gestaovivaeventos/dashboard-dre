import "server-only";

import { enquadrar, rotuloLinha, sugerirLinha, type DpEnquadramento, type DpLinhaSalarial } from "@/lib/dp/cargos";
import { indexarRegras, resolverEmpresa } from "@/lib/dp/empresa";
import { DpNaoInstaladoError, listDpRegras } from "@/lib/dp/queries";
import { resolverCentroCusto, resolverLinha, type DpOrigemCentro, type DpOrigemLinha } from "@/lib/dp/vinculo";
import type { createAdminClient } from "@/lib/supabase/admin";

// Leituras da tela de cargos e salários. Admin client DEPOIS de getDpUser(),
// como o resto do módulo (ver @/lib/dp/queries).

type AdminClient = ReturnType<typeof createAdminClient>;

export interface DpCentroCusto {
  id: string;
  codigo: string;
  nome: string;
}

export interface DpTabelaLinha extends DpLinhaSalarial {
  ordem: number;
  /** Centro de custo PADRÃO de quem está nesta linha (exceção por pessoa vence). */
  centroCustoId: string | null;
  /** Ativos desta empresa vinculados a esta linha (via cargo da Sólides). */
  pessoas: number;
}

export interface DpCargoSolidesUso {
  solidesCargoId: number;
  nome: string;
  /** Ativos desta empresa com este cargo na Sólides. */
  colaboradores: number;
  linhaId: string | null;
  /** Sugestão por nome — só exibida, nunca gravada sem clique. */
  sugestaoLinhaId: string | null;
}

export interface DpEnquadramentoRow {
  colaboradorId: string;
  nome: string;
  departamento: string | null;
  tipoContrato: string | null;
  cargoSolides: string | null;
  linhaRotulo: string | null;
  /** Linha que vale para a pessoa (exceção ?? cargo). */
  linhaId: string | null;
  /** Linha pela regra do cargo — o "automático", mostrado mesmo quando há exceção. */
  linhaDoCargoId: string | null;
  /** "cargo" = pela regra do cargo da Sólides; "excecao" = ajuste manual da pessoa. */
  origemLinha: DpOrigemLinha | null;
  centroId: string | null;
  /** Centro padrão da linha que vale — o "automático" do centro de custo. */
  centroDaLinhaId: string | null;
  centroCusto: string | null;
  origemCentro: DpOrigemCentro | null;
  salario: number | null;
  salarioTabela: number | null;
  enquadramento: DpEnquadramento;
}

export interface DpReajusteRow {
  percentual: number;
  linhas: number;
  totalAntes: number;
  totalDepois: number;
  aplicadoEm: string;
  aplicadoPor: string | null;
}

export interface DpCargosPagina {
  tabela: DpTabelaLinha[];
  centros: DpCentroCusto[];
  cargosSolides: DpCargoSolidesUso[];
  enquadramento: DpEnquadramentoRow[];
  /** Ativos da empresa sem cargo na Sólides — não há o que vincular. */
  semCargo: number;
  reajustes: DpReajusteRow[];
}

function ausente(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

export async function getDpTabela(
  db: AdminClient,
  companyId: string,
): Promise<Array<DpLinhaSalarial & { ordem: number; centroCustoId: string | null }>> {
  const { data, error } = await db
    .from("dp_tabela_salarial")
    .select("id, setor, cargo, salario, ordem, centro_custo_id")
    .eq("company_id", companyId)
    .order("ordem")
    .order("created_at");
  if (ausente(error)) throw new DpNaoInstaladoError();
  if (error) throw new Error(`dp_tabela_salarial: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    setor: (r.setor as string) ?? "",
    cargo: r.cargo as string,
    salario: Number(r.salario),
    ordem: Number(r.ordem),
    centroCustoId: (r.centro_custo_id as string | null) ?? null,
  }));
}

export async function listDpCentrosCusto(db: AdminClient, companyId: string): Promise<DpCentroCusto[]> {
  const { data, error } = await db
    .from("dp_centros_custo")
    .select("id, codigo, nome")
    .eq("company_id", companyId)
    .eq("ativo", true)
    .order("codigo")
    .order("nome");
  if (ausente(error)) throw new DpNaoInstaladoError();
  if (error) throw new Error(`dp_centros_custo: ${error.message}`);
  return (data ?? []).map((c) => ({ id: c.id as string, codigo: (c.codigo as string) ?? "", nome: c.nome as string }));
}

/** "001 · Comercial" (ou só o nome, sem código). */
export function rotuloCentro(c: Pick<DpCentroCusto, "codigo" | "nome">): string {
  return c.codigo.trim() ? `${c.codigo} · ${c.nome}` : c.nome;
}

export interface DpAjusteRow {
  linhaId: string | null;
  linhaMotivo: string | null;
  centroId: string | null;
  centroMotivo: string | null;
}

export async function listDpAjustes(db: AdminClient, solidesIds: number[]): Promise<Map<number, DpAjusteRow>> {
  if (solidesIds.length === 0) return new Map();
  const { data, error } = await db
    .from("dp_colaborador_ajustes")
    .select("solides_id, linha_id, linha_motivo, centro_custo_id, centro_motivo")
    .in("solides_id", solidesIds);
  if (ausente(error)) throw new DpNaoInstaladoError();
  if (error) throw new Error(`dp_colaborador_ajustes: ${error.message}`);
  return new Map(
    (data ?? []).map((a) => [
      Number(a.solides_id),
      {
        linhaId: (a.linha_id as string | null) ?? null,
        linhaMotivo: (a.linha_motivo as string | null) ?? null,
        centroId: (a.centro_custo_id as string | null) ?? null,
        centroMotivo: (a.centro_motivo as string | null) ?? null,
      },
    ]),
  );
}

export async function getDpCargosPagina(db: AdminClient, companyId: string): Promise<DpCargosPagina> {
  const [tabela, centros, regras, vinculosRes, colabsRes, reajustesRes] = await Promise.all([
    getDpTabela(db, companyId),
    listDpCentrosCusto(db, companyId),
    listDpRegras(db),
    db.from("dp_cargo_vinculos").select("solides_cargo_id, linha_id").eq("company_id", companyId),
    db
      .from("dp_colaboradores")
      .select("id, solides_id, nome, unidade_id, departamento_id, departamento_nome, cargo_id, cargo_nome, salario, tipo_contrato")
      .eq("ativo", true)
      .order("nome"),
    db
      .from("dp_tabela_reajustes")
      .select("percentual, linhas, total_antes, total_depois, aplicado_em, users(name, email)")
      .eq("company_id", companyId)
      .order("aplicado_em", { ascending: false })
      .limit(5),
  ]);
  for (const r of [vinculosRes, reajustesRes]) {
    if (ausente(r.error)) throw new DpNaoInstaladoError();
    if (r.error) throw new Error(r.error.message);
  }
  if (colabsRes.error) throw new Error(`dp_colaboradores: ${colabsRes.error.message}`);

  const idx = indexarRegras(regras);
  const vinculo = new Map((vinculosRes.data ?? []).map((v) => [Number(v.solides_cargo_id), v.linha_id as string]));
  const porId = new Map(tabela.map((l) => [l.id, l]));

  // Só os ativos desta empresa, pela MESMA regra de empresa das outras telas.
  const daEmpresa = (colabsRes.data ?? []).filter(
    (r) =>
      resolverEmpresa(
        {
          unidadeId: r.unidade_id === null ? null : Number(r.unidade_id),
          departamentoId: r.departamento_id === null ? null : Number(r.departamento_id),
        },
        idx,
      ).companyId === companyId,
  );

  const ajustes = await listDpAjustes(db, daEmpresa.map((r) => Number(r.solides_id)));
  const centroPorId = new Map(centros.map((c) => [c.id, c]));

  const usos = new Map<number, DpCargoSolidesUso>();
  const pessoasPorLinha = new Map<string, number>();
  let semCargo = 0;
  const enquadramento: DpEnquadramentoRow[] = daEmpresa.map((r) => {
    const cargoId = r.cargo_id === null ? null : Number(r.cargo_id);
    const vinculoCargo = cargoId === null ? null : vinculo.get(cargoId) ?? null;
    const linhaDoCargo = vinculoCargo && porId.has(vinculoCargo) ? vinculoCargo : null;
    const ajuste = ajustes.get(Number(r.solides_id)) ?? null;
    // Exceção só vale se a linha ainda é desta empresa (a tabela pode ter sido apagada/trocada).
    const excecao = ajuste?.linhaId && porId.has(ajuste.linhaId) ? ajuste.linhaId : null;
    const resolvida = resolverLinha({ excecaoLinhaId: excecao, linhaDoCargoId: linhaDoCargo });
    const linha = resolvida.linhaId ? porId.get(resolvida.linhaId) ?? null : null;
    const centroAjuste = ajuste?.centroId && centroPorId.has(ajuste.centroId) ? ajuste.centroId : null;
    const centroLinha = linha?.centroCustoId && centroPorId.has(linha.centroCustoId) ? linha.centroCustoId : null;
    const centro = resolverCentroCusto({ excecaoCentroId: centroAjuste, centroDaLinhaId: centroLinha });
    const centroObj = centro.centroId ? centroPorId.get(centro.centroId) ?? null : null;
    if (cargoId === null) semCargo += 1;
    else {
      // O de-para é por CARGO: mostra a linha do cargo, não a exceção de uma pessoa.
      const u = usos.get(cargoId) ?? {
        solidesCargoId: cargoId,
        nome: r.cargo_nome ?? `Cargo ${cargoId}`,
        colaboradores: 0,
        linhaId: linhaDoCargo,
        sugestaoLinhaId: null,
      };
      u.colaboradores += 1;
      usos.set(cargoId, u);
    }
    if (linha) pessoasPorLinha.set(linha.id, (pessoasPorLinha.get(linha.id) ?? 0) + 1);
    const salario = r.salario === null ? null : Number(r.salario);
    return {
      colaboradorId: r.id as string,
      nome: r.nome as string,
      departamento: r.departamento_nome,
      tipoContrato: r.tipo_contrato,
      cargoSolides: r.cargo_nome,
      linhaRotulo: linha ? rotuloLinha(linha) : null,
      linhaId: linha?.id ?? null,
      linhaDoCargoId: linhaDoCargo,
      origemLinha: linha ? resolvida.origem : null,
      centroId: centroObj?.id ?? null,
      centroDaLinhaId: centroLinha,
      centroCusto: centroObj ? rotuloCentro(centroObj) : null,
      origemCentro: centroObj ? centro.origem : null,
      salario,
      salarioTabela: linha?.salario ?? null,
      enquadramento: enquadrar({ temEmpresa: true, salario, salarioNivel: linha?.salario ?? null }),
    };
  });

  const cargosSolides = Array.from(usos.values())
    .map((u) => ({ ...u, sugestaoLinhaId: u.linhaId ? null : sugerirLinha(u.nome, tabela) }))
    // Sem linha primeiro (é o que falta fazer), depois pelo tamanho.
    .sort(
      (a, b) =>
        Number(a.linhaId !== null) - Number(b.linhaId !== null) ||
        b.colaboradores - a.colaboradores ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );

  const reajustes: DpReajusteRow[] = (reajustesRes.data ?? []).map((r) => {
    const u = (Array.isArray(r.users) ? r.users[0] : r.users) as { name?: string | null; email?: string | null } | null;
    return {
      percentual: Number(r.percentual),
      linhas: Number(r.linhas),
      totalAntes: Number(r.total_antes),
      totalDepois: Number(r.total_depois),
      aplicadoEm: r.aplicado_em as string,
      aplicadoPor: u?.name || u?.email || null,
    };
  });

  return {
    tabela: tabela.map((l) => ({ ...l, pessoas: pessoasPorLinha.get(l.id) ?? 0 })),
    centros,
    cargosSolides,
    enquadramento,
    semCargo,
    reajustes,
  };
}

/** Empresas com quantos ativos cada uma tem no DP — o seletor da tela. */
export async function listDpEmpresasComQuadro(db: AdminClient): Promise<Array<{ id: string; name: string; ativos: number }>> {
  const [regras, companiesRes, colabsRes] = await Promise.all([
    listDpRegras(db),
    db.from("companies").select("id, name").eq("active", true).order("name"),
    db.from("dp_colaboradores").select("unidade_id, departamento_id").eq("ativo", true),
  ]);
  if (companiesRes.error) throw new Error(`companies: ${companiesRes.error.message}`);
  if (colabsRes.error) throw new Error(`dp_colaboradores: ${colabsRes.error.message}`);
  const idx = indexarRegras(regras);
  const conta = new Map<string, number>();
  for (const r of colabsRes.data ?? []) {
    const e = resolverEmpresa(
      {
        unidadeId: r.unidade_id === null ? null : Number(r.unidade_id),
        departamentoId: r.departamento_id === null ? null : Number(r.departamento_id),
      },
      idx,
    );
    if (e.companyId) conta.set(e.companyId, (conta.get(e.companyId) ?? 0) + 1);
  }
  return (companiesRes.data ?? []).map((c) => ({ id: c.id as string, name: c.name as string, ativos: conta.get(c.id as string) ?? 0 }));
}

/** Cargos da Sólides usados pelos ativos de uma empresa, com o departamento — o modelo da planilha. */
export async function listDpCargosSolidesDaEmpresa(
  db: AdminClient,
  companyId: string,
): Promise<Array<{ cargo: string; departamento: string | null }>> {
  const [regras, colabsRes] = await Promise.all([
    listDpRegras(db),
    db.from("dp_colaboradores").select("unidade_id, departamento_id, departamento_nome, cargo_nome").eq("ativo", true),
  ]);
  if (colabsRes.error) throw new Error(`dp_colaboradores: ${colabsRes.error.message}`);
  const idx = indexarRegras(regras);
  const vistos = new Map<string, { cargo: string; departamento: string | null }>();
  for (const r of colabsRes.data ?? []) {
    if (!r.cargo_nome) continue;
    const e = resolverEmpresa(
      {
        unidadeId: r.unidade_id === null ? null : Number(r.unidade_id),
        departamentoId: r.departamento_id === null ? null : Number(r.departamento_id),
      },
      idx,
    );
    if (e.companyId !== companyId) continue;
    const k = `${r.departamento_nome ?? ""}|${r.cargo_nome}`;
    if (!vistos.has(k)) vistos.set(k, { cargo: r.cargo_nome as string, departamento: r.departamento_nome ?? null });
  }
  return Array.from(vistos.values()).sort(
    (a, b) => (a.departamento ?? "").localeCompare(b.departamento ?? "", "pt-BR") || a.cargo.localeCompare(b.cargo, "pt-BR"),
  );
}
