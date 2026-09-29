"use client";

import { useState } from "react";
import { Check, MessageSquare, X } from "lucide-react";

import { decidirItem } from "@/lib/orcamento/actions/validacao-diretoria";
import {
  ESTADO_LABEL,
  type ValidacaoAlvoTipo,
  type ValidacaoEstado,
} from "@/lib/orcamento/validacao-diretoria";
import type { DecisaoAplicada } from "@/lib/orcamento/previa-setor-decisao";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A decisão da diretoria NA LINHA que está sendo construída — ✓ aprovar,
 * ✗ reprovar e pedir revisão.
 *
 * É o mesmo gesto nas quatro telas de método (Pessoal, Média, Valor fixo e
 * Planejamento), e por isso mora aqui: decidir num lugar e ver o efeito noutro
 * obrigava a trocar de aba a cada ✓, e foi o que fez a aba "Validação"
 * separada ser removida em 29/09/2026.
 *
 * Quem NÃO decide vê só a marca do estado — é como o construtor descobre por
 * que a linha travou, em vez de digitar e levar erro ao salvar.
 *
 * O componente não conhece método nenhum: recebe o alvo pronto. Quem sabe
 * montar o alvo é o servidor (na média, por exemplo, a chave depende de a
 * linha já estar gravada — ver `MediaCategoriaItem.alvoId`).
 */
export function DecisaoLinha({
  companyId,
  year,
  alvoTipo,
  alvoId,
  setorId,
  rotulo,
  estado,
  comentario,
  podeValidar,
  onError,
  onDecidiu,
}: {
  companyId: string;
  year: number;
  alvoTipo: ValidacaoAlvoTipo;
  alvoId: string;
  setorId: string | null;
  /** Como a linha se chama — vai para a trilha e para o diálogo de revisão. */
  rotulo: string;
  estado: ValidacaoEstado;
  comentario: string | null;
  podeValidar: boolean;
  onError: (msg: string) => void;
  /** Avisa QUAL foi a decisão, para a prévia abaixo antecipá-la sem refetch. */
  onDecidiu: (d: DecisaoAplicada) => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const [texto, setTexto] = useState("");

  async function decidir(status: "aprovado" | "reprovado" | "revisar", texto?: string) {
    setSalvando(true);
    const res = await decidirItem({
      companyId,
      year,
      alvoTipo,
      alvoId,
      setorId,
      alvoRotulo: rotulo,
      status,
      comentario: texto,
    });
    setSalvando(false);
    if (res.error) {
      onError(res.error);
      return;
    }
    setPedindo(false);
    setTexto("");
    onDecidiu({ alvoTipo, alvoId, estado: status, comentario: texto ?? null });
  }

  if (!podeValidar) {
    // Sem decisão não há o que mostrar: no começo do orçamento TODA linha está
    // pendente, e uma marca em cada uma viraria ruído.
    if (estado === "pendente") return null;
    return (
      <span
        title={comentario ?? ESTADO_LABEL[estado]}
        className={cn(
          "inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase",
          estado === "aprovado" &&
            "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          estado === "reprovado" && "border-destructive/40 bg-destructive/10 text-destructive",
          estado === "revisar" && "border-sky-500/40 bg-sky-500/10 text-sky-700",
        )}
      >
        {estado === "revisar" ? "revisar" : estado}
      </span>
    );
  }

  return (
    <>
      <span className="flex shrink-0 items-center gap-0.5">
        <BotaoDecisao
          titulo="Aprovar"
          ativo={estado === "aprovado"}
          classeAtiva="bg-emerald-500 text-white"
          classeHover="hover:bg-emerald-500/15 hover:text-emerald-700"
          disabled={salvando}
          onClick={() => void decidir("aprovado")}
        >
          <Check className="h-3.5 w-3.5" />
        </BotaoDecisao>
        <BotaoDecisao
          titulo="Reprovar"
          ativo={estado === "reprovado"}
          classeAtiva="bg-destructive text-white"
          classeHover="hover:bg-destructive/15 hover:text-destructive"
          disabled={salvando}
          onClick={() => void decidir("reprovado")}
        >
          <X className="h-3.5 w-3.5" />
        </BotaoDecisao>
        <BotaoDecisao
          titulo={comentario ? `Revisar: ${comentario}` : "Pedir revisão"}
          ativo={estado === "revisar"}
          classeAtiva="bg-sky-500 text-white"
          classeHover="hover:bg-sky-500/15 hover:text-sky-700"
          disabled={salvando}
          onClick={() => setPedindo(true)}
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </BotaoDecisao>
      </span>

      <Dialog open={pedindo} onOpenChange={(o) => !o && setPedindo(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pedir revisão</DialogTitle>
            <DialogDescription>
              {rotulo} — quem constrói volta a poder editar esta linha e vê o seu comentário.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={4}
            autoFocus
            placeholder="O que precisa mudar?"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPedindo(false)}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={salvando || texto.trim() === ""}
              onClick={() => void decidir("revisar", texto)}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
              Enviar a quem construiu
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BotaoDecisao({
  titulo,
  ativo,
  classeAtiva,
  classeHover,
  disabled,
  onClick,
  children,
}: {
  titulo: string;
  ativo: boolean;
  classeAtiva: string;
  classeHover: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      aria-pressed={ativo}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded border transition-colors disabled:opacity-40",
        ativo
          ? `${classeAtiva} border-transparent`
          : `border-transparent text-muted-foreground ${classeHover}`,
      )}
    >
      {children}
    </button>
  );
}
