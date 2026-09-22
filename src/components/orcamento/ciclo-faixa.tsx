import { Lock } from "lucide-react";

import type { CicloInfo } from "@/lib/orcamento/actions/ciclo";
import { ESTADO_BADGE, ESTADO_LABEL } from "@/lib/orcamento/ciclo";
import { cn } from "@/lib/utils";

/**
 * Faixa de estado do ciclo no topo do workspace — aparece em todas as telas de
 * montagem (pessoal, média, valor fixo, planejamento e prévia).
 *
 * Existe para responder, ANTES de a pessoa tentar editar, por que os campos não
 * respondem. Sem ela, "estou em validação e fiquei somente leitura" viraria
 * "salvei e não aconteceu nada" — o pior desfecho possível para uma trava.
 *
 * Em construção (o estado normal, e o de todo orçamento antes de o ciclo
 * começar) a faixa não aparece: nada mudou, nada a explicar.
 */
export function CicloFaixa({ ciclo }: { ciclo: CicloInfo | null }) {
  if (!ciclo || ciclo.needsMigration) return null;
  if (ciclo.estado === "em_construcao" && ciclo.podeEscrever) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm",
        ESTADO_BADGE[ciclo.estado],
      )}
    >
      {!ciclo.podeEscrever && <Lock className="h-4 w-4 shrink-0" />}
      <span className="font-medium">{ESTADO_LABEL[ciclo.estado]}</span>
      {ciclo.bloqueio && <span className="opacity-90">{ciclo.bloqueio}</span>}
    </div>
  );
}
