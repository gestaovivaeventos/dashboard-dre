"use client";

import { Copy, Scale, Sparkles, TrendingUp } from "lucide-react";

import type { AlertaBase, AlertaBaseTipo } from "@/lib/orcamento/planejamento-analise";

const ICONE: Record<AlertaBaseTipo, typeof Copy> = {
  duplicata: Copy,
  concentracao: TrendingUp,
  irrisorio: Scale,
};

/**
 * Leitura crítica da base, na Etapa 1 — antes de a entrevista começar.
 *
 * A base é semeada dos fornecedores da Omie do ano anterior, e é de lá que vêm
 * duplicatas de grafia e centavos que não movem o total. Confirmando item a
 * item ninguém vê esses padrões; olhando o conjunto, sim.
 *
 * São HIPÓTESES: o painel aponta e explica, e quem decide é o administrador —
 * nada é removido nem alterado por conta destes avisos.
 */
export function PlanejamentoAlertasBase({ alertas }: { alertas: AlertaBase[] }) {
  if (alertas.length === 0) return null;

  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-500">
        <Sparkles className="h-3.5 w-3.5" />
        O que chama atenção nesta base
      </div>
      <ul className="space-y-1.5">
        {alertas.map((alerta, idx) => {
          const Icone = ICONE[alerta.tipo];
          return (
            <li key={idx} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Icone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
              <span>{alerta.texto}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted-foreground/80">
        São observações, não decisões — nada foi alterado. Ajuste a base agora se fizer sentido; o
        que ficar aqui é o que a IA vai levar para a entrevista.
      </p>
    </div>
  );
}
