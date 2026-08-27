"use client";

// Motor do tour guiado do módulo Financeiro.
//
// Duas entradas, um só motor:
//   1. Primeiro acesso — dispara sozinho na /home (só para quem `autoStart`
//      permite) e caminha pelas telas na ordem do menu.
//   2. Botão "?" da topbar — reabre o tour DA TELA ATUAL, a qualquer momento.
//
// O conteúdo NÃO mora aqui: vem de @/lib/financeiro/tour/content.
//
// Sem dependência externa: o destaque é uma caixa com `box-shadow` gigante
// (escurece tudo em volta sem precisar de máscara SVG) e a posição é
// recalculada a cada frame, direto no style do nó — sem re-render por frame.

import { X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  nextTourScreen,
  resolveTourScreen,
  tourHref,
  tourStorageKey,
  type TourScreen,
  type TourStep,
} from "@/lib/financeiro/tour/content";

/** Sessão: qual tela deve abrir o tour logo após a navegação. */
const PENDING_KEY = "ch-tour-pending";

/** Largura fixa do balão; o clamp de viewport é feito em cima dela. */
const POPOVER_WIDTH = 360;
const GAP = 12;
const PAD = 6;

/**
 * Elemento existe no DOM mas não ocupa área (menu lateral escondido abaixo de
 * 1100px, aba fechada) não serve de âncora: o destaque viraria um retângulo de
 * tamanho zero num canto da tela. Para o tour, isso é "não está aqui".
 */
function anchorElement(anchor: string): HTMLElement | null {
  const el = document.querySelector(`[data-tour="${anchor}"]`) as HTMLElement | null;
  if (!el) return null;
  return el.getClientRects().length > 0 ? el : null;
}

interface TourContextValue {
  /** Há tour definido para a rota atual? (o "?" some quando não há) */
  available: boolean;
  /** Abre o tour da tela atual — uso avulso, sem encadear as próximas. */
  openCurrent: () => void;
  active: boolean;
}

const TourContext = createContext<TourContextValue>({
  available: false,
  openCurrent: () => {},
  active: false,
});

export function useTour(): TourContextValue {
  return useContext(TourContext);
}

interface TourProviderProps {
  children: React.ReactNode;
  /**
   * Chave de identificação do usuário (e-mail) para a marca de "já vi o tour".
   * Fica no localStorage: é preferência de exibição, não dado de negócio.
   */
  userKey: string;
  /**
   * Dispara o tour sozinho no primeiro acesso. Ligado para TODO usuário com o
   * módulo Financeiro; quem não tem (só Compras, só Contratos) não é
   * interrompido — e nem teria as telas do roteiro.
   */
  autoStart: boolean;
  /** Segmento ativo, para montar o link das telas servidas em /s/<slug>/... */
  segmentSlug: string | null;
}

export function TourProvider({ children, userKey, autoStart, segmentSlug }: TourProviderProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [screen, setScreen] = useState<TourScreen | null>(null);
  const [steps, setSteps] = useState<readonly TourStep[]>([]);
  const [index, setIndex] = useState(0);
  /** "sequence" encadeia as telas seguintes; "single" encerra nesta tela. */
  const [mode, setMode] = useState<"sequence" | "single">("single");

  const startTokenRef = useRef(0);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const spotRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const screenForPath = useMemo(() => resolveTourScreen(pathname), [pathname]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const markDone = useCallback(() => {
    try {
      window.localStorage.setItem(tourStorageKey(userKey), "done");
    } catch {
      // localStorage bloqueado (janela privada, política do navegador): o tour
      // volta a aparecer no próximo acesso. É chato, não é erro.
    }
  }, [userKey]);

  const close = useCallback(
    (opts: { done: boolean }) => {
      startTokenRef.current += 1; // cancela abertura que ainda esteja esperando âncoras
      setScreen(null);
      setSteps([]);
      setIndex(0);
      try {
        window.sessionStorage.removeItem(PENDING_KEY);
      } catch {
        /* idem */
      }
      if (opts.done) markDone();
    },
    [markDone],
  );

  /**
   * Abre um tour. Passo cujo elemento não está na tela é descartado aqui —
   * é o que permite um mesmo roteiro servir variações da tela (aba diferente,
   * usuário sem permissão para um botão) sem apontar para o vazio.
   *
   * A tela pode ainda estar montando quando a navegação termina, então
   * tentamos algumas vezes antes de desistir das âncoras.
   */
  const start = useCallback((target: TourScreen, nextMode: "sequence" | "single") => {
    // Um pedido de abertura invalida os anteriores: se o usuário navegar
    // enquanto esperamos as âncoras montarem, a tentativa antiga morre em vez
    // de abrir o tour da tela errada.
    const token = startTokenRef.current + 1;
    startTokenRef.current = token;
    let tries = 0;
    const attempt = () => {
      if (startTokenRef.current !== token) return;
      const visible = target.steps.filter((step) => !step.anchor || anchorElement(step.anchor));
      const anchored = target.steps.filter((step) => step.anchor).length;
      const found = visible.filter((step) => step.anchor).length;
      if (anchored > 0 && found === 0 && tries < 30) {
        tries += 1;
        window.setTimeout(attempt, 150);
        return;
      }
      if (visible.length === 0) return;
      setScreen(target);
      setSteps(visible);
      setIndex(0);
      setMode(nextMode);
    };
    window.setTimeout(attempt, 250);
  }, []);

  // Primeiro acesso: só na /home, só uma vez, só para quem autoStart libera.
  useEffect(() => {
    if (!autoStart || !mounted || pathname !== "/home") return;
    let done = false;
    try {
      done = window.localStorage.getItem(tourStorageKey(userKey)) === "done";
    } catch {
      done = true; // sem localStorage, não insistimos.
    }
    if (done) return;
    const home = resolveTourScreen("/home");
    if (home) start(home, "sequence");
  }, [autoStart, mounted, pathname, userKey, start]);

  // Continuação da sequência: a tela anterior deixou o próximo id marcado
  // antes de navegar.
  useEffect(() => {
    if (!mounted || !screenForPath) return;
    let pending: string | null = null;
    try {
      pending = window.sessionStorage.getItem(PENDING_KEY);
    } catch {
      pending = null;
    }
    if (pending !== screenForPath.id) return;
    try {
      window.sessionStorage.removeItem(PENDING_KEY);
    } catch {
      /* idem */
    }
    start(screenForPath, "sequence");
  }, [mounted, screenForPath, start]);

  const openCurrent = useCallback(() => {
    if (!screenForPath) return;
    start(screenForPath, "single");
  }, [screenForPath, start]);

  const step = screen ? steps[index] : undefined;

  // Rola até o elemento no início de cada passo. A medição em si acontece no
  // laço de animação abaixo, então não importa quando a rolagem terminar.
  useEffect(() => {
    if (!step?.anchor) return;
    anchorElement(step.anchor)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [step]);

  // Posicionamento contínuo: o elemento pode se mover (rolagem, tabela que
  // termina de carregar, janela redimensionada). Escrever direto no style
  // evita um re-render por frame.
  useEffect(() => {
    if (!screen || !step) return;
    let frame = 0;

    const tick = () => {
      frame = window.requestAnimationFrame(tick);
      const pop = popRef.current;
      const spot = spotRef.current;
      if (!pop) return;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const height = pop.offsetHeight || 180;

      const el = step.anchor ? anchorElement(step.anchor) : null;

      if (!el) {
        // Passo sem âncora (abertura da tela): balão centralizado, tela toda
        // escurecida pelo overlay.
        if (spot) spot.style.display = "none";
        if (overlayRef.current) overlayRef.current.style.background = "rgba(2, 6, 23, 0.55)";
        pop.style.left = `${Math.max(12, (vw - POPOVER_WIDTH) / 2)}px`;
        pop.style.top = `${Math.max(12, (vh - height) / 2)}px`;
        return;
      }

      const rect = el.getBoundingClientRect();
      if (spot) {
        spot.style.display = "block";
        spot.style.top = `${rect.top - PAD}px`;
        spot.style.left = `${rect.left - PAD}px`;
        spot.style.width = `${rect.width + PAD * 2}px`;
        spot.style.height = `${rect.height + PAD * 2}px`;
      }
      if (overlayRef.current) overlayRef.current.style.background = "transparent";

      // Vira o lado quando não cabe — o balão nunca sai da viewport.
      let place = step.placement ?? "bottom";
      if (place === "center") place = "bottom";
      if (place === "bottom" && rect.bottom + GAP + height > vh - 12) place = "top";
      if (place === "top" && rect.top - GAP - height < 12) place = "bottom";
      if (place === "right" && rect.right + GAP + POPOVER_WIDTH > vw - 12) place = "left";
      if (place === "left" && rect.left - GAP - POPOVER_WIDTH < 12) place = "right";

      let top: number;
      let left: number;
      if (place === "bottom") {
        top = rect.bottom + GAP;
        left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
      } else if (place === "top") {
        top = rect.top - GAP - height;
        left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
      } else if (place === "right") {
        top = rect.top + rect.height / 2 - height / 2;
        left = rect.right + GAP;
      } else {
        top = rect.top + rect.height / 2 - height / 2;
        left = rect.left - GAP - POPOVER_WIDTH;
      }

      pop.style.left = `${Math.min(Math.max(12, left), Math.max(12, vw - POPOVER_WIDTH - 12))}px`;
      pop.style.top = `${Math.min(Math.max(12, top), Math.max(12, vh - height - 12))}px`;
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [screen, step]);

  const following = screen && mode === "sequence" ? nextTourScreen(screen.id) : null;
  const isLast = screen ? index === steps.length - 1 : false;

  const goNext = useCallback(() => {
    if (!screen) return;
    if (!isLast) {
      setIndex((prev) => prev + 1);
      return;
    }
    if (!following) {
      close({ done: true });
      return;
    }
    const href = tourHref(following, segmentSlug);
    if (!href) {
      close({ done: true });
      return;
    }
    try {
      window.sessionStorage.setItem(PENDING_KEY, following.id);
    } catch {
      /* sem sessionStorage a sequência para aqui; o "?" segue disponível. */
    }
    setScreen(null);
    setSteps([]);
    setIndex(0);
    router.push(href);
  }, [screen, isLast, following, segmentSlug, router, close]);

  // Esc encerra — sempre. Um tour do qual não se sai é uma armadilha.
  useEffect(() => {
    if (!screen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close({ done: true });
      else if (event.key === "ArrowRight") goNext();
      else if (event.key === "ArrowLeft") setIndex((prev) => Math.max(0, prev - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, close, goNext]);

  const value = useMemo<TourContextValue>(
    () => ({ available: Boolean(screenForPath), openCurrent, active: Boolean(screen) }),
    [screenForPath, openCurrent, screen],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {mounted && screen && step
        ? createPortal(
            <div className="ch-tour" role="dialog" aria-modal="true" aria-label="Tour do módulo Financeiro">
              {/* Bloqueia o clique fora do balão: o passo é explicativo, e um
                  clique perdido no meio do tour desloca tudo. */}
              <div ref={overlayRef} className="fixed inset-0 z-[100]" />
              {/* O escurecimento é o próprio box-shadow: uma sombra maior que
                  a tela cobre tudo, menos a caixa do elemento. Sem máscara SVG,
                  sem recortar quatro retângulos. O contorno vai em `outline`
                  porque `ring` do Tailwind também é box-shadow e seria perdido. */}
              <div
                ref={spotRef}
                className="pointer-events-none fixed z-[101] rounded-lg"
                style={{
                  boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.55)",
                  outline: "2px solid var(--color-accent)",
                  outlineOffset: "-1px",
                }}
              />
              <div
                ref={popRef}
                className="fixed z-[102] rounded-xl border bg-background p-4 shadow-xl"
                style={{ width: POPOVER_WIDTH, maxWidth: "calc(100vw - 24px)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {screen.label}
                    </p>
                    <h3 className="mt-0.5 text-base font-semibold leading-tight">{step.title}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => close({ done: true })}
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                    aria-label="Fechar tour"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>

                <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-200"
                    style={{ width: `${((index + 1) / steps.length) * 100}%` }}
                  />
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => close({ done: true })}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Pular tour
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {index + 1} de {steps.length}
                    </span>
                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => setIndex((prev) => Math.max(0, prev - 1))}
                        className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                      >
                        Voltar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={goNext}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                    >
                      {!isLast ? "Próximo" : following ? `Ir para ${following.label}` : "Concluir"}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </TourContext.Provider>
  );
}
