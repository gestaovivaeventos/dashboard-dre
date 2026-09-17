"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Send, Paperclip, AlertTriangle, CheckCircle2 } from "lucide-react";

import { lancarBvArtistico } from "@/lib/case/actions/bv";
import { getContractAttachmentUrl } from "@/lib/case/actions/contracts";
import { useToast } from "@/components/ui/toaster";
import type { BvArtisticoDetail } from "@/lib/case/queries";

const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = (v: number) => `R$ ${fmt.format(v)}`;
const dateBR = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");

const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  lancado: "Lançado",
  parcial: "Parcial",
  erro: "Erro",
  cancelado: "Cancelado",
};

/**
 * Tela do BV artístico. Enxuta de propósito: não há contrato de venda,
 * assinatura nem conta a pagar — só o cadastro do artista, a comissão e o
 * título a receber no Omie.
 */
export function BvWorkspace({ detail }: { detail: BvArtisticoDetail }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [launching, setLaunching] = useState(false);

  const pendentes = detail.titles.filter((t) => !t.omie_codigo);
  const comErro = detail.titles.filter((t) => t.status === "erro");

  async function lancar() {
    setLaunching(true);
    const res = await lancarBvArtistico(detail.id);
    setLaunching(false);
    if ("error" in res) return showToast({ variant: "destructive", title: res.error });
    showToast({
      variant: res.status === "lancado" ? "success" : "destructive",
      title: res.status === "lancado" ? "Conta a receber lançada no Omie." : `Lançamento ${res.status}. Veja o erro no título.`,
    });
    router.refresh();
  }

  async function abrirAnexo() {
    const res = await getContractAttachmentUrl(detail.id);
    if ("error" in res) return showToast({ variant: "destructive", title: res.error });
    window.open(res.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-5">
      <div>
        <Link href="/case/contratos" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink-primary">
          <ArrowLeft className="h-4 w-4" /> Contratos
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-ink-primary">BV artístico #{detail.contract_number}</h1>
          <span className="rounded bg-violet-500/15 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">BV artístico</span>
          <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-ink-secondary">{STATUS_LABEL[detail.status] ?? detail.status}</span>
        </div>
        <p className="text-sm text-ink-muted">
          Comissão a receber de {detail.band_name}
          {detail.event_name ? ` · ${detail.event_name}` : ""}
          {detail.event_date ? ` · ${dateBR(detail.event_date)}` : ""}
        </p>
      </div>

      <section className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs text-ink-muted">Artista (quem paga)</div>
            <div className="text-sm font-medium text-ink-primary">{detail.band_name}</div>
            <div className="text-xs text-ink-muted">{detail.band_cnpj_cpf ?? "sem documento"}</div>
          </div>
          <div>
            <div className="text-xs text-ink-muted">Comissão</div>
            <div className="text-lg font-semibold tabular-nums text-ink-primary">{brl(detail.valor_comissao)}</div>
          </div>
          <div className="flex items-start justify-end gap-2">
            {detail.attachment_path && (
              <button type="button" onClick={abrirAnexo} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-ink-secondary hover:bg-surface-2">
                <Paperclip className="h-4 w-4" /> Contrato
              </button>
            )}
            {pendentes.length > 0 && (
              <button type="button" onClick={lancar} disabled={launching} className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">
                {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {comErro.length > 0 ? "Tentar de novo" : "Lançar no Omie"}
              </button>
            )}
          </div>
        </div>
        {detail.observacao && <p className="mt-3 border-t border-border pt-3 text-sm text-ink-secondary">{detail.observacao}</p>}
      </section>

      <section className="rounded-lg border border-border bg-surface-1 p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-primary">Contas a receber</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-muted">
              <th className="px-2 py-1.5 font-medium">Parcela</th>
              <th className="px-2 py-1.5 font-medium">Vencimento</th>
              <th className="px-2 py-1.5 text-right font-medium">Valor</th>
              <th className="px-2 py-1.5 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {detail.titles.map((t) => (
              <tr key={t.id} className="border-b border-border/60 last:border-0">
                <td className="px-2 py-2 text-ink-secondary">{t.parcela_numero}/{t.parcela_total}</td>
                <td className="px-2 py-2 text-ink-secondary">{dateBR(t.vencimento)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-primary">{brl(t.valor)}</td>
                <td className="px-2 py-2">
                  {t.pago ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Recebido</span>
                  ) : t.omie_codigo ? (
                    <span className="text-ink-secondary">No Omie (nº {t.omie_codigo})</span>
                  ) : t.status === "erro" ? (
                    <span className="inline-flex items-center gap-1 text-red-500"><AlertTriangle className="h-3.5 w-3.5" /> Erro</span>
                  ) : (
                    <span className="text-ink-muted">Pendente</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {detail.titles.length === 0 && <p className="text-sm text-ink-muted">Nenhum título gerado.</p>}
      </section>
    </div>
  );
}
