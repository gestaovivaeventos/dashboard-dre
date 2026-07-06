import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getViagensUser } from "@/lib/viagens/auth";
import { NovaViagemForm } from "@/components/viagens/nova-viagem-form";

export const dynamic = "force-dynamic";

export default async function NovaViagemPage() {
  const ctx = await getViagensUser();
  if (!ctx) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/viagens/requisicoes"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Viagens
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink-primary">Nova viagem</h1>
        <p className="text-sm text-ink-muted">
          Informe destino e período — o sistema cota carro, ônibus e avião com todos os custos e
          leva os 3 orçamentos pro gerente escolher.
        </p>
      </div>

      <NovaViagemForm />
    </div>
  );
}
