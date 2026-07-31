import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { normalizarTexto, parsePlanoCargos } from "@/lib/orcamento/plano-cargos-xlsx";

export const dynamic = "force-dynamic";

/**
 * Importa o Plano de Cargos e Salários de uma planilha
 * (Empresa | Setor | Cargo | Nível | Salário base) para o ano informado.
 *
 * A planilha carrega a empresa em cada linha, então um upload só atende todas
 * as empresas e setores de uma vez.
 *
 * Semântica: ADITIVA e idempotente. Cargo/nível que já existem são reaproveitados
 * (o salário é atualizado); cargos que existem no banco e não estão na planilha
 * NÃO são apagados — quem sai do plano deve ser inativado na tela.
 */
export async function POST(request: Request) {
  const admin = await getOrcamentoAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const year = Number(form.get("year"));
  // Setor da planilha que ainda não existe no ano: criar ou reportar.
  const criarSetores = String(form.get("criarSetores") ?? "true") === "true";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie a planilha (.xlsx)." }, { status: 400 });
  }
  if (!isValidBudgetYear(year)) {
    return NextResponse.json({ error: "Ano do orçamento inválido." }, { status: 400 });
  }

  let matriz: unknown[][];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return NextResponse.json({ error: "A planilha está vazia." }, { status: 400 });
    }
    matriz = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: true,
      defval: null,
    });
  } catch {
    return NextResponse.json(
      { error: "Não consegui ler o arquivo. Envie um .xlsx válido." },
      { status: 400 },
    );
  }

  const lido = parsePlanoCargos(matriz);
  if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });
  const { rows, problemas } = lido.parse;
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma linha válida na planilha.", problemas },
      { status: 400 },
    );
  }

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  // ─── Empresas: resolve pelo nome normalizado ──────────────────────────────
  const { data: companies, error: compErr } = await supabase
    .from("companies")
    .select("id, name")
    .eq("active", true);
  if (compErr) return NextResponse.json({ error: compErr.message }, { status: 400 });

  const companyIdByName = new Map<string, string>();
  for (const c of companies ?? []) {
    const chave = normalizarTexto(c.name);
    if (!companyIdByName.has(chave)) companyIdByName.set(chave, c.id as string);
  }

  const naoEncontradas = new Set<string>();
  const linhasPorEmpresa = new Map<string, typeof rows>();
  for (const row of rows) {
    const companyId = companyIdByName.get(normalizarTexto(row.empresa));
    if (!companyId) {
      naoEncontradas.add(row.empresa);
      continue;
    }
    const lista = linhasPorEmpresa.get(companyId) ?? [];
    lista.push(row);
    linhasPorEmpresa.set(companyId, lista);
  }
  for (const nome of Array.from(naoEncontradas)) {
    problemas.push(`Empresa "${nome}" não existe no cadastro (ou está inativa) — linhas ignoradas.`);
  }
  const companyIds = Array.from(linhasPorEmpresa.keys());
  if (companyIds.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma empresa da planilha foi encontrada no cadastro.", problemas },
      { status: 400 },
    );
  }

  // ─── Config do ano: quais empresas orçam por setor ────────────────────────
  const { data: configs, error: cfgErr } = await supabase
    .from("orcamento_company_config")
    .select("company_id, orcar_por_setor")
    .eq("year", year)
    .in("company_id", companyIds);
  if (cfgErr) return NextResponse.json({ error: cfgErr.message }, { status: 400 });
  const porSetor = new Set(
    (configs ?? []).filter((c) => c.orcar_por_setor).map((c) => c.company_id as string),
  );

  // ─── Setores do ano ───────────────────────────────────────────────────────
  const { data: setoresData, error: setErr } = await supabase
    .from("orcamento_setores")
    .select("id, company_id, name")
    .eq("year", year)
    .in("company_id", companyIds);
  if (setErr) return NextResponse.json({ error: setErr.message }, { status: 400 });

  const chaveSetor = (companyId: string, nome: string) => `${companyId}::${normalizarTexto(nome)}`;
  const setorIdByKey = new Map<string, string>();
  for (const s of setoresData ?? []) {
    setorIdByKey.set(chaveSetor(s.company_id as string, s.name as string), s.id as string);
  }

  // Setores citados na planilha que ainda não existem (só para quem orça por setor).
  const setoresNovos = new Map<string, { company_id: string; name: string }>();
  for (const [companyId, lista] of Array.from(linhasPorEmpresa)) {
    if (!porSetor.has(companyId)) continue;
    for (const row of lista) {
      if (!row.setor) continue;
      const chave = chaveSetor(companyId, row.setor);
      if (setorIdByKey.has(chave) || setoresNovos.has(chave)) continue;
      setoresNovos.set(chave, { company_id: companyId, name: row.setor.trim() });
    }
  }

  const setoresCriados: string[] = [];
  if (criarSetores && setoresNovos.size > 0) {
    const { data: inseridos, error: insSetErr } = await supabase
      .from("orcamento_setores")
      .insert(
        Array.from(setoresNovos.values()).map((s) => ({
          company_id: s.company_id,
          year,
          name: s.name,
          updated_by: admin.userId,
        })),
      )
      .select("id, company_id, name");
    if (insSetErr) return NextResponse.json({ error: insSetErr.message }, { status: 400 });
    for (const s of inseridos ?? []) {
      setorIdByKey.set(chaveSetor(s.company_id as string, s.name as string), s.id as string);
      setoresCriados.push(s.name as string);
    }
  }

  // ─── Resolve o setor de cada linha ────────────────────────────────────────
  interface LinhaResolvida {
    companyId: string;
    setorId: string | null;
    cargo: string;
    nivel: string;
    salario: number;
  }
  const resolvidas: LinhaResolvida[] = [];
  const setoresFaltando = new Set<string>();

  for (const [companyId, lista] of Array.from(linhasPorEmpresa)) {
    const empresaPorSetor = porSetor.has(companyId);
    for (const row of lista) {
      let setorId: string | null = null;
      if (empresaPorSetor) {
        if (!row.setor) {
          problemas.push(
            `Linha ${row.linha}: "${row.empresa}" orça por setor em ${year}, mas a linha está sem setor.`,
          );
          continue;
        }
        const encontrado = setorIdByKey.get(chaveSetor(companyId, row.setor));
        if (!encontrado) {
          setoresFaltando.add(`${row.empresa} → ${row.setor}`);
          continue;
        }
        setorId = encontrado;
      }
      resolvidas.push({
        companyId,
        setorId,
        cargo: row.cargo,
        nivel: row.nivel,
        salario: row.salario,
      });
    }
  }
  for (const item of Array.from(setoresFaltando)) {
    problemas.push(`Setor não cadastrado em ${year}: ${item} — linhas ignoradas.`);
  }
  if (resolvidas.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma linha pôde ser aplicada.", problemas },
      { status: 400 },
    );
  }

  // ─── Cargos: reaproveita os existentes, cria os que faltam ────────────────
  const { data: cargosData, error: cargosErr } = await supabase
    .from("orcamento_cargos")
    .select("id, company_id, setor_id, name, active")
    .eq("year", year)
    .in("company_id", companyIds);
  if (cargosErr) return NextResponse.json({ error: cargosErr.message }, { status: 400 });

  const chaveCargo = (companyId: string, setorId: string | null, nome: string) =>
    `${companyId}::${setorId ?? "-"}::${normalizarTexto(nome)}`;
  const cargoIdByKey = new Map<string, string>();
  const inativos = new Map<string, string>(); // chave → id, para reativar
  for (const c of cargosData ?? []) {
    const chave = chaveCargo(
      c.company_id as string,
      (c.setor_id as string) ?? null,
      c.name as string,
    );
    cargoIdByKey.set(chave, c.id as string);
    if (!c.active) inativos.set(chave, c.id as string);
  }

  const cargosNovos = new Map<
    string,
    { company_id: string; setor_id: string | null; name: string }
  >();
  for (const linha of resolvidas) {
    const chave = chaveCargo(linha.companyId, linha.setorId, linha.cargo);
    if (cargoIdByKey.has(chave) || cargosNovos.has(chave)) continue;
    cargosNovos.set(chave, {
      company_id: linha.companyId,
      setor_id: linha.setorId,
      name: linha.cargo.trim(),
    });
  }

  if (cargosNovos.size > 0) {
    const { data: inseridos, error: insCargoErr } = await supabase
      .from("orcamento_cargos")
      .insert(
        Array.from(cargosNovos.values()).map((c) => ({
          company_id: c.company_id,
          year,
          setor_id: c.setor_id,
          name: c.name,
          updated_by: admin.userId,
        })),
      )
      .select("id, company_id, setor_id, name");
    if (insCargoErr) return NextResponse.json({ error: insCargoErr.message }, { status: 400 });
    for (const c of inseridos ?? []) {
      cargoIdByKey.set(
        chaveCargo(c.company_id as string, (c.setor_id as string) ?? null, c.name as string),
        c.id as string,
      );
    }
  }

  // Cargo inativo que voltou a aparecer na planilha volta ao plano.
  const reativar = Array.from(
    new Set(
      resolvidas
        .map((l) => inativos.get(chaveCargo(l.companyId, l.setorId, l.cargo)))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (reativar.length > 0) {
    const { error: reErr } = await supabase
      .from("orcamento_cargos")
      .update({ active: true, updated_by: admin.userId })
      .in("id", reativar);
    if (reErr) return NextResponse.json({ error: reErr.message }, { status: 400 });
  }

  // ─── Níveis: cria os novos, atualiza o salário dos existentes ─────────────
  const cargoIds = Array.from(new Set(Array.from(cargoIdByKey.values())));
  const { data: niveisData, error: nivErr } = await supabase
    .from("orcamento_cargo_niveis")
    .select("id, cargo_id, name, salario")
    .in("cargo_id", cargoIds);
  if (nivErr) return NextResponse.json({ error: nivErr.message }, { status: 400 });

  const chaveNivel = (cargoId: string, nome: string) => `${cargoId}::${normalizarTexto(nome)}`;
  const nivelByKey = new Map<string, { id: string; salario: number }>();
  for (const n of niveisData ?? []) {
    nivelByKey.set(chaveNivel(n.cargo_id as string, n.name as string), {
      id: n.id as string,
      salario: Number(n.salario),
    });
  }

  const novosNiveis = new Map<string, { cargo_id: string; name: string; salario: number }>();
  const atualizar: { id: string; salario: number }[] = [];
  let inalterados = 0;

  for (const linha of resolvidas) {
    const cargoId = cargoIdByKey.get(chaveCargo(linha.companyId, linha.setorId, linha.cargo));
    if (!cargoId) continue;
    const chave = chaveNivel(cargoId, linha.nivel);
    const existente = nivelByKey.get(chave);

    if (existente) {
      if (Math.abs(existente.salario - linha.salario) < 0.005) inalterados += 1;
      else atualizar.push({ id: existente.id, salario: linha.salario });
      continue;
    }
    // A última linha repetida do mesmo nível prevalece.
    novosNiveis.set(chave, {
      cargo_id: cargoId,
      name: linha.nivel.trim(),
      salario: linha.salario,
    });
  }

  if (novosNiveis.size > 0) {
    const { error: insNivErr } = await supabase.from("orcamento_cargo_niveis").insert(
      Array.from(novosNiveis.values()).map((n) => ({ ...n, updated_by: admin.userId })),
    );
    if (insNivErr) return NextResponse.json({ error: insNivErr.message }, { status: 400 });
  }

  // Salários mudam um a um: são poucos por importação e cada um tem id próprio.
  for (const item of atualizar) {
    const { error } = await supabase
      .from("orcamento_cargo_niveis")
      .update({ salario: item.salario, updated_by: admin.userId })
      .eq("id", item.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    ano: year,
    linhasLidas: rows.length,
    linhasAplicadas: resolvidas.length,
    empresasAfetadas: companyIds.length,
    setoresCriados,
    setoresFaltando: Array.from(setoresFaltando),
    cargosCriados: cargosNovos.size,
    cargosReativados: reativar.length,
    niveisCriados: novosNiveis.size,
    niveisAtualizados: atualizar.length,
    niveisInalterados: inalterados,
    problemas,
  });
}
