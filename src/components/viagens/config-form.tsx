"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { salvarViagemConfig } from "@/lib/viagens/actions/decisoes";
import type { ViagemConfigRow } from "@/lib/viagens/types";

const INPUT_CLS =
  "h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-teal-500/40";
const LABEL_CLS = "block text-xs font-medium text-ink-secondary mb-1";

const FIELDS: Array<{ key: keyof ViagemConfigRow; label: string; step?: string }> = [
  { key: "rate_per_km", label: "Reembolso por km (R$/km)" },
  { key: "aluguel_diaria", label: "Diária de aluguel de carro (R$)" },
  { key: "preco_combustivel_litro", label: "Combustível (R$/litro)" },
  { key: "consumo_km_litro", label: "Consumo médio (km/litro)" },
  { key: "tarifa_onibus_km", label: "Tarifa de ônibus (R$/km)", step: "0.0001" },
  { key: "diaria_alimentacao", label: "Diária de alimentação por pessoa (R$)" },
  { key: "hotel_diaria_padrao", label: "Diária de hotel padrão (R$)" },
];

export function ViagemConfigForm({ initial }: { initial: ViagemConfigRow }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, String(initial[f.key])])),
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    setSaving(true);
    const payload = Object.fromEntries(
      FIELDS.map((f) => [f.key, Number(values[f.key])]),
    ) as unknown as ViagemConfigRow;
    const res = await salvarViagemConfig(payload);
    setSaving(false);
    if ("error" in res) return setError(res.error);
    setMsg("Configuração salva.");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-border bg-surface-1 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className={LABEL_CLS}>{f.label}</label>
            <input
              type="number"
              min={0}
              step={f.step ?? "0.01"}
              value={values[f.key]}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              className={INPUT_CLS}
            />
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {msg && <p className="text-sm text-emerald-600 dark:text-emerald-400">{msg}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
        </button>
      </div>
    </form>
  );
}
