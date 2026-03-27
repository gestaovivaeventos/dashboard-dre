"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

import { LogoFull } from "@/components/app/logo";
import { NavLinks } from "@/components/app/nav-links";
import { SignOutButton } from "@/components/app/sign-out-button";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r bg-background p-4 md:block">
        <div className="mb-6">
          <LogoFull />
        </div>
        <NavLinks role={userRole} segments={segments} />
      </aside>

      <div className="md:pl-72">
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
                <div className="mb-6">
                  <LogoFull />
                </div>
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
  );
}
