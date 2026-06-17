# Editar previsão do Omie ao enviar para pagamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao enviar uma requisição para pagamento, procurar a previsão recorrente do mesmo fornecedor no Omie (mesmo mês, palavra "previsão" na obs) e, com confirmação humana, editar essa previsão com todos os dados da requisição em vez de criar um título novo.

**Architecture:** Fluxo em dois passos no "Enviar para pagamento": (1) uma server action de *preview* consulta o Omie e devolve a previsão candidata por requisição (a de valor mais próximo quando há várias); (2) um diálogo de confirmação coleta a decisão por linha e `sendToPayment` repassa o código da previsão a `launchRequestToOmie`, que faz `AlterarContaPagar` no título existente.

**Tech Stack:** Next.js 14 (App Router) server actions, TypeScript, Supabase, Omie REST (`financas/contapagar/`). Sem framework de teste — validação por `npm run lint` + `npm run build` + teste manual em produção/preview.

> **Nota de testes:** o repositório não tem runner de teste. Onde um plano normal pediria "escreva o teste que falha", aqui a verificação é `npm run lint` e `npm run build` passando, mais o roteiro de teste manual no fim. Não criar arquivos de teste novos.

---

## File Structure

- `src/lib/omie/contapagar.ts` — **Modify.** Adiciona `findPrevisaoContaPagar` (busca previsão por CNPJ+mês+palavra, escolhe valor mais próximo) e `alterarContaPagar` (AlterarContaPagar com payload completo).
- `src/lib/ctrl/actions/contapagar-launch.ts` — **Modify.** `launchRequestToOmie` ganha `previsaoCodigo?: number`; extrai a montagem do payload para reuso entre incluir/alterar; novo status `previsao_editada`. `resyncContaPagar` repassa o código da previsão quando o status anterior era `previsao_editada`.
- `src/lib/ctrl/actions/requests.ts` — **Modify.** Nova action `previewPrevisaoMatches`; `sendToPayment` ganha 3º parâmetro `decisoes?: Record<string, number | "novo">`.
- `src/components/ctrl/contas-a-pagar-table.tsx` — **Modify.** `handleEnviar` passa a chamar o preview e abrir o diálogo de confirmação; novo estado/diálogo; badge `previsao_editada` em `OmieLaunchBadge`.

---

## Task 1: Omie — buscar previsão e alterar título completo

**Files:**
- Modify: `src/lib/omie/contapagar.ts`

- [ ] **Step 1: Adicionar `findPrevisaoContaPagar` e `alterarContaPagar`**

No fim de `src/lib/omie/contapagar.ts`, antes de `toOmieDate` (ou após `alterarContaPagarCategoria`), adicionar:

```ts
// Normaliza para casar "previsão"/"PREVISAO"/"Previsao" etc.
function normalize(s: string): string {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Procura a PREVISÃO recorrente do fornecedor para o mês do vencimento da
// requisição: título em aberto, do CNPJ, com a palavra "previsão" na observação
// e vencimento no mesmo mês/ano de `dueDateIso` (YYYY-MM-DD). Havendo vários,
// retorna o de valor mais próximo de `amount`. Sem match → null.
export async function findPrevisaoContaPagar(
  appKey: string,
  appSecret: string,
  cnpj: string,
  dueDateIso: string,
  amount: number,
): Promise<
  | { codigoLancamentoOmie: number; valorAtual: number; vencimento: string; observacao: string }
  | null
> {
  const doc = (cnpj ?? "").replace(/\D/g, "");
  if (!doc) return null;
  const [ano, mes] = dueDateIso.split("-");
  if (!ano || !mes) return null;

  let pagina = 1;
  let total = 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidatos: any[] = [];
  do {
    const { data, notFound } = await omieCall(
      CONTAPAGAR_URL,
      "ListarContasPagar",
      appKey,
      appSecret,
      {
        pagina,
        registros_por_pagina: 200,
        filtrar_por_cpf_cnpj: doc,
        filtrar_por_status: "EMABERTO",
      },
    );
    if (notFound) break;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = (data.conta_pagar_cadastro as any[] | undefined) ?? [];
    for (const t of arr) {
      const venc = String(t.data_vencimento ?? ""); // dd/mm/aaaa
      const [, vm, vy] = venc.split("/");
      const mesmoMes = vm === mes && vy === ano;
      const ehPrevisao = normalize(String(t.observacao ?? "")).includes("previsao");
      if (mesmoMes && ehPrevisao) candidatos.push(t);
    }
    total = Number(data.total_de_paginas ?? 1);
    pagina += 1;
  } while (pagina <= total);

  if (candidatos.length === 0) return null;
  candidatos.sort(
    (a, b) =>
      Math.abs(Number(a.valor_documento) - amount) -
      Math.abs(Number(b.valor_documento) - amount),
  );
  const m = candidatos[0];
  return {
    codigoLancamentoOmie: Number(m.codigo_lancamento_omie),
    valorAtual: Number(m.valor_documento),
    vencimento: String(m.data_vencimento ?? ""),
    observacao: String(m.observacao ?? ""),
  };
}

// Edita um título existente (a previsão) sobrescrevendo todos os campos pela
// requisição. `payload` é o mesmo do IncluirContaPagar, sem
// codigo_lancamento_integracao (o título já existe), mais codigo_lancamento_omie.
export async function alterarContaPagar(
  appKey: string,
  appSecret: string,
  payload: Omit<ContaPagarPayload, "codigo_lancamento_integracao"> & {
    codigo_lancamento_omie: number;
  },
): Promise<{ codigoLancamentoOmie: number }> {
  const { data } = await omieCall(
    CONTAPAGAR_URL,
    "AlterarContaPagar",
    appKey,
    appSecret,
    payload as unknown as Record<string, unknown>,
  );
  const code = Number(data.codigo_lancamento_omie ?? payload.codigo_lancamento_omie);
  return { codigoLancamentoOmie: code };
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sem erros novos em `contapagar.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/omie/contapagar.ts
git commit -m "feat(omie): buscar previsao e alterar conta a pagar completo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `launchRequestToOmie` aceita previsão e novo status

**Files:**
- Modify: `src/lib/ctrl/actions/contapagar-launch.ts`

- [ ] **Step 1: Importar `findPrevisaoContaPagar` e `alterarContaPagar`**

Editar o import vindo de `@/lib/omie/contapagar` (linhas 10-15) para:

```ts
import {
  findContaPagarByCnpjValor,
  findPrevisaoContaPagar,
  incluirContaPagar,
  alterarContaPagar,
  alterarContaPagarCategoria,
  toOmieDate,
} from "@/lib/omie/contapagar";
```

- [ ] **Step 2: Adicionar `previsao_editada` ao tipo de retorno**

Editar `LaunchResult` (linhas 18-20):

```ts
type LaunchResult =
  | { ok: true; status: "recebido" | "lancado" | "previsao_editada" }
  | { error: string };
```

- [ ] **Step 3: Assinatura de `launchRequestToOmie` ganha `previsaoCodigo`**

Editar a assinatura (linhas 46-51) para incluir o 4º parâmetro:

```ts
export async function launchRequestToOmie(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  requestId: string,
  companyId: string,
  previsaoCodigo?: number,
): Promise<LaunchResult> {
```

- [ ] **Step 4: Reescrever o bloco "5. Matching + lançamento"**

Substituir o bloco inteiro de matching/lançamento (linhas 183-265, do `let omieStatus` até o `catch` que grava erro) por:

```ts
  // 5. Matching + lançamento
  let omieStatus: "recebido" | "lancado" | "previsao_editada";
  let omieCode: number;

  // Vencimento: fallback para competência se due_date for nulo
  const dueDateIso: string =
    request.due_date ??
    `${request.reference_year}-${String(request.reference_month).padStart(2, "0")}-01`;
  const emissaoIso = `${request.reference_year}-${String(request.reference_month).padStart(2, "0")}-01`;

  // Payload base compartilhado por incluir e alterar (a alteração só acrescenta
  // codigo_lancamento_omie e remove codigo_lancamento_integracao).
  const basePayload = {
    codigo_cliente_fornecedor: codigoClienteFornecedor,
    data_vencimento: toOmieDate(dueDateIso),
    data_previsao: toOmieDate(dueDateIso),
    data_emissao: toOmieDate(emissaoIso),
    valor_documento: Number(request.amount),
    codigo_categoria: codigoCategoria,
    distribuicao: [{ cCodDep: codigoDepartamento, nPerDep: 100 }],
    id_conta_corrente: Number(codigoContaCorrente),
    ...(request.description ? { observacao: request.description as string } : {}),
    ...(request.invoice_number
      ? {
          numero_documento: request.invoice_number as string,
          numero_documento_fiscal: request.invoice_number as string,
        }
      : {}),
    ...(request.payment_method === "boleto" && request.barcode
      ? {
          cnab_integracao_bancaria: {
            codigo_forma_pagamento: "BOL",
            codigo_barras_boleto: request.barcode,
          },
        }
      : {}),
  };

  // Retry sem o bloco de boleto quando o código de barras é rejeitado pelo Omie.
  const isBarcodeError = (e: unknown) => {
    const msg = e instanceof Error ? e.message.toLowerCase() : "";
    return (
      msg.includes("código de barras") ||
      msg.includes("codigo de barras") ||
      msg.includes("codigo_barras")
    );
  };

  try {
    if (previsaoCodigo) {
      // Edita a previsão existente sobrescrevendo todos os campos.
      try {
        await alterarContaPagar(appKey, appSecret, {
          ...basePayload,
          codigo_lancamento_omie: previsaoCodigo,
        });
      } catch (e) {
        if (isBarcodeError(e) && "cnab_integracao_bancaria" in basePayload) {
          const { cnab_integracao_bancaria: _drop, ...noCnab } = basePayload;
          void _drop;
          await alterarContaPagar(appKey, appSecret, {
            ...noCnab,
            codigo_lancamento_omie: previsaoCodigo,
          });
        } else {
          throw e;
        }
      }
      omieStatus = "previsao_editada";
      omieCode = previsaoCodigo;
    } else {
      const found = await findContaPagarByCnpjValor(
        appKey,
        appSecret,
        supplier.cnpj_cpf as string,
        Number(request.amount),
      );

      if (found) {
        await alterarContaPagarCategoria(
          appKey,
          appSecret,
          found.codigoLancamentoOmie,
          codigoCategoria,
        );
        omieStatus = "recebido";
        omieCode = found.codigoLancamentoOmie;
      } else {
        const payload = {
          codigo_lancamento_integracao: request.id as string,
          ...basePayload,
        };
        let codigoLancamentoOmie: number;
        try {
          ({ codigoLancamentoOmie } = await incluirContaPagar(appKey, appSecret, payload));
        } catch (e) {
          if (isBarcodeError(e) && "cnab_integracao_bancaria" in payload) {
            const { cnab_integracao_bancaria: _drop, ...noCnab } = payload;
            void _drop;
            ({ codigoLancamentoOmie } = await incluirContaPagar(appKey, appSecret, noCnab));
          } else {
            throw e;
          }
        }
        omieStatus = "lancado";
        omieCode = codigoLancamentoOmie;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao lançar conta a pagar no Omie.";
    await supabase
      .from("ctrl_requests")
      .update({
        omie_launch_status: "erro",
        omie_launch_error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    return { error: msg };
  }
```

Observação: o `payload` para `ContaPagarPayload` deixa de ser tipado explicitamente; se o `incluirContaPagar` reclamar de tipo, manter o cast existente `payload as ContaPagarPayload` não é necessário porque `incluirContaPagar` já recebe `ContaPagarPayload` e `basePayload + codigo_lancamento_integracao` satisfaz a interface. Se o TS reclamar de campos opcionais, ajustar `ContaPagarPayload` deixando `observacao`, `numero_documento`, `numero_documento_fiscal`, `cnab_integracao_bancaria` opcionais (já estão).

- [ ] **Step 5: Atualizar o update final de status para aceitar `previsao_editada`**

O bloco "7. Atualizar ctrl_requests" (linhas 271-283) já grava `omie_launch_status: omieStatus`; como `omieStatus` agora pode ser `previsao_editada`, nenhuma mudança de código é necessária ali. Confirmar que o `return` final é `{ ok: true, status: omieStatus }`.

- [ ] **Step 6: `resyncContaPagar` repassa o código da previsão**

Editar `resyncContaPagar` (linhas 286-306). Trocar o select e a chamada:

```ts
  const { data: req } = await supabase
    .from("ctrl_requests")
    .select("paying_company_id, omie_launch_status, omie_contapagar_codigo")
    .eq("id", requestId)
    .maybeSingle();

  if (!req?.paying_company_id) {
    return { error: "Requisição sem empresa pagadora." };
  }

  // Se já havia editado uma previsão, reusa o mesmo título no reenvio (não cria
  // duplicata).
  const previsaoCodigo =
    req.omie_launch_status === "previsao_editada" && req.omie_contapagar_codigo
      ? Number(req.omie_contapagar_codigo)
      : undefined;

  const result = await launchRequestToOmie(
    supabase,
    requestId,
    req.paying_company_id as string,
    previsaoCodigo,
  );
```

- [ ] **Step 7: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros de tipo.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ctrl/actions/contapagar-launch.ts
git commit -m "feat(ctrl): launchRequestToOmie edita previsao quando informado

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Action de preview das previsões

**Files:**
- Modify: `src/lib/ctrl/actions/requests.ts`

- [ ] **Step 1: Adicionar `previewPrevisaoMatches` antes de `sendToPayment`**

Inserir logo antes do bloco `// ─── Send to Payment ───` (linha ~1308):

```ts
// ─── Preview de previsões (antes de enviar para pagamento) ──────────────────

export interface PrevisaoMatch {
  requestId: string;
  requestNumber: number;
  supplierName: string;
  amount: number;
  dueDate: string | null;
  previsao:
    | { codigo: number; valorAtual: number; vencimento: string; observacao: string }
    | null;
}

export async function previewPrevisaoMatches(
  requestIds: string[],
  payingCompanyId: string,
): Promise<{ ok: true; matches: PrevisaoMatch[] } | { error: string }> {
  await requireCtrlRole("gerente", "diretor", "csc", "contas_a_pagar", "admin");
  if (!payingCompanyId) return { error: "Empresa pagadora é obrigatória." };

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data: company } = await supabase
    .from("companies")
    .select("id, omie_app_key, omie_app_secret")
    .eq("id", payingCompanyId)
    .maybeSingle();

  if (!company?.omie_app_key || !company?.omie_app_secret) {
    return { error: "Empresa pagadora sem conexão Omie." };
  }

  const { decryptSecret } = await import("@/lib/security/encryption");
  const { findPrevisaoContaPagar } = await import("@/lib/omie/contapagar");
  const appKey = decryptSecret(company.omie_app_key as string);
  const appSecret = decryptSecret(company.omie_app_secret as string);

  const { data: reqs } = await supabase
    .from("ctrl_requests")
    .select(
      "id, request_number, amount, due_date, reference_year, reference_month, supplier_id, ctrl_suppliers(name, cnpj_cpf)",
    )
    .in("id", requestIds)
    .eq("status", "aprovado");

  const matches: PrevisaoMatch[] = [];
  for (const r of reqs ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sup = (r as any).ctrl_suppliers as { name?: string; cnpj_cpf?: string } | null;
    const dueDateIso: string =
      (r.due_date as string | null) ??
      `${r.reference_year}-${String(r.reference_month).padStart(2, "0")}-01`;

    let previsao: PrevisaoMatch["previsao"] = null;
    if (sup?.cnpj_cpf) {
      try {
        const p = await findPrevisaoContaPagar(
          appKey,
          appSecret,
          sup.cnpj_cpf,
          dueDateIso,
          Number(r.amount),
        );
        // findPrevisaoContaPagar usa `codigoLancamentoOmie`; o tipo de UI usa `codigo`.
        previsao = p
          ? {
              codigo: p.codigoLancamentoOmie,
              valorAtual: p.valorAtual,
              vencimento: p.vencimento,
              observacao: p.observacao,
            }
          : null;
      } catch {
        // Best-effort: falha na consulta → trata como "sem previsão" (cria novo).
        previsao = null;
      }
    }

    matches.push({
      requestId: r.id as string,
      requestNumber: Number(r.request_number),
      supplierName: sup?.name ?? "—",
      amount: Number(r.amount),
      dueDate: (r.due_date as string | null) ?? null,
      previsao,
    });
  }

  return { ok: true, matches };
}
```

Nota: confirmar que `requireCtrlRole`, `createAdminClientIfAvailable` e `createClient` já estão importados no topo de `requests.ts` (são usados por `sendToPayment` logo abaixo) — estão.

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros. Se o TS reclamar do join `ctrl_suppliers(...)`, manter o cast `(r as any).ctrl_suppliers` já incluído.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ctrl/actions/requests.ts
git commit -m "feat(ctrl): action previewPrevisaoMatches

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `sendToPayment` aceita decisões por requisição

**Files:**
- Modify: `src/lib/ctrl/actions/requests.ts`

- [ ] **Step 1: Assinatura e repasse**

Editar `sendToPayment` (linhas 1310-1313) para aceitar o mapa de decisões:

```ts
export async function sendToPayment(
  requestIds: string[],
  payingCompanyId: string,
  decisoes?: Record<string, number | "novo">,
) {
```

- [ ] **Step 2: Repassar `previsaoCodigo` no loop de lançamento**

No loop que chama `launchRequestToOmie` (linhas 1365-1366), trocar a chamada por:

```ts
  for (const id of requestIds) {
    const decisao = decisoes?.[id];
    const previsaoCodigo = typeof decisao === "number" ? decisao : undefined;
    const res = await launchRequestToOmie(supabase, id, payingCompanyId, previsaoCodigo);
```

(O resto do corpo do loop permanece igual.)

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ctrl/actions/requests.ts
git commit -m "feat(ctrl): sendToPayment repassa decisao de previsao

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: UI — preview, diálogo de confirmação e badge

**Files:**
- Modify: `src/components/ctrl/contas-a-pagar-table.tsx`

- [ ] **Step 1: Importar a nova action e o tipo**

Editar o import das actions (topo do arquivo, onde `sendToPayment` é importado, linha ~7):

```ts
import {
  sendToPayment,
  previewPrevisaoMatches,
  type PrevisaoMatch,
  // ...demais imports existentes do mesmo módulo (manter)
} from "@/lib/ctrl/actions/requests";
```

Se os imports atuais estiverem em linhas separadas, apenas acrescentar `previewPrevisaoMatches` e `type PrevisaoMatch` à lista existente, sem remover nada.

- [ ] **Step 2: Estado do diálogo de confirmação**

Logo após os demais `useState` do componente (perto do topo, onde estão `showEnviarModal`, `payingCompanyId` etc.), adicionar:

```ts
  const [previsaoPreview, setPrevisaoPreview] = useState<PrevisaoMatch[] | null>(null);
  // requestId -> decisão escolhida no diálogo
  const [previsaoDecisoes, setPrevisaoDecisoes] = useState<Record<string, number | "novo">>({});
```

- [ ] **Step 3: `handleEnviar` passa a fazer o preview primeiro**

Substituir a função `handleEnviar` (linhas 214-232) por:

```ts
  function executarEnvio(decisoes?: Record<string, number | "novo">) {
    startTransition(async () => {
      const result = await sendToPayment(Array.from(selected), payingCompanyId, decisoes);
      if (result && "error" in result) {
        notify((result as { error: string }).error, false);
      } else if (result && "results" in result) {
        const failCount = result.results.filter((r) => r.error).length;
        setSelected(new Set());
        setPayingCompanyId("");
        setShowEnviarModal(false);
        setPrevisaoPreview(null);
        setPrevisaoDecisoes({});
        if (failCount > 0) {
          notify(`Enviado; ${failCount} falharam no Omie (mapeamento ou erro). Use Reenviar.`, false);
        } else {
          notify(`${result.results.length} requisição(ões) enviadas e lançadas no Omie.`);
        }
      }
    });
  }

  function handleEnviar() {
    if (selected.size === 0 || !payingCompanyId) return;
    startTransition(async () => {
      const preview = await previewPrevisaoMatches(Array.from(selected), payingCompanyId);
      if ("error" in preview) {
        notify(preview.error, false);
        return;
      }
      const comPrevisao = preview.matches.filter((m) => m.previsao);
      if (comPrevisao.length === 0) {
        // Nenhuma previsão: envia direto, comportamento atual.
        executarEnvio();
        return;
      }
      // Pré-seleciona "editar a previsão" para todas as que acharam.
      const iniciais: Record<string, number | "novo"> = {};
      for (const m of comPrevisao) iniciais[m.requestId] = m.previsao!.codigo;
      setPrevisaoDecisoes(iniciais);
      setPrevisaoPreview(comPrevisao);
      setShowEnviarModal(false);
    });
  }
```

- [ ] **Step 4: Diálogo de confirmação de previsões**

Adicionar este bloco logo após o fechamento do modal "Enviar para pagamento" (depois da linha 486, `)}`):

```tsx
      {/* Diálogo — Confirmar edição de previsões */}
      {previsaoPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl border bg-background shadow-lg">
            <div className="border-b px-6 py-4">
              <h3 className="font-semibold">Previsões encontradas no Omie</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Para estes fornecedores existe uma previsão vencendo no mês. Escolha
                editar a previsão (atualiza valor, vencimento e demais campos) ou criar
                um título novo.
              </p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-3">
              {previsaoPreview.map((m) => {
                const decisao = previsaoDecisoes[m.requestId];
                const editar = typeof decisao === "number";
                return (
                  <div key={m.requestId} className="rounded-lg border px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm">
                        <p className="font-medium">
                          #{m.requestNumber} — {m.supplierName}
                        </p>
                        <p className="text-muted-foreground">
                          Previsão vence {m.previsao!.vencimento} · valor atual{" "}
                          {fmt.format(m.previsao!.valorAtual)} → novo {fmt.format(m.amount)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1 rounded-md border p-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            setPrevisaoDecisoes((p) => ({ ...p, [m.requestId]: m.previsao!.codigo }))
                          }
                          className={`rounded px-2 py-1 text-xs font-medium ${
                            editar ? "bg-violet-600 text-white" : "text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          Editar previsão
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPrevisaoDecisoes((p) => ({ ...p, [m.requestId]: "novo" }))
                          }
                          className={`rounded px-2 py-1 text-xs font-medium ${
                            !editar ? "bg-violet-600 text-white" : "text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          Criar novo
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  setPrevisaoPreview(null);
                  setPrevisaoDecisoes({});
                }}
                disabled={isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => executarEnvio(previsaoDecisoes)}
                disabled={isPending}
                className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {isPending ? "Enviando..." : "Confirmar e enviar"}
              </button>
            </div>
          </div>
        </div>
      )}
```

Nota: `fmt` e `isPending` já existem no componente (usados no modal de envio).

- [ ] **Step 5: Badge `previsao_editada`**

Em `OmieLaunchBadge`, após o bloco `if (status === "lancado")` (linha ~580), adicionar:

```tsx
  if (status === "previsao_editada") {
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        Previsão editada
      </span>
    );
  }
```

- [ ] **Step 6: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros de tipo nem de JSX.

- [ ] **Step 7: Commit**

```bash
git add src/components/ctrl/contas-a-pagar-table.tsx
git commit -m "feat(ctrl): confirmacao de edicao de previsao no envio para pagamento

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Teste manual (após deploy em preview/produção)

1. **Caso com previsão:** garantir no Omie um título em aberto do fornecedor X
   com "previsão" na observação, vencendo no mês corrente. Criar/aprovar uma
   requisição do fornecedor X com valor diferente. Em Contas a Pagar, selecionar
   a requisição → "Enviar para pagamento" → escolher empresa → confirmar.
   - Esperado: aparece o diálogo "Previsões encontradas", mostrando valor atual →
     novo. Confirmar com "Editar previsão".
   - No Omie: o **mesmo** título teve valor, vencimento, categoria, departamento e
     observação atualizados (a obs deixa de conter "previsão", passa a ser a
     descrição da requisição). Nenhum título novo criado.
   - Na tela: badge "Previsão editada".

2. **Caso sem previsão:** requisição de fornecedor sem previsão no mês → envio
   direto, sem diálogo, cria título novo (badge "Lançado (Omie)") — comportamento
   atual.

3. **Várias previsões:** dois títulos "previsão" do fornecedor no mês, valores
   diferentes → o diálogo mostra a de valor mais próximo da requisição.

4. **Escolher "Criar novo" no diálogo:** confirma que cria título novo mesmo
   havendo previsão (badge "Lançado (Omie)").

5. **Reenviar:** numa requisição com badge "Previsão editada", forçar erro e usar
   "Reenviar" → confirma que reusa o mesmo título (não duplica).
