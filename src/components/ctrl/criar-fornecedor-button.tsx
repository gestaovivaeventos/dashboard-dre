"use client";

import { Banknote, Contact, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createSupplier } from "@/lib/ctrl/actions/suppliers";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2";
const LABEL_CLS = "text-sm font-medium";

interface FormState {
  name: string;
  cnpj_cpf: string;
  email: string;
  phone: string;
  chave_pix: string;
  banco: string;
  agencia: string;
  conta_corrente: string;
  titular_banco: string;
  doc_titular: string;
  transf_padrao: boolean;
}

const emptyForm: FormState = {
  name: "",
  cnpj_cpf: "",
  email: "",
  phone: "",
  chave_pix: "",
  banco: "",
  agencia: "",
  conta_corrente: "",
  titular_banco: "",
  doc_titular: "",
  transf_padrao: false,
};

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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) {
      setError("Informe o nome do fornecedor.");
      return;
    }
    setLoading(true);
    const result = await createSupplier({
      name: form.name,
      cnpj_cpf: form.cnpj_cpf || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      chave_pix: form.chave_pix || undefined,
      banco: form.banco || undefined,
      agencia: form.agencia || undefined,
      conta_corrente: form.conta_corrente || undefined,
      titular_banco: form.titular_banco || undefined,
      doc_titular: form.doc_titular || undefined,
      transf_padrao: form.transf_padrao,
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
            className="my-10 w-full max-w-2xl rounded-lg border bg-background shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4">
              <h2 className="text-lg font-semibold">Novo Fornecedor</h2>
              <p className="text-sm text-muted-foreground">
                Preencha os dados disponíveis. O fornecedor será criado com status{" "}
                <strong>pendente</strong> e aguardará aprovação do CSC antes de ser usado
                em requisições.
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="max-h-[65vh] space-y-4 overflow-y-auto bg-muted/20 px-6 py-5">
                {error && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}

                {/* Dados cadastrais */}
                <section className="rounded-lg border bg-background shadow-sm">
                  <header className="flex items-center gap-2 border-b px-4 py-2.5">
                    <Contact className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Dados cadastrais</h3>
                  </header>
                  <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <label htmlFor="new-supplier-name" className={LABEL_CLS}>
                        Nome / Razão Social <span className="text-destructive">*</span>
                      </label>
                      <input
                        id="new-supplier-name"
                        type="text"
                        required
                        autoFocus
                        value={form.name}
                        onChange={(e) => update("name", e.target.value)}
                        placeholder="Ex: Acme Serviços LTDA"
                        className={INPUT_CLS}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-cnpj" className={LABEL_CLS}>CPF / CNPJ</label>
                      <input
                        id="new-supplier-cnpj"
                        type="text"
                        value={form.cnpj_cpf}
                        onChange={(e) => update("cnpj_cpf", e.target.value)}
                        placeholder="00.000.000/0000-00"
                        className={`${INPUT_CLS} font-mono`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-phone" className={LABEL_CLS}>Telefone</label>
                      <input
                        id="new-supplier-phone"
                        type="tel"
                        value={form.phone}
                        onChange={(e) => update("phone", e.target.value)}
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

                {/* Dados bancários */}
                <section className="rounded-lg border bg-background shadow-sm">
                  <header className="flex items-center gap-2 border-b px-4 py-2.5">
                    <Banknote className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Dados bancários</h3>
                    <span className="ml-auto text-xs text-muted-foreground">opcional</span>
                  </header>
                  <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <label htmlFor="new-supplier-pix" className={LABEL_CLS}>Chave PIX</label>
                      <input
                        id="new-supplier-pix"
                        type="text"
                        value={form.chave_pix}
                        onChange={(e) => update("chave_pix", e.target.value)}
                        placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
                        className={`${INPUT_CLS} font-mono`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-banco" className={LABEL_CLS}>Banco</label>
                      <input
                        id="new-supplier-banco"
                        type="text"
                        value={form.banco}
                        onChange={(e) => update("banco", e.target.value)}
                        placeholder="Ex: Banco do Brasil"
                        className={INPUT_CLS}
                      />
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
                    <div className="space-y-1.5 sm:col-span-2">
                      <label htmlFor="new-supplier-doc-titular" className={LABEL_CLS}>CPF/CNPJ do titular</label>
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
