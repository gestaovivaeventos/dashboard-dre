import { Database } from "lucide-react";

/** O acesso existe, mas as tabelas do módulo ainda não foram criadas no banco. */
export function DpNaoInstalado({ migration = "20260929160000_dp_solides.sql" }: { migration?: string }) {
  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-amber-500/30 bg-amber-500/5 p-6 text-sm">
      <div className="flex items-start gap-3">
        <Database className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="space-y-1">
          <p className="font-medium text-ink-primary">Esta parte do Departamento Pessoal ainda não foi instalada no banco.</p>
          <p className="text-ink-muted">
            Parte das tabelas do módulo ainda não existe. É preciso aplicar a migration{" "}
            <code className="rounded bg-surface-2 px-1">{migration}</code> no Supabase; depois disso
            esta tela funciona.
          </p>
        </div>
      </div>
    </div>
  );
}
