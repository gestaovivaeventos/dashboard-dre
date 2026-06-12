"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// ============================================================================
// Persistencia do filtro de empresas COMPARTILHADO entre os 3 menus do
// modulo financeiro: Dashboard, Fluxo de Caixa e Budget e Forecast.
//
// Estrategia:
//   - Cada view chama `saveSharedCompanyFilter` em DOIS pontos:
//       (a) no `onChange` do SegmentCompanyPicker — a selecao "segue" o
//           usuario para a proxima tela imediatamente, sem precisar
//           clicar em Aplicar antes. Regra explicita do produto.
//       (b) no `handleApply` que atualiza a URL desta tela — redundante
//           com (a), mas mantemos como rede de seguranca.
//   - Quando o usuario muda de menu via link da sidebar (URL fica sem
//     `companyIds`), `useSharedCompanyFilterHydration` no mount le o
//     storage e da `router.replace` com `?companyIds=...`. Next.js refaz
//     o server-render com o filtro restaurado.
// ============================================================================

const STORAGE_KEY = "dre-shared-company-filter-v1";

// Nome duplicado de `ACTIVE_COMPANY_IDS_COOKIE` em
// `@/lib/context/active-context` — nao importamos aquele modulo aqui porque ele
// usa `next/headers` (server-only) e este arquivo e "use client". Manter os
// dois em sincronia.
//
// O cookie e a FONTE DE VERDADE lida pelo SERVIDOR ao renderizar
// Dashboard/Fluxo/Budget: como viaja na proxima requisicao de navegacao, o
// server-render ja sai com a empresa certa — sem flash e sem depender do
// Router Cache do App Router (indexado por pathname, ignora search params, o
// que tornava instavel restaurar via `?companyIds=` num `router.replace`).
const COMPANY_COOKIE = "active_company_ids";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 ano, igual aos cookies de contexto

/**
 * Grava a selecao no cookie compartilhado lido pelo servidor. Sincrono
 * (document.cookie) para nao competir com a navegacao da sidebar.
 */
function writeSharedCompanyCookie(companyIds: string[]): void {
  if (typeof document === "undefined") return;
  if (companyIds.length === 0) {
    // selecao vazia limpa o cookie — usuario apagou o filtro explicitamente
    document.cookie = `${COMPANY_COOKIE}=; path=/; max-age=0; samesite=lax`;
    return;
  }
  const value = encodeURIComponent(companyIds.join(","));
  document.cookie = `${COMPANY_COOKIE}=${value}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

/**
 * Grava a selecao atual de empresas no sessionStorage. Chamada explicita
 * a partir do `handleApply` de cada view (Dashboard / Fluxo / Budget).
 *
 * Selecao vazia limpa o storage — usuario apagou explicitamente o filtro.
 */
export function saveSharedCompanyFilter(companyIds: string[]): void {
  if (typeof window === "undefined") return;
  // Cookie primeiro: e o que o servidor le para restaurar o filtro ao navegar.
  writeSharedCompanyCookie(companyIds);
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
