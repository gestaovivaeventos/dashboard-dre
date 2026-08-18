"use client";

import { Banknote, Building2, Contact, Globe, KeyRound, Loader2, MapPin, Paperclip, Plus, Tags, User, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { ExpenseTypePicker } from "@/components/ctrl/expense-type-picker";
import { createSupplier } from "@/lib/ctrl/actions/suppliers";
import { MAX_ATTACHMENT_SIZE, uploadCtrlAttachment } from "@/lib/ctrl/attachment-upload";
import { BANCOS_BR, PIX_KEY_TYPES, formatBanco, normalizePixTelefone, type PixKeyType } from "@/lib/ctrl/bancos";
import { CNPJ_LENGTH, CPF_LENGTH, cnpjIsComplete, maskCnpj } from "@/lib/ctrl/cnpj";
import {
  UFS_BR,
  cepDigits,
  enderecoMissing,
  lookupCep,
  maskCep,
} from "@/lib/ctrl/endereco";
import { omieNameError } from "@/lib/ctrl/supplier-name";
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
  nome_fantasia: string;
  cnpj_cpf: string;
  // País só é usado quando estrangeiro; os demais campos de endereço valem
  // para os dois fluxos (a Omie exige endereço em qualquer cadastro).
  codigo_pais: string;
  cep: string;
  cidade: string;
  estado: string;
  endereco: string;
  endereco_numero: string;
  bairro: string;
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
  // Sub-tipo da transferência padrão: "corrente" ou "poupanca". Só relevante
  // quando transf_padrao=true; define a finalidade no lançamento em contas a pagar.
  transf_tipo_conta: "" | "corrente" | "poupanca";
  pix_padrao: boolean;
}

const emptyForm: FormState = {
  personType: "pj",
  estrangeiro: false,
  name: "",
  nome_fantasia: "",
  cnpj_cpf: "",
  codigo_pais: "",
  cep: "",
  cidade: "",
  estado: "",
  endereco: "",
  endereco_numero: "",
  bairro: "",
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
  transf_tipo_conta: "",
  pix_padrao: false,
};

// Light masks — apenas pra ajudar visualmente. Não bloqueia input livre.
// PJ usa o CNPJ alfanumérico (letras + números nas 12 primeiras posições); PF
// segue 100% numérico.
function maskCpfCnpj(value: string, type: PersonType): string {
  if (type === "pj") return maskCnpj(value);
  return value
    .replace(/\D/g, "")
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  }
  return digits.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
}

export function CriarFornecedorButton({
  expenseTypes = [],
}: {
  expenseTypes?: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [selectedExpenseTypes, setSelectedExpenseTypes] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [cepMsg, setCepMsg] = useState<string | null>(null);
  // Guarda o último CEP pedido: se o usuário continuar digitando, a resposta
  // de uma busca antiga não pode sobrescrever o endereço da busca nova.
  const cepRequestRef = useRef("");
  const [, startTransition] = useTransition();

  // ── Anexos (opcional) ──────────────────────────────────────────────────────
  // Documentos de apoio ao cadastro — contrato social, cartão CNPJ, proposta,
  // comprovante de conta bancária. Nada aqui é obrigatório: o usuário anexa se
  // julgar necessário, e quem homologa vê os arquivos na tela de Fornecedores.
  // Cada arquivo já sobe ao bucket no momento em que é escolhido; o submit só
  // reaproveita os paths.
  const [attachments, setAttachments] = useState<Array<{ file: File; path: string }>>([]);
  const [attachUploading, setAttachUploading] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);

  async function addAttachments(files: FileList | null) {
    setAttachError(null);
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    const tooBig = picked.find((f) => f.size > MAX_ATTACHMENT_SIZE);
    if (tooBig) {
      setAttachError(`"${tooBig.name}" excede o limite de 10 MB.`);
      if (attachInputRef.current) attachInputRef.current.value = "";
      return;
    }
    setAttachUploading(true);
    try {
      const uploaded: Array<{ file: File; path: string }> = [];
      for (const file of picked) {
        uploaded.push({ file, path: await uploadCtrlAttachment(file) });
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setAttachError(`Falha ao enviar o anexo: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAttachUploading(false);
      if (attachInputRef.current) attachInputRef.current.value = "";
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Mesma mecânica da tela da Omie: informado o CEP, o endereço vem sozinho e
  // o usuário só completa número e complemento. Falha na busca não trava nada
  // — os campos continuam editáveis.
  async function handleCepChange(raw: string) {
    const masked = maskCep(raw);
    update("cep", masked);
    setCepMsg(null);
    const digits = cepDigits(masked);
    cepRequestRef.current = digits;
    if (digits.length !== 8) return;
    setCepLoading(true);
    const found = await lookupCep(digits);
    if (cepRequestRef.current !== digits) return; // resposta obsoleta
    setCepLoading(false);
    if (!found) {
      setCepMsg("CEP não encontrado — preencha o endereço manualmente.");
      return;
    }
    setForm((prev) => ({
      ...prev,
      endereco: found.endereco || prev.endereco,
      bairro: found.bairro || prev.bairro,
      cidade: found.cidade || prev.cidade,
      estado: found.estado || prev.estado,
      complemento: prev.complemento || found.complemento,
    }));
  }

  function toggleExpenseType(id: string) {
    setSelectedExpenseTypes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function close() {
    if (loading) return;
    setOpen(false);
    setForm(emptyForm);
    setSelectedExpenseTypes(new Set());
    setAttachments([]);
    setAttachError(null);
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

  // Endereço é obrigatório no cadastro da Omie — sem ele o fornecedor não é
  // aceito lá. Estrangeiro segue a regra própria (País + endereço livre).
  const enderecoFaltando = useMemo(() => {
    if (form.estrangeiro) return [] as string[];
    return enderecoMissing({
      cep: form.cep,
      endereco: form.endereco,
      endereco_numero: form.endereco_numero,
      bairro: form.bairro,
      cidade: form.cidade,
      estado: form.estado,
    });
  }, [
    form.estrangeiro,
    form.cep,
    form.endereco,
    form.endereco_numero,
    form.bairro,
    form.cidade,
    form.estado,
  ]);

  // Documento incompleto: CNPJ < 14 caracteres (alfanumérico) ou CPF < 11
  // dígitos. Não vale para estrangeiro (que não tem documento) nem para o campo
  // vazio (tratado como "obrigatório", não como "incompleto").
  const docIncompleto = useMemo(() => {
    if (form.estrangeiro || !form.cnpj_cpf.trim()) return false;
    return form.personType === "pj"
      ? !cnpjIsComplete(form.cnpj_cpf)
      : form.cnpj_cpf.replace(/\D/g, "").length < CPF_LENGTH;
  }, [form.estrangeiro, form.cnpj_cpf, form.personType]);

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
    if (!form.nome_fantasia.trim()) {
      setError("Informe o nome fantasia do fornecedor.");
      return;
    }
    // A Omie não aceita acento nem cedilha na razão social/nome fantasia.
    const nameError = omieNameError(form.name) ?? omieNameError(form.nome_fantasia);
    if (nameError) {
      setError(nameError);
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
    } else if (form.personType === "pj" && !cnpjIsComplete(form.cnpj_cpf)) {
      // CNPJ (numérico ou alfanumérico) tem 14 posições — bloqueia se vier menor.
      setError(
        `O CNPJ informado contém menos de ${CNPJ_LENGTH} caracteres, abaixo do mínimo. Confira e complete o número antes de continuar.`,
      );
      return;
    } else if (form.personType === "pf" && form.cnpj_cpf.replace(/\D/g, "").length < CPF_LENGTH) {
      setError(
        `O CPF informado contém menos de ${CPF_LENGTH} dígitos, abaixo do mínimo. Confira e complete o número antes de continuar.`,
      );
      return;
    }
    if (enderecoFaltando.length) {
      setError(
        `A Omie exige o endereço completo do fornecedor. Preencha: ${enderecoFaltando.join(", ")}.`,
      );
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
      nome_fantasia: form.nome_fantasia || undefined,
      cnpj_cpf: form.estrangeiro ? undefined : form.cnpj_cpf || undefined,
      estrangeiro: form.estrangeiro || undefined,
      pais: form.estrangeiro ? paisNome : undefined,
      codigo_pais: form.estrangeiro ? form.codigo_pais || undefined : undefined,
      // Endereço: o estrangeiro vai com estado "EX" (exigência da Omie) e sem
      // CEP/bairro brasileiros; o nacional vai completo.
      estado: form.estrangeiro ? ESTADO_EXTERIOR : form.estado || undefined,
      cep: form.estrangeiro ? undefined : form.cep || undefined,
      bairro: form.estrangeiro ? undefined : form.bairro || undefined,
      cidade: form.cidade || undefined,
      endereco: form.endereco || undefined,
      endereco_numero: form.endereco_numero || undefined,
      complemento: form.complemento || undefined,
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
      transf_tipo_conta: form.transf_padrao ? form.transf_tipo_conta || "corrente" : undefined,
      pix_padrao: form.pix_padrao,
      expenseTypeIds: Array.from(selectedExpenseTypes),
      attachmentPaths: attachments.map((a) => a.path),
    });
    setLoading(false);
    if ("error" in result && result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setForm(emptyForm);
    setSelectedExpenseTypes(new Set());
    setAttachments([]);
    setAttachError(null);
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
                    <div className="space-y-1.5 sm:col-span-2">
                      <label htmlFor="new-supplier-nome-fantasia" className={LABEL_CLS}>
                        Nome Fantasia <span className="text-destructive">*</span>
                      </label>
                      <input
                        id="new-supplier-nome-fantasia"
                        type="text"
                        required
                        maxLength={60}
                        value={form.nome_fantasia}
                        onChange={(e) =>
                          update("nome_fantasia", e.target.value.toUpperCase().slice(0, 60))
                        }
                        placeholder="Ex: ACME"
                        className={INPUT_CLS}
                      />
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
                        <>
                          <input
                            id="new-supplier-cnpj"
                            type="text"
                            required
                            value={form.cnpj_cpf}
                            onChange={(e) =>
                              update("cnpj_cpf", maskCpfCnpj(e.target.value, form.personType))
                            }
                            placeholder={form.personType === "pj" ? "00.000.000/0000-00" : "000.000.000-00"}
                            className={`${INPUT_CLS} font-mono${invalidCls(docIncompleto)}`}
                          />
                          {form.personType === "pj" && (
                            <p className="text-xs text-muted-foreground">
                              Aceita o novo CNPJ alfanumérico (letras e números). São 14 caracteres.
                            </p>
                          )}
                          {submitAttempted && docIncompleto && (
                            <p className="text-xs text-destructive">
                              {form.personType === "pj"
                                ? `CNPJ incompleto — são ${CNPJ_LENGTH} caracteres.`
                                : `CPF incompleto — são ${CPF_LENGTH} dígitos.`}
                            </p>
                          )}
                        </>
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

                {/* Endereço (Brasil) — obrigatório: a Omie não cadastra o
                    fornecedor sem ele. Estrangeiro usa a seção abaixo. */}
                {!form.estrangeiro && (
                  <section className="rounded-lg border bg-background shadow-sm">
                    <header className="flex items-center gap-2 border-b px-4 py-2.5">
                      <MapPin className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold">Endereço</h3>
                      <span className="ml-auto text-xs font-medium text-destructive">
                        obrigatório
                      </span>
                    </header>
                    <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        Informe o CEP e o número — o restante do endereço é
                        preenchido automaticamente. A Omie exige esses dados para
                        cadastrar o fornecedor.
                      </p>
                      <div className="space-y-1.5">
                        <label htmlFor="new-supplier-cep" className={LABEL_CLS}>
                          CEP <span className="text-destructive">*</span>
                        </label>
                        <div className="relative">
                          <input
                            id="new-supplier-cep"
                            type="text"
                            inputMode="numeric"
                            required
                            value={form.cep}
                            onChange={(e) => handleCepChange(e.target.value)}
                            placeholder="00000-000"
                            className={`${INPUT_CLS} font-mono${invalidCls(
                              enderecoFaltando.includes("CEP"),
                            )}`}
                          />
                          {cepLoading && (
                            <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                          )}
                        </div>
                        {cepMsg && <p className="text-xs text-amber-600">{cepMsg}</p>}
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="new-supplier-endereco-numero" className={LABEL_CLS}>
                          Número <span className="text-destructive">*</span>
                        </label>
                        <input
                          id="new-supplier-endereco-numero"
                          type="text"
                          required
                          value={form.endereco_numero}
                          onChange={(e) => update("endereco_numero", e.target.value)}
                          placeholder="Ex: 115"
                          className={`${INPUT_CLS}${invalidCls(
                            enderecoFaltando.includes("Número"),
                          )}`}
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <label htmlFor="new-supplier-endereco-br" className={LABEL_CLS}>
                          Endereço <span className="text-destructive">*</span>
                        </label>
                        <input
                          id="new-supplier-endereco-br"
                          type="text"
                          required
                          value={form.endereco}
                          onChange={(e) => update("endereco", e.target.value)}
                          placeholder="Ex: RUA ALMIRANTE BARROSO"
                          className={`${INPUT_CLS}${invalidCls(
                            enderecoFaltando.includes("Endereço"),
                          )}`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="new-supplier-bairro" className={LABEL_CLS}>
                          Bairro <span className="text-destructive">*</span>
                        </label>
                        <input
                          id="new-supplier-bairro"
                          type="text"
                          required
                          value={form.bairro}
                          onChange={(e) => update("bairro", e.target.value)}
                          placeholder="Ex: PAINEIRAS"
                          className={`${INPUT_CLS}${invalidCls(
                            enderecoFaltando.includes("Bairro"),
                          )}`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="new-supplier-complemento-br" className={LABEL_CLS}>
                          Complemento
                        </label>
                        <input
                          id="new-supplier-complemento-br"
                          type="text"
                          value={form.complemento}
                          onChange={(e) => update("complemento", e.target.value)}
                          placeholder="Ex: APT 101"
                          className={INPUT_CLS}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="new-supplier-cidade-br" className={LABEL_CLS}>
                          Cidade <span className="text-destructive">*</span>
                        </label>
                        <input
                          id="new-supplier-cidade-br"
                          type="text"
                          required
                          value={form.cidade}
                          onChange={(e) => update("cidade", e.target.value)}
                          placeholder="Ex: Juiz de Fora"
                          className={`${INPUT_CLS}${invalidCls(
                            enderecoFaltando.includes("Cidade"),
                          )}`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="new-supplier-estado-br" className={LABEL_CLS}>
                          Estado (UF) <span className="text-destructive">*</span>
                        </label>
                        <select
                          id="new-supplier-estado-br"
                          value={form.estado}
                          onChange={(e) => update("estado", e.target.value)}
                          required
                          className={`${INPUT_CLS}${invalidCls(
                            enderecoFaltando.includes("Estado"),
                          )}`}
                        >
                          <option value="">Selecione</option>
                          {UFS_BR.map((uf) => (
                            <option key={uf} value={uf}>
                              {uf}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </section>
                )}

                {/* Tipos de despesa — pré-seleção que já vem marcada na aprovação */}
                <section className="rounded-lg border bg-background shadow-sm">
                  <header className="flex items-center gap-2 border-b px-4 py-2.5">
                    <Tags className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Tipos de despesa</h3>
                  </header>
                  <div className="p-4">
                    <p className="mb-3 text-xs text-muted-foreground">
                      Vincule os tipos de despesa deste fornecedor. A seleção já virá marcada
                      na hora da aprovação (o aprovador ainda pode ajustar).
                    </p>
                    <ExpenseTypePicker
                      idPrefix="new-supplier"
                      options={expenseTypes}
                      selected={selectedExpenseTypes}
                      onToggle={toggleExpenseType}
                      onClear={() => setSelectedExpenseTypes(new Set())}
                    />
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
                        checked={form.transf_padrao && form.transf_tipo_conta === "corrente"}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          // Mutuamente exclusivo com "Conta Poupança".
                          update("transf_padrao", checked);
                          update("transf_tipo_conta", checked ? "corrente" : "");
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
                      Usar transferência como método de pagamento padrão - Conta Corrente
                    </label>
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={form.transf_padrao && form.transf_tipo_conta === "poupanca"}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          // Mutuamente exclusivo com "Conta Corrente".
                          update("transf_padrao", checked);
                          update("transf_tipo_conta", checked ? "poupanca" : "");
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
                      Usar transferência como método de pagamento padrão - Conta Poupança
                    </label>
                    {form.transf_padrao && bankMissing.length > 0 && (
                      <p className="text-xs text-destructive sm:col-span-2">
                        Preencha {bankMissing.join(", ")} para usar a transferência como método
                        padrão.
                      </p>
                    )}
                  </div>
                </section>

                {/* Anexos — opcional. Documentos de apoio à homologação. */}
                <section className="rounded-lg border bg-background shadow-sm">
                  <header className="flex items-center gap-2 border-b px-4 py-2.5">
                    <Paperclip className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Anexos</h3>
                    <span className="ml-auto text-xs text-muted-foreground">opcional</span>
                  </header>
                  <div className="space-y-3 p-4">
                    <p className="text-xs text-muted-foreground">
                      Anexe documentos de apoio se julgar necessário — contrato social,
                      cartão CNPJ, proposta, comprovante da conta bancária. Ficam
                      disponíveis na tela de Fornecedores para quem homologa o cadastro.
                      Até 10 MB por arquivo.
                    </p>
                    <input
                      ref={attachInputRef}
                      id="new-supplier-attachments"
                      type="file"
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
                      onChange={(e) => addAttachments(e.target.files)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => attachInputRef.current?.click()}
                      disabled={attachUploading}
                      className="inline-flex items-center gap-2 rounded-md border border-dashed px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      {attachUploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Paperclip className="h-4 w-4" />
                      )}
                      {attachUploading ? "Enviando…" : "Adicionar anexos"}
                    </button>
                    {attachments.length > 0 && (
                      <ul className="space-y-2">
                        {attachments.map((att, i) => (
                          <li
                            key={`${att.path}-${i}`}
                            className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2"
                          >
                            <div className="flex min-w-0 items-center gap-2 text-sm">
                              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="truncate">{att.file.name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                ({(att.file.size / 1024 / 1024).toFixed(2)} MB)
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeAttachment(i)}
                              className="shrink-0 text-muted-foreground hover:text-destructive"
                              aria-label={`Remover ${att.file.name}`}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {attachError && <p className="text-xs text-destructive">{attachError}</p>}
                    <p className="text-xs text-muted-foreground">
                      Formatos: PDF, JPG, PNG, DOC, XLS.
                    </p>
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
                  disabled={loading || attachUploading}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {loading ? "Criando…" : attachUploading ? "Enviando anexo…" : "Criar (Pendente)"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
