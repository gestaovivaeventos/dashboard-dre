"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { getPrevia, type ColaboradorResumo, type PreviaPayload } from "@/lib/orcamento/actions/pessoal";
import { regimeApuracaoLabel } from "@/lib/orcamento/regime-apuracao";
import { vinculoLabel } from "@/lib/orcamento/vinculos";
import { formatBRL } from "@/lib/orcamento/format";
import { PreviaTabela } from "@/components/orcamento/previa-tabela";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

function rotulo(c: ColaboradorResumo): string {
  const nome = c.nome?.trim() || "Sem nome";
  const cargo = c.cargoAtual?.trim();
  return cargo ? `${nome} — ${cargo}` : nome;
}

/**
 * Mesma matriz da Prévia, mas de UM colaborador: serve para conferir de onde
 * vem o número de cada pessoa antes de fechar o orçamento. Os benefícios abrem
 * um a um na própria tabela.
 */
interface Props {
  companyId: string;
  year: number;
  /** Filtro de setor da tela (null = quadro único, SETOR_TODOS = empresa). */
  setorId: string | null;
  escopoLabel: string;
}

export function ColaboradorDetalhe({ companyId, year, setorId, escopoLabel }: Props) {
  const [colaboradorId, setColaboradorId] = useState<string>("");
  const [payload, setPayload] = useState<PreviaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  // Ao trocar de empresa/ano/setor o colaborador escolhido sai da lista.
  useEffect(() => {
    setColaboradorId("");
  }, [companyId, year, setorId]);

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      setLoading(true);
      setError(null);
      setNeedsMigration(false);
      const res = await getPrevia(companyId, year, {
        colaboradorId: colaboradorId || null,
        setorId,
      });
      if (cancelado) return;
      setLoading(false);
      if (res?.needsMigration) {
        setNeedsMigration(true);
        setPayload(null);
        return;
      }
      if (res?.error) {
        setError(res.error);
        setPayload(null);
        return;
      }
      setPayload(res.payload ?? null);
      // Primeira carga: já abre no primeiro colaborador do quadro.
      const primeiro = res.payload?.roster[0]?.id;
      if (!colaboradorId && primeiro) setColaboradorId(primeiro);
    }
    void carregar();
    return () => {
      cancelado = true;
    };
  }, [companyId, year, setorId, colaboradorId]);

  if (loading && !payload) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando…
      </div>
    );
  }

  if (needsMigration) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Migration pendente</p>
        <p className="mt-1 text-muted-foreground">
          Rode a migration{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            20260730140000_orcamento_pessoal_admissao_encargos
          </code>{" "}
          para habilitar esta aba.
        </p>
      </div>
    );
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!payload) return null;

  const { previa, regimeApuracao, roster } = payload;

  if (roster.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        Nenhum colaborador em {escopoLabel} em {year}. Cadastre-os na aba{" "}
        <strong>Quadro</strong> primeiro.
      </div>
    );
  }

  const atual = roster.find((c) => c.id === colaboradorId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-80 space-y-1.5">
          <label className="text-sm font-medium">Colaborador</label>
          <select
            value={colaboradorId}
            onChange={(e) => setColaboradorId(e.target.value)}
            disabled={loading}
            className={INPUT_CLS}
          >
            {roster.map((c) => (
              <option key={c.id} value={c.id}>
                {rotulo(c)}
              </option>
            ))}
          </select>
        </div>
        {atual && (
          <div className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
            <span className="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              {vinculoLabel(atual.vinculo)}
            </span>
            <span>
              Regime de apuração:{" "}
              <strong className="text-foreground">{regimeApuracaoLabel(regimeApuracao)}</strong>
            </span>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </div>
        )}
      </div>

      {atual && atual.vinculo !== "clt" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-2.5 text-sm text-muted-foreground">
          <strong>{vinculoLabel(atual.vinculo)}</strong> não entra na base de encargos: sem INSS
          patronal, FGTS, 13º nem férias. Só as linhas de Salários e Benefícios têm valor.
        </div>
      )}

      {previa.avisos.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-2.5 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Movimentações que a prévia não conseguiu posicionar no tempo
          </p>
          <ul className="list-inside list-disc text-muted-foreground">
            {previa.avisos.map((aviso, idx) => (
              <li key={idx}>{aviso}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Clique em <strong>Benefícios</strong> na tabela para abrir um a um.
      </p>

      <PreviaTabela previa={previa} mostrarHeadcount={false} />

      <p className="text-sm">
        Custo total deste colaborador no ano:{" "}
        <strong className="tabular-nums">{formatBRL(previa.totalAno)}</strong>
      </p>
    </div>
  );
}
