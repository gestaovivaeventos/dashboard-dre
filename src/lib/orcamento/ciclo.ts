// =============================================================================
// Ciclo do orçamento: construção → validação → retorno. Módulo PURO (client +
// server), sem acesso a banco — as actions em `actions/ciclo.ts` são só o guard
// e a gravação.
//
// Spec: docs/superpowers/specs/2026-09-22-orcamento-ciclo-validacao-design.md
//
// O que este arquivo decide, e por que ele existe separado:
//   - quais estados existem e quem pode fazer cada transição;
//   - quem pode ESCREVER no orçamento em cada estado (é a trava que impede um
//     construtor de mexer nos números enquanto a diretoria valida);
//   - qual versão é congelada em cada transição.
//
// Tudo isso é regra de negócio pura, que se quebra por engano ao mexer numa
// tela — então mora aqui, com teste.
// =============================================================================

import type { OrcamentoPapel } from "@/lib/supabase/types";

export type CicloEstado =
  | "em_construcao"
  | "em_validacao"
  | "em_ajuste"
  | "concluido"
  | "publicado";

export type CicloTransicao =
  | "enviar_validacao"
  | "concluir_validacao"
  | "reenviar"
  | "concluir"
  | "publicar"
  | "reabrir";

/** Fase registrada na trilha — 1:1 com o estado, mas sem os nomes de máquina. */
export type TrilhaFase = "construcao" | "validacao" | "ajuste" | "concluido" | "publicado";

/** Tipo de versão congelada (ver orcamento_versoes.tipo). */
export type VersaoTipo = "construcao" | "validacao" | "final";

/**
 * Ciclo inexistente = em construção. Não se cria linha para toda empresa: o
 * `getCiclo` devolve este default, e a primeira transição materializa a linha.
 */
export const CICLO_PADRAO: CicloEstado = "em_construcao";

export const ESTADO_LABEL: Record<CicloEstado, string> = {
  em_construcao: "Em construção",
  em_validacao: "Em validação",
  em_ajuste: "Retorno da diretoria",
  concluido: "Concluído",
  publicado: "Publicado",
};

export const ESTADO_DESCRICAO: Record<CicloEstado, string> = {
  em_construcao: "Os gestores montam o orçamento dos seus setores.",
  em_validacao: "A diretoria está revisando. O orçamento fica somente leitura para quem o montou.",
  em_ajuste: "A validação terminou: veja o que a diretoria mudou e ajuste o que ficou pendente.",
  concluido: "Orçamento fechado. Falta publicar no Budget e Forecast.",
  publicado: "Publicado no Budget e Forecast.",
};

/** Cor do selo por estado (mesma paleta dos selos de status do módulo). */
export const ESTADO_BADGE: Record<CicloEstado, string> = {
  em_construcao: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  em_validacao: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  em_ajuste: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  concluido: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  publicado: "border-emerald-600/50 bg-emerald-600/15 text-emerald-800 dark:text-emerald-300",
};

export const TRANSICAO_LABEL: Record<CicloTransicao, string> = {
  enviar_validacao: "Enviar para validação",
  concluir_validacao: "Concluir validação",
  reenviar: "Reenviar para validação",
  concluir: "Concluir e publicar",
  publicar: "Publicar no Budget e Forecast",
  reabrir: "Voltar para edição",
};

/** Estado de destino de cada transição, a partir de um estado de origem. */
const DESTINO: Record<CicloTransicao, { de: CicloEstado[]; para: CicloEstado }> = {
  enviar_validacao: { de: ["em_construcao"], para: "em_validacao" },
  concluir_validacao: { de: ["em_validacao"], para: "em_ajuste" },
  reenviar: { de: ["em_ajuste"], para: "em_validacao" },
  // Concluir JÁ PUBLICA: eram dois botões para um ato só ("o orçamento está
  // fechado"), e o estado `concluido` no meio era uma parada sem função — o
  // orçamento fechado mas fora do Budget não serve a ninguém.
  concluir: { de: ["em_ajuste", "em_validacao"], para: "publicado" },
  // Rede de segurança: linha que já estava em `concluido` (antes desta
  // simplificação) ainda consegue publicar. Não aparece no fluxo normal.
  publicar: { de: ["concluido"], para: "publicado" },
  // "Voltar para edição": de QUALQUER estado. É a válvula do administrador —
  // erro de envio, decisão revista, orçamento reaberto no meio do ano. Sem
  // isso, um clique errado em "Enviar" só se desfazia no banco.
  reabrir: {
    de: ["em_validacao", "em_ajuste", "concluido", "publicado"],
    para: "em_construcao",
  },
};

/**
 * Quem pode disparar cada transição.
 *
 * O admin opera o ciclo inteiro — é ele que fecha a empresa para validação e
 * decide quando o orçamento está pronto. A única transição que também é do
 * VALIDADOR é `concluir_validacao`: quem termina de validar é quem validou.
 */
const QUEM_PODE: Record<CicloTransicao, OrcamentoPapel[]> = {
  enviar_validacao: ["admin"],
  concluir_validacao: ["admin", "validador"],
  reenviar: ["admin"],
  concluir: ["admin"],
  publicar: ["admin"],
  reabrir: ["admin"],
};

/** Transições possíveis a partir de um estado, para o papel informado. */
export function transicoesDisponiveis(
  estado: CicloEstado,
  papel: OrcamentoPapel,
): CicloTransicao[] {
  return (Object.keys(DESTINO) as CicloTransicao[]).filter(
    (t) => DESTINO[t].de.includes(estado) && QUEM_PODE[t].includes(papel),
  );
}

/** Valida uma transição; devolve o estado de destino ou o motivo da recusa. */
export function aplicarTransicao(
  estado: CicloEstado,
  transicao: CicloTransicao,
  papel: OrcamentoPapel,
): { ok: true; estado: CicloEstado } | { ok: false; error: string } {
  const regra = DESTINO[transicao];
  if (!regra) return { ok: false, error: "Ação de ciclo desconhecida." };
  if (!regra.de.includes(estado)) {
    return {
      ok: false,
      error: `Não dá para "${TRANSICAO_LABEL[transicao]}" com o orçamento em "${ESTADO_LABEL[estado]}".`,
    };
  }
  if (!QUEM_PODE[transicao].includes(papel)) {
    return { ok: false, error: "Você não tem permissão para esta ação no ciclo." };
  }
  return { ok: true, estado: regra.para };
}

/**
 * A transição incrementa a rodada? Só as que mandam o orçamento à diretoria —
 * é o que faz a 2ª rodada não herdar as entregas de setor da 1ª.
 */
export function incrementaRodada(transicao: CicloTransicao): boolean {
  return transicao === "enviar_validacao" || transicao === "reenviar";
}

/**
 * Que versão congelar nesta transição, se alguma.
 *
 * `construcao` só no PRIMEIRO envio: é a ponta esquerda do comparativo "o que
 * os construtores montaram × o aprovado" (§10.F da spec). Um reenvio é outra
 * coisa — já passou pela diretoria.
 */
export function versaoDaTransicao(
  transicao: CicloTransicao,
  rodadaAtual: number,
): VersaoTipo | null {
  if (transicao === "enviar_validacao") return rodadaAtual === 0 ? "construcao" : "validacao";
  if (transicao === "reenviar") return "validacao";
  if (transicao === "concluir") return "final";
  return null;
}

/** Fase da trilha correspondente ao estado. */
export function faseDoEstado(estado: CicloEstado): TrilhaFase {
  switch (estado) {
    case "em_construcao":
      return "construcao";
    case "em_validacao":
      return "validacao";
    case "em_ajuste":
      return "ajuste";
    case "concluido":
      return "concluido";
    case "publicado":
      return "publicado";
  }
}

// ─── A trava de escrita por fase ─────────────────────────────────────────────

export interface PermissaoEscrita {
  pode: boolean;
  /** Mensagem pronta para a action devolver, quando `pode` é false. */
  motivo?: string;
}

/**
 * Quem pode ESCREVER no orçamento, dado o estado do ciclo e o papel.
 *
 * É a trava central da fase B: antes dela, um construtor podia mudar os números
 * no meio da validação e o diretor validava areia.
 *
 *   em_construcao → construtores e admin escrevem; validador lê.
 *   em_validacao  → só validador e admin (a diretoria está trabalhando).
 *   em_ajuste     → construtores voltam a escrever (no que não está travado);
 *                   validador lê (a rodada dele terminou) — mas segue podendo
 *                   LIBERAR item travado, que não passa por aqui.
 *   concluido / publicado → ninguém escreve, exceto admin.
 *
 * Admin nunca é barrado por fase: é ele que opera o ciclo e conserta o que
 * precisa ser consertado. É uma escolha consciente — a trilha registra.
 */
export function podeEscreverNaFase(
  estado: CicloEstado,
  papel: OrcamentoPapel,
): PermissaoEscrita {
  if (papel === "admin") return { pode: true };

  switch (estado) {
    // Em construção TODO MUNDO monta — inclusive a diretoria, que também tem
    // setor próprio (o Diretoria). O que separa os papéis aqui não é PODER
    // escrever, é ONDE: o escopo de setor (ver `setoresDeEscrita`).
    case "em_construcao":
      return { pode: true };

    // Na validação, só a diretoria mexe: quem montou fica somente leitura, para
    // o número não mudar embaixo de quem está decidindo.
    case "em_validacao":
      return papel === "validador"
        ? { pode: true }
        : {
            pode: false,
            motivo:
              "Este orçamento está em validação pela diretoria e ficou somente leitura. Você poderá ajustar quando ele voltar.",
          };

    // No retorno, cada um ajusta os próprios setores — a diretoria também, pelo
    // que ela mesma pediu no setor dela.
    case "em_ajuste":
      return { pode: true };

    case "concluido":
    case "publicado":
      return {
        pode: false,
        motivo: `Este orçamento está ${ESTADO_LABEL[estado].toLowerCase()} e não aceita mais alterações. Um administrador pode voltá-lo para edição.`,
      };
  }
}

/**
 * Na fase atual, o VALIDADOR escreve na empresa inteira ou só nos setores dele?
 *
 * Só durante a validação ele decide sobre tudo. Fora dela, ele é mais um
 * construtor — e do setor dele, como qualquer gestor.
 */
export function validadorEscreveEmTudo(estado: CicloEstado): boolean {
  return estado === "em_validacao";
}

/** O construtor pode ENTREGAR setor? Só faz sentido enquanto ele constrói. */
export function podeEntregarSetor(estado: CicloEstado): boolean {
  return estado === "em_construcao" || estado === "em_ajuste";
}
