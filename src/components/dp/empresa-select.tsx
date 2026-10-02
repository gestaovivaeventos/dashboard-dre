"use client";

import { usePathname, useRouter } from "next/navigation";

/** Troca a empresa da tela pela URL (?empresa=), para o link continuar compartilhável. */
export function DpEmpresaSelect({ empresas, value }: { empresas: Array<{ id: string; name: string; ativos: number }>; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-ink-muted">Empresa</span>
      <select
        value={value}
        onChange={(e) => router.push(`${pathname}?empresa=${e.target.value}`)}
        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      >
        {empresas.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} {e.ativos > 0 ? `(${e.ativos})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
