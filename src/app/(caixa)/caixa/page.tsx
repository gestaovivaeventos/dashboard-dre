import { redirect } from "next/navigation";

import { CAIXA_REAL_PATH } from "@/lib/auth/caixa";

/** O módulo tem uma tela só por ora; a raiz leva a ela. */
export default function CaixaIndexPage() {
  redirect(CAIXA_REAL_PATH);
}
