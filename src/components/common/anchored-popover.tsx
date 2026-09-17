"use client";

// Painel flutuante ancorado num elemento, em portal com posição fixa.
//
// Portal + `position: fixed` não é capricho: quem abre esses painéis costuma
// estar dentro de um contêiner com `overflow-x-auto` (uma tabela que rola na
// horizontal), e qualquer painel posicionado dentro dele seria cortado.
//
// Cuida do que é fácil errar: reposicionar ao rolar/redimensionar, não escapar
// pela direita da janela, fechar no clique fora e no Escape — sem fechar
// quando o clique foi no próprio gatilho (senão o botão abre e fecha junto).

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** Elemento que o painel acompanha (normalmente o botão que o abriu). */
  anchorRef: React.RefObject<HTMLElement>;
  onClose: () => void;
  width?: number;
  children: ReactNode;
  /** Rótulo acessível do painel. */
  label?: string;
}

const MARGIN = 12;

export function AnchoredPopover({
  anchorRef,
  onClose,
  width = 260,
  children,
  label,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    function place() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const left = Math.min(rect.left, window.innerWidth - width - MARGIN);
      setPos({ top: rect.bottom + 6, left: Math.max(MARGIN, left) });
    }
    place();
    // O painel é `fixed`: sem isto ele fica parado enquanto a página rola.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchorRef, width]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      // O gatilho trata o próprio clique (alternar); fechar aqui também faria
      // o painel reabrir no mesmo clique.
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      style={{ top: pos.top, left: pos.left, width }}
      className="fixed z-50 overflow-hidden rounded-viva-lg border border-border bg-surface-1 shadow-viva-lg"
    >
      {children}
    </div>,
    document.body,
  );
}
