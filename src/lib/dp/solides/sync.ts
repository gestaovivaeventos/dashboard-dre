import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { buscarFicha, listarColaboradores } from "@/lib/dp/solides/client";
import { parseDetail, parseListItem, type DpColaboradorFicha } from "@/lib/dp/solides/parse";

// ============================================================================
// Sincronização Sólides → dp_colaboradores. Chamada pelo cron diário e pelo
// botão "Sincronizar agora" (sempre depois de requireDpUser()).
//
// Relê TODAS as fichas a cada execução, de propósito: o updated_at da Sólides
// só tem a DATA, então "buscar só o que mudou" perderia a segunda alteração do
// mesmo dia. São ~200 chamadas de ~0,26 s, 4 em paralelo ≈ 15 s.
//
// Desligamento: a lista da Sólides só traz ativos, então quem SOME dela vira
// ativo=false (nunca é apagado — o histórico é fato). A trava de "lista
// encolheu demais" existe porque uma resposta vazia ou truncada da Sólides
// marcaria o grupo inteiro como desligado.
// ============================================================================

type AdminClient = ReturnType<typeof createAdminClient>;

const FICHA_CONCURRENCY = 4;
/** Execução "running" mais nova que isto bloqueia uma nova (duplo clique, cron + botão). */
const RUNNING_LOCK_MINUTES = 10;
/** A lista nova precisa ter pelo menos esta fração dos ativos atuais. */
const MIN_FRACAO_LISTA = 0.5;

export interface DpSyncResult {
  ok: boolean;
  runId: string | null;
  lista: number;
  fichasOk: number;
  fichasErro: number;
  novos: number;
  desligados: number;
  reativados: number;
  erro: string | null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function fichaOuNull(solidesId: number): Promise<DpColaboradorFicha | null> {
  try {
    return parseDetail(await buscarFicha(solidesId));
  } catch (error) {
    console.error(`[dp-solides] ficha ${solidesId}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

export async function runDpSolidesSync(
  admin: AdminClient,
  opts: { trigger: "cron" | "manual"; userId?: string | null },
): Promise<DpSyncResult> {
  const empty: Omit<DpSyncResult, "ok" | "runId" | "erro"> = {
    lista: 0, fichasOk: 0, fichasErro: 0, novos: 0, desligados: 0, reativados: 0,
  };

  const lockSince = new Date(Date.now() - RUNNING_LOCK_MINUTES * 60_000).toISOString();
  const { data: running } = await admin
    .from("dp_sync_runs")
    .select("id")
    .eq("status", "running")
    .gte("started_at", lockSince)
    .limit(1);
  if (running && running.length > 0) {
    return { ok: false, runId: null, ...empty, erro: "Já existe uma sincronização em andamento. Aguarde alguns minutos." };
  }

  const { data: run, error: runErr } = await admin
    .from("dp_sync_runs")
    .insert({ trigger: opts.trigger, created_by: opts.userId ?? null })
    .select("id")
    .single();
  if (runErr || !run) throw new Error(`dp_sync_runs insert: ${runErr?.message ?? "sem linha"}`);
  const runId = run.id as string;

  const finish = async (res: Omit<DpSyncResult, "runId">): Promise<DpSyncResult> => {
    await admin
      .from("dp_sync_runs")
      .update({
        status: res.ok ? "ok" : "erro",
        finished_at: new Date().toISOString(),
        colaboradores_lista: res.lista,
        fichas_ok: res.fichasOk,
        fichas_erro: res.fichasErro,
        novos: res.novos,
        desligados: res.desligados,
        reativados: res.reativados,
        erro: res.erro,
      })
      .eq("id", runId);
    return { ...res, runId };
  };

  try {
    const lista = (await listarColaboradores()).map(parseListItem);

    const { data: existentes, error: exErr } = await admin
      .from("dp_colaboradores")
      .select("solides_id, ativo");
    if (exErr) throw new Error(`dp_colaboradores select: ${exErr.message}`);
    const antes = new Map((existentes ?? []).map((r) => [Number(r.solides_id), Boolean(r.ativo)]));
    const ativosAntes = Array.from(antes.values()).filter(Boolean).length;

    if (ativosAntes > 0 && lista.length < ativosAntes * MIN_FRACAO_LISTA) {
      return finish({
        ok: false, ...empty, lista: lista.length,
        erro:
          `A Sólides devolveu ${lista.length} colaboradores e há ${ativosAntes} ativos aqui. ` +
          "Nada foi alterado: parece falha da Sólides, não desligamento em massa.",
      });
    }

    const fichas = await mapLimit(lista, FICHA_CONCURRENCY, (c) => fichaOuNull(c.solides_id));
    const agora = new Date().toISOString();
    const naLista = new Set(lista.map((c) => c.solides_id));

    const comFicha = [];
    const semFicha = [];
    for (let i = 0; i < lista.length; i++) {
      const base = { ...lista[i], ativo: true, desligado_detectado_em: null, sincronizado_em: agora, updated_at: agora };
      const ficha = fichas[i];
      if (ficha) comFicha.push({ ...base, ...ficha, ficha_sincronizada_em: agora });
      else semFicha.push(base); // mantém salário/endereço da última ficha boa
    }

    for (const rows of [comFicha, semFicha]) {
      if (rows.length === 0) continue;
      const { error } = await admin.from("dp_colaboradores").upsert(rows, { onConflict: "solides_id" });
      if (error) throw new Error(`dp_colaboradores upsert: ${error.message}`);
    }

    const novos = lista.filter((c) => !antes.has(c.solides_id)).length;
    const reativados = lista.filter((c) => antes.get(c.solides_id) === false).length;

    // Sumiu da lista = desligado. A ficha costuma continuar acessível e é de lá
    // que vem a data de desligamento; se não vier, a data de detecção basta.
    const sumiram = Array.from(antes).filter(([id, ativo]) => ativo && !naLista.has(id)).map(([id]) => id);
    await mapLimit(sumiram, FICHA_CONCURRENCY, async (id) => {
      const ficha = await fichaOuNull(id);
      const { error } = await admin
        .from("dp_colaboradores")
        .update({
          ativo: false,
          desligado_detectado_em: agora,
          updated_at: agora,
          ...(ficha ? { ...ficha, ficha_sincronizada_em: agora } : {}),
        })
        .eq("solides_id", id);
      if (error) throw new Error(`dp_colaboradores desligar: ${error.message}`);
    });

    const fichasErro = fichas.filter((f) => f === null).length;
    return finish({
      ok: true,
      lista: lista.length,
      fichasOk: lista.length - fichasErro,
      fichasErro,
      novos,
      desligados: sumiram.length,
      reativados,
      erro: fichasErro > 0 ? `${fichasErro} ficha(s) não puderam ser lidas; os dados anteriores delas foram mantidos.` : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dp-solides] sync failed:", message);
    return finish({ ok: false, ...empty, erro: message });
  }
}
