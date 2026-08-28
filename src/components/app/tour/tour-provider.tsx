"use client";

// Motor do tour guiado. Serve os dois módulos com tour (Financeiro e Compras) —
// o que muda entre eles é só o conteúdo, que vem de @/lib/tour.
//
// Duas entradas, um só motor:
//   1. Primeiro acesso — dispara sozinho na /home, no primeiro módulo que o
//      usuário ainda não viu, e caminha pelas telas na ordem do menu.
//   2. Botão "?" ao lado do nome do módulo, no menu lateral — reabre o tour
//      daquele módulo começando pela tela em que o usuário está (ou pela
//      primeira, quando ele está fora do módulo).
//
// TRÊS GATES, cada um com a sua fonte, e nenhum deles escrito à mão no conteúdo:
//   • o módulo — `moduleIds`, o que o usuário tem em "Módulos visíveis";
//   • a tela — `navKeys`, as chaves que o menu daquele usuário realmente montou;
//   • o passo — a âncora existir na tela + o `audiences` do passo.
//
// Sem dependência externa: o destaque é uma caixa com `box-shadow` gigante
// (escurece tudo em volta sem precisar de máscara SVG) e a posição é
// recalculada a cada frame, direto no style do nó — sem re-render por frame.

import { X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  resolveScreenInModule,
  stepsForAudience,
  tourHref,
  tourModuleById,
  tourStorageKey,
  visibleTourScreens,
  type TourAudience,
  type TourModule,
  type TourModuleId,
  type TourScreen,
  type TourStep,
} from "@/lib/tour";

/** Sessão: "<moduleId>:<screenId>" que deve abrir logo após a navegação. */
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
  /** Módulos com tour que este usuário pode abrir. */
  moduleIds: readonly TourModuleId[];
  /** Abre o tour do módulo, a partir da tela atual quando ela é dele. */
  startModule: (id: TourModuleId) => void;
  /** Módulo cujo tour está aberto agora (desabilita os botões enquanto roda). */
  activeModuleId: TourModuleId | null;
}

const TourContext = createContext<TourContextValue>({
  moduleIds: [],
  startModule: () => {},
  activeModuleId: null,
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
   * Módulos com tour que o usuário tem, na ordem do menu.
   *
   * Gate do módulo inteiro — o disparo no primeiro acesso E o botão "?". Não
   * basta gatear por rota: a /home é o pouso de TODOS os perfis, então quem
   * não tem o módulo passa por lá e veria o botão de um tour sobre telas que
   * nem enxerga.
   *
   * Precisa ter identidade estável entre renders (o AppShell memoiza): é
   * dependência dos efeitos de disparo.
   */
  moduleIds: readonly TourModuleId[];
  /** Chaves de item de menu visíveis a este usuário — gate das telas. */
  navKeys: readonly string[];
  /** Perfil do usuário — decide a variante de texto dos passos. */
  audience: TourAudience | null;
  /** Segmento ativo, para montar o link das telas servidas em /s/<slug>/... */
  segmentSlug: string | null;
}

interface ActiveTour {
  tourModule: TourModule;
  screen: TourScreen;
  steps: readonly TourStep[];
}

export function TourProvider({
  children,
  userKey,
  moduleIds,
  navKeys,
  audience,
  segmentSlug,
}: TourProviderProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState<ActiveTour | null>(null);
  const [index, setIndex] = useState(0);

  const startTokenRef = useRef(0);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const spotRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const navKeySet = useMemo(() => new Set(navKeys), [navKeys]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDone = useCallback(
    (id: TourModuleId) => {
      try {
        return window.localStorage.getItem(tourStorageKey(userKey, id)) === "done";
      } catch {
        // localStorage bloqueado (janela privada, política do navegador): não
        // insistimos com quem não conseguimos lembrar.
        return true;
      }
    },
    [userKey],
  );

  const markDone = useCallback(
    (id: TourModuleId) => {
      try {
        window.localStorage.setItem(tourStorageKey(userKey, id), "done");
      } catch {
        // Sem localStorage o tour volta no próximo acesso. É chato, não é erro.
      }
    },
    [userKey],
  );

  const close = useCallback(
    (opts: { done: boolean }) => {
      startTokenRef.current += 1; // cancela abertura que ainda esteja esperando âncoras
      if (opts.done && active) markDone(active.tourModule.id);
      setActive(null);
      setIndex(0);
      try {
        window.sessionStorage.removeItem(PENDING_KEY);
      } catch {
        /* idem */
      }
    },
    [active, markDone],
  );

  /**
   * Abre o tour numa tela. Passo cujo elemento não está na tela — ou que não é
   * do perfil de quem está lendo — é descartado aqui. É o que permite um mesmo
   * roteiro servir os cinco perfis do Compras sem apontar para o vazio.
   *
   * A tela pode ainda estar montando quando a navegação termina, então
   * tentamos algumas vezes antes de desistir das âncoras.
   */
  const start = useCallback(
    (tourModule: TourModule, screen: TourScreen) => {
      // Um pedido de abertura invalida os anteriores: se o usuário navegar
      // enquanto esperamos as âncoras montarem, a tentativa antiga morre em vez
      // de abrir o tour da tela errada.
      const token = startTokenRef.current + 1;
      startTokenRef.current = token;
      const candidates = stepsForAudience(screen, audience);
      let tries = 0;
      const attempt = () => {
        if (startTokenRef.current !== token) return;
        const visible = candidates.filter((step) => !step.anchor || anchorElement(step.anchor));
        const anchored = candidates.filter((step) => step.anchor).length;
        const found = visible.filter((step) => step.anchor).length;
        if (anchored > 0 && found === 0 && tries < 30) {
          tries += 1;
          window.setTimeout(attempt, 150);
          return;
        }
        if (visible.length === 0) return;
        setActive({ tourModule, screen, steps: visible });
        setIndex(0);
      };
      window.setTimeout(attempt, 250);
    },
    [audience],
  );

  // Primeiro acesso: só na /home, e no primeiro módulo ainda não visto. Quem
  // tem os dois vê o Financeiro primeiro e recebe o Compras como continuação
  // no fim (ver `followingModule`).
  useEffect(() => {
    if (!mounted || pathname !== "/home" || active) return;
    for (const id of moduleIds) {
      if (isDone(id)) continue;
      const tourModule = tourModuleById(id);
      const home = tourModule ? resolveScreenInModule(tourModule, "/home") : null;
      if (tourModule && home) start(tourModule, home);
      return;
    }
  }, [mounted, pathname, active, moduleIds, isDone, start]);

  // Continuação da sequência: a tela anterior deixou "<módulo>:<tela>" marcado
  // antes de navegar. Passa por sessionStorage porque a navegação entre módulos
  // troca de route group — o provider desmonta e remonta, e o estado se perde.
  useEffect(() => {
    if (!mounted) return;
    let pending: string | null = null;
    try {
      pending = window.sessionStorage.getItem(PENDING_KEY);
    } catch {
      pending = null;
    }
    if (!pending) return;
    const [moduleId, screenId] = pending.split(":");
    const tourModule = moduleIds.includes(moduleId as TourModuleId)
      ? tourModuleById(moduleId as TourModuleId)
      : null;
    if (!tourModule) return;
    const screen = resolveScreenInModule(tourModule, pathname);
    if (!screen || screen.id !== screenId) return;
    try {
      window.sessionStorage.removeItem(PENDING_KEY);
    } catch {
      /* idem */
    }
    start(tourModule, screen);
  }, [mounted, pathname, moduleIds, start]);

  const startModule = useCallback(
    (id: TourModuleId) => {
      if (!moduleIds.includes(id)) return;
      const tourModule = tourModuleById(id);
      if (!tourModule) return;
      const screens = visibleTourScreens(tourModule, navKeySet);
      if (screens.length === 0) return;
      // Está numa tela do módulo? Começa por ela — é o "como usar esta tela".
      // Fora do módulo, começa do início e navega até lá.
      const here = resolveScreenInModule(tourModule, pathname);
      const target = here && screens.some((s) => s.id === here.id) ? here : screens[0];
      if (target === here) {
        start(tourModule, target);
        return;
      }
      const href = tourHref(target, segmentSlug);
      if (!href) return;
      try {
        window.sessionStorage.setItem(PENDING_KEY, `${tourModule.id}:${target.id}`);
      } catch {
        /* sem sessionStorage o tour não retoma após a navegação */
      }
      router.push(href);
    },
    [moduleIds, navKeySet, pathname, segmentSlug, router, start],
  );

  const step = active ? active.steps[index] : undefined;

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
    if (!active || !step) return;
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
        // Passo sem âncora (abertura da tela, explicação do fluxo): balão
        // centralizado, tela toda escurecida pelo overlay.
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
  }, [active, step]);

  // Próxima tela do MESMO módulo, já filtrada pelo que o usuário enxerga.
  const followingScreen = useMemo(() => {
    if (!active) return null;
    const screens = visibleTourScreens(active.tourModule, navKeySet);
    const at = screens.findIndex((s) => s.id === active.screen.id);
    if (at < 0 || at === screens.length - 1) return null;
    return screens[at + 1];
  }, [active, navKeySet]);

  // Acabou o módulo e o usuário tem outro que ainda não viu: oferecemos a
  // continuação em vez de um "Concluir" que esconde metade do sistema.
  const followingModule = useMemo(() => {
    if (!active || followingScreen) return null;
    const next = moduleIds.find((id) => id !== active.tourModule.id && !isDone(id));
    return next ? tourModuleById(next) : null;
  }, [active, followingScreen, moduleIds, isDone]);

  const isLast = active ? index === active.steps.length - 1 : false;

  const goNext = useCallback(() => {
    if (!active) return;
    if (!isLast) {
      setIndex((prev) => prev + 1);
      return;
    }

    const target = followingScreen
      ? { tourModule: active.tourModule, screen: followingScreen }
      : followingModule
        ? (() => {
            const screens = visibleTourScreens(followingModule, navKeySet);
            return screens.length > 0 ? { tourModule: followingModule, screen: screens[0] } : null;
          })()
        : null;

    if (!target) {
      close({ done: true });
      return;
    }

    const href = tourHref(target.screen, segmentSlug);
    if (!href) {
      close({ done: true });
      return;
    }
    // Trocar de módulo encerra o anterior: ele foi percorrido até o fim.
    if (target.tourModule.id !== active.tourModule.id) markDone(active.tourModule.id);
    try {
      window.sessionStorage.setItem(PENDING_KEY, `${target.tourModule.id}:${target.screen.id}`);
    } catch {
      /* sem sessionStorage a sequência para aqui; o "?" segue disponível. */
    }
    setActive(null);
    setIndex(0);
    router.push(href);
  }, [
    active,
    isLast,
    followingScreen,
    followingModule,
    navKeySet,
    segmentSlug,
    markDone,
    router,
    close,
  ]);

  // Esc encerra — sempre. Um tour do qual não se sai é uma armadilha.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close({ done: true });
      else if (event.key === "ArrowRight") goNext();
      else if (event.key === "ArrowLeft") setIndex((prev) => Math.max(0, prev - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, close, goNext]);

  const value = useMemo<TourContextValue>(
    () => ({ moduleIds, startModule, activeModuleId: active?.tourModule.id ?? null }),
    [moduleIds, startModule, active],
  );

  const nextLabel = !isLast
    ? "Próximo"
    : followingScreen
      ? `Ir para ${followingScreen.label}`
      : followingModule
        ? `Ver o tour de ${followingModule.label}`
        : "Concluir";

  return (
    <TourContext.Provider value={value}>
      {children}
      {mounted && active && step
        ? createPortal(
            <div className="ch-tour" role="dialog" aria-modal="true" aria-label="Tour guiado">
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
                      {active.tourModule.label} · {active.screen.label}
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
                    style={{ width: `${((index + 1) / active.steps.length) * 100}%` }}
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
                      {index + 1} de {active.steps.length}
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
                      {nextLabel}
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
