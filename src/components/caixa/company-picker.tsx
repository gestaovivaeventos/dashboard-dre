"use client";

// Escopo das ações de sincronizar/atualizar: todas as empresas ou algumas.
//
// Existe porque varrer o grupo inteiro custa ~80s, e o caso mais comum depois
// de uma falha é querer refazer só as duas que falharam. Por isso o atalho
// "só as desatualizadas" — é o motivo nº 1 para reabrir a tela.

import { useMemo, useRef, useState } from "react";
import { Building2, ChevronDown, Search } from "lucide-react";

import { AnchoredPopover } from "@/components/common/anchored-popover";
import {
  allShownSelected,
  noneShownSelected,
  setAllShown,
  toggleValue,
} from "@/components/data-table/filter-logic";

export interface PickerCompany {
  id: string;
  name: string;
}

interface Props {
  companies: PickerCompany[];
  /**
   * `null` = todas (padrão). Um Set — inclusive VAZIO — é escolha explícita.
   *
   * A distinção importa: com "vazio = todas", desmarcar a última empresa faria
   * tudo voltar a ficar marcado, que é o oposto do que o clique pediu. Mesma
   * convenção (e mesmas funções) do filtro da tabela.
   */
  selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
  /** Empresas com alguma conta sem saldo de hoje. Alimenta o atalho. */
  staleIds: Set<string>;
  disabled?: boolean;
}

export function CompanyPicker({
  companies,
  selected,
  onChange,
  staleIds,
  disabled = false,
}: Props) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const todas = selected === null;
  const escolhidas = selected?.size ?? companies.length;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) => c.name.toLowerCase().includes(q));
  }, [companies, search]);

  const staleCount = companies.filter((c) => staleIds.has(c.id)).length;

  const allIds = useMemo(() => companies.map((c) => c.id), [companies]);
  // Os botões operam sobre o que a BUSCA mostra (sem busca, a lista inteira).
  const shownIds = useMemo(() => shown.map((c) => c.id), [shown]);
  const marcadosTodos = allShownSelected(selected, shownIds);
  const nenhumMarcado = noneShownSelected(selected, shownIds);

  function toggle(id: string) {
    // Reaproveita a semântica do filtro (null = todas, marcar tudo de novo
    // volta a null), que já é coberta por testes.
    onChange(toggleValue(selected, id, allIds));
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-viva-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
          todas
            ? "border-border bg-surface-1 text-ink-secondary hover:bg-surface-2"
            : "border-viva-200 bg-viva-50 text-viva-700 hover:bg-viva-100"
        }`}
      >
        <Building2 className="h-4 w-4" />
        {todas ? `Todas as empresas (${companies.length})` : `${escolhidas} de ${companies.length}`}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>

      {open && (
        <AnchoredPopover
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          width={280}
          label="Escolher empresas"
        >
          <div className="relative border-b border-border p-1.5">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-disabled" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar empresa…"
              className="w-full rounded-viva-sm border border-border bg-surface-0 py-1.5 pl-8 pr-2 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-viva-200"
            />
          </div>

          <div className="flex items-center gap-1 border-b border-border p-1.5">
            <button
              type="button"
              disabled={marcadosTodos}
              onClick={() => onChange(setAllShown(selected, shownIds, allIds, true))}
              className="flex-1 rounded-viva-sm px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Marcar todos
            </button>
            <button
              type="button"
              disabled={nenhumMarcado}
              onClick={() => onChange(setAllShown(selected, shownIds, allIds, false))}
              className="flex-1 rounded-viva-sm px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Desmarcar todos
            </button>
          </div>

          {staleCount > 0 && (
            <div className="border-b border-border p-1.5">
              <button
                type="button"
                onClick={() =>
                  onChange(new Set(companies.filter((c) => staleIds.has(c.id)).map((c) => c.id)))
                }
                className="w-full rounded-viva-sm px-2 py-1 text-xs text-status-warning hover:bg-surface-2"
                title="Empresas com alguma conta ativa sem saldo de hoje"
              >
                Só as desatualizadas ({staleCount})
              </button>
            </div>
          )}

          <div className="max-h-64 overflow-y-auto py-1">
            {shown.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-ink-muted">Nenhuma empresa.</p>
            ) : (
              shown.map((company) => {
                const checked = selected === null || selected.has(company.id);
                return (
                  <button
                    key={company.id}
                    type="button"
                    onClick={() => toggle(company.id)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-secondary hover:bg-surface-2"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border ${
                        checked ? "border-viva-500 bg-viva-500 text-white" : "border-border bg-surface-0"
                      }`}
                    >
                      {checked && (
                        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
                          <path
                            d="M2.5 6.2l2.3 2.3 4.7-5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="truncate">{company.name}</span>
                    {staleIds.has(company.id) && (
                      <span
                        className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-status-warning"
                        title="Tem conta sem saldo de hoje"
                      />
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border p-1.5">
            <span className="px-1 text-xs text-ink-muted">
              {todas
                ? "Todas"
                : escolhidas === 0
                ? "Nenhuma — escolha ao menos uma"
                : `${escolhidas} selecionada(s)`}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-viva-sm bg-viva-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-viva-600"
            >
              Concluir
            </button>
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}
