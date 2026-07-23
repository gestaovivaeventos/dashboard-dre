"use client";

import { Banknote, Building2, Contact, Globe, KeyRound, MapPin, Plus, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { createSupplier } from "@/lib/ctrl/actions/suppliers";
import { BANCOS_BR, PIX_KEY_TYPES, formatBanco, normalizePixTelefone, type PixKeyType } from "@/lib/ctrl/bancos";
import { PAISES_EXTERIOR, ESTADO_EXTERIOR, ESTADO_EXTERIOR_LABEL } from "@/lib/ctrl/paises";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2";
const LABEL_CLS = "text-sm font-medium";
// Realce aplicado só depois de uma tentativa de envio, pra não pintar de
// vermelho os cinco campos assim que o usuário marca o método como padrão.
const INVALID_CLS = "border-destructive ring-1 ring-destructive/40";

type PersonType = "pj" | "pf";

interface FormState {
  personType: PersonType;
  estrangeiro: boolean;
  name: string;
  cnpj_cpf: string;
  // Endereço internacional (só usado quando estrangeiro).
  codigo_pais: string;
  cidade: string;
  endereco: string;
  endereco_numero: string;
  complemento: string;
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
  estrangeiro: false,
  name: "",
  cnpj_cpf: "",
  codigo_pais: "",
  cidade: "",
  endereco: "",
  endereco_numero: "",
  complemento: "",
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
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [, startTransition] = useTransition();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function close() {
    if (loading) return;
    setOpen(false);
    setForm(emptyForm);
    setError(null);
    setSubmitAttempted(false);
  }

  // Quando o usuário escolhe um tipo de PIX que casa com um documento já
  // informado (CPF/CNPJ), pré-preenche a chave automaticamente.
  const pixTypeOption = useMemo(
    () => PIX_KEY_TYPES.find((p) => p.value === form.pix_key_type) ?? null,
    [form.pix_key_type],
  );

  // Marcar um método como padrão significa que o CSC vai pagar por ele sem
  // perguntar nada — então os dados daquele método passam a ser obrigatórios.
  const pixMissing = useMemo(() => {
    if (!form.pix_padrao) return [] as string[];
    const missing: string[] = [];
    if (!form.pix_key_type) missing.push("Tipo");
    if (!form.chave_pix.trim()) missing.push("Chave");
    return missing;
  }, [form.pix_padrao, form.pix_key_type, form.chave_pix]);

  const bankMissing = useMemo(() => {
    if (!form.transf_padrao) return [] as string[];
    const missing: string[] = [];
    if (!form.banco) missing.push("Banco");
    if (!form.agencia.trim()) missing.push("Agência");
    if (!form.conta_corrente.trim()) missing.push("Conta corrente");
    if (!form.titular_banco.trim()) missing.push("Titular da conta");
    if (!form.doc_titular.trim()) missing.push("CPF/CNPJ do titular");
    return missing;
  }, [
    form.transf_padrao,
    form.banco,
    form.agencia,
    form.conta_corrente,
    form.titular_banco,
    form.doc_titular,
  ]);

  // Só pinta o campo de vermelho depois que o usuário tentou salvar.
  function invalidCls(isMissing: boolean) {
    return submitAttempted && isMissing ? ` ${INVALID_CLS}` : "";
  }

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
    setSubmitAttempted(true);
    if (!form.name.trim()) {
      setError("Informe o nome do fornecedor.");
      return;
    }
    if (form.estrangeiro) {
      // Estrangeiro: País é obrigatório; CNPJ/CPF não é exigido. O Estado é
      // sempre "EX - Exterior" (a Omie exige isso para cadastros do exterior).
      if (!form.codigo_pais) {
        setError("Selecione o País do fornecedor estrangeiro.");
        return;
      }
    } else if (!form.cnpj_cpf.trim()) {
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
    if (pixMissing.length) {
      setError(
        `Para usar o PIX como método de pagamento padrão, preencha: ${pixMissing.join(", ")}.`,
      );
      return;
    }
    if (bankMissing.length) {
      setError(
        `Para usar a transferência como método de pagamento padrão, preencha: ${bankMissing.join(", ")}.`,
      );
      return;
    }
    setLoading(true);
    const paisNome = form.estrangeiro
      ? PAISES_EXTERIOR.find((p) => p.codigo === form.codigo_pais)?.nome
      : undefined;
    const result = await createSupplier({
      name: form.name,
      cnpj_cpf: form.estrangeiro ? undefined : form.cnpj_cpf || undefined,
      estrangeiro: form.estrangeiro || undefined,
      pais: form.estrangeiro ? paisNome : undefined,
      codigo_pais: form.estrangeiro ? form.codigo_pais || undefined : undefined,
      estado: form.estrangeiro ? ESTADO_EXTERIOR : undefined,
      cidade: form.estrangeiro ? form.cidade || undefined : undefined,
      endereco: form.estrangeiro ? form.endereco || undefined : undefined,
      endereco_numero: form.estrangeiro ? form.endereco_numero || undefined : undefined,
      complemento: form.estrangeiro ? form.complemento || undefined : undefined,
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
    setSubmitAttempted(false);
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
                  <div className="space-y-3 p-4">
                    <label className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2.5 text-sm">
                      <input
                        type="checkbox"
                        checked={form.estrangeiro}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          update("estrangeiro", checked);
                          // Estrangeiro é sempre PJ e não tem CNPJ/CPF brasileiro.
                          if (checked) {
                            update("personType", "pj");
                            update("cnpj_cpf", "");
                          }
                        }}
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>
                        <Globe className="mr-1 inline h-3.5 w-3.5 text-primary" />
                        <strong>Fornecedor estrangeiro</strong> (sem CNPJ/CPF)
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Plataformas/serviços internacionais. Exige País e Estado; o cadastro
                          vai para a Omie como “Estrangeiro” (Estado {ESTADO_EXTERIOR_LABEL}).
                        </span>
                      </span>
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={form.estrangeiro}
                        onClick={() => {
                          update("personType", "pj");
                          // Reseta documento ao trocar tipo pra não ficar mascarado errado
                          if (form.cnpj_cpf) update("cnpj_cpf", "");
                        }}
                        className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          form.personType === "pj" && !form.estrangeiro
                            ? "border-primary bg-primary/10 text-primary"
                            : "hover:bg-muted"
                        }`}
                      >
                        <Building2 className="h-4 w-4" />
                        Pessoa Jurídica
                      </button>
                      <button
                        type="button"
                        disabled={form.estrangeiro}
                        onClick={() => {
                          update("personType", "pf");
                          if (form.cnpj_cpf) update("cnpj_cpf", "");
                        }}
                        className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          form.personType === "pf" && !form.estrangeiro
                            ? "border-primary bg-primary/10 text-primary"
                            : "hover:bg-muted"
                        }`}
                      >
                        <User className="h-4 w-4" />
                        Pessoa Física
                      </button>
                    </div>
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
                        {form.estrangeiro
                          ? "Razão Social / Nome Completo"
                          : form.personType === "pj"
                            ? "Razão Social"
                            : "Nome Completo"}{" "}
                        <span className="text-destructive">*</span>
                      </label>
                      <input
                        id="new-supplier-name"
                        type="text"
                        required
                        autoFocus
                        maxLength={60}
                        value={form.name}
                        onChange={(e) => update("name", e.target.value.toUpperCase().slice(0, 60))}
                        placeholder={
                          form.estrangeiro
                            ? "Ex: OPENAI, LLC"
                            : form.personType === "pj"
                              ? "Ex: ACME SERVIÇOS LTDA"
                              : "Ex: JOÃO DA SILVA"
                        }
                        className={INPUT_CLS}
                      />
                      <p className="text-right text-xs text-muted-foreground">
                        {form.name.length}/60 — limite do Omie
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-cnpj" className={LABEL_CLS}>
                        {form.estrangeiro ? "CNPJ/CPF" : form.personType === "pj" ? "CNPJ" : "CPF"}{" "}
                        {!form.estrangeiro && <span className="text-destructive">*</span>}
                      </label>
                      {form.estrangeiro ? (
                        <input
                          id="new-supplier-cnpj"
                          type="text"
                          disabled
                          value="Estrangeiro"
                          className={`${INPUT_CLS} font-mono italic text-muted-foreground disabled:opacity-100`}
                        />
                      ) : (
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
                      )}
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

                {/* Endereço internacional — só para fornecedor estrangeiro */}
                {form.estrangeiro && (
                  <section className="rounded-lg border bg-background shadow-sm">
                    <header className="flex items-center gap-2 border-b px-4 py-2.5">
                      <MapPin className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold">Endereço internacional</h3>
                    </header>
                    <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label htmlFor="new-supplier-pais" className={LABEL_CLS}>
                          País <span className="text-destructive">*</span>
                        </label>
                        <select
                          id="new-supplier-pais"
                          value={form.codigo_pais}
                          onChange={(e) => update("codigo_pais", e.target.value)}
                          className={INPUT_CLS}
                        >
                          <option value="">Selecione o país</option>
                          {PAISES_EXTERIOR.map((p) => (
                            <option key={p.codigo} value={p.codigo}>
                              {p.nome}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="new-supplier-estado" className={LABEL_CLS}>
                          Estado <span className="text-destructive">*</span>
                        </label>
                        <input
                          id="new-supplier-estado"
                          type="text"
                          disabled
                          value={ESTADO_EXTERIOR_LABEL}
                          className={`${INPUT_CLS} disabled:opacity-100`}
                        />
                        <p className="text-xs text-muted-foreground">
                          A Omie usa “{ESTADO_EXTERIOR_LABEL}” para todo cadastro do exterior.
                        </p>
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <label htmlFor="new-supplier-cidade" className={LABEL_CLS}>Cidade</label>
                        <input
                          id="new-supplier-cidade"
                          type="text"
                          value={form.cidade}
                          onChange={(e) => update("cidade", e.target.value)}
                          placeholder="Ex: San Francisco"
                          className={INPUT_CLS}
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <label htmlFor="new-supplier-endereco" className={LABEL_CLS}>Endereço</label>
                        <input
                          id="new-supplier-endereco"
                          type="text"
                          value={form.endereco}
                          onChange={(e) => update("endereco", e.target.value)}
                          placeholder="Ex: Market Street"
                          className={INPUT_CLS}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="new-supplier-numero" className={LABEL_CLS}>Número</label>
                        <input
                          id="new-supplier-numero"
                          type="text"
                          value={form.endereco_numero}
                          onChange={(e) => update("endereco_numero", e.target.value)}
                          placeholder="Ex: 548"
                          className={INPUT_CLS}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="new-supplier-complemento" className={LABEL_CLS}>Complemento</label>
                        <input
                          id="new-supplier-complemento"
                          type="text"
                          value={form.complemento}
                          onChange={(e) => update("complemento", e.target.value)}
                          placeholder="Ex: 97273"
                          className={INPUT_CLS}
                        />
                      </div>
                    </div>
                  </section>
                )}

                {/* PIX */}
                <section className="rounded-lg border bg-background shadow-sm">
                  <header className="flex items-center gap-2 border-b px-4 py-2.5">
                    <KeyRound className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Chave PIX</h3>
                    <span
                      className={`ml-auto text-xs ${
                        form.pix_padrao ? "font-medium text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {form.pix_padrao ? "obrigatório" : "opcional"}
                    </span>
                  </header>
                  <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[180px_1fr]">
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-pix-type" className={LABEL_CLS}>
                        Tipo {form.pix_padrao && <span className="text-destructive">*</span>}
                      </label>
                      <select
                        id="new-supplier-pix-type"
                        value={form.pix_key_type}
                        onChange={(e) => applyPixTypeAutoFill(e.target.value as PixKeyType)}
                        required={form.pix_padrao}
                        className={`${INPUT_CLS}${invalidCls(pixMissing.includes("Tipo"))}`}
                      >
                        <option value="">Selecione</option>
                        {PIX_KEY_TYPES.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-pix" className={LABEL_CLS}>
                        Chave {form.pix_padrao && <span className="text-destructive">*</span>}
                      </label>
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
                        required={form.pix_padrao}
                        className={`${INPUT_CLS} font-mono disabled:opacity-60${invalidCls(
                          pixMissing.includes("Chave"),
                        )}`}
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
                        className="h-4 w-4"
                      />
                      Usar PIX como método de pagamento padrão
                    </label>
                    {form.pix_padrao && pixMissing.length > 0 && (
                      <p className="text-xs text-destructive sm:col-span-2">
                        Preencha {pixMissing.join(" e ")} para usar o PIX como método padrão.
                      </p>
                    )}
                  </div>
                </section>

                {/* Conta bancária */}
                <section className="rounded-lg border bg-background shadow-sm">
                  <header className="flex items-center gap-2 border-b px-4 py-2.5">
                    <Banknote className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Conta bancária (transferência)</h3>
                    <span
                      className={`ml-auto text-xs ${
                        form.transf_padrao ? "font-medium text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {form.transf_padrao ? "obrigatório" : "opcional"}
                    </span>
                  </header>
                  <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <label htmlFor="new-supplier-banco" className={LABEL_CLS}>
                        Banco {form.transf_padrao && <span className="text-destructive">*</span>}
                      </label>
                      <select
                        id="new-supplier-banco"
                        value={form.banco}
                        onChange={(e) => update("banco", e.target.value)}
                        required={form.transf_padrao}
                        className={`${INPUT_CLS}${invalidCls(bankMissing.includes("Banco"))}`}
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
                      <label htmlFor="new-supplier-agencia" className={LABEL_CLS}>
                        Agência {form.transf_padrao && <span className="text-destructive">*</span>}
                      </label>
                      <input
                        id="new-supplier-agencia"
                        type="text"
                        value={form.agencia}
                        onChange={(e) => update("agencia", e.target.value)}
                        placeholder="0000"
                        required={form.transf_padrao}
                        className={`${INPUT_CLS} font-mono${invalidCls(
                          bankMissing.includes("Agência"),
                        )}`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-conta" className={LABEL_CLS}>
                        Conta corrente{" "}
                        {form.transf_padrao && <span className="text-destructive">*</span>}
                      </label>
                      <input
                        id="new-supplier-conta"
                        type="text"
                        value={form.conta_corrente}
                        onChange={(e) => update("conta_corrente", e.target.value)}
                        placeholder="00000-0"
                        required={form.transf_padrao}
                        className={`${INPUT_CLS} font-mono${invalidCls(
                          bankMissing.includes("Conta corrente"),
                        )}`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-titular" className={LABEL_CLS}>
                        Titular da conta{" "}
                        {form.transf_padrao && <span className="text-destructive">*</span>}
                      </label>
                      <input
                        id="new-supplier-titular"
                        type="text"
                        value={form.titular_banco}
                        onChange={(e) => update("titular_banco", e.target.value)}
                        placeholder="Nome do titular"
                        required={form.transf_padrao}
                        className={`${INPUT_CLS}${invalidCls(
                          bankMissing.includes("Titular da conta"),
                        )}`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-supplier-doc-titular" className={LABEL_CLS}>
                        CPF/CNPJ do titular{" "}
                        {form.transf_padrao && <span className="text-destructive">*</span>}
                      </label>
                      <input
                        id="new-supplier-doc-titular"
                        type="text"
                        value={form.doc_titular}
                        onChange={(e) => update("doc_titular", e.target.value)}
                        placeholder={
                          form.transf_padrao
                            ? "CPF/CNPJ de quem recebe a transferência"
                            : "Se diferente do CPF/CNPJ do fornecedor"
                        }
                        required={form.transf_padrao}
                        className={`${INPUT_CLS} font-mono${invalidCls(
                          bankMissing.includes("CPF/CNPJ do titular"),
                        )}`}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={form.transf_padrao}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          update("transf_padrao", checked);
                          // Na maioria dos casos a conta é do próprio fornecedor —
                          // pré-preenche titular/documento pra não digitar de novo.
                          if (checked) {
                            if (!form.titular_banco.trim() && form.name.trim()) {
                              update("titular_banco", form.name.trim());
                            }
                            if (!form.doc_titular.trim() && form.cnpj_cpf.trim()) {
                              update("doc_titular", form.cnpj_cpf.trim());
                            }
                          }
                        }}
                        className="h-4 w-4"
                      />
                      Usar transferência como método de pagamento padrão
                    </label>
                    {form.transf_padrao && bankMissing.length > 0 && (
                      <p className="text-xs text-destructive sm:col-span-2">
                        Preencha {bankMissing.join(", ")} para usar a transferência como método
                        padrão.
                      </p>
                    )}
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
