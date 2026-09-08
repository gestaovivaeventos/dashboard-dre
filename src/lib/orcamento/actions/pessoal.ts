"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import {
  isMovTipo,
  isVinculo,
  movTemCargo,
  type MovTipo,
  type VinculoKey,
} from "@/lib/orcamento/vinculos";
import { BENEFICIOS, type BeneficioKey, type Beneficios } from "@/lib/orcamento/beneficios";
import {
  isRegimeApuracao,
  REGIME_APURACAO_PADRAO,
  toRegimeApuracao,
  type RegimeApuracao,
} from "@/lib/orcamento/regime-apuracao";
import { SETOR_TODOS, isTodosSetores, setorEspecifico } from "@/lib/orcamento/setor-filtro";
import { getEncargos, getEncargosPorEmpresa } from "@/lib/orcamento/actions/encargos";
import type { EncargoValues } from "@/lib/orcamento/encargos";
import { calcularPrevia, type PreviaResultado } from "@/lib/orcamento/pessoal-calc";

const PATH = "/orcamento/despesas/pessoal";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface Movimentacao {
  tipo: MovTipo;
  data: string | null; // ISO "YYYY-MM-01"
  cargo: string | null;
  salario: number | null;
}

export interface Colaborador {
  id: string;
  setorId: string | null;
  /** Empresa em que ele é registrado — define o REGIME dos encargos dele.
   * null = a própria empresa do quadro. Não muda o destino do valor. */
  empresaEncargosId: string | null;
  nome: string | null;
  vinculo: VinculoKey;
  cargoAtual: string | null;
  salarioAtual: number | null;
  mov1: Movimentacao | null;
  mov2: Movimentacao | null;
  justificativa: string | null;
  beneficios: Beneficios;
}

export interface ColaboradorInput {
  setorId: string | null;
  empresaEncargosId: string | null;
  nome: string | null;
  vinculo: VinculoKey;
  cargoAtual: string | null;
  salarioAtual: number | null;
  mov1: Movimentacao | null;
  mov2: Movimentacao | null;
  justificativa: string | null;
}

/** Opção de cargo do Plano de Cargos (cargo + nível), com o salário-base.
 * `setorId` é o setor do cargo (null = plano sem setor) — usado para filtrar as
 * opções pelo setor selecionado na tela. */
export interface CargoOption {
  label: string;
  salario: number;
  setorId: string | null;
}

export interface SetorOption {
  id: string;
  name: string;
}

export interface PessoalSetup {
  orcarPorSetor: boolean;
  /** Caixa x competência — distribui o 13º na prévia do orçamento. */
  regimeApuracao: RegimeApuracao;
  setores: SetorOption[];
  cargoOptions: CargoOption[];
  /** Benefícios com linha própria na prévia (os demais somam em "Benefícios"). */
  beneficiosSeparados: BeneficioKey[];
  /** Empresas do grupo, para a coluna "Empresa" do quadro (regime dos encargos). */
  empresas: EmpresaEncargosOption[];
  /** A coluna "Empresa" está habilitada nesta empresa/ano? */
  usarEmpresaEncargos: boolean;
}

export interface EmpresaEncargosOption {
  id: string;
  name: string;
  regimeTributario: string | null;
}

/** Lê as exceções de agrupamento de benefícios da empresa/ano. Sem linha na
 * tabela = agrupado, então só as exceções ficam gravadas. */
async function lerBeneficiosSeparados(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  year: number,
): Promise<BeneficioKey[]> {
  const { data, error } = await supabase
    .from("orcamento_beneficios_config")
    .select("beneficio, agrupar")
    .eq("company_id", companyId)
    .eq("year", year);
  // Sem a migration aplicada, tudo agrupado — o comportamento anterior.
  if (error) return [];
  return (data ?? [])
    .filter((r) => r.agrupar === false)
    .map((r) => r.beneficio as BeneficioKey)
    .filter((key) => BENEFICIOS.some((b) => b.key === key));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function db() {
  return createAdminClientIfAvailable();
}

function readMov(
  tipo: unknown,
  data: unknown,
  cargo: unknown,
  salario: unknown,
): Movimentacao | null {
  if (!isMovTipo(tipo)) return null;
  return {
    tipo,
    data: (data as string) ?? null,
    cargo: (cargo as string) ?? null,
    salario: salario == null ? null : Number(salario),
  };
}

/** Normaliza uma movimentação vinda do cliente antes de gravar. Desligamento
 * não carrega cargo/salário. */
function cleanMov(mov: Movimentacao | null): {
  tipo: MovTipo | null;
  data: string | null;
  cargo: string | null;
  salario: number | null;
} {
  if (!mov || !isMovTipo(mov.tipo)) {
    return { tipo: null, data: null, cargo: null, salario: null };
  }
  if (!movTemCargo(mov.tipo)) {
    return { tipo: mov.tipo, data: mov.data ?? null, cargo: null, salario: null };
  }
  return {
    tipo: mov.tipo,
    data: mov.data ?? null,
    cargo: mov.cargo?.trim() || null,
    salario: mov.salario ?? null,
  };
}

function validateInput(input: ColaboradorInput): string | null {
  if (!isVinculo(input.vinculo)) return "Selecione um vínculo válido.";
  const salaries = [
    input.salarioAtual,
    input.mov1?.salario ?? null,
    input.mov2?.salario ?? null,
  ];
  for (const s of salaries) {
    if (s != null && (!Number.isFinite(s) || s < 0)) return "Salário inválido.";
  }
  return null;
}

// ─── Setup (config + setores + opções de cargo) ─────────────────────────────────

export async function getPessoalSetup(companyId: string, year: number): Promise<{
  setup?: PessoalSetup;
  error?: string;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) {
    return {
      setup: {
        orcarPorSetor: false,
        regimeApuracao: REGIME_APURACAO_PADRAO,
        setores: [],
        cargoOptions: [],
        beneficiosSeparados: [],
        empresas: [],
        usarEmpresaEncargos: false,
      },
    };
  }
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());

  // Config do ano: orça por setor? regime de apuração?
  const { data: cfg } = await supabase
    .from("orcamento_company_config")
    .select("orcar_por_setor, regime_apuracao, usar_empresa_encargos")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  const orcarPorSetor = Boolean(cfg?.orcar_por_setor);
  const regimeApuracao = toRegimeApuracao(cfg?.regime_apuracao);
  const usarEmpresaEncargos = Boolean(cfg?.usar_empresa_encargos);

  // Setores ativos do ano.
  const { data: setoresData, error: setErr } = await supabase
    .from("orcamento_setores")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("active", true)
    .order("name");
  if (setErr) return { error: setErr.message };
  const setores: SetorOption[] = (setoresData ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
  }));

  // Opções de cargo (cargo ativo × nível) → salário-base, com o setor do cargo.
  const { data: cargos, error: cargosErr } = await supabase
    .from("orcamento_cargos")
    .select("id, name, setor_id")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("active", true)
    .order("name");
  if (cargosErr) return { error: cargosErr.message };

  const cargoOptions: CargoOption[] = [];
  const cargoIds = (cargos ?? []).map((c) => c.id as string);
  if (cargoIds.length > 0) {
    const { data: niveis, error: nivErr } = await supabase
      .from("orcamento_cargo_niveis")
      .select("cargo_id, name, salario")
      .in("cargo_id", cargoIds);
    if (nivErr) return { error: nivErr.message };
    const cargoById = new Map(
      (cargos ?? []).map((c) => [
        c.id as string,
        { name: c.name as string, setorId: (c.setor_id as string) ?? null },
      ]),
    );
    for (const n of niveis ?? []) {
      const cargo = cargoById.get(n.cargo_id as string);
      if (!cargo) continue;
      cargoOptions.push({
        label: `${cargo.name} — ${n.name as string}`,
        salario: Number(n.salario),
        setorId: cargo.setorId,
      });
    }
    cargoOptions.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }

  const beneficiosSeparados = await lerBeneficiosSeparados(supabase, companyId, year);

  const { data: empresasData } = await supabase
    .from("companies")
    .select("id, name, regime_tributario")
    .eq("active", true)
    .order("name");
  const empresas: EmpresaEncargosOption[] = (empresasData ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    regimeTributario: (c.regime_tributario as string | null) ?? null,
  }));

  return {
    setup: {
      orcarPorSetor,
      regimeApuracao,
      setores,
      cargoOptions,
      beneficiosSeparados,
      empresas,
      usarEmpresaEncargos,
    },
  };
}

/** Liga/desliga o agrupamento de um benefício na linha "Benefícios" da prévia.
 * `agrupar = false` faz o benefício virar linha própria (e rótulo próprio no
 * envio ao Budget e Forecast). */
export async function setBeneficioAgrupar(
  companyId: string,
  year: number,
  beneficio: BeneficioKey,
  agrupar: boolean,
) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (!BENEFICIOS.some((b) => b.key === beneficio)) return { error: "Benefício inválido." };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase.from("orcamento_beneficios_config").upsert(
    { company_id: companyId, year, beneficio, agrupar, updated_by: admin.userId },
    { onConflict: "company_id,year,beneficio" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true as const };
}

/** Define o regime de apuração (caixa x competência) da empresa NAQUELE ANO.
 * O upsert só toca esta coluna — as demais premissas da linha ficam intactas. */
export async function setRegimeApuracao(
  companyId: string,
  year: number,
  regime: RegimeApuracao,
) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (!isRegimeApuracao(regime)) return { error: "Regime de apuração inválido." };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase.from("orcamento_company_config").upsert(
    {
      company_id: companyId,
      year,
      regime_apuracao: regime,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true as const };
}

// ─── Quadro de colaboradores ────────────────────────────────────────────────────

// Precisa ser um literal (o supabase-js infere o tipo da linha a partir dele).
// A cauda são as colunas de benefício: ao acrescentar um item em BENEFICIOS,
// acrescente a coluna aqui também, senão o valor é gravado mas nunca lido.
const COLAB_COLS =
  "id, setor_id, empresa_encargos_id, nome, vinculo, cargo_atual, salario_atual, mov1_tipo, mov1_data, mov1_cargo, mov1_salario, mov2_tipo, mov2_data, mov2_cargo, mov2_salario, justificativa, vale_transporte, beneficio_gasolina, beneficio_alimentacao, refeicoes_empresa, assistencia_medica, auxilio_home_office, seguro_vida";

/** Lê os valores de benefício de uma linha crua. */
function readBeneficios(r: Record<string, unknown>): Beneficios {
  const b = {} as Beneficios;
  for (const meta of BENEFICIOS) {
    const v = r[meta.key];
    b[meta.key] = v == null ? null : Number(v);
  }
  return b;
}

/** Lista os colaboradores de uma empresa/ano/setor. `setorId` null = quadro único
 * (empresa que não orça por setor); SETOR_TODOS = consolidado da empresa. */
export async function getColaboradores(
  companyId: string,
  year: number,
  setorId: string | null,
): Promise<{ items?: Colaborador[]; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { items: [] };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  let query = supabase
    .from("orcamento_pessoal_colaboradores")
    .select(COLAB_COLS)
    .eq("company_id", companyId)
    .eq("year", year);
  if (!isTodosSetores(setorId)) {
    query = setorId ? query.eq("setor_id", setorId) : query.is("setor_id", null);
  }

  const { data, error } = await query
    .order("nome", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  const items: Colaborador[] = (data ?? []).map((r) => ({
    id: r.id as string,
    setorId: (r.setor_id as string) ?? null,
    empresaEncargosId: (r.empresa_encargos_id as string) ?? null,
    nome: (r.nome as string) ?? null,
    vinculo: r.vinculo as VinculoKey,
    cargoAtual: (r.cargo_atual as string) ?? null,
    salarioAtual: r.salario_atual == null ? null : Number(r.salario_atual),
    mov1: readMov(r.mov1_tipo, r.mov1_data, r.mov1_cargo, r.mov1_salario),
    mov2: readMov(r.mov2_tipo, r.mov2_data, r.mov2_cargo, r.mov2_salario),
    justificativa: (r.justificativa as string) ?? null,
    beneficios: readBeneficios(r as Record<string, unknown>),
  }));
  return { items };
}

function toRow(input: ColaboradorInput, adminId: string) {
  const m1 = cleanMov(input.mov1);
  const m2 = cleanMov(input.mov2);
  return {
    setor_id: input.setorId ?? null,
    empresa_encargos_id: input.empresaEncargosId ?? null,
    nome: input.nome?.trim() || null,
    vinculo: input.vinculo,
    cargo_atual: input.cargoAtual?.trim() || null,
    salario_atual: input.salarioAtual,
    mov1_tipo: m1.tipo,
    mov1_data: m1.data,
    mov1_cargo: m1.cargo,
    mov1_salario: m1.salario,
    mov2_tipo: m2.tipo,
    mov2_data: m2.data,
    mov2_cargo: m2.cargo,
    mov2_salario: m2.salario,
    justificativa: input.justificativa?.trim() || null,
    updated_by: adminId,
  };
}

export async function createColaborador(
  companyId: string,
  year: number,
  input: ColaboradorInput,
) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  const err = validateInput(input);
  if (err) return { error: err };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase.from("orcamento_pessoal_colaboradores").insert({
    company_id: companyId,
    year,
    ...toRow(input, admin.userId),
  });
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true as const };
}

export async function updateColaborador(id: string, input: ColaboradorInput) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!id) return { error: "Colaborador inválido." };
  const err = validateInput(input);
  if (err) return { error: err };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_pessoal_colaboradores")
    .update(toRow(input, admin.userId))
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true as const };
}

/** Atualiza só os benefícios (parte verde) de um colaborador. Não toca nos
 * campos do quadro (parte azul). */
export async function updateColaboradorBeneficios(id: string, beneficios: Beneficios) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!id) return { error: "Colaborador inválido." };

  const row: Record<string, number | null> = {};
  for (const meta of BENEFICIOS) {
    const v = beneficios[meta.key];
    if (v != null && (!Number.isFinite(v) || v < 0)) return { error: "Valor de benefício inválido." };
    row[meta.key] = v ?? null;
  }

  const supabase = db() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_pessoal_colaboradores")
    .update({ ...row, updated_by: admin.userId })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true as const };
}

// ─── Prévia mensal ──────────────────────────────────────────────────────────

/** Item do seletor de colaborador da aba de detalhe. */
export interface ColaboradorResumo {
  id: string;
  nome: string | null;
  vinculo: VinculoKey;
  cargoAtual: string | null;
}

/** Contribuição de UM colaborador para cada linha da prévia — o 2º nível do
 * drilldown da Prévia do Orçamento. */
export interface PreviaColaboradorDetalhe {
  id: string;
  nome: string | null;
  vinculo: VinculoKey;
  /** Setor do colaborador — rotula o drilldown na visão consolidada. */
  setorId: string | null;
  linhas: { key: string; label: string; meses: number[]; totalAno: number }[];
}

export interface PreviaPayload {
  previa: PreviaResultado;
  regimeApuracao: RegimeApuracao;
  encargos: EncargoValues;
  /** Total de colaboradores no quadro da empresa (todos os setores). */
  totalColaboradores: number;
  /**
   * Abertura por colaborador (só quando `detalharColaboradores`). A soma bate
   * exatamente com `previa`: o motor é linear em cada linha, então rodar por
   * pessoa e somar dá o mesmo que rodar com todo mundo junto.
   */
  porColaborador?: PreviaColaboradorDetalhe[];
  /** Quadro inteiro da empresa, para o seletor da aba Colaborador. */
  roster: ColaboradorResumo[];
}

export interface PreviaFiltro {
  /** Restringe a uma pessoa (aba Colaborador). */
  colaboradorId?: string | null;
  /** Setor da tela: null = quadro único, SETOR_TODOS = consolidado da empresa. */
  setorId?: string | null;
  /** Devolve também a abertura por colaborador (custo só de CPU: o motor é
   * puro e roda sobre os mesmos dados já carregados). */
  detalharColaboradores?: boolean;
}

/**
 * Prévia mensal do orçamento de pessoal. Por padrão soma a empresa inteira —
 * é o número que vai para a DRE —, mas respeita o filtro de setor da tela. O
 * cálculo em si vive em pessoal-calc.ts (função pura); aqui só se busca o
 * insumo.
 *
 * O roster devolvido segue o mesmo filtro de setor, para o seletor da aba
 * Colaborador listar só quem está no setor escolhido.
 */
export async function getPrevia(
  companyId: string,
  year: number,
  filtro?: PreviaFiltro,
): Promise<{ payload?: PreviaPayload; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());

  const { data: cfg } = await supabase
    .from("orcamento_company_config")
    .select("regime_apuracao, usar_empresa_encargos")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  const regimeApuracao = toRegimeApuracao(cfg?.regime_apuracao);
  const usarEmpresaEncargos = Boolean(cfg?.usar_empresa_encargos);

  let query = supabase
    .from("orcamento_pessoal_colaboradores")
    .select(COLAB_COLS)
    .eq("company_id", companyId)
    .eq("year", year);
  // Mesma semântica de getColaboradores: null = quadro único, TODOS = empresa.
  // SEM filtro (ou setorId ausente) = empresa inteira: `null` só vale como
  // "quadro único" quando vem EXPLÍCITO da tela, senão quem chama sem filtro
  // receberia apenas os colaboradores sem setor.
  const setorFiltro = filtro?.setorId === undefined ? SETOR_TODOS : filtro.setorId;
  if (!isTodosSetores(setorFiltro)) {
    const especifico = setorEspecifico(setorFiltro);
    query = especifico ? query.eq("setor_id", especifico) : query.is("setor_id", null);
  }

  const { data, error } = await query.order("nome", { ascending: true, nullsFirst: false });
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  const colaboradores: Colaborador[] = (data ?? []).map((r) => ({
    id: r.id as string,
    setorId: (r.setor_id as string) ?? null,
    empresaEncargosId: (r.empresa_encargos_id as string) ?? null,
    nome: (r.nome as string) ?? null,
    vinculo: r.vinculo as VinculoKey,
    cargoAtual: (r.cargo_atual as string) ?? null,
    salarioAtual: r.salario_atual == null ? null : Number(r.salario_atual),
    mov1: readMov(r.mov1_tipo, r.mov1_data, r.mov1_cargo, r.mov1_salario),
    mov2: readMov(r.mov2_tipo, r.mov2_data, r.mov2_cargo, r.mov2_salario),
    justificativa: (r.justificativa as string) ?? null,
    beneficios: readBeneficios(r as Record<string, unknown>),
  }));

  const enc = await getEncargos(companyId, year);
  if (enc.needsMigration) return { needsMigration: true };
  if (enc.error || !enc.values) return { error: enc.error ?? "Falha ao ler os encargos." };

  const beneficiosSeparados = await lerBeneficiosSeparados(supabase, companyId, year);

  // Colaborador registrado em outra empresa usa as alíquotas DELA. Uma consulta
  // em lote resolve todas as empresas citadas no quadro. Com a coluna desligada
  // na configuração, o que estiver gravado é IGNORADO e todo o quadro usa o
  // regime da empresa orçada — nada de regra invisível mexendo no orçamento.
  const outrasEmpresas = usarEmpresaEncargos
    ? Array.from(
        new Set(
          colaboradores
            .map((c) => c.empresaEncargosId)
            .filter((id): id is string => Boolean(id) && id !== companyId),
        ),
      )
    : [];
  let encargosPorEmpresa: Record<string, EncargoValues> = {};
  if (outrasEmpresas.length > 0) {
    const res = await getEncargosPorEmpresa(outrasEmpresas, year);
    encargosPorEmpresa = res.values ?? {};
  }

  const roster: ColaboradorResumo[] = colaboradores.map((c) => ({
    id: c.id,
    nome: c.nome,
    vinculo: c.vinculo,
    cargoAtual: c.cargoAtual,
  }));

  const alvo = filtro?.colaboradorId
    ? colaboradores.filter((c) => c.id === filtro.colaboradorId)
    : colaboradores;

  // Abertura por colaborador: roda o MESMO motor uma vez por pessoa. Como
  // cada linha é linear no colaborador (inclusive férias/13º, que usam a média
  // corrida de cada um, e a defasagem do caixa), a soma das partes reproduz o
  // agregado exatamente — é o que permite o drilldown fechar com o total.
  const porColaborador: PreviaColaboradorDetalhe[] | undefined = filtro?.detalharColaboradores
    ? alvo.map((c) => {
        const individual = calcularPrevia({
          colaboradores: [c],
          encargos: enc.values!,
          regimeApuracao,
          beneficiosSeparados,
          encargosPorEmpresa,
        });
        return {
          id: c.id,
          nome: c.nome,
          vinculo: c.vinculo,
          setorId: c.setorId,
          linhas: individual.linhas
            .filter((l) => l.total !== 0)
            .map((l) => ({ key: l.key, label: l.label, meses: l.meses, totalAno: l.total })),
        };
      })
    : undefined;

  return {
    payload: {
      previa: calcularPrevia({
        colaboradores: alvo,
        encargos: enc.values,
        regimeApuracao,
        beneficiosSeparados,
        encargosPorEmpresa,
      }),
      regimeApuracao,
      encargos: enc.values,
      totalColaboradores: colaboradores.length,
      porColaborador,
      roster,
    },
  };
}

export async function deleteColaborador(id: string) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_pessoal_colaboradores")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true as const };
}
