"use client";

import { Menu, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { useState } from "react";

import { CommandPalette } from "@/components/app/command-palette";
import { Logo, LogoFull } from "@/components/app/logo";
import { NavLinks } from "@/components/app/nav-links";
import { NotificationsLink } from "@/components/app/notifications-link";
import { SegmentChip } from "@/components/app/segment-chip";
import { SignOutButton } from "@/components/app/sign-out-button";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ActiveModule } from "@/lib/context/active-context";
import type { ModuleDefinition } from "@/lib/context/modules";
import type { CtrlRole, DreRole, Segment } from "@/lib/supabase/types";

interface AppShellProps {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
  userRole: DreRole;
  ctrlRoles?: CtrlRole[];
  segments: Segment[];
  activeModule: ActiveModule;
  availableModules: ModuleDefinition[];
  activeSegmentSlug: string | null;
  contractsOnly?: boolean;
  isFranqueado?: boolean;
  unreadNotifications?: number;
  navBadges?: Record<string, number>;
}

export function AppShell({
  children,
  userName,
  userEmail,
  userRole,
  ctrlRoles,
  segments,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  activeModule,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  availableModules,
  activeSegmentSlug,
  contractsOnly,
  isFranqueado,
  unreadNotifications = 0,
  navBadges,
}: AppShellProps) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const hasCtrl = (ctrlRoles?.length ?? 0) > 0;
  const hasSegments = segments.length > 0;

  const sidebarNav = (mobile: boolean) => (
    <NavLinks
      dreRole={userRole}
      ctrlRoles={ctrlRoles}
      segments={segments}
      activeSegmentSlug={activeSegmentSlug}
      collapsed={!mobile && collapsed}
      onNavigate={mobile ? () => setOpen(false) : undefined}
      contractsOnly={contractsOnly}
      isFranqueado={isFranqueado}
      badges={navBadges}
    />
  );

  return (
    <TooltipProvider delayDuration={0}>
      <div className="min-h-screen bg-surface-0">
        {/* Desktop sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-border bg-surface-1 transition-all duration-300 md:flex ${
            collapsed ? "w-16" : "w-72"
          }`}
        >
          <a href="/home" className={`flex items-center p-4 ${collapsed ? "justify-center" : ""}`}>
            {collapsed ? <Logo size={32} /> : <LogoFull />}
          </a>

          {!collapsed && hasSegments && (
            <div className="px-3 pb-2">
              <SegmentChip segments={segments} activeSlug={activeSegmentSlug} />
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-2">{sidebarNav(false)}</div>

          <div className="border-t border-border p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCollapsed(!collapsed)}
              className={`w-full text-ink-secondary hover:text-ink-primary ${
                collapsed ? "justify-center px-0" : "justify-start gap-2"
              }`}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <>
                  <PanelLeftClose className="h-4 w-4" />
                  <span className="text-xs">Recolher menu</span>
                </>
              )}
            </Button>
          </div>
        </aside>

        <div className={`transition-all duration-300 ${collapsed ? "md:pl-16" : "md:pl-72"}`}>
          <header className="sticky top-0 z-30 flex h-[68px] items-center gap-3 border-b-2 border-viva-500 bg-surface-1 px-4 md:px-6">
            {/* Mobile menu trigger */}
            <div className="flex items-center gap-3 md:hidden">
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                  <Button type="button" variant="outline" size="icon">
                    <Menu className="h-5 w-5" />
                    <span className="sr-only">Abrir menu</span>
                  </Button>
                </SheetTrigger>
                <SheetContent className="bg-surface-1">
                  <a href="/home" className="mb-4 block">
                    <LogoFull />
                  </a>

                  {hasSegments && (
                    <div className="mb-4">
                      <SegmentChip segments={segments} activeSlug={activeSegmentSlug} />
                    </div>
                  )}

                  {sidebarNav(true)}
                </SheetContent>
              </Sheet>
            </div>

            <div className="ml-auto flex items-center gap-3">
              {/* Busca / command palette (Ctrl+K) */}
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="hidden items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink-secondary sm:flex"
              >
                <Search className="h-3.5 w-3.5" />
                <span>Buscar</span>
                <kbd className="rounded border border-border bg-surface-2 px-1 py-0.5 text-[10px] font-medium">
                  ⌘K
                </kbd>
              </button>
              <div className="hidden text-right md:block">
                <p className="text-sm font-medium leading-none text-ink-primary">{userName}</p>
                <p className="text-xs text-ink-muted">{userEmail}</p>
              </div>
              <NotificationsLink visible={hasCtrl} unreadCount={unreadNotifications} />
              <ThemeToggle />
              <Separator className="hidden h-8 w-px bg-white/10 sm:block" />
              <SignOutButton />
            </div>
          </header>

          <main className="p-4 md:p-6">{children}</main>
        </div>

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          dreRole={userRole}
          ctrlRoles={ctrlRoles}
          segments={segments}
          activeSegmentSlug={activeSegmentSlug}
          contractsOnly={contractsOnly}
          isFranqueado={isFranqueado}
        />
      </div>
    </TooltipProvider>
  );
}
