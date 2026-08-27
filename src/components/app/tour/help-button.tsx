"use client";

// Botão "?" da topbar — "Como usar esta tela".
//
// É o que substitui o treinamento formal: quem pulou o tour de primeiro acesso,
// ou simplesmente esqueceu, reabre a explicação DA TELA EM QUE ESTÁ, sozinho.
//
// Some para quem não tem o módulo Financeiro e nas telas sem tour definido
// (Compras, Contratos, admin…): um "?" que não faz nada — ou que explica telas
// que a pessoa nem enxerga — ensina o usuário a ignorar o "?". Quem decide as
// duas coisas é o `available` do provider, não esta camada.

import { HelpCircle } from "lucide-react";

import { useTour } from "@/components/app/tour/tour-provider";

export function HelpButton() {
  const { available, openCurrent, active } = useTour();

  if (!available) return null;

  return (
    <button
      type="button"
      data-tour="topbar-ajuda"
      onClick={openCurrent}
      disabled={active}
      className="ch-iconbtn"
      aria-label="Como usar esta tela"
      title="Como usar esta tela"
    >
      <HelpCircle className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}
