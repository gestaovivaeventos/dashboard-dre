"use client";

import { PIX_TIPOS, formatPixForOmie, type PixTipo } from "@/lib/case/pix";
import type { CaseBandInput, CaseBandRow } from "@/lib/case/types";

const INPUT_CLS =
  "h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-amber-500/40";
const LABEL_CLS = "block text-xs font-medium text-ink-secondary mb-1";

/** Estado do cadastro de um fornecedor/atração, em 3 grupos. */
export interface BandCadastro {
  // Dados do fornecedor
  name: string;
  doc: string;
  email: string;
  phone: string;
  // Dados do favorecido (titular da conta)
  titular: string;
  docTitular: string;
  // Dados bancários
  banco: string;
  agencia: string;
  conta: string;
  pixTipo: PixTipo | "";
  pix: string;
}

export function emptyBandCadastro(): BandCadastro {
  return { name: "", doc: "", email: "", phone: "", titular: "", docTitular: "", banco: "", agencia: "", conta: "", pixTipo: "", pix: "" };
}

/** Preenche o cadastro a partir de um cadastro existente (case_bands). */
export function bandRowToCadastro(b: CaseBandRow): BandCadastro {
  return {
    name: b.name ?? "",
    doc: b.cnpj_cpf ?? "",
    email: b.email ?? "",
    phone: b.phone ?? "",
    titular: b.titular_banco ?? "",
    docTitular: b.doc_titular ?? "",
    banco: b.banco ?? "",
    agencia: b.agencia ?? "",
    conta: b.conta_corrente ?? "",
    pixTipo: (b.chave_pix_tipo as PixTipo) || "",
    pix: b.chave_pix ?? "",
  };
}

/** Monta o CaseBandInput a partir do cadastro, formatando a chave PIX pro Omie. */
export function bandCadastroToInput(b: BandCadastro, id?: string | null): CaseBandInput {
  const onlyDigits = (s: string) => s.replace(/\D/g, "");
  return {
    ...(id ? { id } : {}),
    name: b.name.trim(),
    cnpj_cpf: b.doc.trim() || null,
    pessoa_fisica: onlyDigits(b.doc).length === 11,
    email: b.email.trim() || null,
    phone: b.phone.trim() || null,
    banco: b.banco.trim() || null,
    agencia: b.agencia.trim() || null,
    conta_corrente: b.conta.trim() || null,
    titular_banco: b.titular.trim() || null,
    doc_titular: b.docTitular.trim() || null,
    chave_pix: b.pix.trim() ? formatPixForOmie(b.pixTipo || null, b.pix) : null,
    chave_pix_tipo: b.pix.trim() ? (b.pixTipo || null) : null,
  };
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={INPUT_CLS} />
    </div>
  );
}

/**
 * Cadastro do fornecedor/atração em 3 grupos: fornecedor, favorecido e bancário.
 * A chave PIX pede o tipo e é formatada no padrão do Omie ao salvar.
 */
export function BandCadastroFields({ value, onChange }: { value: BandCadastro; onChange: (patch: Partial<BandCadastro>) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Dados do fornecedor</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nome / Razão social" value={value.name} onChange={(v) => onChange({ name: v })} />
          <Field label="CNPJ / CPF" value={value.doc} onChange={(v) => onChange({ doc: v })} />
          <Field label="E-mail" value={value.email} onChange={(v) => onChange({ email: v })} />
          <Field label="Telefone" value={value.phone} onChange={(v) => onChange({ phone: v })} />
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Dados do favorecido</div>
        <p className="mb-2 text-xs text-ink-muted">Titular da conta que vai receber (pode ser diferente do fornecedor).</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Titular da conta" value={value.titular} onChange={(v) => onChange({ titular: v })} placeholder="Deixe vazio para usar o fornecedor" />
          <Field label="CPF/CNPJ do titular" value={value.docTitular} onChange={(v) => onChange({ docTitular: v })} />
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Dados bancários</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Banco" value={value.banco} onChange={(v) => onChange({ banco: v })} />
          <Field label="Agência" value={value.agencia} onChange={(v) => onChange({ agencia: v })} />
          <Field label="Conta corrente" value={value.conta} onChange={(v) => onChange({ conta: v })} />
          <div className="hidden sm:block" />
          <div>
            <label className={LABEL_CLS}>Tipo da chave PIX</label>
            <select value={value.pixTipo} onChange={(e) => onChange({ pixTipo: e.target.value as PixTipo | "" })} className={INPUT_CLS}>
              <option value="">— selecione —</option>
              {PIX_TIPOS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <Field
            label="Chave PIX"
            value={value.pix}
            onChange={(v) => onChange({ pix: v })}
            placeholder={PIX_TIPOS.find((t) => t.value === value.pixTipo)?.placeholder ?? "selecione o tipo primeiro"}
          />
        </div>
      </div>
    </div>
  );
}
