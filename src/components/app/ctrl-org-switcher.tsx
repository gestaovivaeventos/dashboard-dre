"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CtrlOrgOption {
  id: string;
  nome: string;
  slug: string;
}

interface CtrlOrgSwitcherProps {
  /** Empresas do Compras que o usuário pode acessar. */
  orgs: CtrlOrgOption[];
  /** Slug da empresa ativa. */
  activeSlug: string | null;
}

/**
 * Seletor de EMPRESA do módulo Compras (a "organização de compras"). Aparece só
 * quando o usuário acessa mais de uma empresa — com uma só, não há o que trocar
 * (e é o caso de todo mundo hoje, só a Viva). Troca a empresa ativa pelo cookie
 * (/api/context) e recarrega; todas as telas do Compras passam a mostrar os dados
 * daquela empresa.
 */
export function CtrlOrgSwitcher({ orgs, activeSlug }: CtrlOrgSwitcherProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  // Uma empresa (ou nenhuma) → sem seletor. Evita o usuário "escolher" o óbvio.
  if (orgs.length <= 1) return null;

  const active = activeSlug ?? orgs[0]?.slug ?? "";

  const onChange = async (nextSlug: string) => {
    if (nextSlug === active || pending) return;
    if (!orgs.some((o) => o.slug === nextSlug)) return;
    setPending(true);
    try {
      await fetch("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ctrlOrgSlug: nextSlug }),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <Select value={active} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="h-9 w-[180px]" aria-label="Empresa ativa do Compras">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {orgs.map((o) => (
          <SelectItem key={o.id} value={o.slug}>
            {o.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
