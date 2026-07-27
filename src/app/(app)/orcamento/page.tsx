import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Raiz do módulo Orçamento: por enquanto a única tela é Configurações.
// Conforme as demais telas (despesas com pessoal, média, fixo, etc.) forem
// construídas, este destino pode virar um cockpit do módulo.
export default function OrcamentoIndexRedirect() {
  redirect("/orcamento/configuracoes");
}
