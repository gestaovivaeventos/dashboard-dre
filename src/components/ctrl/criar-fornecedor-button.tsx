"use client";

import { Banknote, Building2, Contact, KeyRound, Plus, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { createSupplier } from "@/lib/ctrl/actions/suppliers";
import { BANCOS_BR, PIX_KEY_TYPES, formatBanco, normalizePixTelefone, type PixKeyType } from "@/lib/ctrl/bancos";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2";
const LABEL_CLS = "text-sm font-medium";

type PersonType = "pj" | "pf";

interface FormState {
  personType: PersonType;
  name: string;
  cnpj_cpf: string;
  email: string;
  phone: string;
  pix_key_type: PixKeyType | "";
  chave_pix: string;
  banco: string;
  agencia: string;
  conta_corrente: string;
  titular_banco: string;
  doc_titular: string;
  transf_padrao: boolean;
  pix_padrao: boolean;
}

const emptyForm: FormState = {
  personType: "pj",
  name: "",
  cnpj_cpf: "",
  email: "",
  phone: "",
  pix_key_type: "",
  chave_pix: "",
  banco: "",
  agencia: "",
  conta_corrente: "",
  titular_banco: "",
  doc_titular: "",
  transf_padrao: false,
  pix_padrao: false,
};

// Light masks — apenas pra ajudar visualmente. Não bloqueia input livre.
function maskCpfCnpj(value: string, type: PersonType): string {
  const digits = value.replace(/\D/g, "");
  if (type === "pf") {
    return digits
      .slice(0, 11)
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return digits
    .slice(0, 14)
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  }
  return digits.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
}

export function CriarFornecedorButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function close() {
    if (loading) return;
    setOpen(false);
    setForm(emptyForm);
    setError(null);
  }

  // Quando o usuário escolhe um tipo de PIX que casa com um documento já
  // informado (CPF/CNPJ), pré-preenche a chave automaticamente.
  const pixTypeOption = useMemo(
    () => PIX_KEY_TYPES.find((p) => p.value === form.pix_key_type) ?? null,
    [form.pix_key_type],
  );

  function applyPixTypeAutoFill(type: PixKeyType) {
    update("pix_key_type", type);
    if (type === "cpf" && form.personType === "pf" && form.cnpj_cpf && !form.chave_pix) {
      update("chave_pix", form.cnpj_cpf);
    } else if (type === "cnpj" && form.personType === "pj" && form.cnpj_cpf && !form.chave_pix) {
      update("chave_pix", form.cnpj_cpf);
    } else if (type === "email" && form.email && !form.chave_pix) {
      update("chave_pix", form.email);
    } else if (type === "telefone" && form.phone && !form.chave_pix) {
      update("chave_pix", normalizePixTelefone(form.phone));
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) {
      setError("Informe o nome do fornecedor.");
      return;
    }
    if (!form.cnpj_cpf.trim()) {
      setError(form.personType === "pf" ? "Informe o CPF." : "Informe o CNPJ.");
      return;
    }
    // Se preencheu chave PIX, exige tipo (e vice-versa).
    if (form.chave_pix.trim() && !form.pix_key_type) {
      setError("Selecione o tipo da chave PIX.");
      return;
    }
    if (form.pix_key_type && !form.chave_pix.trim()) {
      setError("Informe a chave PIX correspondente ao tipo selecionado.");
      return;
    }
    setLoading(true);
    const result = await createSupplier({
      name: form.name,
      cnpj_cpf: form.cnpj_cpf || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      chave_pix: form.chave_pix || undefined,
      pix_key_type: form.pix_key_type || undefined,
      banco: form.banco || undefined,
      agencia: form.agencia || undefined,
      conta_corrente: form.conta_corrente || undefined,
      titular_banco: form.titular_banco || undefined,
      doc_titular: form.doc_titular || undefined,
      transf_padrao: form.transf_padrao,
      pix_padrao: form.pix_padrao,
    });
    setLoading(false);
    if ("error" in result && result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setForm(emptyForm);
    startTransition(() => router.refresh());
  }

  // Dica visual: se não tem nem PIX nem dados bancários, avisa.
  const hasPix = !!form.chave_pix.trim();
  const hasBank = !!(form.banco || form.agencia || form.conta_corrente);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="mr-2 h-4 w-4" />
        Novo Fornecedor
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="my-10 w-full max-w-3xl rounded-lg border bg-background shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4">
              <h2 className="text-lg font-semibold">Novo Fornecedor</h2>
              <p className="text-sm text-muted-foreground">
                O fornecedor é criado com status{" "}
                <strong className="text-amber-600 dark:text-amber-400">pendente</strong> e
                aguarda aprovação do CSC antes de poder ser usado em requisições.
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="max-h-[70vh] space-y-4 overflow-y-auto bg-muted/20 px-6 py-5">
                {error && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}

                {/* Tipo de pessoa */}
                <section className="rounded-lg border bg-background shadow-sm">
                  <header className="flex items-center gap-2 border-b px-4 py-2.5">
                    <Building2 className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Tipo de pessoa</h3>
                  </header>
                  <div className="grid grid-cols-2 gap-2 p-4">
                    <button
                      type="button"
                      onClick={() => {
                        update("personType", "pj");
                        // Reseta documento ao trocar tipo pra não ficar mascarado errado
                        if (form.cnpj_cpf) update("cnpj_cpf", "");
                      }}
                      className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                        form.personType === "pj"
                          ? "border-primary bg-primary/10 text-primary"
                          : "hover:bg-muted"
                      }`}
                    >
                      <Building2 className="h-4 w-4" />
                      Pessoa Jurídica
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        update("personType", "pf");
                        if (form.cnpj_cpf) update("cnpj_cpf", "");
                      }}
                      className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                        form.personType === "pf"
                          ? "border-primary bg-primary/10 text-primary"
                          : "hover:bg-muted"
                      }`}
                    >
                      <User className="h-4 w-4" />
                      Pessoa Física
                    </button>
                  </div>
                </section>

                {/* Dados cadastrais */}
                <section className="rounded-lg border bg-background shadow-sm">
                  <header className="flex items-center gap-2 border-b px-4 py-2.5">
                    <Contact className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Dados cadastrais</h3>
                  </header>
                  <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <label htmlFor="new-supplier-name" className={LABEL_CLS}>
                        {form.personType === "pj" ? "Razão Social" : "Nome Completo"}{" "}
                        <span className="text-destructive">*</span>
                      </label>
                      <input
                        id="new-supplier-name"
                        type="text"
                        required
                        autoFocus
                        maxLength={60}
                        value={form.name}
                        onChange={(e) => update("name", e.target.value.slice(0, 60))}
                        placeholder={form.personType === "pj" ? "Ex: Acme Serviços LTDA" : "Ex: João da Silva"}
                        className={INPUT_CLS}
                      />
                      <p className="text-right text-xs text-muted-foreground">
                        {form.name.length}/60 — limite do Omie
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-cnpj" className={LABEL_CLS}>
                        {form.personType === "pj" ? "CNPJ" : "CPF"}{" "}
                        <span className="text-destructive">*</span>
                      </label>
                      <input
                        id="new-supplier-cnpj"
                        type="text"
                        required
                        value={form.cnpj_cpf}
                        onChange={(e) =>
                          update("cnpj_cpf", maskCpfCnpj(e.target.value, form.personType))
                        }
                        placeholder={form.personType === "pj" ? "00.000.000/0000-00" : "000.000.000-00"}
                        className={`${INPUT_CLS} font-mono`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-phone" className={LABEL_CLS}>Telefone</label>
                      <input
                        id="new-supplier-phone"
                        type="tel"
                        value={form.phone}
                        onChange={(e) => update("phone", maskPhone(e.target.value))}
                        placeholder="(11) 99999-9999"
                        className={INPUT_CLS}
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <label htmlFor="new-supplier-email" className={LABEL_CLS}>E-mail</label>
                      <input
                        id="new-supplier-email"
                        type="email"
                        value={form.email}
                        onChange={(e) => update("email", e.target.value)}
                        placeholder="contato@fornecedor.com"
                        className={INPUT_CLS}
                      />
                    </div>
                  </div>
                </section>

                {/* PIX */}
                <section className="rounded-lg border bg-background shadow-sm">
                  <header className="flex items-center gap-2 border-b px-4 py-2.5">
                    <KeyRound className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Chave PIX</h3>
                    <span className="ml-auto text-xs text-muted-foreground">opcional</span>
                  </header>
                  <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[180px_1fr]">
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-pix-type" className={LABEL_CLS}>Tipo</label>
                      <select
                        id="new-supplier-pix-type"
                        value={form.pix_key_type}
                        onChange={(e) => applyPixTypeAutoFill(e.target.value as PixKeyType)}
                        className={INPUT_CLS}
                      >
                        <option value="">Selecione</option>
                        {PIX_KEY_TYPES.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-pix" className={LABEL_CLS}>Chave</label>
                      <input
                        id="new-supplier-pix"
                        type="text"
                        value={form.chave_pix}
                        onChange={(e) => update("chave_pix", e.target.value)}
                        onBlur={(e) => {
                          if (form.pix_key_type === "telefone" && e.target.value.trim()) {
                            update("chave_pix", normalizePixTelefone(e.target.value));
                          }
                        }}
                        placeholder={pixTypeOption?.placeholder ?? "Selecione o tipo primeiro"}
                        disabled={!form.pix_key_type}
                        className={`${INPUT_CLS} font-mono disabled:opacity-60`}
                      />
                      {pixTypeOption && (
                        <p className="text-xs text-muted-foreground">{pixTypeOption.hint}</p>
                      )}
                    </div>
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={form.pix_padrao}
                        onChange={(e) => update("pix_padrao", e.target.checked)}
                        disabled={!form.chave_pix.trim()}
                        className="h-4 w-4 disabled:opacity-50"
                      />
                      Usar PIX como método de pagamento padrão
                    </label>
                  </div>
                </section>

                {/* Conta bancária */}
                <section className="rounded-lg border bg-background shadow-sm">
                  <header className="flex items-center gap-2 border-b px-4 py-2.5">
                    <Banknote className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Conta bancária (transferência)</h3>
                    <span className="ml-auto text-xs text-muted-foreground">opcional</span>
                  </header>
                  <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <label htmlFor="new-supplier-banco" className={LABEL_CLS}>Banco</label>
                      <select
                        id="new-supplier-banco"
                        value={form.banco}
                        onChange={(e) => update("banco", e.target.value)}
                        className={INPUT_CLS}
                      >
                        <option value="">Selecione o banco</option>
                        {BANCOS_BR.map((b) => {
                          const value = formatBanco(b);
                          return (
                            <option key={`${b.codigo}-${b.nome}`} value={value}>
                              {value}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-agencia" className={LABEL_CLS}>Agência</label>
                      <input
                        id="new-supplier-agencia"
                        type="text"
                        value={form.agencia}
                        onChange={(e) => update("agencia", e.target.value)}
                        placeholder="0000"
                        className={`${INPUT_CLS} font-mono`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-conta" className={LABEL_CLS}>Conta corrente</label>
                      <input
                        id="new-supplier-conta"
                        type="text"
                        value={form.conta_corrente}
                        onChange={(e) => update("conta_corrente", e.target.value)}
                        placeholder="00000-0"
                        className={`${INPUT_CLS} font-mono`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-titular" className={LABEL_CLS}>Titular da conta</label>
                      <input
                        id="new-supplier-titular"
                        type="text"
                        value={form.titular_banco}
                        onChange={(e) => update("titular_banco", e.target.value)}
                        placeholder="Nome do titular"
                        className={INPUT_CLS}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-doc-titular" className={LABEL_CLS}>
                        CPF/CNPJ do titular
                      </label>
                      <input
                        id="new-supplier-doc-titular"
                        type="text"
                        value={form.doc_titular}
                        onChange={(e) => update("doc_titular", e.target.value)}
                        placeholder="Se diferente do CPF/CNPJ do fornecedor"
                        className={`${INPUT_CLS} font-mono`}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={form.transf_padrao}
                        onChange={(e) => update("transf_padrao", e.target.checked)}
                        className="h-4 w-4"
                      />
                      Usar transferência como método de pagamento padrão
                    </label>
                  </div>
                </section>

                {!hasPix && !hasBank && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                    Sem chave PIX ou conta bancária informada, este fornecedor só poderá
                    receber pagamentos via boleto ou dinheiro. Você pode complementar os
                    dados depois pelo botão de edição.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t px-6 py-4">
                <button
                  type="button"
                  onClick={close}
                  disabled={loading}
                  className="rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {loading ? "Criando…" : "Criar (Pendente)"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
