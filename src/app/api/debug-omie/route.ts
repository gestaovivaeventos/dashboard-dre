import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/security/encryption";

// ==========================================================================
// ENDPOINT TEMPORARIO DE DEBUG — REMOVER APOS DIAGNOSTICO
// Busca janeiro/2026 e mostra a estrutura RAW dos registros,
// especialmente procurando como o rateio/distribuicao aparece no JSON.
// ==========================================================================
export async function GET() {
  const { user, profile } = await getCurrentSessionContext();
  if (
    !user ||
    !profile ||
    (profile.role !== "admin" && profile.role !== "gestor_hero")
  ) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const supabase = await createSupabaseClient();
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, omie_app_key, omie_app_secret")
    .eq("active", true)
    .order("name")
    .limit(10);

  const company = (companies ?? []).find(
    (c: Record<string, unknown>) => c.omie_app_key && c.omie_app_secret,
  ) as {
    id: string;
    name: string;
    omie_app_key: string;
    omie_app_secret: string;
  } | undefined;

  if (!company) {
    return NextResponse.json({ error: "Nenhuma empresa com credenciais." });
  }

  const appKey = decryptSecret(company.omie_app_key);
  const appSecret = decryptSecret(company.omie_app_secret);

  // Busca pagina 1 de janeiro/2026
  const resp = await fetch(
    "https://app.omie.com.br/api/v1/financas/mf/",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        call: "ListarMovimentos",
        app_key: appKey,
        app_secret: appSecret,
        param: [{
          nPagina: 1,
          nRegPorPagina: 500,
          dDtPagtoDe: "01/01/2026",
          dDtPagtoAte: "31/01/2026",
        }],
      }),
      cache: "no-store",
    },
  );
  const d = (await resp.json()) as Record<string, unknown>;
  const arr = Object.values(d).find(Array.isArray) as Record<string, unknown>[] | undefined;
  const allMovimentos = arr ?? [];

  // Funcao para encontrar TODAS as chaves em um objeto (recursivo)
  function findAllKeys(obj: unknown, prefix = ""): string[] {
    if (!obj || typeof obj !== "object") return [];
    const keys: string[] = [];
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const fullKey = prefix ? `${prefix}.${k}` : k;
      keys.push(fullKey);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        keys.push(...findAllKeys(v, fullKey));
      }
      if (Array.isArray(v)) {
        keys.push(`${fullKey}[array:${v.length}]`);
        if (v.length > 0 && typeof v[0] === "object") {
          keys.push(...findAllKeys(v[0], `${fullKey}[0]`));
        }
      }
    }
    return keys;
  }

  // Procura por campos de distribuicao/rateio em TODOS os registros
  const distribFields = new Set<string>();
  const recordsWithDistrib: number[] = [];

  for (let i = 0; i < allMovimentos.length; i++) {
    const mov = allMovimentos[i];
    const allKeys = findAllKeys(mov);
    const hasDistrib = allKeys.some(k =>
      k.toLowerCase().includes("distrib") ||
      k.toLowerCase().includes("rateio") ||
      k.toLowerCase().includes("categ1") ||
      k.toLowerCase().includes("categ2") ||
      k.includes("[array")
    );
    if (hasDistrib) {
      recordsWithDistrib.push(i);
      allKeys.filter(k =>
        k.toLowerCase().includes("distrib") ||
        k.toLowerCase().includes("rateio") ||
        k.toLowerCase().includes("categ") ||
        k.includes("[array")
      ).forEach(k => distribFields.add(k));
    }
  }

  // Pega ALL keys do primeiro registro para ver a estrutura
  const firstRecordKeys = allMovimentos.length > 0 ? findAllKeys(allMovimentos[0]) : [];

  // Retorna 3 registros RAW com distribuicao, ou os 3 primeiros se nao houver
  const sampleIndices = recordsWithDistrib.length > 0
    ? recordsWithDistrib.slice(0, 3)
    : [0, 1, 2].filter(i => i < allMovimentos.length);

  const rawSamples = sampleIndices.map(i => ({
    index: i,
    raw: allMovimentos[i],
  }));

  // Tambem busca chaves especificas de rateio em detalhes e resumo de cada sample
  const distribAnalysis = sampleIndices.map(i => {
    const mov = allMovimentos[i];
    const det = (mov?.detalhes ?? {}) as Record<string, unknown>;
    const res = (mov?.resumo ?? {}) as Record<string, unknown>;

    // Procura campos cCodCategN e nDistrValorN em detalhes
    const detCategFields: Record<string, unknown> = {};
    const resCategFields: Record<string, unknown> = {};
    const rootCategFields: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(det)) {
      if (k.toLowerCase().includes("categ") || k.toLowerCase().includes("distr") || k.toLowerCase().includes("rateio")) {
        detCategFields[k] = v;
      }
    }
    for (const [k, v] of Object.entries(res)) {
      if (k.toLowerCase().includes("categ") || k.toLowerCase().includes("distr") || k.toLowerCase().includes("rateio")) {
        resCategFields[k] = v;
      }
    }
    for (const [k, v] of Object.entries(mov)) {
      if (k !== "detalhes" && k !== "resumo" &&
        (k.toLowerCase().includes("categ") || k.toLowerCase().includes("distr") || k.toLowerCase().includes("rateio") || Array.isArray(v))) {
        rootCategFields[k] = v;
      }
    }

    return {
      index: i,
      cCodCateg: det.cCodCateg,
      cOrigem: det.cOrigem,
      nValLiquido: res.nValLiquido,
      nValPago: res.nValPago,
      detCategFields,
      resCategFields,
      rootCategFields,
      rootKeys: Object.keys(mov),
      detKeys: Object.keys(det),
      resKeys: Object.keys(res),
    };
  });

  return NextResponse.json({
    empresa: company.name,
    totalRegistros: allMovimentos.length,
    firstRecordAllKeys: firstRecordKeys,
    distribFieldsFound: Array.from(distribFields),
    recordsWithDistribCount: recordsWithDistrib.length,
    recordsWithDistribIndices: recordsWithDistrib.slice(0, 10),
    distribAnalysis,
    rawSamples,
  });
}
