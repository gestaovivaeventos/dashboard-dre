"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, Lock, Send, Undo2 } from "lucide-react";

import { entregarSetor, executarTransicao, type CicloInfo } from "@/lib/orcamento/actions/ciclo";
import {
  ESTADO_BADGE,
  ESTADO_DESCRICAO,
  ESTADO_LABEL,
  TRANSICAO_LABEL,
  type CicloEstado,
  type CicloTransicao,
} from "@/lib/orcamento/ciclo";
import { cn } from "@/lib/utils";

/** Cor de acento por estado — a faixa do topo e o ponto do selo. */
const ESTADO_ACENTO: Record<CicloEstado, string> = {
  em_construcao: "bg-sky-500",
  em_validacao: "bg-amber-500",
  em_ajuste: "bg-violet-500",
  concluido: "bg-emerald-500",
  publicado: "bg-emerald-600",
};

/**
 * Painel do ciclo, no hub da empresa — **ADMIN-ONLY** (quem decide mostrá-lo é
 * o `CompanyHub`).
 *
 * As transições (enviar para validação, devolver aos gestores, voltar para
 * edição, concluir e publicar) são atos da EMPRESA inteira, não de uma tela, e
 * só o administrador as dispara. Para o gestor e para o diretor o painel seria
 * informação que eles não acionam: quem valida vê o estado na barra da própria
 * tela de método, e quem constrói, na faixa do workspace.
 *
 * Substituiu o selo heurístico de `status.ts` (Não iniciado / Em andamento /
 * Concluído), que adivinhava o andamento contando linhas preenchidas. O estado
 * agora é fato registrado, com autor e data.
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
  const router = useRouter();
  const [ciclo, setCiclo] = useState(cicloInicial);
  const [isPending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<CicloTransicao | null>(null);
  const [motivo, setMotivo] = useState("");
  const [publicado, setPublicado] = useState<{
    contas: number;
    totalAno: number;
    conflitoComPlanilha: boolean;
  } | null>(null);

  const entregues = ciclo.entregas.filter((e) => e.entregueEm).length;
  const totalSetores = ciclo.entregas.length;
  const faltam = ciclo.entregas.filter((e) => !e.entregueEm);
  // A entrega só significa algo enquanto alguém constrói. Em validação o
  // orçamento está com a diretoria, e mostrar progresso de entrega ali seria
  // informação velha ocupando o lugar da que importa.
  const mostrarEntregas =
    (ciclo.estado === "em_construcao" || ciclo.estado === "em_ajuste") && totalSetores > 0;

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
      router.refresh();
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
        }));
        // O estado novo muda o que o SERVIDOR monta: as ações disponíveis e as
        // caixas do hub. Sem este refresh o painel ficava no estado novo SEM
        // botão nenhum, e as caixas não apareciam até recarregar na mão.
        router.refresh();
        if (res.resultado.publicacao) {
          setPublicado({
            contas: res.resultado.publicacao.contas,
            totalAno: res.resultado.publicacao.totalAno,
            conflitoComPlanilha: res.resultado.publicacao.conflitoComPlanilha,
          });
        }
      }
    });
  }

  if (ciclo.needsMigration) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Ciclo de validação ainda não instalado</p>
        <p className="mt-1 text-muted-foreground">
          As tabelas do ciclo (construção → validação → retorno) não foram aplicadas no banco. O
          orçamento continua funcionando normalmente, sem as etapas.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* Faixa de acento: o estado num relance, sem competir com o conteúdo. */}
      <div className={cn("h-1 w-full", ESTADO_ACENTO[ciclo.estado])} />

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                  ESTADO_BADGE[ciclo.estado],
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", ESTADO_ACENTO[ciclo.estado])} />
                {ESTADO_LABEL[ciclo.estado]}
              </span>
              {ciclo.rodada > 1 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {ciclo.rodada}ª rodada
                </span>
              )}
            </div>
            <p className="max-w-prose text-sm text-muted-foreground">
              {ESTADO_DESCRICAO[ciclo.estado]}
            </p>
          </div>

          {ciclo.acoes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {ciclo.acoes.map((t, i) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setConfirmando(t)}
                  disabled={isPending}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50",
                    // A 1ª ação é a natural da fase; as demais são saídas
                    // (voltar para edição) e não devem competir com ela.
                    i === 0
                      ? "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
                      : "border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {isPending && i === 0 ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : i === 0 ? (
                    <Send className="h-4 w-4" />
                  ) : (
                    <Undo2 className="h-4 w-4" />
                  )}
                  {TRANSICAO_LABEL[t]}
                </button>
              ))}
            </div>
          )}
        </div>

        {mostrarEntregas && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">
                Entregas dos setores
              </span>
              <span className="text-xs font-semibold tabular-nums">
                {entregues} de {totalSetores}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${totalSetores ? (entregues / totalSetores) * 100 : 0}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
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
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      entregue
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "border-transparent bg-background text-muted-foreground",
                      podeMexer ? "hover:bg-muted" : "cursor-default opacity-80",
                    )}
                  >
                    {entregue && <Check className="h-3 w-3" />}
                    {e.setorNome}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Somente leitura: quem está travado precisa saber POR QUÊ, não só
            descobrir que o botão não responde. */}
        {!ciclo.podeEscrever && ciclo.bloqueio && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>{ciclo.bloqueio}</span>
          </div>
        )}

        {erro && (
          <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {erro}
          </div>
        )}

        {publicado && (
          <div className="space-y-1 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm">
            <p className="font-medium">
              Publicado no Budget e Forecast: {publicado.contas} conta(s),{" "}
              {publicado.totalAno.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
                maximumFractionDigits: 0,
              })}{" "}
              no ano.
            </p>
            {publicado.conflitoComPlanilha && (
              <p className="text-amber-700 dark:text-amber-500">
                Atenção: existe orçamento importado por <strong>planilha</strong> neste mesmo ano.
                As duas origens <strong>somam</strong> no Budget — remova uma delas em Mapeamento se
                não for isso o esperado.
              </p>
            )}
          </div>
        )}

        {/* Confirmação da transição. Enviar com setor pendente é possível de
            propósito — mas o aviso diz quantos e quais. */}
        {confirmando && (
          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
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

            {confirmando === "reenviar" && (
              <p
                className={cn(
                  "text-xs",
                  ciclo.alteracoesDesdeVersao === 0
                    ? "font-medium text-amber-700 dark:text-amber-500"
                    : "text-muted-foreground",
                )}
              >
                {ciclo.alteracoesDesdeVersao === 0
                  ? "Nada foi alterado desde a última validação — a diretoria receberia o mesmo orçamento que acabou de revisar."
                  : `${ciclo.alteracoesDesdeVersao} alteração(ões) desde a última validação. Uma nova versão será congelada agora.`}
              </p>
            )}

            {confirmando === "enviar_validacao" && (
              <p className="text-xs text-muted-foreground">
                O orçamento será <strong>congelado numa versão</strong> e ficará somente leitura
                para quem o montou, até a diretoria concluir a validação.
              </p>
            )}

            {confirmando === "publicar" && (
              <p className="text-xs text-muted-foreground">
                Todo o orçamento (pessoal, média, valor fixo e planejamento) vai para o{" "}
                <strong>Budget e Forecast</strong>, substituindo a publicação anterior deste
                módulo.
              </p>
            )}

            {confirmando === "concluir" && (
              <p className="text-xs text-muted-foreground">
                O orçamento aprovado será <strong>congelado</strong> e publicado no Budget e
                Forecast — é essa versão que serve de comparação com o que foi construído.
              </p>
            )}

            {confirmando === "reabrir" && (
              <p className="text-xs text-muted-foreground">
                O orçamento volta a ficar editável para os gestores. As versões congeladas e a
                trilha permanecem, e os itens travados pela diretoria{" "}
                <strong>continuam travados</strong>.
              </p>
            )}

            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Observação (opcional) — fica registrada no histórico"
              rows={2}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => disparar(confirmando)}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
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
                className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
