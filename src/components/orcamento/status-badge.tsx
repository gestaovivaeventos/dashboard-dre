import { STATUS_NIVEL_BADGE, type StatusSelo } from "@/lib/orcamento/status";
import { cn } from "@/lib/utils";

/** Selo único de andamento do orçamento (Não iniciado / Em andamento / Concluído). */
export function StatusBadge({ selo, className }: { selo: StatusSelo; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        STATUS_NIVEL_BADGE[selo.nivel],
        className,
      )}
    >
      {selo.label}
    </span>
  );
}
