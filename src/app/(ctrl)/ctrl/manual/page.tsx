import { redirect } from "next/navigation";

import { ManualClient } from "@/components/ctrl/manual-client";
import { getCtrlUser } from "@/lib/ctrl/auth";
import type { ManualAudience } from "@/lib/ctrl/manual/content";

/**
 * Manual do módulo Compras.
 *
 * Aberto a QUALQUER usuário com acesso ao módulo — getCtrlUser já garante isso
 * (retorna null para quem não tem nenhum papel no Compras). Não há gate por
 * papel de propósito: o manual é o material de entrada de quem está chegando.
 */
export default async function ManualPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  // Abre já filtrado no perfil de quem entrou (dá para trocar na tela). Admin e
  // papéis sem seção própria caem no manual completo.
  const roles = ctx.ctrlRoles;
  const defaultAudience: ManualAudience | "todos" = roles.includes("admin")
    ? "todos"
    : roles.includes("contas_a_pagar") || roles.includes("csc")
      ? "contas_a_pagar"
      : roles.includes("diretor")
        ? "diretor"
        : roles.includes("gerente")
          ? "gerente"
          : roles.includes("solicitante")
            ? "solicitante"
            : "todos";

  return <ManualClient defaultAudience={defaultAudience} />;
}
