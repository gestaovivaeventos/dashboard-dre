"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { SEM_ACESSO, autorizarLeitura } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { generateJsonViaChat, logResolvedUsage, resolveAiProvider } from "@/lib/ai/provider";
import { mensagemDeFalha } from "@/lib/ai/erros";
import { textoDaLinha as texto } from "@/lib/viagens/colunas";
import { SCHEMA_HINT_PLANO, SYSTEM_PLANO, montarPromptPlano } from "@/lib/viagens/plano-prompt";
import { parsePlanoViagens, resolverPlano, type LinhaResolvida } from "@/lib/viagens/plano";

// =============================================================================
// O PLANO DO ANO, lido de uma vez (02/10/2026) — fase 3.
//
// ── Por que isto existe ───────────────────────────────────────────────────
// O gestor orça ~50 viagens por ano, a destinos que quase não se repetem. Uma
// conversa por viagem é inviável — foi o que a fase 1 mediu. Aqui ele DITA ou
// COLA o plano inteiro e recebe as 50 linhas da grade preenchidas, para conferir
// e ajustar. É o padrão do pedido colado do WhatsApp do Case.
//
// ── UMA chamada de IA para as 50 ──────────────────────────────────────────
// Não é uma chamada por viagem: o plano inteiro vai num prompt só. É o que torna
// a leitura rápida e barata, e é o que permite à IA distribuir os meses e
// perceber que duas idas ao mesmo lado são a mesma viagem.
//
// ── Isto NÃO grava NADA ───────────────────────────────────────────────────
// Devolve linhas para a tela; gravar continua sendo "Salvar e calcular", onde o
// custo é calculado pelo motor e as travas de finalização e da diretoria valem.
// Leitura é SUGESTÃO — a mesma disciplina do OCR do Case e da busca de preços.
//
// ── Gate de LEITURA, com recorte por setor ────────────────────────────────
// Nada é escrito, mas a chamada gasta token: não pode ser caminho para disparar
// IA sobre empresa ou setor que a pessoa não enxerga.
// =============================================================================

type Supa = Awaited<ReturnType<typeof createClient>>;

function db() {
  return createAdminClientIfAvailable();
}

export interface PlanoResult {
  linhas?: LinhaResolvida[];
  avisos?: string[];
  error?: string;
  needsMigration?: boolean;
}

/** Teto do texto colado. ~50 viagens cabem com folga; acima disso é cola errada. */
const MAX_TEXTO = 12_000;

export async function interpretarPlanoViagens(
  companyId: string,
  year: number,
  setorId: string | null,
  textoPlano: string,
  /**
   * Cidade de partida como está no cabeçalho da GRADE.
   *
   * Vem da tela porque na primeira leitura não há viagem gravada de onde tirá-la —
   * e sem origem a IA não distingue partida de destino. O banco é o fallback.
   */
  origem?: string | null,
): Promise<PlanoResult> {
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const bruto = (textoPlano ?? "").trim();
  if (bruto.length < 10) {
    return { error: "Escreva ou dite o plano de viagens antes de interpretar." };
  }
  if (bruto.length > MAX_TEXTO) {
    return { error: `O texto é grande demais (máximo ${MAX_TEXTO.toLocaleString("pt-BR")} caracteres).` };
  }

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  if (auth.setores !== null && setorId && !auth.setores.includes(setorId)) {
    return { error: SEM_ACESSO };
  }

  const [tipoRes, empresaRes] = await Promise.all([
    supabase
      .from("orcamento_viagem_tipos")
      .select("id, nome, category_code, ativo")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("orcamento_viagens")
      .select("origem")
      .eq("company_id", companyId)
      .eq("year", year)
      .not("origem", "is", null)
      .limit(1)
      .maybeSingle(),
  ]);

  if (tipoRes.error && isSchemaMissing(tipoRes.error.message)) return { needsMigration: true };

  // Tipo SEM categoria mapeada não é oferecido: a viagem sairia órfã da Prévia e
  // quem a cadastrou não saberia por quê. Mesmo recorte de `tiposOferecidos`.
  const tipos = ((tipoRes.data ?? []) as Array<Record<string, unknown>>)
    .filter((r) => texto(r.category_code) !== "")
    .map((r) => ({ id: r.id as string, nome: texto(r.nome) }));
  if (tipos.length === 0) {
    return {
      error:
        "Nenhum tipo de viagem com categoria mapeada. Cadastre em Configuração da empresa › Tipos de viagem.",
    };
  }


  const resolved = await resolveAiProvider({ capability: "text" }).catch(() => null);
  if (!resolved) {
    return { error: "A IA não está configurada. Verifique o painel em Plataforma > IA." };
  }

  const prompt = montarPromptPlano({
    year,
    origem: texto(origem) || texto(empresaRes.data?.origem),
    tipos,
    texto: bruto,
  });

  let objeto: unknown;
  try {
    const { object, usage } = await generateJsonViaChat(resolved, {
      system: SYSTEM_PLANO,
      prompt,
      schemaHint: SCHEMA_HINT_PLANO,
      temperature: 0,
      // 50 linhas de JSON cabem com folga; cortar no meio (finish_reason=length)
      // devolveria um plano pela metade sem nada dizer.
      maxTokens: 16_000,
    });
    // Consumo no módulo `orcamento`: é o orçamento que gastou.
    await logResolvedUsage(resolved, "orcamento", usage);
    objeto = object;
  } catch (err) {
    const bruta = err instanceof Error ? err.message : String(err);
    return { error: `Não consegui interpretar o plano. ${mensagemDeFalha(bruta)}`.trim() };
  }

  const brutas = parsePlanoViagens(objeto);
  if (brutas.length === 0) {
    return {
      error:
        "Não encontrei nenhuma viagem no texto. Diga a cidade de cada uma, e o mês quando souber.",
    };
  }

  const { linhas, avisos } = resolverPlano(brutas, { tipos });

  return { linhas, avisos };
}
