"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import {
  getOrcamentoUser,
  podeVerEmpresa,
  setoresDeEscrita,
  SEM_ACESSO,
  type OrcamentoUser,
} from "@/lib/orcamento/auth";
import {
  aplicarTransicao,
  CICLO_PADRAO,
  faseDoEstado,
  incrementaRodada,
  podeEntregarSetor,
  podeEscreverNaFase,
  transicoesDisponiveis,
  versaoDaTransicao,
  type CicloEstado,
  type CicloTransicao,
} from "@/lib/orcamento/ciclo";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { SETOR_TODOS } from "@/lib/orcamento/setor-filtro";
import { getPreviaOrcamento } from "@/lib/orcamento/actions/previa-orcamento";
import { registrarAlteracao } from "@/lib/orcamento/actions/trilha";

const db = () => createAdminClientIfAvailable();

// ─── Leitura ─────────────────────────────────────────────────────────────────

export interface SetorEntrega {
  setorId: string;
  setorNome: string;
  entregueEm: string | null;
  entreguePor: string | null;
  /** O usuário atual é responsável por este setor (pode entregar/desfazer). */
  meu: boolean;
}

export interface CicloInfo {
  /** null quando a linha ainda não existe (ciclo nunca movido). */
  id: string | null;
  estado: CicloEstado;
  rodada: number;
  enviadoEm: string | null;
  validadoEm: string | null;
  publicadoEm: string | null;
  /** Transições que o usuário atual pode disparar agora. */
  acoes: CicloTransicao[];
  /** Setores ativos da empresa × ano com o estado de entrega DESTA rodada. */
  entregas: SetorEntrega[];
  /** O usuário pode escrever no orçamento agora (papel × fase)? */
  podeEscrever: boolean;
  /** Motivo, quando não pode — a tela mostra na faixa. */
  bloqueio: string | null;
  /** A migration da fase B ainda não rodou: o ciclo opera em modo degradado. */
  needsMigration?: boolean;
}

/**
 * Estado do ciclo de uma empresa × ano.
 *
 * Ciclo inexistente = "em construção": não se cria linha para toda empresa, a
 * primeira transição materializa. Migration ausente também devolve o default —
 * o módulo continua funcionando como antes da fase B, só sem ciclo.
 */
export async function getCiclo(
  companyId: string,
  year: number,
): Promise<{ ciclo?: CicloInfo; error?: string }> {
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const user = await getOrcamentoUser();
  if (!user) return { error: SEM_ACESSO };
  if (!podeVerEmpresa(user, companyId)) return { error: SEM_ACESSO };

  const supabase = db() ?? (await createClient());
  const { data: linha, error } = await supabase
    .from("orcamento_ciclos")
    .select("id, estado, rodada, enviado_em, validado_em, publicado_em")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();

  if (error && isSchemaMissing(error.message)) {
    return { ciclo: await montarInfo(user, companyId, year, null, true) };
  }
  if (error) return { error: error.message };

  return {
    ciclo: await montarInfo(
      user,
      companyId,
      year,
      linha
        ? {
            id: linha.id as string,
            estado: (linha.estado as CicloEstado) ?? CICLO_PADRAO,
            rodada: Number(linha.rodada ?? 0),
            enviadoEm: (linha.enviado_em as string) ?? null,
            validadoEm: (linha.validado_em as string) ?? null,
            publicadoEm: (linha.publicado_em as string) ?? null,
          }
        : null,
      false,
    ),
  };
}

async function montarInfo(
  user: OrcamentoUser,
  companyId: string,
  year: number,
  linha: {
    id: string;
    estado: CicloEstado;
    rodada: number;
    enviadoEm: string | null;
    validadoEm: string | null;
    publicadoEm: string | null;
  } | null,
  needsMigration: boolean,
): Promise<CicloInfo> {
  const estado = linha?.estado ?? CICLO_PADRAO;
  const rodada = linha?.rodada ?? 0;
  const supabase = db() ?? (await createClient());

  // Setores ativos + quem já entregou NESTA rodada.
  const { data: setores } = await supabase
    .from("orcamento_setores")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("active", true)
    .order("name");

  let entregasPorSetor = new Map<string, { em: string; por: string | null }>();
  if (linha && !needsMigration) {
    const { data: ent } = await supabase
      .from("orcamento_setor_entregas")
      .select("setor_id, entregue_em, entregue_por, users:users(name, email)")
      .eq("ciclo_id", linha.id)
      .eq("rodada", rodada);
    entregasPorSetor = new Map(
      ((ent ?? []) as unknown as Array<{
        setor_id: string;
        entregue_em: string;
        users: { name: string | null; email: string | null } | null;
      }>).map((r) => [
        r.setor_id,
        { em: r.entregue_em, por: r.users?.name ?? r.users?.email ?? null },
      ]),
    );
  }

  const meus = await setoresDeEscrita(supabase, user, companyId, year);
  const entregas: SetorEntrega[] = (setores ?? []).map((s) => {
    const id = s.id as string;
    const e = entregasPorSetor.get(id);
    return {
      setorId: id,
      setorNome: s.name as string,
      entregueEm: e?.em ?? null,
      entreguePor: e?.por ?? null,
      meu: meus === null || meus.includes(id),
    };
  });

  const perm = podeEscreverNaFase(estado, user.papel);

  return {
    id: linha?.id ?? null,
    estado,
    rodada,
    enviadoEm: linha?.enviadoEm ?? null,
    validadoEm: linha?.validadoEm ?? null,
    publicadoEm: linha?.publicadoEm ?? null,
    acoes: needsMigration ? [] : transicoesDisponiveis(estado, user.papel),
    entregas,
    podeEscrever: perm.pode,
    bloqueio: perm.pode ? null : perm.motivo ?? null,
    ...(needsMigration ? { needsMigration: true } : {}),
  };
}

// ─── Entrega por setor ───────────────────────────────────────────────────────

/**
 * "Terminei o meu setor". É SINAL, não gate: o admin olha antes de fechar a
 * empresa, mas o envio não exige 100% entregue (média e valor fixo são do admin
 * e atravessam todos os setores, sem gerente que as entregue).
 */
export async function entregarSetor(
  companyId: string,
  year: number,
  setorId: string,
  desfazer = false,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  if (!companyId || !setorId) return { error: "Setor inválido." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const user = await getOrcamentoUser();
  if (!user) return { error: SEM_ACESSO };
  if (!podeVerEmpresa(user, companyId)) return { error: SEM_ACESSO };

  const supabase = db();
  if (!supabase) return { error: "Serviço indisponível." };

  const ciclo = await garantirCiclo(supabase, companyId, year, user.userId);
  if ("error" in ciclo) return ciclo.needsMigration ? { needsMigration: true } : { error: ciclo.error };

  if (!podeEntregarSetor(ciclo.estado)) {
    return { error: "Este orçamento não está em construção — não há o que entregar agora." };
  }

  // Só o responsável pelo setor (ou admin) entrega por ele.
  const meus = await setoresDeEscrita(supabase, user, companyId, year);
  if (meus !== null && !meus.includes(setorId)) {
    return { error: "Você só pode entregar os setores vinculados a você." };
  }

  const { data: setor } = await supabase
    .from("orcamento_setores")
    .select("name")
    .eq("id", setorId)
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (!setor) return { error: "Setor não pertence a esta empresa/ano." };

  if (desfazer) {
    const { error } = await supabase
      .from("orcamento_setor_entregas")
      .delete()
      .eq("ciclo_id", ciclo.id)
      .eq("rodada", ciclo.rodada)
      .eq("setor_id", setorId);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("orcamento_setor_entregas").upsert(
      {
        ciclo_id: ciclo.id,
        rodada: ciclo.rodada,
        setor_id: setorId,
        entregue_em: new Date().toISOString(),
        entregue_por: user.userId,
      },
      { onConflict: "ciclo_id,rodada,setor_id" },
    );
    if (error) return { error: error.message };
  }

  await registrarAlteracao({
    companyId,
    year,
    cicloId: ciclo.id,
    setorId,
    alvoTipo: "categoria_setor",
    alvoId: setorId,
    alvoRotulo: setor.name as string,
    acao: desfazer ? "desfez_entrega" : "entregou_setor",
    fase: faseDoEstado(ciclo.estado),
    autorId: user.userId,
    autorPapel: user.papel,
  });

  revalidatePath(`/orcamento/empresa/${companyId}/${year}`);
  return { ok: true };
}

// ─── Transições ──────────────────────────────────────────────────────────────

export interface TransicaoResultado {
  estado: CicloEstado;
  rodada: number;
  /** Versão congelada nesta transição, quando houve. */
  versaoId?: string;
  versaoTotalAno?: number;
  /** Linhas gravadas em orcamento_versao_linhas (conferência). */
  versaoLinhas?: number;
}

/**
 * Move o ciclo. A validação da transição (estado × papel) é do módulo puro
 * `ciclo.ts`; aqui é o guard de acesso, o congelamento da versão e a trilha.
 *
 * ORDEM IMPORTA: a versão é congelada ANTES de o estado mudar, porque o
 * snapshot tem de retratar o orçamento como ele estava ao sair das mãos de quem
 * o montou. Congelar depois pegaria o mesmo número (nada muda na transição),
 * mas se a gravação da versão falhar o estado não deve andar — senão o ciclo
 * avança sem memória, e memória não se refaz depois.
 */
export async function executarTransicao(
  companyId: string,
  year: number,
  transicao: CicloTransicao,
  motivo?: string,
): Promise<{ resultado?: TransicaoResultado; error?: string; needsMigration?: boolean }> {
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const user = await getOrcamentoUser();
  if (!user) return { error: SEM_ACESSO };
  if (!podeVerEmpresa(user, companyId)) return { error: SEM_ACESSO };

  const supabase = db();
  if (!supabase) return { error: "Serviço indisponível." };

  const ciclo = await garantirCiclo(supabase, companyId, year, user.userId);
  if ("error" in ciclo) return ciclo.needsMigration ? { needsMigration: true } : { error: ciclo.error };

  const passo = aplicarTransicao(ciclo.estado, transicao, user.papel);
  if (!passo.ok) return { error: passo.error };

  const novaRodada = incrementaRodada(transicao) ? ciclo.rodada + 1 : ciclo.rodada;

  // ── Congela a versão, se esta transição congela ──────────────────────────
  const tipo = versaoDaTransicao(transicao, ciclo.rodada);
  let versao: { id: string; totalAno: number; linhas: number } | undefined;
  if (tipo) {
    const snap = await montarVersao(supabase, {
      cicloId: ciclo.id,
      companyId,
      year,
      numero: novaRodada,
      tipo,
      motivo: motivo ?? null,
      userId: user.userId,
    });
    if (snap.error) return { error: snap.error };
    versao = snap.versao;
  }

  // ── Move o estado ────────────────────────────────────────────────────────
  const agora = new Date().toISOString();
  const patch: Record<string, unknown> = {
    estado: passo.estado,
    rodada: novaRodada,
    updated_by: user.userId,
  };
  if (transicao === "enviar_validacao" || transicao === "reenviar") {
    patch.enviado_em = agora;
    patch.enviado_por = user.userId;
  }
  if (transicao === "concluir_validacao") {
    patch.validado_em = agora;
    patch.validado_por = user.userId;
  }
  if (transicao === "concluir") {
    patch.ajuste_concluido_em = agora;
    patch.ajuste_concluido_por = user.userId;
  }
  if (transicao === "publicar") {
    patch.publicado_em = agora;
    patch.publicado_por = user.userId;
  }
  if (transicao === "reabrir") {
    // Reabrir NÃO apaga as datas anteriores nem a versão final: elas são
    // auditoria. O histórico é aditivo.
    patch.publicado_em = null;
    patch.publicado_por = null;
  }

  const { error: upErr } = await supabase
    .from("orcamento_ciclos")
    .update(patch)
    .eq("id", ciclo.id);
  if (upErr) return { error: upErr.message };

  const ACAO: Record<CicloTransicao, Parameters<typeof registrarAlteracao>[0]["acao"]> = {
    enviar_validacao: "enviou_validacao",
    concluir_validacao: "concluiu_validacao",
    reenviar: "reenviou",
    concluir: "concluiu",
    publicar: "publicou",
    reabrir: "reabriu",
  };
  await registrarAlteracao({
    companyId,
    year,
    cicloId: ciclo.id,
    versaoId: versao?.id ?? null,
    alvoTipo: "ciclo",
    alvoRotulo: `Orçamento ${year}`,
    acao: ACAO[transicao],
    // A fase registrada é a de ORIGEM: a alteração aconteceu enquanto o ciclo
    // ainda estava no estado anterior.
    fase: faseDoEstado(ciclo.estado),
    antes: { estado: ciclo.estado, rodada: ciclo.rodada },
    depois: { estado: passo.estado, rodada: novaRodada },
    motivo: motivo ?? null,
    autorId: user.userId,
    autorPapel: user.papel,
  });

  revalidatePath(`/orcamento/empresa/${companyId}/${year}`);
  revalidatePath("/orcamento");
  return {
    resultado: {
      estado: passo.estado,
      rodada: novaRodada,
      ...(versao
        ? { versaoId: versao.id, versaoTotalAno: versao.totalAno, versaoLinhas: versao.linhas }
        : {}),
    },
  };
}

/** Cria a linha do ciclo se ainda não existir, e devolve o estado atual. */
async function garantirCiclo(
  supabase: NonNullable<ReturnType<typeof db>>,
  companyId: string,
  year: number,
  userId: string,
): Promise<
  { id: string; estado: CicloEstado; rodada: number } | { error: string; needsMigration?: boolean }
> {
  const { data, error } = await supabase
    .from("orcamento_ciclos")
    .select("id, estado, rodada")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (error) {
    if (isSchemaMissing(error.message)) return { error: "Migration pendente.", needsMigration: true };
    return { error: error.message };
  }
  if (data) {
    return {
      id: data.id as string,
      estado: (data.estado as CicloEstado) ?? CICLO_PADRAO,
      rodada: Number(data.rodada ?? 0),
    };
  }

  const { data: criado, error: insErr } = await supabase
    .from("orcamento_ciclos")
    .insert({ company_id: companyId, year, updated_by: userId })
    .select("id, estado, rodada")
    .single();
  if (insErr) {
    if (isSchemaMissing(insErr.message)) return { error: "Migration pendente.", needsMigration: true };
    return { error: insErr.message };
  }
  return {
    id: criado.id as string,
    estado: (criado.estado as CicloEstado) ?? CICLO_PADRAO,
    rodada: Number(criado.rodada ?? 0),
  };
}

// ─── O snapshot ──────────────────────────────────────────────────────────────

/**
 * Congela o orçamento da empresa × ano numa versão.
 *
 * **Como o snapshot é montado, e por quê**: chamando a Prévia uma vez por setor
 * (mais uma para a empresa inteira), em vez de reestruturar o acumulador dela
 * para emitir setor. Duas razões:
 *
 *  1. o número congelado sai do MESMO caminho que a tela mostra, então snapshot
 *     e Prévia não podem divergir — que é o risco real de um segundo motor;
 *  2. a agregação da Prévia por `category_code` é território de bug conhecido
 *     (já subestimou em silêncio quando alguém a simplificou); mexer nela para
 *     uma leitura que roda em transição de ciclo — algo raro — trocaria risco
 *     alto por ganho de milissegundos.
 *
 * O `total_ano` da versão vem da chamada da EMPRESA INTEIRA, não da soma dos
 * setores: colaborador cadastrado sem setor entra no consolidado e em setor
 * nenhum (a Prévia avisa isso na tela), então somar setores daria menos.
 */
async function montarVersao(
  supabase: NonNullable<ReturnType<typeof db>>,
  params: {
    cicloId: string;
    companyId: string;
    year: number;
    numero: number;
    tipo: "construcao" | "validacao" | "final";
    motivo: string | null;
    userId: string;
  },
): Promise<{ versao?: { id: string; totalAno: number; linhas: number }; error?: string }> {
  const { companyId, year } = params;

  // Consolidado da empresa — é o total autoritativo da versão.
  const geral = await getPreviaOrcamento(companyId, year, SETOR_TODOS);
  if (geral.error || !geral.data) {
    return { error: geral.error ?? "Não consegui calcular a prévia para congelar a versão." };
  }

  const { data: setores } = await supabase
    .from("orcamento_setores")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("active", true)
    .order("name");

  // Uma linha achatada por (setor × categoria × método × conta × mês).
  type LinhaFlat = {
    versao_id?: string;
    setor_id: string | null;
    setor_nome: string | null;
    category_code: string | null;
    category_name: string | null;
    metodo: string | null;
    dre_account_id: string | null;
    dre_code: string | null;
    mes: number;
    valor: number;
  };
  const flat: LinhaFlat[] = [];
  const porSetor: Record<string, unknown> = {};

  for (const s of setores ?? []) {
    const setorId = s.id as string;
    const setorNome = s.name as string;
    const res = await getPreviaOrcamento(companyId, year, setorId);
    if (res.error || !res.data) continue; // setor que falha não derruba a versão
    porSetor[setorId] = { nome: setorNome, linhas: res.data.linhas };
    for (const linha of res.data.linhas) {
      for (const fonte of linha.fontes) {
        fonte.meses.forEach((valor, i) => {
          if (!valor) return;
          flat.push({
            setor_id: setorId,
            setor_nome: setorNome,
            category_code: null,
            category_name: fonte.chave,
            metodo: fonte.metodo,
            dre_account_id: linha.id,
            dre_code: linha.code,
            mes: i + 1,
            valor: Math.round(valor * 100) / 100,
          });
        });
      }
    }
  }

  // O "total do ano" da versão é o total de DESPESA ORÇADA: soma das FOLHAS de
  // despesa. Somar linhas calculadas ou grupos dupla-contaria (o grupo já é a
  // soma dos filhos, e as linhas 4/6/8/11 são fórmulas sobre elas).
  const totalDespesa = geral.data.linhas
    .filter((l) => !l.isCalculado && !l.hasChildren && !l.isReceita)
    .reduce((acc, l) => acc + l.totalAno, 0);

  const { data: versao, error: vErr } = await supabase
    .from("orcamento_versoes")
    .insert({
      ciclo_id: params.cicloId,
      company_id: companyId,
      year,
      numero: params.numero,
      tipo: params.tipo,
      total_ano: Math.round(totalDespesa * 100) / 100,
      motivo: params.motivo,
      payload_schema: 1,
      payload: { geral: geral.data.linhas, porSetor },
      criada_por: params.userId,
    })
    .select("id")
    .single();
  if (vErr) return { error: vErr.message };

  const versaoId = versao.id as string;
  if (flat.length > 0) {
    // Em lotes: uma empresa grande com muitos setores passa de mil linhas.
    const LOTE = 500;
    for (let i = 0; i < flat.length; i += LOTE) {
      const { error } = await supabase
        .from("orcamento_versao_linhas")
        .insert(flat.slice(i, i + LOTE).map((l) => ({ ...l, versao_id: versaoId })));
      if (error) return { error: error.message };
    }
  }

  return {
    versao: {
      id: versaoId,
      totalAno: Math.round(totalDespesa * 100) / 100,
      linhas: flat.length,
    },
  };
}
