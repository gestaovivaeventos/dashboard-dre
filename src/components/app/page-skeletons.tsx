import { Skeleton } from "@/components/ui/skeleton";

export function DashboardPageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-background p-4">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      <div className="rounded-xl border bg-background p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="mt-3 h-10 w-full" />
      </div>
      <div className="rounded-xl border bg-background p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="mt-2 h-10 w-full" />
        <Skeleton className="mt-2 h-10 w-full" />
        <Skeleton className="mt-2 h-10 w-full" />
      </div>
      <div className="rounded-xl border bg-background p-4">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="mt-3 h-72 w-full" />
      </div>
    </div>
  );
}

export function KpiPageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-background p-4">
        <Skeleton className="h-7 w-36" />
      </div>
      <div className="rounded-xl border bg-background p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="mt-3 h-10 w-full" />
      </div>
      <div className="rounded-xl border bg-background p-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="mt-2 h-11 w-full" />
        <Skeleton className="mt-2 h-11 w-full" />
      </div>
    </div>
  );
}

export function ConnectionsPageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-background p-4">
        <Skeleton className="h-7 w-40" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="rounded-xl border bg-background p-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="mt-2 h-4 w-1/2" />
            <Skeleton className="mt-4 h-10 w-full" />
            <Skeleton className="mt-2 h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsPageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-background p-4">
        <Skeleton className="h-10 w-80" />
      </div>
      <div className="rounded-xl border bg-background p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="mt-2 h-10 w-full" />
        <Skeleton className="mt-2 h-10 w-full" />
      </div>
    </div>
  );
}

export function UsersPageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-background p-4">
        <Skeleton className="h-7 w-44" />
      </div>
      <div className="rounded-xl border bg-background p-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="mt-2 h-11 w-full" />
        <Skeleton className="mt-2 h-11 w-full" />
      </div>
    </div>
  );
}

/**
 * Esqueleto genérico de tela — o fallback dos `loading.tsx` de grupo de rota.
 *
 * Não tenta imitar nenhuma página específica: cabeçalho, faixa de filtros e um
 * bloco de conteúdo, que é a forma comum a praticamente todas as telas do app.
 * O objetivo é a navegação responder no clique em vez de congelar a tela
 * anterior enquanto o servidor renderiza. Telas que já têm um esqueleto próprio
 * (Dashboard, KPIs, Usuários, Configurações) continuam usando o delas — o
 * `loading.tsx` mais próximo do segmento é o que vale.
 */
export function GenericPageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-background p-4">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <div className="rounded-xl border bg-background p-4">
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="rounded-xl border bg-background p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="mt-2 h-10 w-full" />
        <Skeleton className="mt-2 h-10 w-full" />
        <Skeleton className="mt-2 h-10 w-full" />
        <Skeleton className="mt-2 h-10 w-full" />
        <Skeleton className="mt-2 h-10 w-full" />
      </div>
    </div>
  );
}
