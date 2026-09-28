import { Info, TriangleAlert } from "lucide-react";

import { ACAO_ADMIN_TEXTO, type EscopoDiagnostico } from "@/lib/orcamento/escopo";
import { cn } from "@/lib/utils";

/**
 * A faixa que explica por que o orçamento desta empresa está vazio.
 *
 * Existe porque o recorte por setor falha em SILÊNCIO: escopo vazio vira
 * `.in("setor_id", [])`, que casa com nada e não devolve erro — a pessoa vê
 * uma tela em branco e conclui que o sistema está quebrado. Ver escopo.ts,
 * que é quem decide a frase.
 *
 * Não leva link: quem vê esta faixa nunca é admin (o diagnóstico devolve vazio
 * para ele), e as duas telas do conserto são admin-only. Um botão que leva a
 * um redirect é pior do que o nome da tela escrito.
 */
export function EscopoAlerta({ diagnostico }: { diagnostico: EscopoDiagnostico | null }) {
  if (!diagnostico || diagnostico.gravidade === "ok") return null;

  const bloqueio = diagnostico.gravidade === "bloqueio";
  const Icone = bloqueio ? TriangleAlert : Info;

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border p-4 text-sm",
        bloqueio
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-sky-500/40 bg-sky-500/5",
      )}
    >
      <Icone
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          bloqueio
            ? "text-amber-600 dark:text-amber-500"
            : "text-sky-600 dark:text-sky-500",
        )}
      />
      <div className="space-y-1">
        <p className="font-medium">{diagnostico.titulo}</p>
        <p className="text-muted-foreground">
          {diagnostico.detalhe}
          {diagnostico.acaoAdmin && ` ${ACAO_ADMIN_TEXTO[diagnostico.acaoAdmin]}`}
        </p>
      </div>
    </div>
  );
}
