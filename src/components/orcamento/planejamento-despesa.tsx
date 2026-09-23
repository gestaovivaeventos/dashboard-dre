"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import {
  adicionarItemPlanejamento,
  alterarItemPlanejamento,
} from "@/lib/orcamento/actions/validacao";
import type { PlanejamentoListItem } from "@/lib/orcamento/actions/planejamento-socios";
import { PERIODICIDADES } from "@/lib/orcamento/planejamento-calc";
import { formatBRL, parseBrNumber } from "@/lib/orcamento/format";
import { cn } from "@/lib/utils";

const MESES_CURTOS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

type Despesa = PlanejamentoListItem["itensProposta"][number];

/**
 * Quadro de uma despesa do planejamento: onde o dinheiro sai, mês a mês, e os
 * campos que a diretoria pode alterar.
 *
 * A série mensal é o ponto. "R$ 1.000 trimestral" não diz em QUAIS meses o
 * pagamento cai, e é a frequência que a diretoria precisa enxergar para
 * decidir — o total do ano sozinho esconde isso.
 */
export function DespesaDetalhe({
  companyId,
  year,
  categoryCode,
  setorId,
  despesa,
  podeEditar,
  onSalvo,
  onError,
}: {
  companyId: string;
  year: number;
  categoryCode: string;
  setorId: string | null;
  despesa: Despesa;
  podeEditar: boolean;
  onSalvo: () => void;
  onError: (msg: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [descricao, setDescricao] = useState(despesa.descricao);
  const [valor, setValor] = useState(String(despesa.valorMensal).replace(".", ","));
  const [periodicidade, setPeriodicidade] = useState<string>(despesa.periodicidade);
  const [mesInicio, setMesInicio] = useState(String(despesa.mesInicio));
  const [mesFim, setMesFim] = useState(despesa.mesFim == null ? "" : String(despesa.mesFim));

  async function salvar() {
    const v = parseBrNumber(valor);
    if (v == null || v < 0) {
      onError("Informe o valor da despesa.");
      return;
    }
    setSalvando(true);
    const res = await alterarItemPlanejamento({
      companyId,
      year,
      categoryCode,
      setorId,
      indice: despesa.indice,
      // A descrição ATUAL vai junto: é a trava contra corrida, caso a proposta
      // tenha mudado desde que a tela carregou.
      descricao: despesa.descricao,
      descricaoNova: descricao,
      valorMensal: v,
      periodicidade,
      mesInicio: Number(mesInicio),
      mesFim: mesFim === "" ? null : Number(mesFim),
    });
    setSalvando(false);
    if (res.error) onError(res.error);
    else onSalvo();
  }

  return (
    <div className="space-y-2 rounded-md border bg-background p-2">
      {/* Mês sem pagamento fica tracejado: é assim que a frequência salta aos
          olhos — trimestral, anual e "a partir de junho" viram desenho. */}
      <div className="grid grid-cols-6 gap-1">
        {despesa.meses.map((v, i) => (
          <div
            key={MESES_CURTOS[i]}
            className={cn(
              "rounded border px-1 py-0.5 text-center",
              v === 0 ? "border-dashed text-muted-foreground/50" : "bg-muted/40",
            )}
          >
            <div className="text-[9px] uppercase text-muted-foreground">{MESES_CURTOS[i]}</div>
            <div className="text-[10px] tabular-nums">{v === 0 ? "—" : formatBRL(v)}</div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {despesa.periodicidadeLabel} · a partir de {MESES_CURTOS[despesa.mesInicio - 1]}
        {despesa.mesFim ? ` até ${MESES_CURTOS[despesa.mesFim - 1]}` : ""} · total do ano{" "}
        <strong className="text-foreground">{formatBRL(despesa.totalAno)}</strong>
      </p>

      {podeEditar &&
        (editando ? (
          <div className="space-y-1.5 border-t pt-2">
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descrição"
              className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex flex-wrap gap-1.5">
              <input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="Valor"
                inputMode="decimal"
                className="w-24 rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              <select
                value={periodicidade}
                onChange={(e) => setPeriodicidade(e.target.value)}
                className="rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                {PERIODICIDADES.map((pp) => (
                  <option key={pp.key} value={pp.key}>
                    {pp.label}
                  </option>
                ))}
              </select>
              <select
                value={mesInicio}
                onChange={(e) => setMesInicio(e.target.value)}
                title="Mês de início"
                className="rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                {MESES_CURTOS.map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                value={mesFim}
                onChange={(e) => setMesFim(e.target.value)}
                title="Mês final (vazio = até dezembro)"
                className="rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">até dez</option>
                {MESES_CURTOS.map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => void salvar()}
                disabled={salvando}
                className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Salvar
              </button>
              <button
                type="button"
                onClick={() => setEditando(false)}
                disabled={salvando}
                className="rounded border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
          >
            <Pencil className="h-3 w-3" /> editar esta despesa
          </button>
        ))}
    </div>
  );
}

/**
 * Acrescenta uma despesa à proposta (diretoria).
 *
 * Existe porque revisar não é só cortar: na conversa com o gestor aparece o que
 * faltou, e mandá-lo voltar à entrevista para incluir uma linha é caro para os
 * dois.
 */
export function NovaDespesa({
  companyId,
  year,
  categoryCode,
  setorId,
  onSalvo,
  onCancelar,
  onError,
}: {
  companyId: string;
  year: number;
  categoryCode: string;
  setorId: string | null;
  onSalvo: () => void;
  onCancelar: () => void;
  onError: (msg: string) => void;
}) {
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [periodicidade, setPeriodicidade] = useState<string>("mensal");
  const [mesInicio, setMesInicio] = useState("1");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const v = parseBrNumber(valor);
    if (!descricao.trim()) {
      onError("Descreva a despesa.");
      return;
    }
    if (v == null || v < 0) {
      onError("Informe o valor da despesa.");
      return;
    }
    setSalvando(true);
    const res = await adicionarItemPlanejamento({
      companyId,
      year,
      categoryCode,
      setorId,
      descricao,
      valorMensal: v,
      mesInicio: Number(mesInicio),
      periodicidade,
    });
    setSalvando(false);
    if (res.error) onError(res.error);
    else onSalvo();
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background p-2">
      <input
        value={descricao}
        onChange={(e) => setDescricao(e.target.value)}
        placeholder="Descrição da despesa"
        className="min-w-[10rem] flex-1 rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
      />
      <input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="Valor"
        inputMode="decimal"
        className="w-24 rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
      />
      <select
        value={periodicidade}
        onChange={(e) => setPeriodicidade(e.target.value)}
        className="rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
      >
        {PERIODICIDADES.map((pp) => (
          <option key={pp.key} value={pp.key}>
            {pp.label}
          </option>
        ))}
      </select>
      <select
        value={mesInicio}
        onChange={(e) => setMesInicio(e.target.value)}
        title="Mês de início"
        className="rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
      >
        {MESES_CURTOS.map((m, i) => (
          <option key={m} value={String(i + 1)}>
            {m}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => void salvar()}
        disabled={salvando}
        className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        Adicionar
      </button>
      <button
        type="button"
        onClick={onCancelar}
        disabled={salvando}
        className="rounded border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        Cancelar
      </button>
    </div>
  );
}
