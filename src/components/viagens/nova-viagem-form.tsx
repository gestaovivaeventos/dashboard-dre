"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { criarRequisicao } from "@/lib/viagens/actions/requests";
import type { ViagemModoCarro } from "@/lib/viagens/types";

const INPUT_CLS =
  "h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-teal-500/40";
const LABEL_CLS = "block text-xs font-medium text-ink-secondary mb-1";
const SECTION_CLS = "rounded-lg border border-border bg-surface-1 p-4 space-y-3";

export function NovaViagemForm() {
  const router = useRouter();
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [dataIda, setDataIda] = useState("");
  const [dataVolta, setDataVolta] = useState("");
  const [janela, setJanela] = useState(0);
  const [passageiros, setPassageiros] = useState(1);
  const [modoCarro, setModoCarro] = useState<ViagemModoCarro>("ambos");
  const [incluirHospedagem, setIncluirHospedagem] = useState(true);
  const [monitorar, setMonitorar] = useState(true);
  const [observacao, setObservacao] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (!origem.trim() || !destino.trim()) return setError("Informe origem e destino.");
    if (!dataIda || !dataVolta) return setError("Informe as datas de ida e volta.");
    if (dataVolta < dataIda) return setError("A volta não pode ser antes da ida.");

    setSubmitting(true);
    const res = await criarRequisicao({
      origem: origem.trim(),
      destino: destino.trim(),
      data_ida: dataIda,
      data_volta: dataVolta,
      janela_flex_dias: janela,
      passageiros,
      modo_carro: modoCarro,
      incluir_hospedagem: incluirHospedagem,
      monitorar,
      observacao: observacao.trim() || null,
    });
    if ("error" in res) {
      setSubmitting(false);
      return setError(res.error);
    }
    router.push(`/viagens/requisicoes/${res.requestId}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className={SECTION_CLS}>
        <h2 className="text-sm font-semibold text-ink-primary">Trajeto e período</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLS}>Origem (cidade/UF)</label>
            <input value={origem} onChange={(e) => setOrigem(e.target.value)} placeholder="Ex.: Belo Horizonte/MG" className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Destino (cidade/UF)</label>
            <input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Ex.: São Paulo/SP" className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Ida</label>
            <input type="date" value={dataIda} onChange={(e) => setDataIda(e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Volta</label>
            <input type="date" value={dataVolta} onChange={(e) => setDataVolta(e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Flexibilidade de datas</label>
            <select value={janela} onChange={(e) => setJanela(Number(e.target.value))} className={INPUT_CLS}>
              <option value={0}>Datas exatas</option>
              <option value={1}>± 1 dia</option>
              <option value={2}>± 2 dias</option>
              <option value={3}>± 3 dias</option>
              <option value={5}>± 5 dias</option>
              <option value={7}>± 7 dias</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Passageiros</label>
            <input
              type="number"
              min={1}
              max={30}
              value={passageiros}
              onChange={(e) => setPassageiros(Math.max(1, Number(e.target.value) || 1))}
              className={INPUT_CLS}
            />
          </div>
        </div>
      </div>

      <div className={SECTION_CLS}>
        <h2 className="text-sm font-semibold text-ink-primary">Opções de cotação</h2>
        <div>
          <label className={LABEL_CLS}>Custo do carro</label>
          <div className="flex flex-wrap gap-4 pt-1">
            {(
              [
                ["ambos", "Comparar os dois"],
                ["km", "Reembolso por km"],
                ["aluguel", "Aluguel de carro"],
              ] as Array<[ViagemModoCarro, string]>
            ).map(([value, label]) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-ink-secondary">
                <input type="radio" name="modo_carro" checked={modoCarro === value} onChange={() => setModoCarro(value)} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-6">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-secondary">
            <input type="checkbox" checked={incluirHospedagem} onChange={(e) => setIncluirHospedagem(e.target.checked)} className="h-4 w-4 rounded border-border" />
            Incluir hospedagem
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-secondary">
            <input type="checkbox" checked={monitorar} onChange={(e) => setMonitorar(e.target.checked)} className="h-4 w-4 rounded border-border" />
            Monitorar preço (re-cota todo dia e avisa quando cair)
          </label>
        </div>
        <div>
          <label className={LABEL_CLS}>Observação</label>
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={2}
            placeholder="Motivo da viagem, preferências…"
            className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-teal-500/40"
          />
        </div>
      </div>

      {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">{error}</div>}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => router.push("/viagens/requisicoes")} className="rounded-md border border-border px-4 py-2 text-sm text-ink-secondary hover:bg-surface-2">
          Cancelar
        </button>
        <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Pedir cotação
        </button>
      </div>
    </form>
  );
}
