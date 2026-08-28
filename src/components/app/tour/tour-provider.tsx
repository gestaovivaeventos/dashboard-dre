"use client";

// Motor do tour guiado. Serve os dois módulos com tour (Financeiro e Compras) —
// o que muda entre eles é só o conteúdo, que vem de @/lib/tour.
//
// Duas entradas, um só motor:
//   1. Primeiro acesso — dispara sozinho na /home UMA ÚNICA VEZ na vida do
//      usuário, e caminha pelas telas na ordem do menu. Quem tem os dois
//      módulos recebe o segundo como continuação, no mesmo passeio.
//   2. Botão "?" ao lado do nome do módulo, no menu lateral — reabre o tour
//      daquele módulo começando pela tela em que o usuário está (ou pela
//      primeira, quando ele está fora do módulo). Sem limite de vezes.
//
// A marca de "já viu" é do SERVIDOR (`autoStart`, vindo de `profile.tour_seen`)
// e é gravada no instante em que o tour abre sozinho — não ao fechar. Fechar no
// primeiro passo, recarregar a página no meio ou fechar o navegador não devolvem
// o tour: ele já apareceu, e a partir daí o caminho é o "?".
//
// TRÊS GATES, cada um com a sua fonte, e nenhum deles escrito à mão no conteúdo:
//   • o módulo — `moduleIds`, o que o usuário tem em "Módulos visíveis";
//   • a tela — `navKeys`, as chaves que o menu daquele usuário realmente montou;
//   • o passo — a âncora existir na tela + o `audiences` do passo.
//
// Sem dependência externa: o destaque é uma caixa com `box-shadow` gigante
// (escurece tudo em volta sem precisar de máscara SVG) e a posição é
// recalculada a cada frame, direto no style do nó — sem re-render por frame.

import { Loader2, X } from "lucide-react";
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

/**
 * Sessão: "<moduleId>:<screenId>:<chainDepth>:<timestamp>" que deve abrir logo
 * após a navegação. Passa por sessionStorage porque navegar entre módulos troca
 * de route group — o provider desmonta e remonta, e o estado em memória se
 * perde.
 *
 * O timestamp existe porque o marcador só é consumido quando a rota casa: se a
 * navegação falhar ou o usuário desviar no meio, ele ficaria na sessão e
 * ressuscitaria o balão de "abrindo..." numa navegação qualquer, horas depois.
 */
const PENDING_KEY = "ch-tour-pending";

/** Além disso, o marcador não vale mais nada — a navegação já não é "a de agora". */
const PENDING_MAX_AGE_MS = 30_000;

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

/**
 * O que o balão de espera anuncia. Abrir a PRIMEIRA tela de um módulo é, para
 * quem lê, "começar o tour do Compras" — não "abrir o Início": as duas abrem a
 * mesma /home, e o nome da tela não diria o que está acontecendo.
 */
function openingLabel(tourModule: TourModule, screen: TourScreen): string {
  return tourModule.screens[0]?.id === screen.id ? tourModule.label : screen.label;
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
   * Identificação do usuário (e-mail) usada só na chave do supressor local.
   * A marca que vale é a do servidor — ver `autoStart`.
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
  /**
   * O tour ainda não foi apresentado a este usuário (`!profile.tour_seen`).
   *
   * É a ÚNICA autorização para o tour abrir sozinho, e vem do banco — não do
   * navegador. Quem já usava o Control Hub antes desta implementação não tem a
   * marca, então recebe o passeio na próxima entrada, uma vez só.
   */
  autoStart: boolean;
}

interface ActiveTour {
  tourModule: TourModule;
  screen: TourScreen;
  steps: readonly TourStep[];
  /**
   * Quantos módulos AINDA podem ser emendados depois deste.
   *
   * 0 = encerra aqui, e é o caso de quem abriu pelo "?": pediu um módulo
   * específico, emendar o outro seria atropelo. No passeio de primeiro acesso
   * começa em (nº de módulos − 1) e decrementa a cada emenda — sem essa
   * contagem, o fim do segundo módulo ofereceria o primeiro de novo, em laço.
   */
  chainDepth: number;
}

export function TourProvider({
  children,
  userKey,
  moduleIds,
  navKeys,
  audience,
  segmentSlug,
  autoStart,
}: TourProviderProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState<ActiveTour | null>(null);
  const [index, setIndex] = useState(0);
  /**
   * Nome da tela que estamos abrindo, enquanto ela carrega.
   *
   * Sem isso o tour SOME no clique de "Ir para..." e só volta quando a tela
   * nova termina de montar — em telas pesadas isso são segundos de nada, e o
   * usuário conclui que o tour acabou. Enquanto este valor existe, o balão
   * continua na tela dizendo o que está sendo aberto.
   */
  const [navLabel, setNavLabel] = useState<string | null>(null);
  /**
   * Quem tem os dois módulos escolhe por onde começar, em vez de cair no
   * Financeiro por ser o primeiro do menu. O outro módulo continua vindo em
   * seguida — muda a ordem, não o conteúdo.
   */
  const [choosing, setChoosing] = useState(false);

  const startTokenRef = useRef(0);
  const autoStartRecordedRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const spotRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const navKeySet = useMemo(() => new Set(navKeys), [navKeys]);

  useEffect(() => {
    setMounted(true);
  }, []);

  /**
   * Registra que o tour já apareceu — no servidor (definitivo, vale em qualquer
   * navegador) e no localStorage (supressor local, para a janela entre o
   * disparo e a resposta do servidor). Chamado no instante em que o tour abre
   * sozinho, nunca quando o usuário o abre pelo "?".
   */
  const recordAutoStart = useCallback(() => {
    if (autoStartRecordedRef.current) return;
    autoStartRecordedRef.current = true;
    try {
      window.localStorage.setItem(tourStorageKey(userKey), "1");
    } catch {
      /* navegador sem storage: sobra a marca do servidor, que é a que vale */
    }
    // Falha aqui não interrompe nada: o tour já está na tela, e o pior caso é
    // ele reaparecer no próximo acesso.
    void fetch("/api/tour/seen", { method: "POST" }).catch(() => {});
  }, [userKey]);

  const close = useCallback(() => {
    startTokenRef.current += 1; // cancela abertura que ainda esteja esperando âncoras
    setActive(null);
    setNavLabel(null);
    setChoosing(false);
    setIndex(0);
    try {
      window.sessionStorage.removeItem(PENDING_KEY);
    } catch {
      /* idem */
    }
  }, []);

  /**
   * Abre o tour numa tela. Passo cujo elemento não está na tela — ou que não é
   * do perfil de quem está lendo — é descartado aqui. É o que permite um mesmo
   * roteiro servir os cinco perfis do Compras sem apontar para o vazio.
   *
   * A tela pode ainda estar montando quando a navegação termina, então
   * tentamos algumas vezes antes de desistir das âncoras.
   */
  const start = useCallback(
    (tourModule: TourModule, screen: TourScreen, chainDepth: number) => {
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
        // Telas pesadas (a Nova Requisição carrega fornecedores, setores,
        // tipos, eventos e câmbio no servidor) chegam bem depois do clique.
        // Insistimos por ~10s, em passos curtos, para reabrir no instante em
        // que a tela monta — e não um tempo fixo depois dela.
        if (anchored > 0 && found === 0 && tries < 100) {
          tries += 1;
          window.setTimeout(attempt, 100);
          return;
        }
        setNavLabel(null);
        if (visible.length === 0) return;
        setActive({ tourModule, screen, steps: visible, chainDepth });
        setIndex(0);
      };
      // Primeira tentativa imediata: quem chama `start` é sempre um efeito, que
      // já roda depois do commit da tela nova — esperar um tempo fixo antes de
      // olhar o DOM só atrasava a reabertura nas telas que já estavam prontas.
      attempt();
    },
    [audience],
  );

  /** Abre o passeio de primeiro acesso pelo módulo escolhido. */
  const startChainAt = useCallback(
    (id: TourModuleId) => {
      const tourModule = tourModuleById(id);
      const home = tourModule ? resolveScreenInModule(tourModule, "/home") : null;
      if (!tourModule || !home) return;
      setChoosing(false);
      // Os demais módulos que a pessoa tem podem ser emendados depois deste.
      start(tourModule, home, Math.max(0, moduleIds.length - 1));
    },
    [moduleIds, start],
  );

  // Primeiro acesso: uma vez na vida, na /home. Com um módulo só, abre direto;
  // com os dois, pergunta por onde começar — o outro vem como continuação, no
  // mesmo passeio (ver `followingModule`), nunca como um segundo disparo.
  useEffect(() => {
    if (!autoStart || !mounted || pathname !== "/home" || active || choosing) return;
    if (autoStartRecordedRef.current) return;
    // Supressor local: cobre a janela entre o disparo e a marca do servidor
    // chegar (o layout já foi renderizado com o tour_seen antigo).
    try {
      if (window.localStorage.getItem(tourStorageKey(userKey))) return;
    } catch {
      /* sem storage seguimos com a marca do servidor apenas */
    }
    if (moduleIds.length === 0) return;
    // O tour "apareceu" tanto na escolha quanto no passeio: marcar aqui é o que
    // garante uma única aparição mesmo se a pessoa fechar na pergunta.
    recordAutoStart();
    if (moduleIds.length > 1) {
      setChoosing(true);
      return;
    }
    startChainAt(moduleIds[0]);
  }, [
    autoStart,
    mounted,
    pathname,
    active,
    choosing,
    moduleIds,
    userKey,
    recordAutoStart,
    startChainAt,
  ]);

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
    const [moduleId, screenId, depthFlag, stamp] = pending.split(":");
    // Marcador velho é lixo de uma sequência abandonada: descarta em vez de
    // abrir um tour que ninguém pediu.
    if (!stamp || Date.now() - Number(stamp) > PENDING_MAX_AGE_MS) {
      try {
        window.sessionStorage.removeItem(PENDING_KEY);
      } catch {
        /* idem */
      }
      return;
    }
    const tourModule = moduleIds.includes(moduleId as TourModuleId)
      ? tourModuleById(moduleId as TourModuleId)
      : null;
    if (!tourModule) return;
    // Provider recém-montado no meio de uma sequência (a navegação trocou de
    // route group): mostra o balão de "abrindo" antes mesmo de a tela existir,
    // senão sobra uma tela nua e a impressão de que o tour acabou.
    const target = tourModule.screens.find((s) => s.id === screenId);
    if (target) setNavLabel(openingLabel(tourModule, target));
    const screen = resolveScreenInModule(tourModule, pathname);
    if (!screen || screen.id !== screenId) return;
    try {
      window.sessionStorage.removeItem(PENDING_KEY);
    } catch {
      /* idem */
    }
    start(tourModule, screen, Number(depthFlag) || 0);
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
        start(tourModule, target, 0);
        return;
      }
      const href = tourHref(target, segmentSlug);
      if (!href) return;
      try {
        window.sessionStorage.setItem(PENDING_KEY, `${tourModule.id}:${target.id}:0:${Date.now()}`);
      } catch {
        /* sem sessionStorage o tour não retoma após a navegação */
      }
      setNavLabel(openingLabel(tourModule, target));
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

  // Acabou o módulo e o usuário tem outro: no passeio de primeiro acesso
  // oferecemos a continuação, em vez de um "Concluir" que esconderia metade do
  // sistema de quem só vai ver isso uma vez. Quem abriu pelo "?" não recebe a
  // emenda — pediu um módulo específico.
  const followingModule = useMemo(() => {
    if (!active || followingScreen || active.chainDepth <= 0) return null;
    const next = moduleIds.find((id) => id !== active.tourModule.id);
    return next ? tourModuleById(next) : null;
  }, [active, followingScreen, moduleIds]);

  const isLast = active ? index === active.steps.length - 1 : false;

  // Aquece a próxima tela enquanto a pessoa lê o passo atual. Não elimina a
  // consulta ao servidor (são rotas dinâmicas), mas tira do caminho o download
  // e a compilação do bundle da tela — que na Nova Requisição é grande.
  useEffect(() => {
    if (!active || !followingScreen) return;
    const href = tourHref(followingScreen, segmentSlug);
    if (href) router.prefetch(href);
  }, [active, followingScreen, segmentSlug, router]);

  // Rede de segurança do balão de "abrindo...": se a tela nunca montar as
  // âncoras (rota que falhou, usuário navegou para outro lugar no meio), o
  // balão não pode ficar preso na frente da tela para sempre.
  useEffect(() => {
    if (!navLabel || active) return;
    const timer = window.setTimeout(() => {
      setNavLabel(null);
      try {
        window.sessionStorage.removeItem(PENDING_KEY);
      } catch {
        /* idem */
      }
    }, 20_000);
    return () => window.clearTimeout(timer);
  }, [navLabel, active]);

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
      close();
      return;
    }

    const href = tourHref(target.screen, segmentSlug);
    if (!href) {
      close();
      return;
    }
    // Seguir para outra TELA mantém a profundidade; emendar outro MÓDULO gasta
    // uma — é o que impede o fim do segundo módulo oferecer o primeiro de novo.
    const nextDepth =
      target.tourModule.id === active.tourModule.id
        ? active.chainDepth
        : Math.max(0, active.chainDepth - 1);
    try {
      window.sessionStorage.setItem(
        PENDING_KEY,
        `${target.tourModule.id}:${target.screen.id}:${nextDepth}:${Date.now()}`,
      );
    } catch {
      /* sem sessionStorage a sequência para aqui; o "?" segue disponível. */
    }
    setActive(null);
    setIndex(0);
    // O balão troca para "abrindo <tela>" em vez de sumir: a tela seguinte pode
    // levar segundos para montar, e sem sinal nenhum isso lê como fim do tour.
    setNavLabel(openingLabel(target.tourModule, target.screen));
    router.push(href);
  }, [active, isLast, followingScreen, followingModule, navKeySet, segmentSlug, router, close]);

  // Esc encerra — sempre, inclusive na pergunta inicial e na espera da próxima
  // tela. Um tour do qual não se sai é uma armadilha.
  useEffect(() => {
    if (!active && !navLabel && !choosing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (!active) return;
      if (event.key === "ArrowRight") goNext();
      else if (event.key === "ArrowLeft") setIndex((prev) => Math.max(0, prev - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, navLabel, choosing, close, goNext]);

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
      {/* Pergunta inicial de quem tem os dois módulos. */}
      {mounted && choosing
        ? createPortal(
            <div className="ch-tour" role="dialog" aria-modal="true" aria-label="Escolha do tour guiado">
              <div className="fixed inset-0 z-[100]" style={{ background: "rgba(2, 6, 23, 0.55)" }} />
              <div
                className="fixed left-1/2 top-1/2 z-[102] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-5 shadow-xl"
                style={{ width: 460, maxWidth: "calc(100vw - 24px)" }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Tour guiado
                </p>
                <h3 className="mt-0.5 text-lg font-semibold leading-tight">
                  Por onde você quer começar?
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Você tem acesso aos dois módulos. Escolha qual apresentar primeiro — ao
                  terminar, o tour segue para o outro.
                </p>

                <div className="mt-4 space-y-2">
                  {moduleIds.map((id) => {
                    const tourModule = tourModuleById(id);
                    if (!tourModule) return null;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => startChainAt(id)}
                        className="flex w-full flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-muted/60"
                      >
                        <span className="text-sm font-semibold">{tourModule.label}</span>
                        <span className="text-xs leading-relaxed text-muted-foreground">
                          {tourModule.summary}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex justify-start">
                  <button
                    type="button"
                    onClick={() => close()}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Pular tour
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {/* Espera da próxima tela. Mesma moldura do balão do passo, para o tour
          parecer contínuo — o que ele é: a tela é que está carregando. */}
      {mounted && !active && navLabel
        ? createPortal(
            <div className="ch-tour" role="status" aria-live="polite">
              <div className="fixed inset-0 z-[100]" style={{ background: "rgba(2, 6, 23, 0.55)" }} />
              <div
                className="fixed left-1/2 top-1/2 z-[102] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-4 shadow-xl"
                style={{ width: POPOVER_WIDTH, maxWidth: "calc(100vw - 24px)" }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Tour guiado
                </p>
                <h3 className="mt-0.5 flex items-center gap-2 text-base font-semibold leading-tight">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  Abrindo {navLabel}…
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  O tour continua assim que a tela terminar de carregar.
                </p>
                <div className="mt-3 flex justify-start">
                  <button
                    type="button"
                    onClick={() => close()}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Pular tour
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
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
                    onClick={() => close()}
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
                    onClick={() => close()}
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
