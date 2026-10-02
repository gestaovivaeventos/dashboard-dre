import "server-only";

import { enquadrar, sugerirNivel, type DpEnquadramento, type DpEstruturaCargo } from "@/lib/dp/cargos";
import { indexarRegras, resolverEmpresa } from "@/lib/dp/empresa";
import { DpNaoInstaladoError, listDpRegras } from "@/lib/dp/queries";
import type { createAdminClient } from "@/lib/supabase/admin";

// Leituras da tela de cargos e salários. Admin client DEPOIS de getDpUser(),
// como o resto do módulo (ver @/lib/dp/queries).

type AdminClient = ReturnType<typeof createAdminClient>;

export interface DpCargoSolidesUso {
  solidesCargoId: number;
  nome: string;
  /** Ativos desta empresa com este cargo na Sólides. */
  colaboradores: number;
  nivelId: string | null;
  /** Sugestão por nome — só exibida, nunca gravada sem clique. */
  sugestaoNivelId: string | null;
}

export interface DpEnquadramentoRow {
  colaboradorId: string;
  nome: string;
  cargoSolides: string | null;
  nivelId: string | null;
  nivelRotulo: string | null;
  salario: number | null;
  salarioNivel: number | null;
  enquadramento: DpEnquadramento;
}

export interface DpCargosPagina {
  estrutura: DpEstruturaCargo[];
  cargosSolides: DpCargoSolidesUso[];
  enquadramento: DpEnquadramentoRow[];
  /** Ativos da empresa sem cargo na Sólides — não há o que vincular. */
  semCargo: number;
}

function ausente(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

export async function getDpEstrutura(db: AdminClient, companyId: string): Promise<DpEstruturaCargo[]> {
  const { data, error } = await db
    .from("dp_cargos")
    .select("id, nome, dp_cargo_niveis(id, nome, ordem, salario)")
    .eq("company_id", companyId)
    .eq("ativo", true)
    .order("nome");
  if (ausente(error)) throw new DpNaoInstaladoError();
  if (error) throw new Error(`dp_cargos: ${error.message}`);
  return (data ?? []).map((c) => ({
    cargoId: c.id as string,
    cargoNome: c.nome as string,
    niveis: ((c.dp_cargo_niveis ?? []) as Array<{ id: string; nome: string; ordem: number; salario: number | string }>)
      .slice()
      .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"))
      .map((n) => ({ id: n.id, nome: n.nome, salario: Number(n.salario) })),
  }));
}

export async function getDpCargosPagina(db: AdminClient, companyId: string): Promise<DpCargosPagina> {
  const [estrutura, regras, vinculosRes, colabsRes] = await Promise.all([
    getDpEstrutura(db, companyId),
    listDpRegras(db),
    db.from("dp_cargo_vinculos").select("solides_cargo_id, nivel_id").eq("company_id", companyId),
    db
      .from("dp_colaboradores")
      .select("id, nome, unidade_id, departamento_id, cargo_id, cargo_nome, salario")
      .eq("ativo", true)
      .order("nome"),
  ]);
  if (ausente(vinculosRes.error)) throw new DpNaoInstaladoError();
  if (vinculosRes.error) throw new Error(`dp_cargo_vinculos: ${vinculosRes.error.message}`);
  if (colabsRes.error) throw new Error(`dp_colaboradores: ${colabsRes.error.message}`);

  const idx = indexarRegras(regras);
  const vinculo = new Map((vinculosRes.data ?? []).map((v) => [Number(v.solides_cargo_id), v.nivel_id as string]));
  const nivelInfo = new Map<string, { rotulo: string; salario: number }>();
  for (const c of estrutura) for (const n of c.niveis) nivelInfo.set(n.id, { rotulo: `${c.cargoNome} — ${n.nome}`, salario: n.salario });

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
  let semCargo = 0;
  const enquadramento: DpEnquadramentoRow[] = daEmpresa.map((r) => {
    const cargoId = r.cargo_id === null ? null : Number(r.cargo_id);
    if (cargoId === null) semCargo += 1;
    else {
      const u = usos.get(cargoId) ?? {
        solidesCargoId: cargoId,
        nome: r.cargo_nome ?? `Cargo ${cargoId}`,
        colaboradores: 0,
        nivelId: vinculo.get(cargoId) ?? null,
        sugestaoNivelId: null,
      };
      u.colaboradores += 1;
      usos.set(cargoId, u);
    }
    // Vínculo para nível que saiu da estrutura (cargo inativado) não conta.
    const nivelId = cargoId === null ? null : vinculo.get(cargoId) ?? null;
    const info = nivelId ? nivelInfo.get(nivelId) ?? null : null;
    const salario = r.salario === null ? null : Number(r.salario);
    return {
      colaboradorId: r.id as string,
      nome: r.nome as string,
      cargoSolides: r.cargo_nome,
      nivelId: info ? nivelId : null,
      nivelRotulo: info?.rotulo ?? null,
      salario,
      salarioNivel: info?.salario ?? null,
      enquadramento: enquadrar({ temEmpresa: true, salario, salarioNivel: info?.salario ?? null }),
    };
  });

  const cargosSolides = Array.from(usos.values())
    .map((u) => ({ ...u, sugestaoNivelId: u.nivelId ? null : sugerirNivel(u.nome, estrutura) }))
    // Sem nível primeiro (é o que falta fazer), depois pelo tamanho.
    .sort(
      (a, b) =>
        Number(a.nivelId !== null) - Number(b.nivelId !== null) ||
        b.colaboradores - a.colaboradores ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );

  return { estrutura, cargosSolides, enquadramento, semCargo };
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
