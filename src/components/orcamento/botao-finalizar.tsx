"use client";

import { useState } from "react";
import { Loader2, Lock, LockOpen } from "lucide-react";

import { finalizarFatia, reabrirFatia } from "@/lib/orcamento/actions/finalizacao";
import { formatBRL } from "@/lib/orcamento/format";
import type { Finalizacao } from "@/lib/orcamento/finalizacao";
import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";
import { cn } from "@/lib/utils";

/**
 * Finalizar / Reabrir uma fatia do orçamento (método × categoria × setor).
 *
 * O clique faz duas coisas ao mesmo tempo, e é por isso que o botão é um só:
 * TRAVA aquela fatia para todo mundo — inclusive para o admin que clicou — e
 * manda ao Budget do Financeiro o que a diretoria aprovou nela.
 *
 * ── Quem vê o quê ──────────────────────────────────────────────────────────
 * Só o ADMIN finaliza e reabre. Quem não é admin vê a marca "Finalizado"
 * quando a fatia está fechada, e nada quando está aberta — é assim que ele
 * descobre por que os campos travaram, em vez de digitar e levar a recusa ao
 * salvar. Fatia aberta não ganha selo: no começo do orçamento TUDO está
 * aberto, e uma marca em cada tela viraria ruído.
 */
export function BotaoFinalizar({
  companyId,
  year,
  metodo,
  categoryCode,
  setorId,
  rotulo,
  finalizacao,
  isAdmin,
  onMudou,
  compacto = false,
}: {
  companyId: string;
  year: number;
  metodo: OrcamentoMetodo;
  /** Vazio no pessoal: lá a fatia é o quadro do setor inteiro. */
  categoryCode?: string;
  setorId: string | null;
  /** Como a fatia se chama na tela — vai no aviso e na trilha. */
  rotulo: string;
  finalizacao: Finalizacao | null;
  isAdmin: boolean;
  /** Recarrega a tela: a trava muda o que é editável. */
  onMudou: () => void;
  /** Versão miúda, para caber na linha de uma categoria. */
  compacto?: boolean;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const fechada = finalizacao != null;

  async function finalizar() {
    const ok = window.confirm(
      `Finalizar "${rotulo}"?\n\n` +
        "• O que a diretoria aprovou vai para o Budget e Forecast do Financeiro.\n" +
        "• Esta parte do orçamento fica FECHADA para edição — inclusive para administradores.\n\n" +
        "Você pode reabrir depois, aqui mesmo.",
    );
    if (!ok) return;
    setOcupado(true);
    setErro(null);
    setAviso(null);
    const res = await finalizarFatia({ companyId, year, metodo, categoryCode, setorId, rotulo });
    setOcupado(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    const d = res.data;
    if (d) {
      // Nomeia o que ficou de fora: publicar menos sem dizer a diferença é o
      // tipo de número que leva à decisão errada no Financeiro.
      setAviso(
        `${formatBRL(d.totalPublicado)} publicado no Budget (${d.itensPublicados} item(ns))` +
          (d.itensFora > 0
            ? ` · ${d.itensFora} ficaram de fora por não estarem aprovados`
            : ""),
      );
    }
    onMudou();
  }

  async function reabrir() {
    const ok = window.confirm(
      `Reabrir "${rotulo}"?\n\n` +
        "• O valor desta parte SAI do Budget e Forecast do Financeiro.\n" +
        "• O orçamento volta a aceitar edição.\n\n" +
        "Finalize de novo depois de ajustar.",
    );
    if (!ok) return;
    setOcupado(true);
    setErro(null);
    setAviso(null);
    const res = await reabrirFatia({ companyId, year, metodo, categoryCode, setorId, rotulo });
    setOcupado(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    setAviso("Reaberto. O valor saiu do Budget e a edição está liberada.");
    onMudou();
  }

  // Quem não decide só precisa saber POR QUE travou.
  if (!isAdmin) {
    if (!fechada) return null;
    return (
      <span
        title={`Finalizado em ${new Date(finalizacao.finalizadoEm).toLocaleDateString("pt-BR")} · ${formatBRL(finalizacao.totalPublicado)} no Budget`}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400"
      >
        <Lock className="h-3 w-3" /> Finalizado
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-2">
        {fechada && (
          <span
            className="text-[11px] text-muted-foreground"
            title={`Finalizado em ${new Date(finalizacao.finalizadoEm).toLocaleString("pt-BR")}`}
          >
            {formatBRL(finalizacao.totalPublicado)} no Budget
          </span>
        )}
        <button
          type="button"
          onClick={() => void (fechada ? reabrir() : finalizar())}
          disabled={ocupado}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-50",
            compacto ? "px-2 py-1 text-[11px]" : "px-3 py-2 text-sm",
            fechada
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
              : "hover:bg-muted",
          )}
        >
          {ocupado ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : fechada ? (
            <LockOpen className="h-3.5 w-3.5" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          {fechada ? "Reabrir" : "Finalizar orçamento"}
        </button>
      </span>
      {erro && <span className="text-[11px] text-destructive">{erro}</span>}
      {aviso && !erro && <span className="text-[11px] text-emerald-600">{aviso}</span>}
    </span>
  );
}
