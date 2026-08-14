// ============================================================================
// Catálogo das regras NOMINAIS do sistema — as exceções que vivem no código e
// não aparecem em nenhuma tela de cadastro.
//
// Por que existe: acordos de negócio como "este gerente só aprova 4 setores" ou
// "esta pessoa acompanha o Compras inteiro" não têm campo no banco; ficam fixos
// no código (routing.ts, full-view.ts, bi-validation.ts). Sem uma vitrine, o
// admin não tem como saber que existem — e conclui que a tela de Usuários está
// com defeito quando alguém vê (ou deixa de ver) algo fora do padrão do perfil.
//
// Este módulo NÃO define regra nenhuma: ele LÊ as fontes de verdade e as
// descreve em português. Ao criar uma regra nominal nova, adicione a leitura
// dela aqui — é o que mantém a tela de Usuários honesta.
//
// Client-safe: só importa constantes e funções puras.
// ============================================================================

import { BI_VALIDATION_EXTRA_EMAILS } from "@/lib/auth/bi-validation";
import { CTRL_FULL_VIEW_EMAILS } from "@/lib/ctrl/full-view";
import {
  APPROVAL_ROUTING,
  APPROVER_SECTOR_RESTRICTIONS,
  DIRECTOR_HIGHLIGHT_SECTORS,
} from "@/lib/ctrl/routing";

export interface UserException {
  /** Identificador estável da regra (chave de render). */
  key: string;
  /** Módulo onde a exceção age — vira o rótulo colorido no diálogo. */
  scope: "Compras" | "Financeiro";
  title: string;
  detail: string;
  /** Arquivo que precisa ser editado para mudar a regra. */
  source: string;
}

export interface UserRef {
  id: string;
  email: string;
  name?: string;
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Todas as exceções nominais que se aplicam a um usuário. Lista vazia = o
 * usuário segue exatamente as regras do perfil dele.
 */
export function describeUserExceptions(user: UserRef): UserException[] {
  const email = normalizeEmail(user.email);
  const out: UserException[] = [];

  // ── Compras: alçada de aprovação restrita (routing.ts) ────────────────────
  const restriction = APPROVER_SECTOR_RESTRICTIONS.find(
    (r) => normalizeEmail(r.email) === email,
  );
  if (restriction) {
    out.push({
      key: "approver-sector-restriction",
      scope: "Compras",
      title: "Alçada de aprovação restrita",
      detail:
        `Mesmo vinculado a outros setores na tela de Usuários (o que ele precisa para CRIAR ` +
        `requisições), só responde por: ${restriction.allowedSectorNames.join(", ")}. ` +
        `Vale na tela de Aprovações, nas ações do servidor e no lembrete diário por e-mail — e ` +
        `também na tela de Requisições, onde estes setores (e não os vínculos) definem quais ` +
        `requisições de terceiros ele enxerga.`,
      source: "src/lib/ctrl/routing.ts",
    });
  }

  // ── Compras: responsável por setores fora do perfil diretor (routing.ts) ──
  const highlight = DIRECTOR_HIGHLIGHT_SECTORS.find(
    (r) => normalizeEmail(r.email) === email,
  );
  if (highlight) {
    out.push({
      key: "director-highlight-sectors",
      scope: "Compras",
      title: "Diretor responsável por setores (sem o perfil Diretor)",
      detail:
        `Responsável pela aprovação de: ${highlight.sectorNames.join(", ")}. ` +
        `Esses setores aparecem destacados como "Do seu setor" na tela de Aprovações e ele ` +
        `entra na etapa do DIRETOR do lembrete diário por e-mail, restrito a eles — ou seja, ` +
        `recebe o aviso quando o gerente já aprovou e a requisição desses setores aguarda o diretor.`,
      source: "src/lib/ctrl/routing.ts",
    });
  }

  // ── Compras: visão completa do módulo (full-view.ts) ─────────────────────
  if (CTRL_FULL_VIEW_EMAILS.has(email)) {
    out.push({
      key: "ctrl-full-view",
      scope: "Compras",
      title: "Visão completa do módulo Compras",
      detail:
        "Enxerga o módulo inteiro (Requisições de todos, Aprovações, Contas a Pagar com ações, " +
        "Orçamento, Relatórios e Fornecedores) sem que o perfil mude. NÃO ganha alçada: continua " +
        "aprovando apenas os setores vinculados a ele. Configurações seguem admin-only.",
      source: "src/lib/ctrl/full-view.ts",
    });
  }

  // ── Financeiro: liberação nominal da Validação Relatório ─────────────────
  if (BI_VALIDATION_EXTRA_EMAILS.has(email)) {
    out.push({
      key: "bi-validation-extra",
      scope: "Financeiro",
      title: 'Acesso à tela "Validação Relatório"',
      detail:
        "Liberação nominal: a tela é fechada ao perfil CSC e a admins, e este e-mail entra por " +
        "exceção. A mesma lista é espelhada no banco (can_validate_bi_reports) para as policies.",
      source: "src/lib/auth/bi-validation.ts",
    });
  }

  // ── Compras: roteamento fixo por ID (routing.ts) ─────────────────────────
  if (user.id === APPROVAL_ROUTING.directorOnly.requesterId) {
    out.push({
      key: "routing-requester",
      scope: "Compras",
      title: "Solicitante com rota direta ao diretor",
      detail:
        "As requisições criadas por este usuário pulam a etapa do gerente e já nascem aguardando " +
        "um diretor fixo — independentemente do orçamento.",
      source: "src/lib/ctrl/routing.ts",
    });
  }
  if (user.id === APPROVAL_ROUTING.directorOnly.directorId) {
    out.push({
      key: "routing-director",
      scope: "Compras",
      title: "Diretor fixo do solicitante especial",
      detail:
        "É o ÚNICO aprovador das requisições daquele solicitante — nem outros diretores nem os " +
        "responsáveis por setor são acionados nesses casos.",
      source: "src/lib/ctrl/routing.ts",
    });
  }
  if (user.id === APPROVAL_ROUTING.expenseTypeManager.managerId) {
    out.push({
      key: "routing-expense-manager",
      scope: "Compras",
      title: "Gerente fixo de um tipo de despesa",
      detail:
        "A etapa de gerente das requisições do tipo de despesa Capacitações e Treinamentos é " +
        "sempre direcionada a ele, qualquer que seja o setor.",
      source: "src/lib/ctrl/routing.ts",
    });
  }

  return out;
}

export function hasUserExceptions(user: UserRef): boolean {
  return describeUserExceptions(user).length > 0;
}

/** Regras que existem no código e não casaram com nenhum usuário carregado. */
export interface OrphanExceptionRule {
  key: string;
  label: string;
  reason: string;
}

/**
 * Regras nominais órfãs — o e-mail/ID do código não existe (ou mudou) na base de
 * usuários. São silenciosas em produção: a regra simplesmente deixa de valer.
 * A tela de Usuários mostra isso para o admin perceber.
 */
export function findOrphanExceptionRules(users: UserRef[]): OrphanExceptionRule[] {
  const emails = new Set(users.map((u) => normalizeEmail(u.email)));
  const ids = new Set(users.map((u) => u.id));
  const out: OrphanExceptionRule[] = [];

  const byEmail: Array<{ key: string; email: string; label: string }> = [
    ...APPROVER_SECTOR_RESTRICTIONS.map((r) => ({
      key: `restriction:${r.email}`,
      email: r.email,
      label: "Alçada de aprovação restrita",
    })),
    ...DIRECTOR_HIGHLIGHT_SECTORS.map((r) => ({
      key: `highlight:${r.email}`,
      email: r.email,
      label: "Diretor responsável por setores",
    })),
    ...Array.from(CTRL_FULL_VIEW_EMAILS).map((email) => ({
      key: `fullview:${email}`,
      email,
      label: "Visão completa do módulo Compras",
    })),
    ...Array.from(BI_VALIDATION_EXTRA_EMAILS).map((email) => ({
      key: `bi:${email}`,
      email,
      label: 'Acesso à tela "Validação Relatório"',
    })),
  ];

  for (const rule of byEmail) {
    if (!emails.has(normalizeEmail(rule.email))) {
      out.push({
        key: rule.key,
        label: rule.label,
        reason: `Nenhum usuário com o e-mail ${rule.email}.`,
      });
    }
  }

  const byId: Array<{ key: string; id: string; label: string }> = [
    {
      key: "routing:requester",
      id: APPROVAL_ROUTING.directorOnly.requesterId,
      label: "Solicitante com rota direta ao diretor",
    },
    {
      key: "routing:director",
      id: APPROVAL_ROUTING.directorOnly.directorId,
      label: "Diretor fixo do solicitante especial",
    },
    {
      key: "routing:manager",
      id: APPROVAL_ROUTING.expenseTypeManager.managerId,
      label: "Gerente fixo de um tipo de despesa",
    },
  ];

  for (const rule of byId) {
    if (!ids.has(rule.id)) {
      out.push({
        key: rule.key,
        label: rule.label,
        reason: `Nenhum usuário com o ID ${rule.id}.`,
      });
    }
  }

  return out;
}

/**
 * Regras fixas que NÃO são por usuário — entram no mesmo diálogo porque também
 * são invisíveis nas telas de cadastro e explicam comportamentos "estranhos" de
 * aprovação.
 */
export const NON_USER_RULES: ReadonlyArray<{ title: string; detail: string; source: string }> = [
  {
    title: "Setor Diretoria vai direto ao diretor",
    detail:
      "Requisições do setor Diretoria pulam a etapa do gerente mesmo dentro do orçamento. Não é " +
      '"fora do orçamento" — é roteamento por regra.',
    source: "src/lib/ctrl/routing.ts",
  },
];
