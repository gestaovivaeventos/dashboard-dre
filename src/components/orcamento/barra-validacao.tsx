"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, ClipboardCheck, Info, Loader2, Lock, LockOpen } from "lucide-react";

import { executarTransicao } from "@/lib/orcamento/actions/ciclo";
import {
  concluirTelaSetor,
  finalizarTelaSetor,
  marcarTodosRevisados,
} from "@/lib/orcamento/actions/revisao";
import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";
import { cn } from "@/lib/utils";

/** Nome curto da tela, para o marcador de "validado". */
const METODO_TITULO: Record<string, string> = {
  pessoal: "Despesas com pessoal",
  media: "Média com correção",
  valor_fixo: "Valor fixo com correção",
  planejamento_socios: "Planejamento dos gestores",
};

/**
 * Barra de validação — aparece no TOPO das telas de método quando o orçamento
 * está em validação e quem está olhando é a diretoria (ou o admin).
 *
 * Ela existe porque a validação deixou de ter tela própria: o diretor percorre
 * as mesmas telas de quem construiu, escolhendo o setor. A barra é o que diz
 * "você está validando", mostra o quanto desta tela já passou pelo olho dele e
 * termina o trabalho — sem obrigá-lo a voltar ao hub, que era o vai-e-vem que
 * tornava o fluxo estranho.
 */
export function BarraValidacao({
  companyId,
  year,
  metodo,
  setorId,
  setorNome,
  total,
  revisados,
  alvos,
  aberta,
  estadoLabel,
  telaConcluida,
}: {
  companyId: string;
  year: number;
  metodo: OrcamentoMetodo;
  setorId: string | null;
  setorNome: string | null;
  /** Linhas visíveis nesta tela, no recorte atual. */
  total: number;
  /** Quantas delas já têm o visto. */
  revisados: number;
  /** Chaves das linhas visíveis, para o "revisar todas". */
  alvos: Array<{ chave: string; tipo: string }>;
  /**
   * A validação está ABERTA (ciclo em validação). Falso = barra informativa:
   * a diretoria vê por que não consegue validar em vez de encontrar uma tela
   * muda. Foi o que faltou no teste — o ciclo estava em construção e nada dizia.
   */
  aberta: boolean;
  /** Rótulo do estado atual, para a barra informativa. */
  estadoLabel: string;
  /** Esta tela × setor já foi concluída nesta rodada. */
  telaConcluida: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const completo = total > 0 && revisados >= total;
  const tituloTela = METODO_TITULO[metodo] ?? metodo;

  function revisarTudo() {
    setErro(null);
    startTransition(async () => {
      const res = await marcarTodosRevisados({
        companyId,
        year,
        metodo,
        setorId,
        alvos,
        revisado: !completo,
      });
      if (res.error) {
        setErro(res.error);
        return;
      }
      router.refresh();
    });
  }

  function concluirTela() {
    setErro(null);
    startTransition(async () => {
      const res = await concluirTelaSetor({
        companyId,
        year,
        metodo,
        setorId,
        desfazer: telaConcluida,
      });
      if (res.error) {
        setErro(res.error);
        return;
      }
      router.refresh();
    });
  }

  function concluir() {
    setErro(null);
    startTransition(async () => {
      const res = await executarTransicao(companyId, year, "concluir_validacao");
      if (res.error) {
        setErro(res.error);
        return;
      }
      setConfirmando(false);
      router.refresh();
    });
  }

  // Fora da janela: barra informativa. Diz o estado e o que falta, em vez de
  // simplesmente não existir.
  if (!aberta) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-4 py-2.5 text-sm">
        <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">Validação fechada</span>
        <span className="text-muted-foreground">
          Este orçamento está em <strong>{estadoLabel}</strong>. A revisão linha a linha abre
          quando ele for enviado para validação.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
      {/* Marcador: esta tela E este setor estão validados. Fica em destaque
          porque a validação é INDIVIDUAL por setor — sem dizer qual, o diretor
          não sabe o que já fechou. */}
      {telaConcluida && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCheck className="h-4 w-4 shrink-0" />
          <span>
            {tituloTela}
            {setorNome ? ` · ${setorNome}` : ""} — validado
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardCheck className="h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              Validação da diretoria
              {setorNome && <span className="font-normal"> · {setorNome}</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              {total === 0
                ? "Nada para revisar neste recorte."
                : `${revisados} de ${total} linha(s) revisada(s) nesta tela.`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {total > 0 && (
            <button
              type="button"
              onClick={revisarTudo}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCheck className="h-3.5 w-3.5" />
              )}
              {completo ? "Desmarcar todas" : "Marcar todas como revisadas"}
            </button>
          )}

          {total > 0 && (
            <button
              type="button"
              onClick={concluirTela}
              disabled={isPending}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                telaConcluida
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : "bg-background hover:bg-muted",
              )}
              title={
                telaConcluida
                  ? "Reabrir esta tela/setor para revisão"
                  : "Marcar esta tela e este setor como validados"
              }
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCheck className="h-3.5 w-3.5" />
              )}
              {telaConcluida ? "Tela validada" : "Validar esta tela/setor"}
            </button>
          )}

          {confirmando ? (
            <>
              <button
                type="button"
                onClick={concluir}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Confirmar e devolver aos gestores
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                disabled={isPending}
                className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Voltar
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Devolver aos gestores
            </button>
          )}
        </div>
      </div>

      {/* Concluir vale para a EMPRESA, não para esta tela — o aviso evita que o
          diretor feche achando que terminou só o que está vendo. */}
      {confirmando && (
        <p className="text-xs text-muted-foreground">
          Isto conclui a validação da <strong>empresa inteira</strong>, não só desta tela. O
          orçamento volta aos gestores com o que você decidiu, e o que você alterou fica travado
          para eles (salvo o que você liberou).
        </p>
      )}

      {erro && <p className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}

/**
 * O controle da LINHA: o visto da diretoria.
 *
 * Fica na primeira coluna de cada linha das telas de método, visível só em
 * validação. As demais ações (cancelar, comentar) moram ao lado, em
 * `AcoesDiretoria`.
 */
export function VistoRevisao({
  revisado,
  ocupado,
  onToggle,
}: {
  revisado: boolean;
  ocupado?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={ocupado}
      title={revisado ? "Revisado — clique para desmarcar" : "Marcar como revisado"}
      aria-pressed={revisado}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors disabled:opacity-50",
        revisado
          ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : "text-muted-foreground hover:bg-muted",
      )}
    >
      <CheckCheck className="h-3.5 w-3.5" />
    </button>
  );
}


/**
 * Rodapé das telas de construção: o gestor declara que terminou o orçamento
 * DESTA tela NESTE setor, e o fecha para edição.
 *
 * A finalização TRAVA de verdade — nem ele mesmo edita depois. Só um
 * administrador reabre, pelo botão ao lado (que só ele enxerga). Sem a trava,
 * "finalizei" seria uma opinião que o orçamento não respeitava.
 */
export function BarraFinalizacao({
  companyId,
  year,
  metodo,
  setorId,
  setorNome,
  finalizada,
  podeReabrir,
  /** Falso quando o ciclo não está numa fase em que finalizar faça sentido. */
  disponivel,
}: {
  companyId: string;
  year: number;
  metodo: OrcamentoMetodo;
  setorId: string | null;
  setorNome: string | null;
  finalizada: boolean;
  podeReabrir: boolean;
  disponivel: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  if (!disponivel) return null;

  function agir(reabrir: boolean) {
    setErro(null);
    startTransition(async () => {
      const res = await finalizarTelaSetor({ companyId, year, metodo, setorId, reabrir });
      if (res.error) {
        setErro(res.error);
        return;
      }
      setConfirmando(false);
      router.refresh();
    });
  }

  const titulo = METODO_TITULO[metodo] ?? metodo;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4",
        finalizada ? "border-emerald-500/40 bg-emerald-500/5" : "bg-muted/20",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        {finalizada ? (
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        ) : (
          <CheckCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 text-sm">
          <p className="font-medium">
            {finalizada
              ? `${titulo}${setorNome ? ` · ${setorNome}` : ""} — finalizado`
              : "Terminou este setor?"}
          </p>
          <p className="text-muted-foreground">
            {finalizada
              ? "Fechado para edição. Só um administrador pode reabrir."
              : `Finalizar fecha ${titulo.toLowerCase()}${setorNome ? ` de ${setorNome}` : ""} para edição — inclusive para você.`}
          </p>
          {erro && <p className="mt-1 text-destructive">{erro}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {finalizada ? (
          podeReabrir && (
            <button
              type="button"
              onClick={() => agir(true)}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LockOpen className="h-4 w-4" />
              )}
              Reabrir para edição
            </button>
          )
        ) : confirmando ? (
          <>
            <button
              type="button"
              onClick={() => agir(false)}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirmar e fechar
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              disabled={isPending}
              className="rounded-lg border px-3.5 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Voltar
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <CheckCheck className="h-4 w-4" />
            Finalizei este setor
          </button>
        )}
      </div>
    </div>
  );
}
