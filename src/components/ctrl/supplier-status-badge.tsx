"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Indicativo de fornecedor NÃO HOMOLOGADO, exibido ao lado do nome do
 * fornecedor nas listagens de requisição (Contas a Pagar, Aprovações e modal de
 * detalhes).
 *
 * Desde a mudança de fluxo, um fornecedor pendente pode ser usado na criação da
 * requisição e ela segue normalmente pela aprovação — a trava só acontece no
 * envio para pagamento (Contas a Pagar). Este selo é o aviso antecipado de que
 * aquela requisição vai travar se o fornecedor não for homologado antes.
 */

/** Só "aprovado" libera o envio ao pagamento. */
export function isSupplierHomologado(status: string | null | undefined): boolean {
  return status === "aprovado";
}

/**
 * `status` ausente (telas/consultas que não trazem a coluna) é tratado como
 * homologado: sem o dado, o selo não pode afirmar o contrário. A trava real é
 * feita no servidor, que sempre lê o status direto do banco.
 */
export function SupplierNotApprovedBadge({
  status,
  className = "",
}: {
  status?: string | null;
  className?: string;
}) {
  if (status == null || isSupplierHomologado(status)) return null;

  const rejeitado = status === "rejeitado";
  return (
    <span
      title={
        rejeitado
          ? "Fornecedor rejeitado na tela de Fornecedores. O envio para pagamento está bloqueado."
          : "Fornecedor ainda não homologado. O envio para pagamento fica bloqueado até a homologação em Admin > Fornecedores."
      }
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        rejeitado
          ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
          : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
      } ${className}`}
    >
      <AlertTriangle className="h-3 w-3" />
      {rejeitado ? "Fornecedor rejeitado" : "Não homologado"}
    </span>
  );
}
