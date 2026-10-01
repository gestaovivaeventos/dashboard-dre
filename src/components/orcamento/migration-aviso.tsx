import { AlertTriangle } from "lucide-react";

/**
 * O aviso de "falta aplicar a migration" das telas do Orçamento.
 *
 * Existe como componente compartilhado por dois motivos que vieram de uso real
 * (01/10/2026):
 *
 *  1. **nomear o ARQUIVO.** As cópias anteriores diziam só a tabela que faltava,
 *     e quem administra o banco precisou vir perguntar qual migration era. O nome
 *     do arquivo é a única informação que resolve o problema sozinha.
 *  2. **distinguir as duas causas.** `isSchemaMissing` casa tanto com a relação
 *     realmente ausente quanto com `PGRST205` — o cache de schema do PostgREST,
 *     que fica velho por alguns instantes depois de um CREATE pelo SQL Editor.
 *     Dizer "a tabela não existe" quando ela acabou de ser criada manda a pessoa
 *     investigar o banco em vez de recarregar a página.
 */
export function MigrationAviso({
  migration,
  tabela,
}: {
  /** Nome do arquivo, sem caminho (ex.: `20261001150000_orcamento_metodos_ocultos.sql`). */
  migration: string;
  /** A tabela que a tela não achou. */
  tabela: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div>
        <p className="font-semibold">Esta tela depende de uma migration.</p>
        <p className="mt-1 text-muted-foreground">
          Não encontrei a tabela <code className="rounded bg-muted px-1 py-0.5">{tabela}</code>.
          Aplique{" "}
          <code className="rounded bg-muted px-1 py-0.5">supabase/migrations/{migration}</code>.
        </p>
        <p className="mt-1.5 text-muted-foreground">
          Se você <strong>acabou de aplicá-la</strong>, recarregue a página: o cache de schema do
          PostgREST leva alguns instantes para enxergar a tabela nova, e este mesmo aviso aparece
          nesse intervalo.
        </p>
      </div>
    </div>
  );
}
