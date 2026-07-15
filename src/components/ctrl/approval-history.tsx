"use client";

import { useEffect, useState } from "react";

import {
  getApprovalHistory,
  type ApprovalHistoryEntry,
} from "@/lib/ctrl/actions/requests";

// Etapa que ainda aguarda decisão (quando aplicável). Passada pelo chamador, que
// conhece o status atual da requisição — em telas onde a requisição já está
// aprovada/enviada (Contas a Pagar) fica null.
export type PendingStage = "gerente" | "diretor" | null;

const STAGE_LABEL: Record<"gerente" | "diretor", string> = {
  gerente: "Gerente",
  diretor: "Diretor",
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// "Histórico de aprovações" — lê os eventos persistentes de decisão (ctrl_history
// via getApprovalHistory) e os exibe em ordem cronológica. Como a fonte é o
// banco, o histórico permanece após a aprovação, reload, troca de status ou
// quando a requisição já passou para contas a pagar. Reutilizado na tela de
// Aprovações e no modal de detalhes de Contas a Pagar.
export function ApprovalHistory({
  requestId,
  pending = null,
  showTitle = true,
}: {
  requestId: string;
  pending?: PendingStage;
  // Suprime o <h4> interno quando o chamador já fornece um cabeçalho de seção.
  showTitle?: boolean;
}) {
  const [entries, setEntries] = useState<ApprovalHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError(null);
    (async () => {
      const res = await getApprovalHistory(requestId);
      if (!alive) return;
      if (res.error) {
        setError(res.error);
        setEntries([]);
        return;
      }
      setEntries(res.entries ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [requestId]);

  return (
    <div>
      {showTitle && (
        <h4 className="mb-3 text-sm font-semibold">Histórico de aprovações</h4>
      )}

      {entries === null ? (
        <p className="text-xs text-muted-foreground">Carregando histórico…</p>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : entries.length === 0 && !pending ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma aprovação registrada ainda.
        </p>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <ApprovalHistoryItem key={e.id} entry={e} />
          ))}

          {pending && (
            <div className="rounded-md border border-dashed px-3 py-2">
              <p className="text-sm font-semibold">{STAGE_LABEL[pending]}</p>
              <p className="text-xs text-muted-foreground">Pendente de aprovação</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalHistoryItem({ entry }: { entry: ApprovalHistoryEntry }) {
  const actor = entry.actorName ?? entry.actorEmail ?? "—";

  // Cabeçalho: etapa (Gerente/Diretor) quando houver; senão o tipo da ação.
  const heading = entry.stage
    ? STAGE_LABEL[entry.stage]
    : entry.action === "rejeitado"
    ? "Rejeição"
    : entry.action === "estornado"
    ? "Estorno"
    : "Aprovação";

  const accent =
    entry.action === "aprovado"
      ? "border-green-200 bg-green-50 dark:border-green-900/40 dark:bg-green-950/20"
      : entry.action === "rejeitado"
      ? "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20"
      : "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20";

  return (
    <div className={`rounded-md border px-3 py-2 ${accent}`}>
      <p className="text-sm font-semibold">{heading}</p>

      {entry.action === "aprovado" && entry.autoApproved ? (
        <>
          <p className="text-sm">Aprovação automática</p>
          <p className="text-sm">Solicitante: {actor}</p>
          <p className="text-xs text-muted-foreground">
            Motivo: solicitante é gerente e a despesa está prevista em orçamento
          </p>
        </>
      ) : entry.action === "aprovado" ? (
        <p className="text-sm">Aprovado por: {actor}</p>
      ) : entry.action === "rejeitado" ? (
        <>
          <p className="text-sm">Rejeitado por: {actor}</p>
          {entry.comment && (
            <p className="text-xs text-muted-foreground">Motivo: {entry.comment}</p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm">Estornado por: {actor}</p>
          {entry.comment && (
            <p className="text-xs text-muted-foreground">Motivo: {entry.comment}</p>
          )}
        </>
      )}

      <p className="mt-0.5 text-xs text-muted-foreground">
        Data: {fmtDateTime(entry.createdAt)}
      </p>
    </div>
  );
}
