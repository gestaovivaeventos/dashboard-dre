"use client";

import { useState } from "react";
import { Circle, Lock } from "lucide-react";

import { NovoContratoForm } from "@/components/case/novo-contrato-form";
import type { CaseBandRow, CaseClientRow } from "@/lib/case/types";

// Mesma casca de abas do workspace, porém em modo "novo": a aba Contrato Cliente
// é o formulário de criação; Atração e Financeiro ficam travados até salvar
// (precisam do contrato criado). Ao salvar, o form redireciona pro workspace.
export function NovoContratoTabs({ clients, bands }: { clients: CaseClientRow[]; bands: CaseBandRow[] }) {
  const [tab, setTab] = useState<"cliente" | "atracao">("cliente");

  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setTab("cliente")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === "cliente" ? "border-amber-600 text-ink-primary" : "border-transparent text-ink-muted hover:text-ink-secondary"
          }`}
        >
          <Circle className="h-4 w-4 text-ink-muted" />
          Contrato Cliente
        </button>
        <button
          type="button"
          onClick={() => setTab("atracao")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === "atracao" ? "border-amber-600 text-ink-primary" : "border-transparent text-ink-muted hover:text-ink-secondary"
          }`}
        >
          <Lock className="h-4 w-4 text-ink-muted" />
          Contrato Atração
        </button>
      </div>

      <div className="pt-4">
        {tab === "cliente" ? (
          <NovoContratoForm clients={clients} bands={bands} />
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-surface-1 p-8 text-center">
            <Lock className="mx-auto h-6 w-6 text-ink-muted" />
            <p className="mt-2 text-sm font-medium text-ink-primary">Etapa bloqueada</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
              Preencha e salve o <strong>Contrato Cliente</strong> primeiro. Depois que o contrato for gerado
              e enviado para assinatura, esta aba libera para você subir o contrato do artista e lançar o pagamento.
            </p>
          </div>
        )}
      </div>

      <section className="rounded-lg border border-border bg-surface-1 p-4">
        <h2 className="text-sm font-semibold text-ink-primary">Financeiro</h2>
        <p className="mt-2 flex items-center gap-2 text-sm text-ink-muted">
          <Circle className="h-4 w-4" /> Os lançamentos (a receber do cliente e a pagar do artista) aparecem aqui
          depois que você concluir o Contrato Atração.
        </p>
      </section>
    </div>
  );
}
