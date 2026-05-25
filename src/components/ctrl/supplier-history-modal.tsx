"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  History,
  Loader2,
  PencilLine,
  PlusCircle,
  X,
  XCircle,
} from "lucide-react";

import {
  getSupplierHistory,
  type SupplierHistoryEntry,
} from "@/lib/ctrl/actions/suppliers";
import { PIX_KEY_TYPES } from "@/lib/ctrl/bancos";

interface Props {
  supplierId: string;
  supplierName: string;
  onClose: () => void;
}

// Labels amigaveis pros campos rastreados em ctrl_supplier_history.changes.
const FIELD_LABEL: Record<string, string> = {
  name: "Nome",
  cnpj_cpf: "CNPJ/CPF",
  email: "E-mail",
  phone: "Telefone",
  chave_pix: "Chave PIX",
  pix_key_type: "Tipo PIX",
  banco: "Banco",
  agencia: "Agência",
  conta_corrente: "Conta corrente",
  titular_banco: "Titular",
  doc_titular: "Doc. titular",
  transf_padrao: "Transf. padrão",
  pix_padrao: "PIX padrão",
};

function formatFieldValue(field: string, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  if (typeof raw === "boolean") return raw ? "Sim" : "Não";
  if (field === "pix_key_type") {
    return PIX_KEY_TYPES.find((p) => p.value === raw)?.label ?? String(raw);
  }
  return String(raw);
}

const ACTION_META: Record<
  string,
  { label: string; icon: typeof PencilLine; className: string }
> = {
  criado: { label: "Cadastrado", icon: PlusCircle, className: "text-blue-600" },
  editado: { label: "Editado", icon: PencilLine, className: "text-amber-600" },
  aprovado: { label: "Aprovado", icon: CheckCircle2, className: "text-green-600" },
  rejeitado: { label: "Rejeitado", icon: XCircle, className: "text-red-600" },
};

export function SupplierHistoryModal({ supplierId, supplierName, onClose }: Props) {
  const [entries, setEntries] = useState<SupplierHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const result = await getSupplierHistory(supplierId);
      if (!alive) return;
      if (result.error) {
        setError(result.error);
        setEntries([]);
        return;
      }
      setEntries(result.entries ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [supplierId]);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Histórico do fornecedor</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{supplierName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto bg-muted/20 px-6 py-5">
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {entries === null ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Clock className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Nenhuma alteração registrada ainda.
              </p>
            </div>
          ) : (
            <ol className="relative space-y-4 border-l border-border/50 pl-6">
              {entries.map((entry) => {
                const meta = ACTION_META[entry.action] ?? {
                  label: entry.action,
                  icon: PencilLine,
                  className: "text-muted-foreground",
                };
                const Icon = meta.icon;
                const author =
                  entry.user?.name ?? entry.user?.email ?? "Usuário desconhecido";
                return (
                  <li key={entry.id} className="relative">
                    <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border bg-background shadow-sm">
                      <Icon className={`h-3.5 w-3.5 ${meta.className}`} />
                    </span>
                    <div className="rounded-lg border bg-background p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className={`text-sm font-semibold ${meta.className}`}>
                          {meta.label}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {fmtDate(entry.createdAt)}
                        </p>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        por <span className="font-medium text-foreground">{author}</span>
                      </p>
                      {entry.comment && (
                        <p className="mt-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs">
                          {entry.comment}
                        </p>
                      )}
                      {entry.changes && Object.keys(entry.changes).length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs">
                          {Object.entries(entry.changes).map(([field, [before, after]]) => (
                            <li key={field} className="flex flex-wrap items-center gap-1">
                              <span className="font-medium text-foreground">
                                {FIELD_LABEL[field] ?? field}:
                              </span>
                              <span className="rounded bg-red-50 px-1.5 py-0.5 font-mono text-red-700 line-through dark:bg-red-950/30 dark:text-red-300">
                                {formatFieldValue(field, before)}
                              </span>
                              <span className="text-muted-foreground">→</span>
                              <span className="rounded bg-green-50 px-1.5 py-0.5 font-mono text-green-700 dark:bg-green-950/30 dark:text-green-300">
                                {formatFieldValue(field, after)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {entry.action === "editado" && (!entry.changes || Object.keys(entry.changes).length === 0) && (
                        <p className="mt-2 text-xs text-muted-foreground italic">
                          Nenhum campo alterado.
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="border-t px-6 py-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
