"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// ============================================================================
// Persistencia do filtro de empresas COMPARTILHADO entre os 3 menus do
// modulo financeiro: Dashboard, Fluxo de Caixa e Budget e Forecast.
//
// Estrategia:
//   - Cada view, no `handleApply` que ja atualiza a URL, tambem chama
//     `saveSharedCompanyFilter` para gravar a selecao no sessionStorage.
//     Esse e o sinal claro de "intenção do usuario".
//   - Quando o usuario muda de menu via link da sidebar (URL fica sem
//     `companyIds`), `useSharedCompanyFilterHydration` no mount le o
//     storage e da `router.replace` com `?companyIds=...`. Next.js refaz
//     o server-render com o filtro restaurado.
//
// Decisao explicita: NAO auto-salvamos a cada render — apenas em apply.
// Isso preserva selecoes amplas (ex.: [A,B] no Dashboard) mesmo se o user
// navegar por uma view que so permite [A] (Fluxo). Quando voltar pro
// Dashboard, ainda ve [A,B] como esperava.
// ============================================================================

const STORAGE_KEY = "dre-shared-company-filter-v1";

/**
 * Grava a selecao atual de empresas no sessionStorage. Chamada explicita
 * a partir do `handleApply` de cada view (Dashboard / Fluxo / Budget).
 *
 * Selecao vazia limpa o storage — usuario apagou explicitamente o filtro.
 */
export function saveSharedCompanyFilter(companyIds: string[]): void {
  if (typeof window === "undefined") return;
  try {
    if (companyIds.length === 0) {
      sessionStorage.removeItem(STORAGE_KEY);
    } else {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(companyIds));
    }
  } catch {
    // sessionStorage indisponivel (modo privado, quota cheia) — ignora.
  }
}

/**
 * Hidrata o filtro de empresas a partir do sessionStorage no MOUNT da
 * pagina. Quando ja houver `companyIds` na URL, e no-op (URL e a fonte
 * de verdade quando presente).
 *
 * Quando o storage tem ids salvos e a URL nao tem, faz `router.replace`
 * para a URL com `?companyIds=...` — Next.js refaz o server-render do
 * componente pai e a view recebe o filtro restaurado via props.
 */
export function useSharedCompanyFilterHydration(): void {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    // URL ja traz o filtro (mesmo que seja string vazia "companyIds="):
    // usuario chegou aqui via link explicito ou apply — respeitamos.
    if (params.has("companyIds")) return;

    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const ids = JSON.parse(raw) as unknown;
      if (!Array.isArray(ids) || ids.length === 0) return;
      const cleanIds = ids.filter(
        (x): x is string => typeof x === "string" && x.length > 0,
      );
      if (cleanIds.length === 0) return;

      params.set("companyIds", cleanIds.join(","));
      router.replace(`${window.location.pathname}?${params.toString()}`);
    } catch {
      // storage corrompido ou indisponivel — segue com o estado default
    }
    // Apenas no mount. router e estavel, nao precisa entrar em deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
