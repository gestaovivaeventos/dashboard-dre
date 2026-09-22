"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, Loader2, Lock, Send, Undo2 } from "lucide-react";

import { entregarSetor, executarTransicao, type CicloInfo } from "@/lib/orcamento/actions/ciclo";
import {
  ESTADO_BADGE,
  ESTADO_DESCRICAO,
  ESTADO_LABEL,
  TRANSICAO_LABEL,
  type CicloTransicao,
} from "@/lib/orcamento/ciclo";
import { cn } from "@/lib/utils";

/**
 * Painel do ciclo no hub da empresa: em que pé está o orçamento, quem já
 * entregou o seu setor e as ações de quem está olhando.
 *
 * Substitui o selo heurístico de `status.ts` (Não iniciado / Em andamento /
 * Concluído), que adivinhava o andamento contando linhas preenchidas. Agora o
 * estado é um fato registrado, com autor e data.
 */
export function CicloPainel({
  companyId,
  year,
  ciclo: cicloInicial,
}: {
  companyId: string;
  year: number;
  ciclo: CicloInfo;
}) {
  const [ciclo, setCiclo] = useState(cicloInicial);
  const [isPending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<CicloTransicao | null>(null);
  const [motivo, setMotivo] = useState("");

  const entregues = ciclo.entregas.filter((e) => e.entregueEm).length;
  const totalSetores = ciclo.entregas.length;
  const faltam = ciclo.entregas.filter((e) => !e.entregueEm);

  function toggleEntrega(setorId: string, desfazer: boolean) {
    setErro(null);
    startTransition(async () => {
      const res = await entregarSetor(companyId, year, setorId, desfazer);
      if (res.error) {
        setErro(res.error);
        return;
      }
      setCiclo((prev) => ({
        ...prev,
        entregas: prev.entregas.map((e) =>
          e.setorId === setorId
            ? { ...e, entregueEm: desfazer ? null : new Date().toISOString() }
            : e,
        ),
      }));
    });
  }

  function disparar(transicao: CicloTransicao) {
    setErro(null);
    startTransition(async () => {
      const res = await executarTransicao(companyId, year, transicao, motivo.trim() || undefined);
      if (res.error) {
        setErro(res.error);
        return;
      }
      setConfirmando(null);
      setMotivo("");
      if (res.resultado) {
        setCiclo((prev) => ({
          ...prev,
          estado: res.resultado!.estado,
          rodada: res.resultado!.rodada,
          acoes: [],
        }));
      }
    });
  }

  if (ciclo.needsMigration) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Ciclo de validação ainda não instalado</p>
        <p className="mt-1 text-muted-foreground">
          As tabelas do ciclo (construção → validação → retorno) não foram aplicadas no banco. O
          orçamento continua funcionando normalmente, sem as etapas.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                ESTADO_BADGE[ciclo.estado],
              )}
            >
              {ESTADO_LABEL[ciclo.estado]}
            </span>
            {ciclo.rodada > 1 && (
              <span className="text-xs text-muted-foreground">{ciclo.rodada}ª rodada</span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {ESTADO_DESCRICAO[ciclo.estado]}
          </p>
        </div>

        {ciclo.acoes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {ciclo.acoes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setConfirmando(t)}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {TRANSICAO_LABEL[t]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Somente leitura: quem está travado precisa saber POR QUÊ, não só
          descobrir que o botão não responde. */}
      {!ciclo.podeEscrever && ciclo.bloqueio && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>{ciclo.bloqueio}</span>
        </div>
      )}

      {/* Entregas por setor. O progresso é informativo: o envio NÃO exige 100% —
          média e valor fixo são do administrador e atravessam todos os setores,
          sem gerente que as entregue. */}
      {totalSetores > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>
              Entregas dos setores: {entregues} de {totalSetores}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ciclo.entregas.map((e) => {
              const entregue = Boolean(e.entregueEm);
              const podeMexer = e.meu && ciclo.podeEscrever;
              return (
                <button
                  key={e.setorId}
                  type="button"
                  onClick={() => podeMexer && toggleEntrega(e.setorId, entregue)}
                  disabled={!podeMexer || isPending}
                  title={
                    podeMexer
                      ? entregue
                        ? "Desfazer a entrega deste setor"
                        : "Marcar este setor como entregue"
                      : entregue
                        ? `Entregue${e.entreguePor ? ` por ${e.entreguePor}` : ""}`
                        : "Setor de outro responsável"
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    entregue
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "text-muted-foreground",
                    podeMexer ? "hover:bg-muted" : "cursor-default opacity-70",
                  )}
                >
                  {entregue ? <Check className="h-3.5 w-3.5" /> : null}
                  {e.setorNome}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {erro && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</div>
      )}

      {/* Confirmação da transição. Enviar para validação com setor pendente é
          possível de propósito — mas o aviso diz quantos e quais. */}
      {confirmando && (
        <div className="space-y-2 rounded-md border bg-background p-3">
          <p className="text-sm font-medium">{TRANSICAO_LABEL[confirmando]}?</p>
          {(confirmando === "enviar_validacao" || confirmando === "reenviar") &&
            faltam.length > 0 && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                <span>
                  {faltam.length} setor(es) ainda não entregaram (
                  {faltam.map((f) => f.setorNome).join(", ")}). Você pode enviar assim mesmo — a
                  entrega é um aviso dos gestores, não uma trava.
                </span>
              </div>
            )}
          {confirmando === "enviar_validacao" && (
            <p className="text-xs text-muted-foreground">
              O orçamento será <strong>congelado numa versão</strong> e ficará somente leitura para
              quem o montou, até a diretoria concluir a validação.
            </p>
          )}
          {confirmando === "concluir" && (
            <p className="text-xs text-muted-foreground">
              O orçamento aprovado será <strong>congelado</strong> — é essa versão que serve de
              comparação com o que foi construído.
            </p>
          )}
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Observação (opcional) — fica registrada no histórico"
            rows={2}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => disparar(confirmando)}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmando(null);
                setMotivo("");
              }}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Undo2 className="h-4 w-4" />
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
