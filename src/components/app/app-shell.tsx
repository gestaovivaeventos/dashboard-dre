"use client";

import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";

import { Logo, LogoFull } from "@/components/app/logo";
import { NavLinks } from "@/components/app/nav-links";
import { SignOutButton } from "@/components/app/sign-out-button";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Segment, UserRole } from "@/lib/supabase/types";

interface AppShellProps {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
  userRole: UserRole;
  segments: Segment[];
}

export function AppShell({ children, userName, userEmail, userRole, segments }: AppShellProps) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <TooltipProvider delayDuration={0}>
      <div className="min-h-screen bg-slate-50 dark:bg-background">
        {/* Desktop sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-20 hidden flex-col border-r bg-background transition-all duration-300 md:flex ${
            collapsed ? "w-16" : "w-72"
          }`}
        >
          <a href="/home" className={`flex items-center p-4 ${collapsed ? "justify-center" : ""}`}>
            {collapsed ? <Logo size={32} /> : <LogoFull />}
          </a>

          <div className="flex-1 overflow-y-auto px-2">
            <NavLinks role={userRole} segments={segments} collapsed={collapsed} />
          </div>

          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCollapsed(!collapsed)}
              className={`w-full ${collapsed ? "justify-center px-0" : "justify-start gap-2"}`}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <>
                  <PanelLeftClose className="h-4 w-4" />
                  <span className="text-xs text-muted-foreground">Recolher menu</span>
                </>
              )}
            </Button>
          </div>
        </aside>

        <div
          className={`transition-all duration-300 ${
            collapsed ? "md:pl-16" : "md:pl-72"
          }`}
        >
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background px-4 md:px-6">
            <div className="flex items-center gap-2 md:hidden">
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                  <Button type="button" variant="outline" size="icon">
                    <Menu className="h-5 w-5" />
                    <span className="sr-only">Abrir menu</span>
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <a href="/home" className="mb-6 block">
                    <LogoFull />
                  </a>
                  <NavLinks role={userRole} segments={segments} onNavigate={() => setOpen(false)} />
                </SheetContent>
              </Sheet>
              <span className="text-sm font-bold">Controll Hub</span>
            </div>

            <div className="ml-auto flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium leading-none">{userName}</p>
                <p className="text-xs text-muted-foreground">{userEmail}</p>
              </div>
              <ThemeToggle />
              <Separator className="hidden h-8 w-px sm:block" />
              <SignOutButton />
            </div>
          </header>

          <main className="p-4 md:p-6">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
