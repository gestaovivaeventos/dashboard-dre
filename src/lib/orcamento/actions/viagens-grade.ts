"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import {
  SEM_ACESSO,
  SEM_ACESSO_SETOR,
  autorizarEscrita,
  autorizarLeitura,
  podeEscreverNoSetor,
  podeValidarOrcamento,
  setoresDeEscrita,
} from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { orcaPorSetor, setorParaGravar } from "@/lib/orcamento/setor-gravacao";
import { registrarAlteracao } from "@/lib/orcamento/actions/trilha";
import { travaDaValidacao } from "@/lib/orcamento/actions/validacao-diretoria";
import { estadoDaLinha, lerDecisoes } from "@/lib/orcamento/decisoes-linha";
import { lerFaixasParaCalculo } from "@/lib/orcamento/actions/viagens-faixas";
import { lerHistoricoParaCalculo } from "@/lib/orcamento/actions/viagens-historico";
import { referenciaDeHospedagem, referenciaDePassagem } from "@/lib/viagens/historico";
import { chaveNome } from "@/lib/viagens/plano";
import { getCategoriasOrcamento } from "@/lib/orcamento/actions/categoria-metodo";
import { categoriaDoTipo, tiposOferecidos, type TipoViagem } from "@/lib/viagens/tipos";
import { numDaLinha as num, textoDaLinha as texto } from "@/lib/viagens/colunas";
import { calcularViagem } from "@/lib/viagens/custo/motor";
import { PARAMETROS_PADRAO, parametrosDaLinha, retratoParaGravar, specDaViagem } from "@/lib/viagens/custo/mapear";
import {
  modalDaLinhaDaGrade,
  paradaRowDaLinha,
  resumirLote,
  validarLinhaViagem,
  viagemRowDaLinha,
  type LinhaViagemInput,
  type ResultadoLinha,
  type ResumoLote,
} from "@/lib/viagens/grade";

// =============================================================================
// A GRADE de viagens — entrada em lote (02/10/2026).
//
// ~50 viagens por ano, a destinos que quase não se repetem, não cabem em 50
// conversas. Aqui o gestor preenche uma linha por viagem e grava tudo de uma vez.
//
// ── Falha POR LINHA, nunca pelo lote ─────────────────────────────────────
// Destino errado na linha 30 não pode custar as 49 certas, e a linha recusada
// volta com o ÍNDICE para a tela apontar onde foi. É a mesma regra da importação
// do plano de cargos e dos grupos de despesa.
//
// ── O custo continua sendo do servidor ───────────────────────────────────
// Cada linha é recalculada pelo motor com as faixas vigentes, e o retrato é
// gravado. A tela nunca manda total — mesmo invariante da tela da viagem.
//
// ── As travas valem por linha ────────────────────────────────────────────
// Fatia finalizada e decisão da diretoria barram a linha, não o lote: o gestor
// salva as 48 que pode e lê o motivo das 2 que não.
// =============================================================================

const PATH = "/orcamento";

type Supa = Awaited<ReturnType<typeof createClient>>;

function db() {
  return createAdminClientIfAvailable();
}

const GRADE_COLS =
  "id, titulo, finalidade, origem, mes_ida, data_ida, pessoas, pessoas_por_quarto, tipo_id, faixa_passagem_id, faixa_hospedagem_id, translado_custo_trajeto, translado_trajetos, volta_modal, volta_distancia_km, volta_preco_pessoa, volta_preco_total, volta_pedagios, volta_veiculos, outros, custo_total, meses, grupos, premissas, parametros, status, category_code, setor_id, updated_at";

export interface GrupoDaLinha {
  grupo: string;
  label: string;
  total: number;
  linhas: Array<{ descricao: string; valor: number }>;
}

/** Uma linha da grade, como a tela a recebe. */
export interface LinhaGrade {
  id: string;
  destino: string;
  mesIda: number | null;
  noites: number;
  pessoas: number;
  pessoasPorQuarto: number;
  tipoId: string | null;
  tipoNome: string | null;
  faixaPassagemId: string | null;
  faixaHospedagemId: string | null;
  modal: string | null;
  distanciaKm: number | null;
  finalidade: string | null;
  custoTotal: number;
  /** A árvore que o diretor abre na linha. */
  grupos: GrupoDaLinha[];
  premissas: string[];
  status: "rascunho" | "enviada";
  /** Este destino tem histórico de viagem realizada — o custo dele é observado. */
  temHistorico: boolean;
  setorId: string | null;
  categoryCode: string;
  /** Validação da diretoria. */
  estado: string;
  comentario: string | null;
  travado: boolean;
  finalizado: boolean;
  atualizadoEm: string | null;
}

export interface GradeSetup {
  orcaPorSetor: boolean;
  setores: Array<{ id: string; name: string; podeEscrever: boolean }>;
  tipos: Array<{ id: string; nome: string }>;
  faixas: Array<{ id: string; tipo: "passagem" | "hospedagem"; nome: string; valor: number; modal: string | null }>;
  linhas: LinhaGrade[];
  /** Nome de cada categoria, para rotular as fatias do Finalizar. */
  categorias: Array<{ categoryCode: string; categoryName: string }>;
  /** Cidade de partida do time — vem da última viagem gravada, editável na tela. */
  origemPadrao: string;
  /** Custo de UM trajeto casa ↔ aeroporto. Da última viagem; editável na tela. */
  transladoPadrao: number | null;
  podeEditar: boolean;
  podeValidar: boolean;
  isAdmin: boolean;
  /** Nenhuma faixa com valor: toda linha sairia zerada, e a tela avisa. */
  semFaixas: boolean;
  error?: string;
  needsMigration?: boolean;
}

const VAZIO: GradeSetup = {
  orcaPorSetor: false,
  setores: [],
  tipos: [],
  faixas: [],
  linhas: [],
  categorias: [],
  origemPadrao: "",
  transladoPadrao: null,
  podeEditar: false,
  podeValidar: false,
  isAdmin: false,
  semFaixas: true,
};

function gruposDaLinhaJson(v: unknown): GrupoDaLinha[] {
  if (!Array.isArray(v)) return [];
  const out: GrupoDaLinha[] = [];
  for (const g of v) {
    if (!g || typeof g !== "object") continue;
    const o = g as Record<string, unknown>;
    const linhas = Array.isArray(o.linhas)
      ? (o.linhas as Array<Record<string, unknown>>)
          .map((l) => ({ descricao: texto(l.descricao), valor: num(l.valor) ?? 0 }))
          .filter((l) => l.descricao !== "")
      : [];
    out.push({
      grupo: texto(o.grupo),
      label: texto(o.label) || texto(o.grupo),
      total: num(o.total) ?? 0,
      linhas,
    });
  }
  return out;
}

function premissasJson(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

async function lerTipos(supabase: Supa, companyId: string, year: number): Promise<TipoViagem[]> {
  const { data, error } = await supabase
    .from("orcamento_viagem_tipos")
    .select("id, nome, category_code, ativo")
    .eq("company_id", companyId)
    .eq("year", year);
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    nome: texto(r.nome),
    categoryCode: texto(r.category_code) || null,
    ativo: r.ativo !== false,
  }));
}

/** Tudo o que a grade precisa para abrir: cadastros, linhas e permissões. */
export async function getGradeViagens(
  companyId: string,
  year: number,
  setorId?: string | null,
): Promise<GradeSetup> {
  if (!companyId) return VAZIO;
  if (!isValidBudgetYear(year)) return { ...VAZIO, error: "Ano do orçamento inválido." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { ...VAZIO, error: auth.error };
  // O `setorId` vem do CLIENTE: sem esta conferência um gerente listaria, pela
  // própria action, viagens de um setor que a tela não lhe oferece.
  if (auth.setores !== null && setorId && !auth.setores.includes(setorId)) {
    return { ...VAZIO, error: SEM_ACESSO };
  }

  const porSetor = await orcaPorSetor(supabase, companyId, year);
  const escrita = await setoresDeEscrita(supabase, auth.user, companyId, year);

  let setores: GradeSetup["setores"] = [];
  if (porSetor) {
    const { data } = await supabase
      .from("orcamento_setores")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("active", true)
      .order("name");
    const visiveis =
      auth.setores === null
        ? data ?? []
        : (data ?? []).filter((r) => auth.setores!.includes(r.id as string));
    setores = visiveis.map((r) => ({
      id: r.id as string,
      name: (r.name as string) ?? "",
      podeEscrever: escrita === null || escrita.includes(r.id as string),
    }));
  }

  const [tipos, cats] = await Promise.all([
    lerTipos(supabase, companyId, year),
    getCategoriasOrcamento(companyId, year),
  ]);

  const { data: faixaRows, error: faixaErr } = await supabase
    .from("orcamento_viagem_faixas")
    .select("id, tipo, nome, valor, modal, ativo, ordem")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("ativo", true)
    .order("tipo")
    .order("ordem");
  if (faixaErr && isSchemaMissing(faixaErr.message)) return { ...VAZIO, needsMigration: true };
  const faixas = ((faixaRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    tipo: (r.tipo === "hospedagem" ? "hospedagem" : "passagem") as "passagem" | "hospedagem",
    nome: texto(r.nome),
    valor: num(r.valor) ?? 0,
    modal: texto(r.modal) || null,
  }));

  let q = supabase
    .from("orcamento_viagens")
    .select(GRADE_COLS)
    .eq("company_id", companyId)
    .eq("year", year);
  if (setorId) q = q.eq("setor_id", setorId);
  else if (auth.setores !== null) {
    // Gerente sem setor atribuído vê a grade vazia, nunca a empresa inteira.
    q = q.in("setor_id", auth.setores);
  }
  const { data: viagemRows, error: viagemErr } = await q.order("mes_ida", {
    ascending: true,
    nullsFirst: false,
  });
  if (viagemErr) {
    if (isSchemaMissing(viagemErr.message)) return { ...VAZIO, needsMigration: true };
    return { ...VAZIO, error: viagemErr.message };
  }
  const rows = (viagemRows ?? []) as unknown as Array<Record<string, unknown>>;

  // Cidade e noites de cada viagem (a parada), numa consulta só.
  const ids = rows.map((r) => r.id as string);
  const paradas = new Map<string, { cidade: string; noites: number; km: number | null; modal: string }>();
  if (ids.length > 0) {
    const { data: pRows } = await supabase
      .from("orcamento_viagem_paradas")
      .select("viagem_id, ordem, cidade, noites, chegada_distancia_km, chegada_modal")
      .in("viagem_id", ids)
      .order("ordem");
    for (const p of (pRows ?? []) as Array<Record<string, unknown>>) {
      const vid = p.viagem_id as string;
      // Só a PRIMEIRA parada: a grade é de viagem simples. Multi-destino tem a
      // tela própria, e aqui aparece pela primeira cidade (a tela avisa).
      if (paradas.has(vid)) continue;
      paradas.set(vid, {
        cidade: texto(p.cidade),
        noites: num(p.noites) ?? 0,
        km: num(p.chegada_distancia_km),
        modal: texto(p.chegada_modal),
      });
    }
  }

  // O histórico é lido junto para a tela poder dizer, linha a linha, se o custo
  // daquele destino é OBSERVADO ou estimado por faixa. É a leitura que diz ao admin
  // quanto do orçamento está ancorado em fato.
  const historico = await lerHistoricoParaCalculo(supabase, companyId, year);

  const decisoes = await lerDecisoes(supabase, companyId, year, "viagem", ids);
  const nomeDoTipo = new Map(tipos.map((t) => [t.id, t.nome] as const));

  const { data: finRows } = await supabase
    .from("orcamento_finalizacoes")
    .select("category_code, setor_id")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("metodo", "viagens");
  const fechadas = new Set(
    ((finRows ?? []) as Array<Record<string, unknown>>).map(
      (r) => `${texto(r.category_code)}|${(r.setor_id as string | null) ?? "-"}`,
    ),
  );

  let origemPadrao = "";
  let transladoPadrao: number | null = null;

  const linhas: LinhaGrade[] = rows.map((r) => {
    const id = r.id as string;
    const p = paradas.get(id);
    const sId = (r.setor_id as string | null) ?? null;
    const linha = estadoDaLinha(decisoes.get(id), (r.updated_at as string | null) ?? null, auth.user.papel);
    if (!origemPadrao) origemPadrao = texto(r.origem);
    if (transladoPadrao == null) transladoPadrao = num(r.translado_custo_trajeto);
    return {
      id,
      destino: p?.cidade ?? texto(r.titulo),
      mesIda: num(r.mes_ida),
      noites: p?.noites ?? 0,
      pessoas: num(r.pessoas) ?? 1,
      pessoasPorQuarto: num(r.pessoas_por_quarto) ?? 2,
      tipoId: (r.tipo_id as string | null) ?? null,
      tipoNome: r.tipo_id ? nomeDoTipo.get(r.tipo_id as string) ?? null : null,
      faixaPassagemId: (r.faixa_passagem_id as string | null) ?? null,
      faixaHospedagemId: (r.faixa_hospedagem_id as string | null) ?? null,
      modal: p?.modal || null,
      distanciaKm: p?.km ?? null,
      finalidade: texto(r.finalidade) || null,
      custoTotal: num(r.custo_total) ?? 0,
      grupos: gruposDaLinhaJson(r.grupos),
      premissas: premissasJson(r.premissas),
      status: r.status === "enviada" ? "enviada" : "rascunho",
      temHistorico: historico ? historico.refs.has(chaveNome(p?.cidade ?? texto(r.titulo))) : false,
      setorId: sId,
      categoryCode: texto(r.category_code),
      estado: linha.estado,
      comentario: linha.comentario,
      travado: linha.travado,
      finalizado: fechadas.has(`${texto(r.category_code)}|${sId ?? "-"}`),
      atualizadoEm: (r.updated_at as string | null) ?? null,
    };
  });

  return {
    orcaPorSetor: porSetor,
    setores,
    tipos: tiposOferecidos(tipos).map((t) => ({ id: t.id, nome: t.nome })),
    categorias: (cats.items ?? []).map((c) => ({
      categoryCode: c.categoryCode,
      categoryName: c.categoryName,
    })),
    faixas,
    linhas,
    origemPadrao,
    transladoPadrao,
    podeEditar: escrita === null || escrita.length > 0,
    podeValidar: podeValidarOrcamento(auth.user),
    isAdmin: auth.user.isAdmin,
    semFaixas: faixas.every((f) => f.valor <= 0),
  };
}

export interface SalvarGradeResult {
  resultados: ResultadoLinha[];
  resumo: ResumoLote;
  error?: string;
  needsMigration?: boolean;
}

/**
 * Grava a grade inteira, linha a linha.
 *
 * Cada linha é criada ou atualizada, recebe UMA parada e é recalculada pelo motor
 * com as faixas vigentes. Nenhuma linha derruba as outras.
 */
export async function salvarGradeViagens(
  companyId: string,
  year: number,
  setorId: string | null,
  origem: string,
  transladoCustoTrajeto: number | null,
  linhas: LinhaViagemInput[],
): Promise<SalvarGradeResult> {
  const vazio = { resultados: [], resumo: resumirLote([]) };
  if (!isValidBudgetYear(year)) return { ...vazio, error: "Ano do orçamento inválido." };
  if (!Array.isArray(linhas) || linhas.length === 0) return vazio;

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { ...vazio, error: auth.error };

  const alvo = await setorParaGravar(supabase, companyId, year, setorId, auth.user.userId);
  if (!podeEscreverNoSetor(auth.setores, alvo.id)) return { ...vazio, error: SEM_ACESSO_SETOR };

  const [tipos, faixas, historico, paramRow] = await Promise.all([
    lerTipos(supabase, companyId, year),
    lerFaixasParaCalculo(supabase, companyId, year),
    lerHistoricoParaCalculo(supabase, companyId, year),
    supabase
      .from("orcamento_viagem_parametros")
      .select("*")
      .eq("company_id", companyId)
      .eq("year", year)
      .maybeSingle(),
  ]);
  const params = paramRow.data
    ? parametrosDaLinha(paramRow.data as Record<string, unknown>)
    : PARAMETROS_PADRAO;

  // As travas são lidas UMA vez e aplicadas por linha: 50 linhas fariam 100
  // consultas de trava, e a resposta é a mesma para todas as da mesma fatia.
  const { data: finRows } = await supabase
    .from("orcamento_finalizacoes")
    .select("category_code, setor_id")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("metodo", "viagens");
  const fechadas = new Set(
    ((finRows ?? []) as Array<Record<string, unknown>>).map(
      (r) => `${texto(r.category_code)}|${(r.setor_id as string | null) ?? "-"}`,
    ),
  );

  const resultados: ResultadoLinha[] = [];

  for (let i = 0; i < linhas.length; i += 1) {
    const l = linhas[i];
    const invalido = validarLinhaViagem(l);
    if (invalido) {
      resultados.push({ indice: i, erro: invalido });
      continue;
    }

    const categoryCode = categoriaDoTipo(tipos, l.tipoId);
    if (!categoryCode) {
      const nome = tipos.find((t) => t.id === l.tipoId)?.nome;
      resultados.push({
        indice: i,
        erro: `O tipo ${nome ? `"${nome}"` : "escolhido"} não tem categoria de despesa mapeada.`,
      });
      continue;
    }

    if (fechadas.has(`${categoryCode}|${alvo.id ?? "-"}`)) {
      resultados.push({
        indice: i,
        erro: "Esta categoria foi finalizada neste setor — reabra antes de editar.",
      });
      continue;
    }

    const faixaPassagem = l.faixaPassagemId ? faixas.get(l.faixaPassagemId) : undefined;
    const faixaHospedagem = l.faixaHospedagemId ? faixas.get(l.faixaHospedagemId) : undefined;
    const modal = modalDaLinhaDaGrade(l, faixaPassagem?.modal ?? null);

    // ── O HISTÓRICO do destino vence a faixa ──
    // A faixa é uma referência REGIONAL curada; o histórico é o que este time
    // pagou para ir NAQUELA cidade. Quando existe, ele é a melhor estimativa que o
    // sistema tem — e a premissa do motor diz de onde o número veio, com a
    // mediana, os meses observados e o reajuste. A faixa continua sendo a rede
    // para destino sem histórico.
    const refHistorico = historico ? historico.refs.get(chaveNome(l.destino)) : undefined;
    const passagemDoHistorico = historico
      ? referenciaDePassagem(refHistorico, historico.anoBase, historico.reajustes)
      : null;
    const hospedagemDoHistorico = historico
      ? referenciaDeHospedagem(refHistorico, historico.anoBase, historico.reajustes)
      : null;
    const cabecalho = viagemRowDaLinha(l, modal, transladoCustoTrajeto);
    const parada = paradaRowDaLinha(l, origem, modal);

    // O CUSTO é calculado aqui, nunca recebido da tela.
    const spec = specDaViagem(
      { ...cabecalho, origem } as unknown as Record<string, unknown>,
      [parada],
      {
        passagem:
          passagemDoHistorico ??
          (faixaPassagem ? { nome: faixaPassagem.nome, valor: faixaPassagem.valor } : null),
        hospedagem:
          hospedagemDoHistorico ??
          (faixaHospedagem
            ? { nome: faixaHospedagem.nome, valor: faixaHospedagem.valor }
            : null),
      },
    );
    const resultado = calcularViagem(spec, params);
    const retrato = retratoParaGravar(resultado, params);

    let viagemId = texto(l.id);

    if (viagemId) {
      const { data: atual } = await supabase
        .from("orcamento_viagens")
        .select("setor_id, category_code, updated_at")
        .eq("id", viagemId)
        .eq("company_id", companyId)
        .eq("year", year)
        .maybeSingle();
      if (!atual) {
        resultados.push({ indice: i, erro: "Viagem não encontrada." });
        continue;
      }
      if (!podeEscreverNoSetor(auth.setores, (atual.setor_id as string | null) ?? null)) {
        resultados.push({ indice: i, erro: SEM_ACESSO_SETOR });
        continue;
      }
      // Fatia de ORIGEM também trava: trocar o tipo não pode escapar de um fecho.
      const codeAntigo = texto(atual.category_code);
      if (codeAntigo && fechadas.has(`${codeAntigo}|${(atual.setor_id as string | null) ?? "-"}`)) {
        resultados.push({
          indice: i,
          erro: "A categoria atual desta viagem está finalizada — reabra antes de editar.",
        });
        continue;
      }
      const travado = await travaDaValidacao({
        companyId,
        year,
        alvoTipo: "viagem",
        alvoId: viagemId,
        atualizadoEm: (atual.updated_at as string | null) ?? null,
        papel: auth.user.papel,
      });
      if (travado) {
        resultados.push({ indice: i, erro: travado });
        continue;
      }

      const { error } = await supabase
        .from("orcamento_viagens")
        .update({
          ...cabecalho,
          category_code: categoryCode,
          origem,
          ...retrato,
          updated_at: new Date().toISOString(),
          updated_by: auth.user.userId,
        })
        .eq("id", viagemId);
      if (error) {
        resultados.push({ indice: i, erro: error.message });
        continue;
      }
    } else {
      const { data, error } = await supabase
        .from("orcamento_viagens")
        .insert({
          company_id: companyId,
          year,
          setor_id: alvo.id,
          category_code: categoryCode,
          origem,
          ...cabecalho,
          ...retrato,
          created_by: auth.user.userId,
          updated_by: auth.user.userId,
        })
        .select("id")
        .maybeSingle();
      if (error) {
        if (isSchemaMissing(error.message)) return { ...vazio, needsMigration: true };
        resultados.push({ indice: i, erro: error.message });
        continue;
      }
      viagemId = (data?.id as string) ?? "";
      if (!viagemId) {
        resultados.push({ indice: i, erro: "Não consegui criar a viagem." });
        continue;
      }
    }

    // A parada é SUBSTITUÍDA: a grade tem uma por viagem, e upsert não faria a
    // troca de destino funcionar (a antiga continuaria no banco e no custo).
    await supabase.from("orcamento_viagem_paradas").delete().eq("viagem_id", viagemId);
    const { error: pErr } = await supabase
      .from("orcamento_viagem_paradas")
      .insert({ ...parada, viagem_id: viagemId });
    if (pErr) {
      resultados.push({ indice: i, erro: `Roteiro: ${pErr.message}` });
      continue;
    }

    resultados.push({ indice: i, id: viagemId, custoTotal: resultado.total });
  }

  // Uma entrada de trilha pelo LOTE, não 50: a trilha serve para reconstituir o
  // que mudou, e cinquenta linhas idênticas no mesmo segundo são ruído.
  const resumo = resumirLote(resultados);
  if (resumo.gravadas > 0) {
    await registrarAlteracao({
      companyId,
      year,
      setorId: alvo.id,
      metodo: "viagens",
      alvoTipo: "viagem",
      alvoId: null,
      alvoRotulo: `grade de viagens (${resumo.gravadas} linha(s))`,
      acao: "alterou",
      depois: { gravadas: resumo.gravadas, comErro: resumo.comErro },
      autorId: auth.user.userId,
      autorPapel: auth.user.papel,
    });
  }

  revalidatePath(PATH);
  return { resultados, resumo };
}
