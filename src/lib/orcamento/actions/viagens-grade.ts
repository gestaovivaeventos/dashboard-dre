"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import {
  SEM_ACESSO,
  SEM_ACESSO_ADMIN,
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
import { travaDeFinalizacao } from "@/lib/orcamento/actions/finalizacao";
import { estadoDaLinha, lerDecisoes } from "@/lib/orcamento/decisoes-linha";
import { getCategoriasOrcamento } from "@/lib/orcamento/actions/categoria-metodo";
import { categoriaDoTipo, tiposOferecidos, type TipoViagem } from "@/lib/viagens/tipos";
import { numDaLinha as num, textoDaLinha as texto } from "@/lib/viagens/colunas";
import { GRUPO_LABEL } from "@/lib/viagens/custo/tipos";
import type { ValidacaoEstado } from "@/lib/orcamento/validacao-diretoria";
import {
  GRUPOS_COTACAO,
  acoesDisponiveis,
  adminPodeEditarBasico,
  contarPorEstado,
  destinoDaAcao,
  estadoAposValores,
  faltaParaOk,
  gestorPodeEditar,
  normalizarEstado,
  podeLancarValores,
  retratoDaCotacao,
  roteiroMudouDepoisDaCotacao,
  totalCotado,
  type AcaoFluxo,
  type ContagemPorEstado,
  type EstadoViagem,
  type ValoresCotacao,
} from "@/lib/viagens/fluxo";
import {
  faltaParaOkDaLinha,
  origemMaisUsada,
  paradaRowDaLinha,
  resumirLote,
  validarLinhaViagem,
  viagemRowDaLinha,
  type LinhaViagemInput,
  type ResultadoLinha,
  type ResumoLote,
} from "@/lib/viagens/grade";

// =============================================================================
// A GRADE de viagens (reescrita em 06/10/2026).
//
// ── O desenho ─────────────────────────────────────────────────────────────
// O sistema não precifica mais nada. O gestor descreve a viagem e dá OK; o admin
// fecha, baixa o .xls, cota FORA (IA no cowork) e lança os valores por grupo;
// depois manda para a diretoria, que decide por viagem. A máquina de estados é
// `src/lib/viagens/fluxo.ts` — pura e testada —, e esta action só a obedece.
//
// ── Falha POR LINHA, nunca pelo lote ─────────────────────────────────────
// Vale para gravar, para mover o fluxo e para lançar valores: a linha recusada
// volta com o motivo e as outras 49 passam.
//
// ── As travas que continuam valendo ──────────────────────────────────────
// Fatia finalizada (sem exceção, nem para o admin) e decisão da diretoria
// (`travaDaValidacao`, onde admin e diretoria passam). A de finalização é lida UMA
// vez na gravação e aplicada às 50 linhas — duas consultas por linha seriam 100
// para a mesma resposta.
// =============================================================================

const PATH = "/orcamento";
const METODO = "viagens";

type Supa = Awaited<ReturnType<typeof createClient>>;

function db() {
  return createAdminClientIfAvailable();
}

const GRADE_COLS =
  "id, titulo, finalidade, origem, mes_ida, pessoas, pessoas_por_quarto, tipo_id, volta_modal, " +
  "cot_passagem, cot_translado, cot_transporte_local, cot_hospedagem, cot_alimentacao, cot_outros, " +
  "cotado_em, cotacao_data_base, cotacao_observacao, basico_alterado_em, " +
  "custo_total, meses, grupos, premissas, status, category_code, setor_id, updated_at";

export interface GrupoDaLinha {
  grupo: string;
  label: string;
  total: number;
  linhas: Array<{ descricao: string; valor: number }>;
}

/** Uma linha da grade, como a tela a recebe. */
export interface LinhaGrade {
  id: string;
  estado: EstadoViagem;
  /** De onde ESTE trecho parte — por linha, por causa da viagem casada. */
  origem: string | null;
  destino: string;
  uf: string | null;
  mesIda: number | null;
  noites: number;
  pessoas: number;
  pessoasPorQuarto: number;
  tipoId: string | null;
  tipoNome: string | null;
  modal: string | null;
  finalidade: string | null;

  /** Os valores cotados, por grupo. Vazios enquanto a Controladoria não lança. */
  valores: ValoresCotacao;
  custoTotal: number;
  cotadoEm: string | null;
  cotacaoDataBase: string | null;
  cotacaoObservacao: string | null;
  /** O roteiro mudou depois de a cotação ter sido feita. */
  roteiroMudou: boolean;

  /** A árvore que o diretor abre na linha. */
  grupos: GrupoDaLinha[];
  premissas: string[];

  setorId: string | null;
  categoryCode: string;

  /** Validação da diretoria. */
  decisao: ValidacaoEstado;
  comentario: string | null;
  travadoPelaValidacao: boolean;
  finalizado: boolean;

  /** O que ESTE usuário pode fazer nesta linha, resolvido no servidor. */
  podeEditarBasico: boolean;
  podeLancarValores: boolean;
  podeDecidir: boolean;
  acoes: AcaoFluxo[];
  /** O que falta para dar OK (`null` = pode). */
  faltaParaOk: string | null;

  atualizadoEm: string | null;
}

export interface GradeSetup {
  orcaPorSetor: boolean;
  setores: Array<{ id: string; name: string; podeEscrever: boolean }>;
  tipos: Array<{ id: string; nome: string }>;
  linhas: LinhaGrade[];
  contagem: ContagemPorEstado;
  categorias: Array<{ categoryCode: string; categoryName: string }>;
  /**
   * A partida mais usada na grade. Serve só para pré-preencher linha NOVA e para
   * dizer à IA do plano de onde o time sai; a partida que vale é a de cada linha.
   */
  origemPadrao: string;
  podeEditar: boolean;
  podeValidar: boolean;
  isAdmin: boolean;
  error?: string;
  needsMigration?: boolean;
}

const VAZIO: GradeSetup = {
  orcaPorSetor: false,
  setores: [],
  tipos: [],
  linhas: [],
  contagem: contarPorEstado([]),
  categorias: [],
  origemPadrao: "",
  podeEditar: false,
  podeValidar: false,
  isAdmin: false,
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

function valoresDaRow(r: Record<string, unknown>): ValoresCotacao {
  const out: ValoresCotacao = {};
  for (const g of GRUPOS_COTACAO) out[g] = num(r[`cot_${g}`]);
  return out;
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

async function lerFechadas(
  supabase: Supa,
  companyId: string,
  year: number,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("orcamento_finalizacoes")
    .select("category_code, setor_id")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("metodo", METODO);
  return new Set(
    ((data ?? []) as Array<Record<string, unknown>>).map(
      (r) => `${texto(r.category_code)}|${(r.setor_id as string | null) ?? "-"}`,
    ),
  );
}

/** Tudo o que a grade precisa para abrir: cadastros, linhas, estado e permissões. */
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
  const isAdmin = auth.user.isAdmin;

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
    if (isSchemaMissing(viagemErr.message)) return { ...VAZIO, isAdmin, needsMigration: true };
    return { ...VAZIO, isAdmin, error: viagemErr.message };
  }
  const rows = (viagemRows ?? []) as unknown as Array<Record<string, unknown>>;

  // Cidade, UF e noites de cada viagem (a parada), numa consulta só.
  const ids = rows.map((r) => r.id as string);
  const paradas = new Map<string, { cidade: string; uf: string | null; noites: number }>();
  if (ids.length > 0) {
    const { data: pRows, error: pErr } = await supabase
      .from("orcamento_viagem_paradas")
      .select("viagem_id, ordem, cidade, uf, noites")
      .in("viagem_id", ids)
      .order("ordem");
    if (pErr && isSchemaMissing(pErr.message)) {
      return { ...VAZIO, isAdmin, needsMigration: true };
    }
    for (const p of (pRows ?? []) as Array<Record<string, unknown>>) {
      const vid = p.viagem_id as string;
      // Uma linha = uma cidade (06/10/2026), então só a primeira parada.
      if (paradas.has(vid)) continue;
      paradas.set(vid, {
        cidade: texto(p.cidade),
        uf: texto(p.uf) || null,
        noites: num(p.noites) ?? 0,
      });
    }
  }

  const [decisoes, fechadas] = await Promise.all([
    lerDecisoes(supabase, companyId, year, "viagem", ids),
    lerFechadas(supabase, companyId, year),
  ]);
  const nomeDoTipo = new Map(tipos.map((t) => [t.id, t.nome] as const));

  const linhas: LinhaGrade[] = rows.map((r) => {
    const id = r.id as string;
    const p = paradas.get(id);
    const sId = (r.setor_id as string | null) ?? null;
    const estado = normalizarEstado(r.status);
    const validacao = estadoDaLinha(
      decisoes.get(id),
      (r.updated_at as string | null) ?? null,
      auth.user.papel,
    );
    const valores = valoresDaRow(r);
    const noSetor = podeEscreverNoSetor(escrita, sId);
    const finalizado = fechadas.has(`${texto(r.category_code)}|${sId ?? "-"}`);

    // O gestor edita por escopo de SETOR + estado + decisão; o admin, pelo estado.
    // Resolver aqui e mandar pronto evita a tela recalcular a mesma regra — e
    // divergir dela, que é o defeito que a grade não pode ter.
    const gestorEdita = noSetor && gestorPodeEditar(estado, validacao.estado);
    const adminEdita = isAdmin && adminPodeEditarBasico(estado);

    const basicos: LinhaViagemInput = {
      id,
      // A partida vive na viagem (`origem`) e é espelhada na parada (`chegada_de`);
      // a viagem é a fonte, que é a coluna que o .xls da cotação exporta.
      origem: texto(r.origem) || null,
      destino: p?.cidade ?? texto(r.titulo),
      uf: p?.uf ?? null,
      mesIda: num(r.mes_ida),
      noites: p?.noites ?? 0,
      pessoas: num(r.pessoas) ?? 1,
      pessoasPorQuarto: num(r.pessoas_por_quarto),
      tipoId: (r.tipo_id as string | null) ?? "",
      modal: texto(r.volta_modal) || null,
      finalidade: texto(r.finalidade) || null,
    };

    return {
      id,
      estado,
      origem: basicos.origem ?? null,
      destino: basicos.destino,
      uf: basicos.uf ?? null,
      mesIda: basicos.mesIda,
      noites: basicos.noites,
      pessoas: basicos.pessoas,
      pessoasPorQuarto: num(r.pessoas_por_quarto) ?? 2,
      tipoId: (r.tipo_id as string | null) ?? null,
      tipoNome: r.tipo_id ? nomeDoTipo.get(r.tipo_id as string) ?? null : null,
      modal: basicos.modal ?? null,
      finalidade: basicos.finalidade ?? null,

      valores,
      custoTotal: num(r.custo_total) ?? 0,
      cotadoEm: (r.cotado_em as string | null) ?? null,
      cotacaoDataBase: (r.cotacao_data_base as string | null) ?? null,
      cotacaoObservacao: texto(r.cotacao_observacao) || null,
      roteiroMudou: roteiroMudouDepoisDaCotacao(
        (r.basico_alterado_em as string | null) ?? null,
        (r.cotado_em as string | null) ?? null,
      ),

      grupos: gruposDaLinhaJson(r.grupos),
      premissas: premissasJson(r.premissas),

      setorId: sId,
      categoryCode: texto(r.category_code),

      decisao: validacao.estado,
      comentario: validacao.comentario,
      travadoPelaValidacao: validacao.travado,
      finalizado,

      podeEditarBasico: (gestorEdita || adminEdita) && !finalizado,
      podeLancarValores: isAdmin && podeLancarValores(estado) && !finalizado,
      podeDecidir: podeValidarOrcamento(auth.user) && estado === "em_aprovacao",
      acoes: finalizado
        ? []
        : acoesDisponiveis(estado, isAdmin ? "admin" : "gestor").filter(() => isAdmin || noSetor),
      faltaParaOk: faltaParaOkDaLinha(basicos),

      atualizadoEm: (r.updated_at as string | null) ?? null,
    };
  });

  return {
    orcaPorSetor: porSetor,
    setores,
    tipos: tiposOferecidos(tipos).map((t) => ({ id: t.id, nome: t.nome })),
    linhas,
    contagem: contarPorEstado(linhas),
    categorias: (cats.items ?? []).map((c) => ({
      categoryCode: c.categoryCode,
      categoryName: c.categoryName,
    })),
    origemPadrao: origemMaisUsada(linhas),
    podeEditar: escrita === null || escrita.length > 0,
    podeValidar: podeValidarOrcamento(auth.user),
    isAdmin,
  };
}

// ─── Gravar os dados básicos ─────────────────────────────────────────────────

export interface SalvarGradeResult {
  resultados: ResultadoLinha[];
  resumo: ResumoLote;
  error?: string;
  needsMigration?: boolean;
}

/**
 * Grava a grade inteira, linha a linha.
 *
 * Só dados BÁSICOS — o custo entra por `lancarValoresViagens`. Cada gravação toca
 * `basico_alterado_em`, que é o que permite a linha avisar depois que o roteiro
 * mudou em relação à cotação já feita.
 *
 * A ORIGEM vem em cada linha, não num parâmetro do lote (07/10/2026): viagem casada
 * tem uma partida por trecho, e um valor só para as 50 linhas gravava trecho que
 * não existe.
 */
export async function salvarGradeViagens(
  companyId: string,
  year: number,
  setorId: string | null,
  linhas: LinhaViagemInput[],
): Promise<SalvarGradeResult> {
  const vazio = { resultados: [], resumo: resumirLote([]) };
  if (!isValidBudgetYear(year)) return { ...vazio, error: "Ano do orçamento inválido." };
  if (!Array.isArray(linhas) || linhas.length === 0) return vazio;

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { ...vazio, error: auth.error };
  const isAdmin = auth.user.isAdmin;

  const alvo = await setorParaGravar(supabase, companyId, year, setorId, auth.user.userId);
  if (!podeEscreverNoSetor(auth.setores, alvo.id)) return { ...vazio, error: SEM_ACESSO_SETOR };

  const [tipos, fechadas] = await Promise.all([
    lerTipos(supabase, companyId, year),
    lerFechadas(supabase, companyId, year),
  ]);

  const agora = new Date().toISOString();
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

    const cabecalho = viagemRowDaLinha(l);
    const parada = paradaRowDaLinha(l);
    let viagemId = texto(l.id);

    if (viagemId) {
      const { data: atual } = await supabase
        .from("orcamento_viagens")
        .select(
          // UM literal, nunca concatenacao: o client tipado analisa o select em
          // tempo de compilacao e com string montada devolve GenericStringError em
          // cada coluna. Mesma pegadinha do NIVEL_COLS do plano de cargos.
          "setor_id, category_code, status, updated_at, cotado_em, cotacao_data_base, cotacao_observacao, cot_passagem, cot_translado, cot_transporte_local, cot_hospedagem, cot_alimentacao, cot_outros",
        )
        .eq("id", viagemId)
        .eq("company_id", companyId)
        .eq("year", year)
        .maybeSingle();
      if (!atual) {
        resultados.push({ indice: i, erro: "Viagem não encontrada." });
        continue;
      }
      const setorDaLinha = (atual.setor_id as string | null) ?? null;
      if (!podeEscreverNoSetor(auth.setores, setorDaLinha)) {
        resultados.push({ indice: i, erro: SEM_ACESSO_SETOR });
        continue;
      }
      // Fatia de ORIGEM também trava: trocar o tipo não pode escapar de um fecho.
      const codeAntigo = texto(atual.category_code);
      if (codeAntigo && fechadas.has(`${codeAntigo}|${setorDaLinha ?? "-"}`)) {
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

      // ── O ESTADO decide quem pode mexer ──
      // `travaDaValidacao` já barrou aprovado/reprovado para quem não é admin nem
      // diretoria; o que falta é o fecho da cotação, que é do fluxo.
      const estado = normalizarEstado(atual.status);
      const gestorPode = gestorPodeEditar(estado, "pendente");
      if (!gestorPode && !(isAdmin && adminPodeEditarBasico(estado))) {
        resultados.push({
          indice: i,
          erro:
            estado === "em_cotacao" || estado === "cotada"
              ? "Viagem fechada para cotação — só a Controladoria altera. Peça para reabrir."
              : "Viagem com a diretoria — peça a revisão para poder alterar.",
        });
        continue;
      }

      // Editar uma viagem que já passou do OK a devolve ao começo do ciclo: o dado
      // mudou, então a cotação anterior não vale mais e ela precisa de OK outra vez.
      // É o que o fluxo manda ("ele clica em ok, e o processo se repete") e o que
      // evita a viagem ficar "na diretoria" com dado novo por baixo.
      const estadoNovo: EstadoViagem =
        estado === "rascunho" || estado === "aguardando_cotacao" ? estado : "rascunho";

      const valores = valoresDaRow(atual as Record<string, unknown>);
      const tinhaCotacao = Boolean(atual.cotado_em) && totalCotado(valores) > 0;
      const retrato = retratoDaCotacao({
        valores,
        mesIda: l.mesIda ?? null,
        cotadoEm: (atual.cotado_em as string | null) ?? null,
        dataBase: (atual.cotacao_data_base as string | null) ?? null,
        observacao: texto(atual.cotacao_observacao) || null,
        labels: GRUPO_LABEL,
        // Acabou de mudar o básico: se havia cotação, ela ficou para trás. Os
        // valores NÃO são apagados — pode ser que só um grupo precise de ajuste.
        roteiroMudou: tinhaCotacao,
      });

      const { error } = await supabase
        .from("orcamento_viagens")
        .update({
          ...cabecalho,
          category_code: categoryCode,
          status: estadoNovo,
          basico_alterado_em: agora,
          custo_total: retrato.custo_total,
          meses: retrato.meses,
          grupos: retrato.grupos,
          premissas: retrato.premissas,
          updated_at: agora,
          updated_by: auth.user.userId,
        })
        .eq("id", viagemId);
      if (error) {
        if (isSchemaMissing(error.message)) return { ...vazio, needsMigration: true };
        resultados.push({ indice: i, erro: error.message });
        continue;
      }
    } else {
      const retrato = retratoDaCotacao({
        valores: {},
        mesIda: l.mesIda ?? null,
        cotadoEm: null,
        dataBase: null,
        observacao: null,
        labels: GRUPO_LABEL,
      });
      const { data, error } = await supabase
        .from("orcamento_viagens")
        .insert({
          company_id: companyId,
          year,
          setor_id: alvo.id,
          category_code: categoryCode,
          status: "rascunho",
          basico_alterado_em: agora,
          ...cabecalho,
          custo_total: retrato.custo_total,
          meses: retrato.meses,
          grupos: retrato.grupos,
          premissas: retrato.premissas,
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

    // A parada é SUBSTITUÍDA: upsert não faria a troca de destino funcionar — a
    // antiga continuaria no banco e na leitura.
    await supabase.from("orcamento_viagem_paradas").delete().eq("viagem_id", viagemId);
    const { error: pErr } = await supabase
      .from("orcamento_viagem_paradas")
      .insert({ ...parada, viagem_id: viagemId });
    if (pErr) {
      if (isSchemaMissing(pErr.message)) return { ...vazio, needsMigration: true };
      resultados.push({ indice: i, erro: `Roteiro: ${pErr.message}` });
      continue;
    }

    resultados.push({ indice: i, id: viagemId });
  }

  // Uma entrada de trilha pelo LOTE, não 50: cinquenta linhas idênticas no mesmo
  // segundo são ruído para quem precisa reconstituir o que mudou.
  const resumo = resumirLote(resultados);
  if (resumo.gravadas > 0) {
    await registrarAlteracao({
      companyId,
      year,
      setorId: alvo.id,
      metodo: METODO,
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

// ─── Mover o fluxo ───────────────────────────────────────────────────────────

export interface MoverFluxoResult {
  movidas: number;
  recusadas: Array<{ id: string; motivo: string }>;
  error?: string;
  needsMigration?: boolean;
}

/**
 * Move uma ou várias viagens no fluxo.
 *
 * Em LOTE porque nenhuma dessas ações faz sentido uma por uma com 50 viagens:
 * fechar as 12 que estão com OK, mandar as 20 cotadas para a diretoria. A linha que
 * não pode volta com o motivo, e as outras andam.
 *
 * Quem pode o quê sai de `acoesDisponiveis` — a MESMA função que a tela usa para
 * mostrar o botão. Com as duas lendo da mesma tabela não existe botão que a action
 * recusa nem caminho que a tela esconde.
 */
export async function moverFluxoViagens(
  companyId: string,
  year: number,
  ids: string[],
  acao: AcaoFluxo,
): Promise<MoverFluxoResult> {
  const vazio = { movidas: 0, recusadas: [] as Array<{ id: string; motivo: string }> };
  if (!isValidBudgetYear(year)) return { ...vazio, error: "Ano do orçamento inválido." };
  if (!Array.isArray(ids) || ids.length === 0) return vazio;

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { ...vazio, error: auth.error };
  const papel = auth.user.isAdmin ? "admin" : "gestor";

  const { data: rows, error } = await supabase
    .from("orcamento_viagens")
    .select(
      "id, titulo, status, setor_id, category_code, origem, mes_ida, pessoas, pessoas_por_quarto, tipo_id, finalidade",
    )
    .eq("company_id", companyId)
    .eq("year", year)
    .in("id", ids);
  if (error) {
    if (isSchemaMissing(error.message)) return { ...vazio, needsMigration: true };
    return { ...vazio, error: error.message };
  }

  // Noites e cidade vêm da parada — o OK precisa delas para validar.
  const paradas = new Map<string, { cidade: string; uf: string | null; noites: number }>();
  const { data: pRows } = await supabase
    .from("orcamento_viagem_paradas")
    .select("viagem_id, ordem, cidade, uf, noites")
    .in("viagem_id", ids)
    .order("ordem");
  for (const p of (pRows ?? []) as Array<Record<string, unknown>>) {
    const vid = p.viagem_id as string;
    if (paradas.has(vid)) continue;
    paradas.set(vid, {
      cidade: texto(p.cidade),
      uf: texto(p.uf) || null,
      noites: num(p.noites) ?? 0,
    });
  }

  const fechadas = await lerFechadas(supabase, companyId, year);
  const recusadas: Array<{ id: string; motivo: string }> = [];
  let movidas = 0;
  const agora = new Date().toISOString();

  for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
    const id = r.id as string;
    const rotulo = texto(r.titulo) || "viagem";
    const estado = normalizarEstado(r.status);
    const setorDaLinha = (r.setor_id as string | null) ?? null;

    if (!auth.user.isAdmin && !podeEscreverNoSetor(auth.setores, setorDaLinha)) {
      recusadas.push({ id, motivo: `${rotulo}: ${SEM_ACESSO_SETOR}` });
      continue;
    }
    const destino = acoesDisponiveis(estado, papel).includes(acao)
      ? destinoDaAcao(estado, acao)
      : null;
    if (!destino) {
      recusadas.push({ id, motivo: `${rotulo}: a ação não é possível em "${estado}".` });
      continue;
    }
    if (fechadas.has(`${texto(r.category_code)}|${setorDaLinha ?? "-"}`)) {
      recusadas.push({
        id,
        motivo: `${rotulo}: a categoria foi finalizada neste setor — reabra antes.`,
      });
      continue;
    }

    // O OK é o único movimento que exige o cadastro completo: é dali que a viagem
    // sai da mão do gestor e alguém de fora tenta cotá-la.
    if (acao === "ok") {
      const p = paradas.get(id);
      const falta = faltaParaOk({
        destino: p?.cidade ?? texto(r.titulo),
        uf: p?.uf ?? null,
        origem: texto(r.origem) || null,
        mesIda: num(r.mes_ida),
        noites: p?.noites ?? 0,
        pessoas: num(r.pessoas) ?? 1,
        pessoasPorQuarto: num(r.pessoas_por_quarto),
        modal: null,
        finalidade: texto(r.finalidade) || null,
        tipoId: (r.tipo_id as string | null) ?? null,
      });
      if (falta) {
        recusadas.push({ id, motivo: `${rotulo}: ${falta}` });
        continue;
      }
    }

    const { error: upErr } = await supabase
      .from("orcamento_viagens")
      .update({ status: destino, updated_at: agora, updated_by: auth.user.userId })
      .eq("id", id);
    if (upErr) {
      if (isSchemaMissing(upErr.message)) return { ...vazio, needsMigration: true };
      recusadas.push({ id, motivo: `${rotulo}: ${upErr.message}` });
      continue;
    }
    movidas += 1;
  }

  if (movidas > 0) {
    await registrarAlteracao({
      companyId,
      year,
      setorId: null,
      metodo: METODO,
      alvoTipo: "viagem",
      alvoId: null,
      alvoRotulo: `fluxo de viagens: ${acao} (${movidas} viagem(ns))`,
      acao: "alterou",
      depois: { acao, movidas, recusadas: recusadas.length },
      autorId: auth.user.userId,
      autorPapel: auth.user.papel,
    });
  }

  revalidatePath(PATH);
  return { movidas, recusadas };
}

// ─── Lançar os valores da cotação ────────────────────────────────────────────

export interface ValoresDaViagem {
  id: string;
  valores: ValoresCotacao;
  dataBase?: string | null;
  observacao?: string | null;
}

export interface LancarValoresResult {
  gravadas: number;
  recusadas: Array<{ id: string; motivo: string }>;
  error?: string;
  needsMigration?: boolean;
}

/**
 * Lança os valores cotados, por grupo de despesa.
 *
 * É a MESMA action para a digitação na tela e para o upload da planilha — uma só,
 * porque a regra é idêntica e duplicá-la faria a planilha aceitar o que a tela
 * recusa. Admin-only: a cotação é da Controladoria.
 *
 * O ESTADO é derivado do valor (`estadoAposValores`): lançar torna a viagem
 * `cotada`, zerar a devolve para `em_cotacao`. Em `em_aprovacao` não volta —
 * corrigir um valor não deve tirar a viagem da fila da diretoria; o que avisa que o
 * número mudou é a decisão vencida pela edição, que já é regra do módulo.
 */
export async function lancarValoresViagens(
  companyId: string,
  year: number,
  itens: ValoresDaViagem[],
): Promise<LancarValoresResult> {
  const vazio = { gravadas: 0, recusadas: [] as Array<{ id: string; motivo: string }> };
  if (!isValidBudgetYear(year)) return { ...vazio, error: "Ano do orçamento inválido." };
  if (!Array.isArray(itens) || itens.length === 0) return vazio;

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { ...vazio, error: auth.error };
  if (!auth.user.isAdmin) return { ...vazio, error: SEM_ACESSO_ADMIN };

  const ids = itens.map((i) => texto(i.id)).filter(Boolean);
  if (ids.length === 0) return { ...vazio, error: "Nenhuma viagem informada." };

  const { data: rows, error } = await supabase
    .from("orcamento_viagens")
    .select("id, titulo, status, setor_id, category_code, mes_ida")
    .eq("company_id", companyId)
    .eq("year", year)
    .in("id", ids);
  if (error) {
    if (isSchemaMissing(error.message)) return { ...vazio, needsMigration: true };
    return { ...vazio, error: error.message };
  }
  const porId = new Map(
    ((rows ?? []) as Array<Record<string, unknown>>).map((r) => [r.id as string, r] as const),
  );

  const fechadas = await lerFechadas(supabase, companyId, year);
  const recusadas: Array<{ id: string; motivo: string }> = [];
  let gravadas = 0;
  const agora = new Date().toISOString();

  for (const item of itens) {
    const id = texto(item.id);
    const r = porId.get(id);
    if (!r) {
      recusadas.push({ id, motivo: "Viagem não encontrada nesta empresa e ano." });
      continue;
    }
    const rotulo = texto(r.titulo) || "viagem";
    const estado = normalizarEstado(r.status);
    if (!podeLancarValores(estado)) {
      recusadas.push({
        id,
        motivo: `${rotulo}: só aceita valores depois de fechada para cotação (está em "${estado}").`,
      });
      continue;
    }
    if (fechadas.has(`${texto(r.category_code)}|${(r.setor_id as string | null) ?? "-"}`)) {
      recusadas.push({
        id,
        motivo: `${rotulo}: a categoria foi finalizada neste setor — reabra antes.`,
      });
      continue;
    }

    // Valor negativo é erro de digitação ou de planilha, nunca estorno.
    const valores: ValoresCotacao = {};
    let negativo = false;
    for (const g of GRUPOS_COTACAO) {
      const bruto = item.valores?.[g];
      const n = bruto == null ? null : num(bruto);
      if (n != null && n < 0) negativo = true;
      valores[g] = n;
    }
    if (negativo) {
      recusadas.push({ id, motivo: `${rotulo}: valor negativo.` });
      continue;
    }

    const temValor = totalCotado(valores) > 0;
    const retrato = retratoDaCotacao({
      valores,
      mesIda: num(r.mes_ida),
      cotadoEm: temValor ? agora : null,
      dataBase: texto(item.dataBase) || null,
      observacao: texto(item.observacao) || null,
      labels: GRUPO_LABEL,
      // Acabou de cotar: a cotação é mais nova que a última alteração do básico.
      roteiroMudou: false,
    });

    const campos: Record<string, unknown> = {
      status: estadoAposValores(estado, valores),
      cotado_em: temValor ? agora : null,
      cotado_por: temValor ? auth.user.userId : null,
      cotacao_data_base: texto(item.dataBase) || null,
      cotacao_observacao: texto(item.observacao) || null,
      custo_total: retrato.custo_total,
      meses: retrato.meses,
      grupos: retrato.grupos,
      premissas: retrato.premissas,
      updated_at: agora,
      updated_by: auth.user.userId,
    };
    for (const g of GRUPOS_COTACAO) campos[`cot_${g}`] = valores[g];

    const { error: upErr } = await supabase.from("orcamento_viagens").update(campos).eq("id", id);
    if (upErr) {
      if (isSchemaMissing(upErr.message)) return { ...vazio, needsMigration: true };
      recusadas.push({ id, motivo: `${rotulo}: ${upErr.message}` });
      continue;
    }
    gravadas += 1;
  }

  if (gravadas > 0) {
    await registrarAlteracao({
      companyId,
      year,
      setorId: null,
      metodo: METODO,
      alvoTipo: "viagem",
      alvoId: null,
      alvoRotulo: `cotação de viagens (${gravadas} viagem(ns))`,
      acao: "alterou",
      depois: { gravadas, recusadas: recusadas.length },
      autorId: auth.user.userId,
      autorPapel: auth.user.papel,
    });
  }

  revalidatePath(PATH);
  return { gravadas, recusadas };
}

/** Exclui uma viagem. O gestor só exclui o que ainda é dele. */
export async function removerViagemDaGrade(
  companyId: string,
  year: number,
  id: string,
): Promise<{ error?: string }> {
  if (!companyId || !id) return { error: "Viagem inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  const { data: atual } = await supabase
    .from("orcamento_viagens")
    .select("status, setor_id, category_code, titulo")
    .eq("id", id)
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (!atual) return { error: "Viagem não encontrada." };

  const setorDaLinha = (atual.setor_id as string | null) ?? null;
  if (!podeEscreverNoSetor(auth.setores, setorDaLinha)) return { error: SEM_ACESSO_SETOR };

  const estado = normalizarEstado(atual.status);
  if (!auth.user.isAdmin && estado !== "rascunho" && estado !== "aguardando_cotacao") {
    return { error: "Viagem já fechada para cotação — peça à Controladoria." };
  }

  const fechado = await travaDeFinalizacao({
    companyId,
    year,
    metodo: METODO,
    categoryCode: texto(atual.category_code),
    setorId: setorDaLinha,
  });
  if (fechado) return { error: fechado };

  const { error } = await supabase.from("orcamento_viagens").delete().eq("id", id);
  if (error) return { error: error.message };

  await registrarAlteracao({
    companyId,
    year,
    setorId: setorDaLinha,
    metodo: METODO,
    alvoTipo: "viagem",
    alvoId: id,
    alvoRotulo: texto(atual.titulo) || "viagem",
    acao: "excluiu",
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return {};
}
