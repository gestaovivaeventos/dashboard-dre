import { redirect } from "next/navigation";

import { getViagensUser } from "@/lib/viagens/auth";
import { getViagemConfig } from "@/lib/viagens/queries";
import { ViagemConfigForm } from "@/components/viagens/config-form";

export const dynamic = "force-dynamic";

export default async function ViagensConfigPage() {
  const ctx = await getViagensUser();
  if (!ctx) redirect("/login");
  if (!ctx.isAdmin) redirect("/viagens/requisicoes");

  const config = await getViagemConfig();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Configuração de viagens</h1>
        <p className="text-sm text-ink-muted">
          Parâmetros usados no cálculo dos orçamentos (carro por km/aluguel, ônibus por km,
          alimentação e hotel padrão). Preços de voo vêm do provedor/estimativa.
        </p>
      </div>
      <ViagemConfigForm initial={config} />
    </div>
  );
}
