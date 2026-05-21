"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createSupplier } from "@/lib/ctrl/actions/suppliers";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2";
const LABEL_CLS = "text-sm font-medium";

export function CriarFornecedorButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cnpjCpf, setCnpjCpf] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  function reset() {
    setName("");
    setCnpjCpf("");
    setEmail("");
    setPhone("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Informe o nome do fornecedor.");
      setLoading(false);
      return;
    }
    const result = await createSupplier({
      name: trimmed,
      cnpj_cpf: cnpjCpf.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
    });
    setLoading(false);
    if ("error" in result && result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
    reset();
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
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="mt-16 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Novo Fornecedor</h2>
              <p className="text-sm text-muted-foreground">
                O fornecedor é criado com status <strong>pendente</strong> — aguardará
                aprovação pelo CSC antes de poder ser usado em requisições.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="space-y-1.5">
                <label htmlFor="new-supplier-name" className={LABEL_CLS}>
                  Nome / Razão Social <span className="text-destructive">*</span>
                </label>
                <input
                  id="new-supplier-name"
                  type="text"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Acme Serviços LTDA"
                  className={INPUT_CLS}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="new-supplier-cnpj" className={LABEL_CLS}>
                  CPF / CNPJ
                </label>
                <input
                  id="new-supplier-cnpj"
                  type="text"
                  value={cnpjCpf}
                  onChange={(e) => setCnpjCpf(e.target.value)}
                  placeholder="00.000.000/0000-00"
                  className={INPUT_CLS}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="new-supplier-email" className={LABEL_CLS}>
                    E-mail
                  </label>
                  <input
                    id="new-supplier-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contato@fornecedor.com"
                    className={INPUT_CLS}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="new-supplier-phone" className={LABEL_CLS}>
                    Telefone
                  </label>
                  <input
                    id="new-supplier-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(11) 99999-9999"
                    className={INPUT_CLS}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setOpen(false); reset(); }}
                  disabled={loading}
                  className="rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
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
