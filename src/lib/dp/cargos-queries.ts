import "server-only";

import { enquadrar, rotuloLinha, sugerirLinha, type DpEnquadramento, type DpLinhaSalarial } from "@/lib/dp/cargos";
import { indexarRegras, resolverEmpresa } from "@/lib/dp/empresa";
import { DpNaoInstaladoError, listDpRegras } from "@/lib/dp/queries";
import type { createAdminClient } from "@/lib/supabase/admin";

// Leituras da tela de cargos e salários. Admin client DEPOIS de getDpUser(),
// como o resto do módulo (ver @/lib/dp/queries).

type AdminClient = ReturnType<typeof createAdminClient>;

export interface DpTabelaLinha extends DpLinhaSalarial {
  ordem: number;
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
  cargoSolides: string | null;
  linhaRotulo: string | null;
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
  cargosSolides: DpCargoSolidesUso[];
  enquadramento: DpEnquadramentoRow[];
  /** Ativos da empresa sem cargo na Sólides — não há o que vincular. */
  semCargo: number;
  reajustes: DpReajusteRow[];
}

function ausente(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

export async function getDpTabela(db: AdminClient, companyId: string): Promise<Array<DpLinhaSalarial & { ordem: number }>> {
  const { data, error } = await db
    .from("dp_tabela_salarial")
    .select("id, setor, cargo, salario, ordem")
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
  }));
}

export async function getDpCargosPagina(db: AdminClient, companyId: string): Promise<DpCargosPagina> {
  const [tabela, regras, vinculosRes, colabsRes, reajustesRes] = await Promise.all([
    getDpTabela(db, companyId),
    listDpRegras(db),
    db.from("dp_cargo_vinculos").select("solides_cargo_id, linha_id").eq("company_id", companyId),
    db
      .from("dp_colaboradores")
      .select("id, nome, unidade_id, departamento_id, departamento_nome, cargo_id, cargo_nome, salario")
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

  const usos = new Map<number, DpCargoSolidesUso>();
  const pessoasPorLinha = new Map<string, number>();
  let semCargo = 0;
  const enquadramento: DpEnquadramentoRow[] = daEmpresa.map((r) => {
    const cargoId = r.cargo_id === null ? null : Number(r.cargo_id);
    const linhaId = cargoId === null ? null : vinculo.get(cargoId) ?? null;
    const linha = linhaId ? porId.get(linhaId) ?? null : null;
    if (cargoId === null) semCargo += 1;
    else {
      const u = usos.get(cargoId) ?? {
        solidesCargoId: cargoId,
        nome: r.cargo_nome ?? `Cargo ${cargoId}`,
        colaboradores: 0,
        linhaId: linha ? linha.id : null,
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
      cargoSolides: r.cargo_nome,
      linhaRotulo: linha ? rotuloLinha(linha) : null,
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
