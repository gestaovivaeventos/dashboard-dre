"use client";

// Botão "?" ao lado do nome do módulo, no menu lateral.
//
// É o que substitui o treinamento formal: quem pulou o tour de primeiro acesso,
// ou esqueceu como uma tela funciona, se resolve sozinho. Fica junto do nome do
// módulo — e não na topbar — porque com mais de um módulo com tour um único "?"
// não diria de qual deles ele é.
//
// Some para quem não tem o módulo: um "?" que abre a explicação de telas que a
// pessoa nem enxerga ensina o usuário a ignorar o "?". Quem decide isso é o
// `moduleIds` do provider, não esta camada.

import { HelpCircle } from "lucide-react";

import { useTour } from "@/components/app/tour/tour-provider";
import { tourModuleForNavGroup } from "@/lib/tour";

export function ModuleTourButton({ navGroupId }: { navGroupId: string }) {
  const { moduleIds, startModule, activeModuleId } = useTour();

  const tourModule = tourModuleForNavGroup(navGroupId);
  if (!tourModule || !moduleIds.includes(tourModule.id)) return null;

  return (
    <button
      type="button"
      data-tour={`tour-btn-${tourModule.id}`}
      onClick={() => startModule(tourModule.id)}
      disabled={activeModuleId !== null}
      className="ch-module__tour"
      aria-label={`Tour guiado do módulo ${tourModule.label}`}
      title={`Tour guiado do módulo ${tourModule.label}`}
    >
      <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  );
}
