import type { OrcamentoPapel } from "@/lib/supabase/types";

// =============================================================================
// Por que o orçamento desta empresa aparece VAZIO para mim?
//
// O módulo recorta tudo por setor, e o recorte é uma corrente de três elos:
//
//   user_sectors (Compras) → ctrl_sectors → orcamento_setores.ctrl_sector_id
//
// Quebrando qualquer elo, o escopo de leitura vira `[]` e as consultas viram
// `.in("setor_id", [])` — que casa com NADA e não devolve erro nenhum. O
// resultado é uma tela em branco que parece defeito do sistema, e foi
// exatamente assim que o módulo se comportou no primeiro teste com gerente.
//
// Este módulo transforma esse silêncio em frase. É PURO de propósito: a
// decisão do que dizer é regra de negócio (quem conserta o quê, e se a pessoa
// está bloqueada ou só sem permissão de escrita), não detalhe de tela, e
// precisa de teste — cada motivo aponta para um cadastro diferente, e mandar
// alguém para a tela errada é pior do que não avisar.
// =============================================================================

export type EscopoMotivo =
  /** Alcança setor (ou não precisa de setor): nada a dizer. */
  | "ok"
  /** O usuário não tem NENHUM setor marcado — conserta-se em Usuários. */
  | "sem_setor_no_usuario"
  /** A empresa não tem setor ativo neste ano — conserta-se em Configuração. */
  | "empresa_sem_setor"
  /** Os setores da empresa existem, mas nenhum está ligado ao Compras. */
  | "ponte_vazia"
  /** Está tudo cadastrado; esta pessoa é que não responde por setor nenhum. */
  | "fora_da_responsabilidade"
  /** A empresa orça só por categoria — o orçamento dela é do administrador. */
  | "empresa_sem_recorte";

/**
 * `bloqueio` = a pessoa não vê nada (escopo de leitura vazio).
 * `aviso`    = ela vê o orçamento da empresa, mas não pode editar nada.
 */
export type EscopoGravidade = "ok" | "aviso" | "bloqueio";

/** Onde o ADMIN conserta. `null` = não há conserto, é assim por desenho. */
export type EscopoAcaoAdmin = "usuarios" | "setores" | null;

/**
 * A frase do conserto, separada do `detalhe` de propósito: o que está errado
 * é uma coisa, quem resolve onde é outra. Manter as duas juntas fazia a tela
 * repetir o pedido quando não havia o que pedir (`acaoAdmin: null`).
 */
export const ACAO_ADMIN_TEXTO: Record<Exclude<EscopoAcaoAdmin, null>, string> = {
  usuarios: "Um administrador resolve na tela de Usuários.",
  setores: "Um administrador resolve em Configuração › Setores, dentro desta empresa.",
};

export interface EscopoFatos {
  papel: OrcamentoPapel;
  /** `orcamento_company_config.orcar_por_setor` desta empresa × ano. */
  orcaPorSetor: boolean;
  /** Quantos setores do Compras estão marcados para o usuário (user_sectors). */
  ctrlSetoresDoUsuario: number;
  /** Setores ATIVOS desta empresa no ano. */
  setoresDaEmpresa: number;
  /** Destes, quantos têm `ctrl_sector_id` preenchido (a ponte). */
  setoresComPonte: number;
  /** Quantos o usuário de fato alcança — o escopo que as consultas usam. */
  setoresAlcancados: number;
}

export interface EscopoDiagnostico {
  motivo: EscopoMotivo;
  gravidade: EscopoGravidade;
  titulo: string;
  /** Uma frase: o que está acontecendo e quem resolve. */
  detalhe: string;
  acaoAdmin: EscopoAcaoAdmin;
}

const OK: EscopoDiagnostico = {
  motivo: "ok",
  gravidade: "ok",
  titulo: "",
  detalhe: "",
  acaoAdmin: null,
};

/**
 * O papel LÊ a empresa inteira?
 *
 * Espelha `setoresDeLeitura` em auth.ts: admin, validador (diretoria) e
 * construtor_amplo ("Gerente Sócio") leem tudo; só o construtor ("Gerente") é
 * recortado na leitura. Para os que leem tudo, escopo vazio não esconde a
 * tela — apenas impede a escrita, e por isso o aviso é mais brando.
 */
function lePorInteiro(papel: OrcamentoPapel): boolean {
  return papel === "admin" || papel === "validador" || papel === "construtor_amplo";
}

/**
 * Diagnostica por que o escopo está vazio — ou confirma que está tudo certo.
 *
 * A ordem das perguntas é a ordem do CONSERTO, do elo mais próximo do usuário
 * para o mais distante: primeiro o cadastro dele, depois o da empresa, depois
 * a ponte entre os dois. Assim o aviso sempre nomeia a primeira coisa que
 * precisa acontecer, e não a última.
 */
export function diagnosticarEscopo(f: EscopoFatos): EscopoDiagnostico {
  // O admin não é recortado em lugar nenhum — nunca cai em escopo vazio.
  if (f.papel === "admin") return OK;
  if (f.setoresAlcancados > 0) return OK;

  const gravidade: EscopoGravidade = lePorInteiro(f.papel) ? "aviso" : "bloqueio";
  const naoVe = gravidade === "bloqueio";
  // O prefixo muda o que a frase promete: quem não vê nada precisa saber que
  // a tela vazia NÃO é o orçamento vazio.
  const abertura = naoVe
    ? "As telas do orçamento desta empresa vão aparecer vazias para você"
    : "Você consegue ver o orçamento desta empresa, mas não editar nada";

  // A empresa não orça por setor: tudo cai no balde "Não atribuído", que não
  // pertence a gerente nenhum. Não há o que ligar — é assim por desenho.
  if (!f.orcaPorSetor) {
    return {
      motivo: "empresa_sem_recorte",
      gravidade,
      titulo: "Esta empresa orça só por categoria",
      detalhe: `${abertura}: sem o recorte por setor, o orçamento dela é montado pelo administrador. Não é um cadastro faltando.`,
      acaoAdmin: null,
    };
  }

  if (f.ctrlSetoresDoUsuario === 0) {
    return {
      motivo: "sem_setor_no_usuario",
      gravidade,
      titulo: "Seu usuário não tem setor marcado",
      detalhe: `${abertura}, porque o recorte do módulo é por setor e nenhum está vinculado a você.`,
      acaoAdmin: "usuarios",
    };
  }

  if (f.setoresDaEmpresa === 0) {
    return {
      motivo: "empresa_sem_setor",
      gravidade,
      titulo: "Esta empresa ainda não tem setores no ano",
      detalhe: `${abertura}: os setores do orçamento são cadastrados por empresa e por ano, e esta ainda não tem nenhum.`,
      acaoAdmin: "setores",
    };
  }

  if (f.setoresComPonte === 0) {
    return {
      motivo: "ponte_vazia",
      gravidade,
      titulo: "Os setores desta empresa não estão ligados ao Compras",
      detalhe: `${abertura}: é o vínculo com o setor do Compras que diz quem responde por cada setor, e nenhum dos ${f.setoresDaEmpresa} setores desta empresa tem esse vínculo.`,
      acaoAdmin: "setores",
    };
  }

  // Tudo cadastrado, e ainda assim ela não alcança nada: os setores desta
  // empresa simplesmente são de outras pessoas. Não é defeito — e por isso
  // esta é a única mensagem que não manda ninguém consertar nada.
  return {
    motivo: "fora_da_responsabilidade",
    gravidade,
    titulo: "Nenhum setor desta empresa está sob sua responsabilidade",
    detalhe: `${abertura}. Os setores desta empresa estão vinculados a outras pessoas — se algum deveria ser seu, ele precisa entrar no seu usuário.`,
    acaoAdmin: "usuarios",
  };
}
