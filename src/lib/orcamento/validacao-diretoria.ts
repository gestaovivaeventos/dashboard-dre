// =============================================================================
// Validação da diretoria — as regras, em módulo PURO.
//
// Reconstrução simples (25/09/2026) do que foi removido em 24/09. Toda a
// semântica cabe em quatro estados e duas perguntas: **o item entra no número?**
// e **o gestor pode editá-lo?**
//
//   pendente   (sem decisão)  → fora do número · gestor EDITA
//   aprovado                  → NO número      · gestor não edita
//   reprovado                 → fora do número · gestor não edita
//   revisar                   → fora do número · gestor EDITA (é o único
//                               estado em que ele mexe, e vem com o comentário
//                               do diretor dizendo o quê)
//
// A trava do gestor NÃO é uma coluna: deriva do status. O modelo antigo tinha
// um `diretoria_travado` escrito e liberado à mão, e foi ele que deixou
// colaboradores presos sem saída pela tela.
//
// Módulo puro: a mesma regra vale no servidor (filtrar a Prévia, recusar a
// escrita) e no cliente (desabilitar o campo, pintar o ✓). Se cada lado
// decidisse por conta, a tela deixaria digitar o que o servidor recusa.
// =============================================================================

export type ValidacaoStatus = "aprovado" | "reprovado" | "revisar";

/** O que a tela mostra por item — inclui o estado sem decisão. */
export type ValidacaoEstado = ValidacaoStatus | "pendente";

/** Tipos de alvo, um por método de orçamento. */
export type ValidacaoAlvoTipo =
  | "colaborador"
  | "media_linha"
  | "valor_fixo_contrato"
  | "planejamento_item"
  /**
   * A VIAGEM inteira — não cada custo dela. Pedido explícito do dono do
   * projeto: o diretor aprova ou reprova a viagem olhando a abertura por grupo
   * (passagem, hotel, alimentação), e não faria sentido aprovar a passagem e
   * reprovar o hotel da mesma ida. Mesmo enquadramento do colaborador no
   * Pessoal, que também é decidido por inteiro.
   */
  | "viagem";

/** Uma decisão, como ela é lida. */
export interface Validacao {
  alvoTipo: ValidacaoAlvoTipo;
  alvoId: string;
  status: ValidacaoStatus;
  comentario: string | null;
  decididoEm: string;
  decididoPor: string | null;
}

export const ESTADO_LABEL: Record<ValidacaoEstado, string> = {
  pendente: "Aguardando o diretor",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  revisar: "Revisar",
};

/**
 * A decisão VENCEU porque o item mudou depois dela?
 *
 * É o que dispensa hook em cada action de escrita: a decisão guarda a hora, e
 * qualquer UPDATE no item empurra o `updated_at` para depois dela. Caminho de
 * escrita novo já nasce coberto, e o que alguém esquecer de instrumentar
 * também.
 *
 * Empate conta como VÁLIDA: gravar a decisão e o item no mesmo instante é
 * artefato de relógio, não edição do gestor.
 */
export function decisaoVencida(
  decididoEm: string | null | undefined,
  itemAtualizadoEm: string | null | undefined,
): boolean {
  if (!decididoEm || !itemAtualizadoEm) return false;
  const d = Date.parse(decididoEm);
  const i = Date.parse(itemAtualizadoEm);
  if (!Number.isFinite(d) || !Number.isFinite(i)) return false;
  return i > d;
}

/**
 * Estado efetivo de um item: a decisão, ou 'pendente' quando não há nenhuma
 * ou quando a que havia venceu.
 */
export function estadoDoItem(
  validacao: Pick<Validacao, "status" | "decididoEm"> | null | undefined,
  itemAtualizadoEm: string | null | undefined,
): ValidacaoEstado {
  if (!validacao) return "pendente";
  if (decisaoVencida(validacao.decididoEm, itemAtualizadoEm)) return "pendente";
  return validacao.status;
}

/**
 * O item compõe o número da empresa?
 *
 * SÓ o aprovado (decisão do dono do projeto em 25/09/2026): a Prévia da
 * empresa passou a responder "o que está aprovado", e é ela que o
 * `publicarOrcamentoNoBudget` publica. Pendente e reprovado ficam de fora — e
 * a tela nomeia quanto ficou, porque total menor sem dizer o que faltou é o
 * tipo de número que leva à decisão errada.
 */
export function entraNoNumero(estado: ValidacaoEstado): boolean {
  return estado === "aprovado";
}

/**
 * O GESTOR (construtor) pode editar este item?
 *
 * Aprovado e reprovado são decisão tomada: mexer neles é do admin ou da
 * diretoria. 'revisar' é o convite explícito para ele editar — e a edição
 * vence a decisão (`decisaoVencida`), devolvendo o item à fila do diretor.
 */
export function gestorPodeEditar(estado: ValidacaoEstado): boolean {
  return estado === "pendente" || estado === "revisar";
}

/** Mensagem de recusa, para a action e para o `title` do campo na tela. */
export function motivoDaTrava(estado: ValidacaoEstado): string | null {
  if (gestorPodeEditar(estado)) return null;
  return estado === "aprovado"
    ? "Item já aprovado pela diretoria. Só um diretor ou o administrador pode alterá-lo."
    : "Item reprovado pela diretoria. Só um diretor ou o administrador pode alterá-lo.";
}

/** Quem decide. Admin entra junto: é ele quem opera o módulo. */
export function podeDecidir(papel: string): boolean {
  return papel === "validador" || papel === "admin";
}

// ─── Contadores (os números do card de cada método) ──────────────────────────

export interface ContagemValidacao {
  /** Sem decisão ou com decisão vencida — é a fila do DIRETOR. */
  pendentes: number;
  aprovados: number;
  reprovados: number;
  /** Devolvidos com comentário — é a fila do GESTOR. */
  revisar: number;
  total: number;
}

export const CONTAGEM_ZERO: ContagemValidacao = {
  pendentes: 0,
  aprovados: 0,
  reprovados: 0,
  revisar: 0,
  total: 0,
};

/**
 * Conta os itens por estado efetivo.
 *
 * Recebe os itens com o `atualizadoEm` de cada um, e não só os status, porque
 * uma decisão vencida tem de contar como PENDENTE nos dois cards: senão o
 * diretor não vê que voltou trabalho para ele.
 */
export function contarValidacoes(
  itens: readonly {
    atualizadoEm?: string | null;
    validacao?: Pick<Validacao, "status" | "decididoEm"> | null;
  }[],
): ContagemValidacao {
  const c: ContagemValidacao = { ...CONTAGEM_ZERO, total: itens.length };
  itens.forEach((i) => {
    switch (estadoDoItem(i.validacao, i.atualizadoEm)) {
      case "aprovado":
        c.aprovados += 1;
        break;
      case "reprovado":
        c.reprovados += 1;
        break;
      case "revisar":
        c.revisar += 1;
        break;
      default:
        c.pendentes += 1;
    }
  });
  return c;
}

/**
 * Conta estados JÁ RESOLVIDOS.
 *
 * Existe ao lado de `contarValidacoes` porque a Prévia já resolveu o estado de
 * cada item (inclusive o vencimento) ao montá-la, e refazer a conta a partir
 * das decisões cruas ali correria o risco de os dois números discordarem —
 * a tela mostraria "3 a verificar" com 4 itens marcados como pendentes.
 */
export function contarEstados(estados: readonly ValidacaoEstado[]): ContagemValidacao {
  const c: ContagemValidacao = { ...CONTAGEM_ZERO, total: estados.length };
  estados.forEach((e) => {
    if (e === "aprovado") c.aprovados += 1;
    else if (e === "reprovado") c.reprovados += 1;
    else if (e === "revisar") c.revisar += 1;
    else c.pendentes += 1;
  });
  return c;
}

/**
 * Chave do alvo da MÉDIA.
 *
 * Os outros três métodos têm uma linha com id; a média pode nem ter linha
 * gravada (o valor "vivo" do realizado aparece na tela antes de o gestor
 * salvar). Então ela é chaveada por (categoria, setor), que existe sempre.
 */
export function chaveMedia(categoryCode: string, setorId: string | null): string {
  return `${categoryCode}|${setorId ?? ""}`;
}
