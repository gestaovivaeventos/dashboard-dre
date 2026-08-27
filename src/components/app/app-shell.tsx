"use client";

import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Logo, LogoFull } from "@/components/app/logo";
import { NavLinks } from "@/components/app/nav-links";
import { NotificationsLink } from "@/components/app/notifications-link";
import { SegmentChip } from "@/components/app/segment-chip";
import { SignOutButton } from "@/components/app/sign-out-button";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { HelpButton } from "@/components/app/tour/help-button";
import { TourProvider } from "@/components/app/tour/tour-provider";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BI_VALIDATION_PATH } from "@/lib/auth/bi-validation";
import type { ActiveModule } from "@/lib/context/active-context";
import type { ModuleDefinition } from "@/lib/context/modules";
import type { CtrlRole, DreRole, Segment } from "@/lib/supabase/types";

interface AppShellProps {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
  /** Papel DRE para o menu; null quando o usuário não tem o módulo Financeiro. */
  userRole: DreRole | null;
  ctrlRoles?: CtrlRole[];
  canCase?: boolean;
  canViagens?: boolean;
  canViagensAprovar?: boolean;
  /** Módulo Validação de Contratos — grupo CONTRATOS no menu. */
  canContratos?: boolean;
  segments: Segment[];
  activeModule: ActiveModule;
  availableModules: ModuleDefinition[];
  activeSegmentSlug: string | null;
  contractsOnly?: boolean;
  isFranqueado?: boolean;
  /** Perfil 'csc' — cópia do franqueado + tela "Validação Relatório". */
  isCsc?: boolean;
  /** Pode acessar "Validação Relatório" (CSC, admin ou e-mail nominal). */
  canBiValidation?: boolean;
  /** Visão completa (leitura) do módulo Compras — override nominal por e-mail. */
  ctrlFullView?: boolean;
  unreadNotifications?: number;
}

export function AppShell({
  children,
  userName,
  userEmail,
  userRole,
  ctrlRoles,
  canCase,
  canViagens,
  canViagensAprovar,
  canContratos,
  segments,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  activeModule,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  availableModules,
  activeSegmentSlug,
  contractsOnly,
  isFranqueado,
  isCsc,
  canBiValidation,
  ctrlFullView,
  unreadNotifications = 0,
}: AppShellProps) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  const hasCtrl = (ctrlRoles?.length ?? 0) > 0;
  const hasSegments = segments.length > 0;
  // A home é desenhada em faixas de largura total (padding próprio por
  // faixa); as demais telas continuam com o respiro do <main>.
  const isHome = pathname === "/home";

  // Segmento usado para montar os links do tour — mesma regra do menu
  // (buildGroups): o ativo quando ele existe na lista, senão o primeiro.
  const tourSegmentSlug =
    activeSegmentSlug && segments.some((s) => s.slug === activeSegmentSlug)
      ? activeSegmentSlug
      : segments[0]?.slug ?? null;

  const sidebarNav = (mobile: boolean) => (
    <NavLinks
      dreRole={userRole}
      ctrlRoles={ctrlRoles}
      canCase={canCase}
      canViagens={canViagens}
      canViagensAprovar={canViagensAprovar}
      canContratos={canContratos}
      segments={segments}
      activeSegmentSlug={activeSegmentSlug}
      collapsed={!mobile && collapsed}
      onNavigate={mobile ? () => setOpen(false) : undefined}
      contractsOnly={contractsOnly}
      isFranqueado={isFranqueado}
      isCsc={isCsc}
      canBiValidation={canBiValidation}
      ctrlFullView={ctrlFullView}
    />
  );

  return (
    <TooltipProvider delayDuration={0}>
      {/* Tour guiado do Financeiro, para TODO MUNDO que tem o módulo. O gate é
          o `userRole` (= navDreRole no layout), não-nulo exatamente quando o
          usuário tem `can_financeiro` — quem só tem Compras/Contratos não é
          interrompido. Roda uma vez por pessoa e o "?" da topbar traz de volta. */}
      <TourProvider
        userKey={userEmail || userName}
        autoStart={userRole !== null}
        segmentSlug={tourSegmentSlug}
      >
      <div className="ch-shell">
        {/* Sidebar fixa (>= 1100px). Abaixo disso vira drawer. */}
        <aside className={`ch-sidebar ${collapsed ? "ch-sidebar--collapsed" : ""}`}>
          <a
            href="/home"
            className={`ch-brand-link ${collapsed ? "ch-brand-link--collapsed" : ""}`}
          >
            {collapsed ? <Logo size={22} /> : <LogoFull />}
          </a>

          {/* Só esta faixa rola; a marca no topo e o "Recolher menu" na base
              ficam sempre à vista. */}
          <div className="ch-sidebar__scroll" data-tour="nav-menu">
            {sidebarNav(false)}
          </div>

          <div className="ch-sidebar__foot">
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className={`ch-btn ch-btn--ghost ${collapsed ? "" : "ch-btn--wide"}`}
              title={collapsed ? "Expandir menu" : "Recolher menu"}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" strokeWidth={2} />
              ) : (
                <>
                  <PanelLeftClose className="h-4 w-4" strokeWidth={2} />
                  Recolher menu
                </>
              )}
            </button>
          </div>
        </aside>

        <div className={`ch-content ${collapsed ? "ch-content--collapsed" : ""}`}>
          <header className="ch-topbar">
            {/* Drawer (abaixo de 1100px) */}
            <div className="ch-drawer-trigger">
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                  <button type="button" className="ch-iconbtn" aria-label="Abrir menu">
                    <Menu className="h-4 w-4" strokeWidth={2} />
                  </button>
                </SheetTrigger>
                <SheetContent className="bg-[var(--menu-bg)] p-0">
                  <a href="/home" className="ch-brand-link">
                    <LogoFull />
                  </a>

                  {hasSegments && (
                    <div className="px-4 pb-3">
                      <SegmentChip segments={segments} activeSlug={activeSegmentSlug} />
                    </div>
                  )}

                  {sidebarNav(true)}
                </SheetContent>
              </Sheet>
            </div>

            {/* Sem título aqui: cada tela já abre com o próprio título (e a
                linha de descrição abaixo dele). Repetir o nome na topbar
                deixava o mesmo texto duas vezes no topo de toda página. */}
            <div className="ch-topbar__right">
              {/* Sino: módulo Compras (padrão) ou, para quem só valida
                  relatórios BI (perfil CSC, sem Compras), a própria tela de
                  Validação Relatório — onde a pendência é resolvida. */}
              <NotificationsLink
                visible={hasCtrl || Boolean(canBiValidation)}
                unreadCount={unreadNotifications}
                href={hasCtrl ? "/ctrl/notificacoes" : BI_VALIDATION_PATH}
              />
              <HelpButton />
              <span data-tour="topbar-tema" className="inline-flex">
                <ThemeToggle />
              </span>
              <div className="ch-user">
                <p className="ch-user__name">{userName}</p>
                <p className="ch-user__mail">{userEmail}</p>
              </div>
              <SignOutButton />
            </div>
          </header>

          <main className={isHome ? undefined : "p-5 md:p-7"}>{children}</main>
        </div>
      </div>
      </TourProvider>
    </TooltipProvider>
  );
}
