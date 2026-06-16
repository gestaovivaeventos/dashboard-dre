# Métodos de pagamento da requisição — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar o método de pagamento "PIX Copia e Cola", usar conta corrente específica por método (dinheiro→caixa físico, cartão→cartão, resto→padrão) e remover a opção "Não sei" da pergunta de nota fiscal.

**Architecture:** Migração no banco (CHECK de `payment_method` + 2 colunas em `ctrl_company_omie_config`); ajustes no formulário de nova requisição e no tipo `PaymentMethod`; resolução da conta corrente por método no `launchRequestToOmie`; admin de mapeamento Omie ganha dois seletores de conta.

**Tech Stack:** Next.js 14 (App Router) server actions, TypeScript, Supabase (Postgres, CHECK constraints), Omie. Sem framework de teste — validação por `npm run lint` + `npm run build` + teste manual.

> **Nota de testes:** o repositório não tem runner de teste. "Verificação" = `npm run lint` e `npm run build` passando + roteiro manual no fim. Não criar arquivos de teste.

---

## File Structure

- **Migrações Supabase** (Task 1) — CHECK de `payment_method` recriado com `pix_copia_cola`; `ctrl_company_omie_config` ganha `codigo_conta_corrente_caixa` e `codigo_conta_corrente_cartao`.
- `src/lib/ctrl/actions/requests.ts` (Task 2) — `PaymentMethod` union ganha `pix_copia_cola`.
- `src/components/ctrl/nova-requisicao-form.tsx` (Task 2) — método PIX copia e cola (opção + campo colar + disponibilidade + validação + submit), e remoção da opção "Não sei".
- `src/lib/ctrl/actions/omie-mapping.ts` (Task 3) — `OmieMappingData` + `getOmieMappingData` retornam caixa/cartão; `saveContaCorrente` ganha `tipo`.
- `src/lib/ctrl/actions/contapagar-launch.ts` (Task 3) — resolve a conta corrente por método.
- `src/components/ctrl/omie-mapeamento-client.tsx` (Task 4) — dois seletores novos de conta.

---

## Task 1: Migrações no banco (DDL)

> **Executor:** o CONTROLADOR roda esta task (não um subagente): precisa do Supabase MCP e da confirmação "ok" do Marcelo antes de aplicar DDL (regra global). Projeto: DASH_HERO (`hlophikvgtqoexqwxxis`).

**Files:**
- Create: `supabase/migrations/20260616000001_payment_method_pix_copia_cola.sql`
- Create: `supabase/migrations/20260616000002_company_omie_config_contas_por_metodo.sql`

- [ ] **Step 1: Criar o arquivo de migração do payment_method**

`supabase/migrations/20260616000001_payment_method_pix_copia_cola.sql`:

```sql
-- Adiciona 'pix_copia_cola' aos métodos de pagamento aceitos.
ALTER TABLE ctrl_requests DROP CONSTRAINT IF EXISTS ctrl_requests_payment_method_check;
ALTER TABLE ctrl_requests
  ADD CONSTRAINT ctrl_requests_payment_method_check
  CHECK (payment_method IN ('boleto','pix','transferencia','cartao_credito','dinheiro','pix_copia_cola'));
```

- [ ] **Step 2: Criar o arquivo de migração das contas por método**

`supabase/migrations/20260616000002_company_omie_config_contas_por_metodo.sql`:

```sql
-- Conta corrente específica por método de pagamento (dinheiro=caixa, cartão).
ALTER TABLE ctrl_company_omie_config
  ADD COLUMN IF NOT EXISTS codigo_conta_corrente_caixa  text,
  ADD COLUMN IF NOT EXISTS codigo_conta_corrente_cartao text;
```

- [ ] **Step 3: Mostrar o SQL ao Marcelo e aguardar "ok"** (regra global de DDL). Dizer que roda no DASH_HERO.

- [ ] **Step 4: Aplicar via Supabase MCP** (`mcp__claude_ai_Supabase__apply_migration`), uma migração por chamada (`name` = nome do arquivo sem extensão; `query` = conteúdo).

- [ ] **Step 5: Verificar** com `mcp__claude_ai_Supabase__execute_sql`:

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint where conname = 'ctrl_requests_payment_method_check';
select column_name from information_schema.columns
where table_name = 'ctrl_company_omie_config'
  and column_name in ('codigo_conta_corrente_caixa','codigo_conta_corrente_cartao');
```
Esperado: o CHECK lista `pix_copia_cola`; as duas colunas aparecem.

- [ ] **Step 6: Commit dos arquivos de migração**

```bash
git add supabase/migrations/20260616000001_payment_method_pix_copia_cola.sql supabase/migrations/20260616000002_company_omie_config_contas_por_metodo.sql
git commit -m "feat(db): payment_method pix_copia_cola + contas correntes por metodo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: PIX Copia e Cola + remover "Não sei" (formulário + tipo)

**Files:**
- Modify: `src/lib/ctrl/actions/requests.ts` (type `PaymentMethod`)
- Modify: `src/components/ctrl/nova-requisicao-form.tsx`

- [ ] **Step 1: Estender `PaymentMethod`**

Em `src/lib/ctrl/actions/requests.ts` (linhas 13-18), trocar:

```ts
export type PaymentMethod =
  | "boleto"
  | "pix"
  | "transferencia"
  | "cartao_credito"
  | "dinheiro";
```
por:
```ts
export type PaymentMethod =
  | "boleto"
  | "pix"
  | "transferencia"
  | "cartao_credito"
  | "dinheiro"
  | "pix_copia_cola";
```

- [ ] **Step 2: Disponibilidade do novo método (sempre disponível)**

Em `nova-requisicao-form.tsx`, no `availableMethods` useMemo (linhas 298-303), trocar:

```ts
  const availableMethods = useMemo(() => {
    const avail = new Set(["boleto", "cartao_credito", "dinheiro"]);
    if (!selectedSupplier || selectedSupplier.chave_pix) avail.add("pix");
    if (!selectedSupplier || (selectedSupplier.banco && selectedSupplier.conta_corrente)) avail.add("transferencia");
    return avail;
  }, [selectedSupplier]);
```
por (adicionar `pix_copia_cola` ao set inicial — independe do fornecedor):
```ts
  const availableMethods = useMemo(() => {
    const avail = new Set(["boleto", "cartao_credito", "dinheiro", "pix_copia_cola"]);
    if (!selectedSupplier || selectedSupplier.chave_pix) avail.add("pix");
    if (!selectedSupplier || (selectedSupplier.banco && selectedSupplier.conta_corrente)) avail.add("transferencia");
    return avail;
  }, [selectedSupplier]);
```

E no `handleSupplierChange` (linhas 367-370), trocar:
```ts
    const newAvail = new Set(["boleto", "cartao_credito", "dinheiro"]);
    if (sup.chave_pix) newAvail.add("pix");
    if (sup.banco && sup.conta_corrente) newAvail.add("transferencia");
    if (!newAvail.has(paymentMethod)) { setPaymentMethod("boleto"); setInstallments(1); }
```
por:
```ts
    const newAvail = new Set(["boleto", "cartao_credito", "dinheiro", "pix_copia_cola"]);
    if (sup.chave_pix) newAvail.add("pix");
    if (sup.banco && sup.conta_corrente) newAvail.add("transferencia");
    if (!newAvail.has(paymentMethod)) { setPaymentMethod("boleto"); setInstallments(1); }
```

- [ ] **Step 3: Adicionar a opção no seletor de método**

No array de métodos (linhas 907-913), trocar:
```tsx
            { value: "cartao_credito", label: "Cartão de Crédito" },
            { value: "dinheiro", label: "Dinheiro" },
          ].map((opt) => {
```
por:
```tsx
            { value: "cartao_credito", label: "Cartão de Crédito" },
            { value: "dinheiro", label: "Dinheiro" },
            { value: "pix_copia_cola", label: "PIX Copia e Cola" },
          ].map((opt) => {
```

- [ ] **Step 4: Seção do campo "colar código" (após a seção do PIX)**

Logo após o bloco `{paymentMethod === "pix" && ( ... )}` (que termina na linha 976 com `)}`), inserir:

```tsx
      {/* PIX Copia e Cola — pagamento avulso; campo editável mesmo com fornecedor */}
      {paymentMethod === "pix_copia_cola" && (
        <div className="space-y-1.5 rounded-lg border bg-muted/20 p-4">
          <label htmlFor="pix_copia_cola" className={LABEL_CLS}>
            Código PIX (copia e cola) <span className="text-destructive">*</span>
          </label>
          <textarea
            id="pix_copia_cola"
            name="pix_copia_cola"
            rows={3}
            value={pixKey}
            onChange={(e) => setPixKey(e.target.value)}
            placeholder="Cole aqui o código PIX copia e cola"
            className={`${INPUT_CLS} resize-none font-mono text-xs`}
          />
        </div>
      )}
```

- [ ] **Step 5: Validação no submit**

No `handleSubmit`, logo após o bloco que valida `invoiceAttachmentRequired` (linhas 404-407, termina com `}`), inserir:

```ts
    if (paymentMethod === "pix_copia_cola" && !pixKey.trim()) {
      setError("Cole o código PIX copia e cola antes de enviar.");
      return;
    }
```

- [ ] **Step 6: Ampliar o cast do `payment_method` no payload**

Na chamada `createRequest` (linha 461), trocar:
```ts
      payment_method: paymentMethod as "boleto" | "pix" | "transferencia" | "cartao_credito" | "dinheiro",
```
por:
```ts
      payment_method: paymentMethod as "boleto" | "pix" | "transferencia" | "cartao_credito" | "dinheiro" | "pix_copia_cola",
```

(Os campos `pix_key`/`pix_key_type` já são enviados no payload — `pix_key` levará o código colado e `pix_key_type` ficará vazio para este método, pois nada o seta.)

- [ ] **Step 7: Remover a opção "Não sei"**

No select "O fornecedor emite nota fiscal?" (linhas 1137-1141), remover a linha:
```tsx
          <option value="nao_sei">Não sei</option>
```
Manter as demais (`Selecione`, `sim`, `sim_apos_pagamento`, `nao`).

- [ ] **Step 8: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros.

- [ ] **Step 9: Commit**

```bash
git add src/lib/ctrl/actions/requests.ts src/components/ctrl/nova-requisicao-form.tsx
git commit -m "feat(ctrl): metodo PIX copia e cola e remove opcao Nao sei

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Conta corrente por método — backend

**Files:**
- Modify: `src/lib/ctrl/actions/omie-mapping.ts`
- Modify: `src/lib/ctrl/actions/contapagar-launch.ts`

- [ ] **Step 1: Estender `OmieMappingData`**

Em `omie-mapping.ts` (linhas 106-116), na interface, após `contaCorrente: string | null;` adicionar:
```ts
  contaCorrenteCaixa: string | null;
  contaCorrenteCartao: string | null;
```

- [ ] **Step 2: `getOmieMappingData` lê e retorna as 2 novas colunas**

Localizar o select da conta corrente (linhas 183-187):
```ts
  const { data: ccConfig, error: ccErr } = await db
    .from("ctrl_company_omie_config")
    .select("codigo_conta_corrente")
    .eq("company_id", companyId)
    .maybeSingle();
```
trocar o `.select(...)` por:
```ts
    .select("codigo_conta_corrente, codigo_conta_corrente_caixa, codigo_conta_corrente_cartao")
```
E no objeto de retorno (linha ~209, onde está `contaCorrente: ccConfig?.codigo_conta_corrente ?? null,`), adicionar logo abaixo:
```ts
    contaCorrenteCaixa: ccConfig?.codigo_conta_corrente_caixa ?? null,
    contaCorrenteCartao: ccConfig?.codigo_conta_corrente_cartao ?? null,
```

- [ ] **Step 3: `saveContaCorrente` ganha `tipo`**

Substituir a assinatura e o corpo de `saveContaCorrente` (linhas 292-309 e seguintes até o `revalidatePath`/`return`) por:

```ts
export async function saveContaCorrente(
  companyId: string,
  codigo: string | null,
  tipo: "padrao" | "caixa" | "cartao" = "padrao",
): Promise<{ ok: true } | { error: string }> {
  await requireCtrlRole("admin", "csc", "contas_a_pagar");
  const db = createAdminClient();

  const coluna =
    tipo === "caixa"
      ? "codigo_conta_corrente_caixa"
      : tipo === "cartao"
      ? "codigo_conta_corrente_cartao"
      : "codigo_conta_corrente";

  const { error } = await db
    .from("ctrl_company_omie_config")
    .upsert(
      {
        company_id: companyId,
        [coluna]: codigo ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id" },
    );
```

Manter o que vinha depois do upsert original (o tratamento de `error`, `revalidatePath("/ctrl/admin/omie-mapeamento")` e `return { ok: true }`). Conferir ao ler que o fechamento da função permanece correto.

- [ ] **Step 4: Resolver conta corrente por método no launch**

Em `contapagar-launch.ts`, substituir o bloco das linhas 101-120 (do `const { data: ccRow }` até `const codigoContaCorrente = ...`) por:

```ts
  const { data: ccRow } = await supabase
    .from("ctrl_company_omie_config")
    .select("codigo_conta_corrente, codigo_conta_corrente_caixa, codigo_conta_corrente_cartao")
    .eq("company_id", companyId)
    .maybeSingle();

  // Conta corrente por método: dinheiro→caixa físico, cartão→cartão; ambos com
  // fallback para a conta padrão. Demais métodos usam a padrão.
  const ccPadrao = (ccRow?.codigo_conta_corrente as string | number | null) ?? null;
  const ccCaixa = (ccRow?.codigo_conta_corrente_caixa as string | number | null) ?? null;
  const ccCartao = (ccRow?.codigo_conta_corrente_cartao as string | number | null) ?? null;
  const codigoContaCorrenteResolved =
    request.payment_method === "dinheiro"
      ? (ccCaixa ?? ccPadrao)
      : request.payment_method === "cartao_credito"
      ? (ccCartao ?? ccPadrao)
      : ccPadrao;

  const missing: string[] = [];
  if (!catRow?.codigo_categoria) missing.push("categoria");
  if (!depRow?.codigo_departamento) missing.push("departamento");
  if (!codigoContaCorrenteResolved) missing.push("conta corrente");

  if (missing.length > 0) {
    return {
      error: `Mapeamento Omie incompleto para ${company.name}: ${missing.join(", ")}.`,
    };
  }

  const codigoCategoria = catRow!.codigo_categoria as string;
  const codigoDepartamento = depRow!.codigo_departamento as string;
  const codigoContaCorrente = codigoContaCorrenteResolved as string | number;
```

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros. Se os tipos gerados do Supabase ainda não conhecerem as colunas novas (types.ts desatualizado), os `as string | number | null` já cobrem; se o `.select(...)` reclamar, manter — em runtime as colunas existem após a Task 1. Não regenerar types.ts neste plano.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ctrl/actions/omie-mapping.ts src/lib/ctrl/actions/contapagar-launch.ts
git commit -m "feat(ctrl): conta corrente por metodo de pagamento (caixa/cartao)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Conta corrente por método — admin UI

**Files:**
- Modify: `src/components/ctrl/omie-mapeamento-client.tsx`

- [ ] **Step 1: Handler genérico por tipo de conta**

Substituir a função `handleContaCorrente` (linhas 81-93 aproximadamente; ela usa `data.contaCorrente`, chama `saveContaCorrente(companyId, codigo || null)` e seta `saveFeedback` com `id: "cc"`) por uma versão parametrizada. Ler a função inteira primeiro para preservar o fechamento e o `setSaveFeedback` de sucesso. Nova versão:

```tsx
  function handleContaCorrente(
    codigo: string,
    tipo: "padrao" | "caixa" | "cartao" = "padrao",
  ) {
    if (!companyId || !data) return;
    const campo =
      tipo === "caixa"
        ? "contaCorrenteCaixa"
        : tipo === "cartao"
        ? "contaCorrenteCartao"
        : "contaCorrente";
    const feedbackId = `cc_${tipo}`;
    const prev = data[campo];
    setData({ ...data, [campo]: codigo || null });
    startTransition(async () => {
      const res = await saveContaCorrente(companyId, codigo || null, tipo);
      if ("error" in res) {
        setData({ ...data, [campo]: prev });
        setSaveFeedback({ id: feedbackId, ok: false, msg: res.error });
      } else {
        setSaveFeedback({ id: feedbackId, ok: true, msg: "Salvo." });
      }
    });
  }
```

Nota: confirmar ao ler a função original qual é a mensagem/feedback de sucesso usada e manter o mesmo texto (ex.: se hoje usa `"Salvo."` ou outra string — use a string real do arquivo). O `id` do feedback da conta padrão muda de `"cc"` para `"cc_padrao"`; ajustar o JSX correspondente (próximo step).

- [ ] **Step 2: JSX — conta padrão usa o novo feedbackId e ganha 2 seletores**

Substituir a `<section>` "Conta OmieCash" (linhas 231-256) por:

```tsx
              {/* ── Contas OmieCash por método ───────────────────────── */}
              <section className="space-y-3">
                <h2 className="text-base font-semibold">Contas OmieCash</h2>

                <div className="space-y-1.5">
                  <label className={LABEL_CLS}>Conta padrão</label>
                  <div className="flex items-center gap-3">
                    <select
                      value={data.contaCorrente ?? suggestedCc?.codigo ?? ""}
                      onChange={(e) => handleContaCorrente(e.target.value, "padrao")}
                      disabled={isPending}
                      className={INPUT_CLS + " max-w-sm"}
                    >
                      <option value="">— não mapeado —</option>
                      {data.contasCorrentes.map((cc) => (
                        <option key={cc.codigo} value={cc.codigo}>
                          {cc.descricao}
                        </option>
                      ))}
                    </select>
                    {saveFeedback?.id === "cc_padrao" && (
                      <span className={`text-xs font-medium ${saveFeedback.ok ? "text-green-700" : "text-destructive"}`}>
                        {saveFeedback.msg}
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className={LABEL_CLS}>Dinheiro (caixa físico)</label>
                  <div className="flex items-center gap-3">
                    <select
                      value={data.contaCorrenteCaixa ?? ""}
                      onChange={(e) => handleContaCorrente(e.target.value, "caixa")}
                      disabled={isPending}
                      className={INPUT_CLS + " max-w-sm"}
                    >
                      <option value="">— não mapeado —</option>
                      {data.contasCorrentes.map((cc) => (
                        <option key={cc.codigo} value={cc.codigo}>
                          {cc.descricao}
                        </option>
                      ))}
                    </select>
                    {saveFeedback?.id === "cc_caixa" && (
                      <span className={`text-xs font-medium ${saveFeedback.ok ? "text-green-700" : "text-destructive"}`}>
                        {saveFeedback.msg}
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className={LABEL_CLS}>Cartão de crédito</label>
                  <div className="flex items-center gap-3">
                    <select
                      value={data.contaCorrenteCartao ?? ""}
                      onChange={(e) => handleContaCorrente(e.target.value, "cartao")}
                      disabled={isPending}
                      className={INPUT_CLS + " max-w-sm"}
                    >
                      <option value="">— não mapeado —</option>
                      {data.contasCorrentes.map((cc) => (
                        <option key={cc.codigo} value={cc.codigo}>
                          {cc.descricao}
                        </option>
                      ))}
                    </select>
                    {saveFeedback?.id === "cc_cartao" && (
                      <span className={`text-xs font-medium ${saveFeedback.ok ? "text-green-700" : "text-destructive"}`}>
                        {saveFeedback.msg}
                      </span>
                    )}
                  </div>
                </div>
              </section>
```

Nota: usa `LABEL_CLS` — confirmar que existe no arquivo; se não, usar a mesma classe de label usada em outras seções (ex.: a string de classe literal já usada). Se `LABEL_CLS` não existir, definir as labels com `className="text-sm font-medium"`.

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros (TypeScript reconhece `contaCorrenteCaixa`/`contaCorrenteCartao` por causa da Task 3 Step 1).

- [ ] **Step 4: Commit**

```bash
git add src/components/ctrl/omie-mapeamento-client.tsx
git commit -m "feat(ctrl): seletores de conta corrente por metodo no admin Omie

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Teste manual (após deploy)

1. **PIX Copia e Cola:** nova requisição → método "PIX Copia e Cola" aparece e é selecionável mesmo sem fornecedor. Campo de colar o código aparece; enviar sem colar → erro "Cole o código PIX copia e cola". Colar e enviar → requisição criada; conferir que `pix_key` guardou o código.
2. **Não sei:** na pergunta "O fornecedor emite nota fiscal?" a opção "Não sei" não existe mais; as outras seguem.
3. **Conta por método (admin):** em ctrl/admin/omie-mapeamento, escolher empresa → aparecem 3 seletores (padrão, caixa, cartão). Definir caixa e cartão; recarregar e confirmar que persistiram.
4. **Launch dinheiro:** aprovar+enviar uma requisição método "dinheiro" → no Omie o título sai na conta "caixa físico" configurada. Sem caixa configurado → cai na padrão.
5. **Launch cartão:** método "cartão de crédito" → conta "cartão". Sem cartão configurado → padrão.
6. **Launch outros:** boleto/pix/transferência → conta padrão (inalterado).
