"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActiveModule } from "@/lib/context/active-context";
import type { ModuleDefinition } from "@/lib/context/modules";

interface ModuleSwitcherProps {
  active: ActiveModule;
  available: ModuleDefinition[];
}

export function ModuleSwitcher({ active, available }: ModuleSwitcherProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  // Single-module users see a static label, no dropdown.
  if (available.length <= 1) {
    const only = available[0];
    if (!only) return null;
    return (
      <span className="t-label hidden text-ink-muted md:inline">{only.label}</span>
    );
  }

  const onChange = async (next: string) => {
    if (next === active || pending) return;
    const target = available.find((m) => m.id === next);
    if (!target) return;

    setPending(true);
    try {
      await fetch("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: target.id }),
      });
      router.push(target.defaultPath);
      router.refresh();
    } finally {
      setPending(false);
    }
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
