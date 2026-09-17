// Tipos e rótulos dos Chamados (suporte). Fica FORA de actions.ts porque um
// arquivo "use server" só pode exportar funções async — constantes e tipos
// (valores em runtime) precisam morar num módulo comum, compartilhado entre a
// server action e o client.

export type TicketCategory = "melhoria" | "bug";
export type TicketStatus =
  | "aberto"
  | "em_analise"
  | "aguardando_resposta"
  | "resolvido"
  | "fechado";
export type TicketPriority = "baixa" | "media" | "alta";

export interface TicketAuthor {
  name: string | null;
  email: string | null;
}

export interface SupportAdmin {
  id: string;
  name: string | null;
  email: string | null;
}

export interface TicketListItem {
  id: string;
  ticket_number: number;
  title: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority | null;
  created_at: string;
  updated_at: string;
  author: TicketAuthor | null;
  assignee_id: string | null;
  assignee: TicketAuthor | null;
}

export interface TicketAttachment {
  id: string;
  name: string;
  mime: string | null;
  size: number | null;
  url: string | null;
}

export interface TicketDetail extends TicketListItem {
  description: string;
}

export interface TicketMessage {
  id: string;
  body: string;
  created_at: string;
  author: TicketAuthor | null;
  /** true quando quem escreveu é o próprio solicitante (do contrário, é a equipe). */
  fromRequester: boolean;
}

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  aberto: "Aberto",
  em_analise: "Em análise",
  aguardando_resposta: "Aguardando resposta",
  resolvido: "Resolvido",
  fechado: "Fechado",
};
