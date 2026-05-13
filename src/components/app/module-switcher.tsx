"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActiveModule } from "@/lib/context/active-context";
import type { ModuleDefinition } from "@/lib/context/modules";

interface ModuleSwitcherProps {
  active: ActiveModule;
  available: ModuleDefinition[];
}

export function ModuleSwitcher({ active, available }: ModuleSwitcherProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Single-module users see a static label, no dropdown.
  if (available.length <= 1) {
    const only = available[0];
    if (!only) return null;
    return (
      <span className="t-label hidden text-ink-muted md:inline">{only.label}</span>
    );
  }

  const onChange = (next: string) => {
    if (next === active) return;
    const target = available.find((m) => m.id === next);
    if (!target) return;

    startTransition(async () => {
      await fetch("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: target.id }),
      });
      router.push(target.defaultPath);
      router.refresh();
    });
  };

  return (
    <Select value={active} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="h-9 w-[180px]" aria-label="Modulo ativo">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {available.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
