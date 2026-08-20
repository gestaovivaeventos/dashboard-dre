import { GenericPageSkeleton } from "@/components/app/page-skeletons";

/**
 * Fallback de Suspense do grupo inteiro. Vale para todas as telas abaixo deste
 * segmento que não definirem o próprio `loading.tsx` — sem ele o App Router
 * segura a navegação inteira até o Server Component resolver, e o clique no
 * menu parece não ter funcionado.
 */
export default function Loading() {
  return <GenericPageSkeleton />;
}
