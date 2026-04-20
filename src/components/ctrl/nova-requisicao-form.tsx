"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createRequest } from "@/lib/ctrl/actions/requests";
import type { CtrlExpenseType, CtrlSector, CtrlSupplier } from "@/lib/supabase/types";

interface NovaRequisicaoFormProps {
  sectors: CtrlSector[];
  expenseTypes: CtrlExpenseType[];
  suppliers: CtrlSupplier[];
}

export function NovaRequisicaoForm({ sectors, expenseTypes, suppliers }: NovaRequisicaoFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const amountRaw = (form.get("amount") as string).replace(",", ".");

    const result = await createRequest({
      title: form.get("title") as string,
      description: (form.get("description") as string) || undefined,
      sector_id: form.get("sector_id") as string,
      expense_type_id: (form.get("expense_type_id") as string) || undefined,
      supplier_id: (form.get("supplier_id") as string) || undefined,
      amount: parseFloat(amountRaw),
      due_date: (form.get("due_date") as string) || undefined,
    });

    setLoading(false);

    if ("error" in result && result.error) {
      setError(result.error);
      return;
    }

    router.push("/ctrl/requisicoes");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Título */}
      <div className="space-y-1.5">
        <label htmlFor="title" className="text-sm font-medium">
          Título <span className="text-destructive">*</span>
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          placeholder="Ex: Pagamento de serviço de limpeza"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
        />
      </div>

      {/* Descrição */}
      <div className="space-y-1.5">
        <label htmlFor="description" className="text-sm font-medium">
          Descrição
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          placeholder="Detalhes adicionais sobre a requisição..."
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
        />
      </div>

      {/* Setor + Tipo de Despesa */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="sector_id" className="text-sm font-medium">
            Setor <span className="text-destructive">*</span>
          </label>
          <select
            id="sector_id"
            name="sector_id"
            required
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="">Selecione o setor</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="expense_type_id" className="text-sm font-medium">
            Tipo de Despesa
          </label>
          <select
            id="expense_type_id"
            name="expense_type_id"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="">Selecione (opcional)</option>
            {expenseTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Fornecedor */}
      <div className="space-y-1.5">
        <label htmlFor="supplier_id" className="text-sm font-medium">
          Fornecedor
        </label>
        <select
          id="supplier_id"
          name="supplier_id"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="">Selecione (opcional)</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}{s.cnpj_cpf ? ` — ${s.cnpj_cpf}` : ""}
            </option>
          ))}
        </select>
        {suppliers.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nenhum fornecedor aprovado cadastrado.
          </p>
        )}
      </div>

      {/* Valor + Data de Vencimento */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="amount" className="text-sm font-medium">
            Valor (R$) <span className="text-destructive">*</span>
          </label>
          <input
            id="amount"
            name="amount"
            type="text"
            inputMode="decimal"
            required
            placeholder="0,00"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="due_date" className="text-sm font-medium">
            Data de Vencimento
          </label>
          <input
            id="due_date"
            name="due_date"
            type="date"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 border-t pt-4">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={loading}
          className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
        >
          {loading ? "Enviando..." : "Enviar Requisição"}
        </button>
      </div>
    </form>
  );
}
