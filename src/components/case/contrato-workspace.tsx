"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Upload, Loader2, ScanLine, FileSignature, PenLine, CheckCircle2, Circle, RefreshCw } from "lucide-react";

import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { salvarAtracao, gerarEnviarContrato, lancarNoOmie } from "@/lib/case/actions/stages";
import { extractArtistContract } from "@/lib/case/actions/ocr";
import { getContractAttachmentUrl, getSaleContractUrl, resendSignature } from "@/lib/case/actions/contracts";
import { resyncContract } from "@/lib/case/actions/contract-launch";
import type { ContractDetail, ContractTitleRow } from "@/lib/case/queries";
import type { CaseBandRow } from "@/lib/case/types";

const ATTACHMENT_BUCKET = "case-attachments";
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = (n: number) => `R$ ${fmt.format(n)}`;
const dateBR = (iso: string | null) => (iso ? new Date(iso.slice(0, 10) + "T00:00:00").toLocaleDateString("pt-BR") : "—");

const INPUT_CLS = "h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-amber-500/40";
const LABEL_CLS = "block text-xs font-medium text-ink-secondary mb-1";

function maskBRL(digits: string): string {
  const clean = digits.replace(/\D/g, "");
  return clean ? fmt.format(parseInt(clean, 10) / 100) : "";
}
function parseBRL(masked: string): number {
  const n = parseFloat(masked.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
const brlFromNumber = (n: number) => (n > 0 ? maskBRL(String(Math.round(n * 100))) : "");

interface ParcelaRow {
  vencimento: string;
  valorStr: string;
}

function StatusPill({ children, tone }: { children: React.ReactNode; tone: "ok" | "wait" | "err" | "muted" }) {
  const cls = {
    ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    wait: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    err: "bg-red-500/15 text-red-700 dark:text-red-300",
    muted: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  }[tone];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="text-ink-primary">{value}</div>
    </div>
  );
}

function TabButton({ active, done, label, onClick }: { active: boolean; done: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
        active ? "border-amber-600 text-ink-primary" : "border-transparent text-ink-muted hover:text-ink-secondary"
      }`}
    >
      {done ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4 text-ink-muted" />}
      {label}
    </button>
  );
}

export function ContratoWorkspace({ detail, bands }: { detail: ContractDetail; bands: CaseBandRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<"cliente" | "atracao">("cliente");
  const etapa2Done = detail.valor_artista > 0;
  const signed = Boolean(detail.signed_at);
  const refresh = () => startTransition(() => router.refresh());

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={() => router.push("/case/contratos")} className="text-sm text-ink-muted hover:text-ink-primary">← Contratos</button>
          <h1 className="mt-1 text-xl font-semibold text-ink-primary">Contrato #{detail.contract_number} — {detail.band.name}</h1>
          <p className="text-sm text-ink-muted">Cliente: {detail.client.name} · {detail.event_name ?? "evento"} · {dateBR(detail.event_date)}</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-ink-muted">Venda</div>
          <div className="text-lg font-semibold tabular-nums text-ink-primary">{brl(detail.total_venda)}</div>
        </div>
      </div>

      {/* Abas: Contrato Cliente / Contrato Atração */}
      <div>
        <div className="flex gap-1 border-b border-border">
          <TabButton active={tab === "cliente"} done={signed} label="Contrato Cliente" onClick={() => setTab("cliente")} />
          <TabButton active={tab === "atracao"} done={etapa2Done} label="Contrato Atração" onClick={() => setTab("atracao")} />
        </div>
        <div className="pt-4">
          {tab === "cliente" ? <ClienteTab detail={detail} signed={signed} onChange={refresh} /> : <AtracaoTab detail={detail} bands={bands} onChange={refresh} />}
        </div>
      </div>

      {/* Financeiro (sempre visível) */}
      <FinanceiroPanel detail={detail} signed={signed} onChange={refresh} />
    </div>
  );
}

// ── ABA: Contrato Cliente ────────────────────────────────────────────────────
function ClienteTab({ detail, signed, onChange }: { detail: ContractDetail; signed: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const sent = Boolean(detail.sent_for_signature_at);

  async function openSale() {
    const res = await getSaleContractUrl(detail.id);
    if ("error" in res) return alert(res.error);
    window.open(res.url, "_blank");
  }
  async function resend() {
    setBusy(true);
    const res = await resendSignature(detail.id);
    setBusy(false);
    alert("error" in res ? res.error : "Assinatura reenviada ao cliente.");
  }
  async function gerarEnviar() {
    setBusy(true);
    const res = await gerarEnviarContrato(detail.id);
    setBusy(false);
    if ("error" in res) return alert(res.error);
    if (res.warning) alert(res.warning);
    onChange();
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-primary">Contrato com o cliente</h2>
        {signed ? <StatusPill tone="ok">Assinado · {dateBR(detail.signed_at)}</StatusPill> : sent ? <StatusPill tone="wait">Aguardando assinatura</StatusPill> : <StatusPill tone="muted">Rascunho</StatusPill>}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <Info label="Atração" value={brl(detail.valor_atracao_cliente)} />
        <Info label="Rider" value={brl(detail.valor_rider)} />
        <Info label="Camarim" value={brl(detail.valor_camarim)} />
        <Info label="Extras" value={brl(detail.valor_extras)} />
        <Info label="Local" value={detail.local_name ?? "—"} />
        <Info label="Cidade" value={detail.local_city ?? "—"} />
        <Info label="Horário" value={detail.show_time ?? "—"} />
        <Info label="Passagem de som" value={detail.passagem_som ?? "—"} />
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {!signed && (
          <button onClick={gerarEnviar} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />} {sent ? "Gerar e reenviar" : "Gerar e enviar para assinatura"}
          </button>
        )}
        {detail.sale_contract_path && (
          <button onClick={openSale} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-2">
            <FileSignature className="h-4 w-4" /> Ver contrato (PDF)
          </button>
        )}
        {!signed && sent && (
          <button onClick={resend} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-2 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />} Reenviar assinatura
          </button>
        )}
        {detail.sign_url && !signed && (
          <a href={detail.sign_url} target="_blank" rel="noreferrer" className="text-xs text-amber-600 hover:underline">Link de assinatura</a>
        )}
      </div>
    </section>
  );
}

// ── ABA: Contrato Atração (pagamento ao artista) ─────────────────────────────
function AtracaoTab({ detail, bands, onChange }: { detail: ContractDetail; bands: CaseBandRow[]; onChange: () => void }) {
  const launched = detail.titles.some((t) => t.status === "lancado");
  const pagarTitles = detail.titles.filter((t) => t.leg === "pagar_custodia").sort((a, b) => a.parcela_numero - b.parcela_numero);
  const [bandMode, setBandMode] = useState<"existing" | "new">(detail.band_id || bands.length ? "existing" : "new");
  const [bandId, setBandId] = useState<string>(detail.band_id ?? bands[0]?.id ?? "");
  const [bName, setBName] = useState("");
  const [bDoc, setBDoc] = useState("");
  const [bEmail, setBEmail] = useState("");
  const [bPhone, setBPhone] = useState("");
  const [bBanco, setBBanco] = useState("");
  const [bAgencia, setBAgencia] = useState("");
  const [bConta, setBConta] = useState("");
  const [bTitular, setBTitular] = useState("");
  const [bDocTitular, setBDocTitular] = useState("");
  const [bPix, setBPix] = useState("");
  const [attachmentPath, setAttachmentPath] = useState<string | null>(detail.attachment_path);
  const [attachmentName, setAttachmentName] = useState<string>(detail.attachment_path ? "Contrato anexado" : "");
  const [uploading, setUploading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [vArtista, setVArtista] = useState(detail.valor_artista > 0 ? brlFromNumber(detail.valor_artista) : "");
  const [parcelas, setParcelas] = useState<ParcelaRow[]>(
    pagarTitles.length > 0
      ? pagarTitles.map((t) => ({ vencimento: t.vencimento, valorStr: brlFromNumber(t.valor) }))
      : [{ vencimento: "", valorStr: "" }],
  );
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const valArtista = parseBRL(vArtista);
  const soma = parcelas.reduce((a, p) => a + parseBRL(p.valorStr), 0);
  const somaOk = Math.abs(soma - valArtista) < 0.005 && valArtista > 0;

  async function openAttachment() {
    const res = await getContractAttachmentUrl(detail.id);
    if ("error" in res) return alert(res.error);
    window.open(res.url, "_blank");
  }

  async function handleUpload(file: File) {
    setErr(null);
    if (file.size > MAX_ATTACHMENT_SIZE) return setErr("Arquivo maior que 10MB.");
    setUploading(true);
    try {
      const supabase = createSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return setErr("Sessão expirada.");
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const objectPath = `${user.id}/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(objectPath, file, { contentType: file.type, upsert: false });
      if (error) return setErr(`Falha no upload: ${error.message}`);
      setAttachmentPath(objectPath);
      setAttachmentName(file.name);
    } finally {
      setUploading(false);
    }
  }

  async function handleOcr() {
    if (!attachmentPath) return setErr("Suba o contrato do artista primeiro.");
    setErr(null);
    setMsg(null);
    setOcrLoading(true);
    const res = await extractArtistContract(attachmentPath);
    setOcrLoading(false);
    if ("error" in res) return setErr(res.error);
    const d = res.data;
    if (bandMode === "new" && d.bandName) { setBName(d.bandName); setBDoc(d.bandDoc ?? ""); }
    if (d.valorCache != null) setVArtista(brlFromNumber(d.valorCache));
    const ps = (d.parcelas ?? []).filter((p) => p.data && p.valor);
    if (ps.length) setParcelas(ps.map((p) => ({ vencimento: p.data!, valorStr: brlFromNumber(p.valor!) })));
    setMsg("Contrato lido. Revise a atração, o valor e as parcelas antes de salvar.");
  }

  function buildBandInput() {
    const sel = bands.find((b) => b.id === bandId);
    return bandMode === "existing" && sel
      ? {
          id: sel.id, name: sel.name, cnpj_cpf: sel.cnpj_cpf, pessoa_fisica: sel.pessoa_fisica, email: sel.email, phone: sel.phone,
          banco: sel.banco, agencia: sel.agencia, conta_corrente: sel.conta_corrente, titular_banco: sel.titular_banco, doc_titular: sel.doc_titular, chave_pix: sel.chave_pix,
        }
      : {
          name: bName.trim(), cnpj_cpf: bDoc.trim() || null, pessoa_fisica: bDoc.replace(/\D/g, "").length === 11,
          email: bEmail.trim() || null, phone: bPhone.trim() || null, banco: bBanco.trim() || null, agencia: bAgencia.trim() || null,
          conta_corrente: bConta.trim() || null, titular_banco: bTitular.trim() || null, doc_titular: bDocTitular.trim() || null, chave_pix: bPix.trim() || null,
        };
  }

  async function submit() {
    setErr(null);
    setMsg(null);
    if (bandMode === "existing" && !bandId) return setErr("Selecione a atração/artista.");
    if (bandMode === "new" && !bName.trim()) return setErr("Informe o nome da atração/artista.");
    if (valArtista > 0 && !somaOk) return setErr("A soma das parcelas não confere com o valor do artista.");
    setSubmitting(true);
    const res = await salvarAtracao({
      contract_id: detail.id,
      band: buildBandInput(),
      valor_artista: valArtista > 0 ? valArtista : undefined,
      parcelas_pagar: valArtista > 0 ? parcelas.filter((p) => p.vencimento && parseBRL(p.valorStr) > 0).map((p) => ({ vencimento: p.vencimento, valor: parseBRL(p.valorStr) })) : undefined,
      attachment_path: attachmentPath,
    });
    setSubmitting(false);
    if ("error" in res) return setErr(res.error);
    setMsg(valArtista > 0
      ? "Contrato da atração salvo — títulos gerados como pendentes. Lance no Omie pelo Financeiro quando o contrato estiver assinado."
      : "Atração salva. Informe o valor pago ao artista para gerar os títulos.");
    onChange();
  }

  if (launched) {
    return (
      <section className="space-y-3 rounded-lg border border-border bg-surface-1 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-primary">Contrato da atração / pagamento ao artista</h2>
          <StatusPill tone="ok">Lançado no Omie</StatusPill>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Info label="Pago ao artista" value={brl(detail.valor_artista)} />
          <Info label="Custódia" value={brl(detail.valor_custodia)} />
          <Info label="Margem" value={brl(detail.valor_margem)} />
          <Info label="Serviços" value={brl(detail.valor_servicos)} />
        </div>
        {detail.attachment_path && (
          <button onClick={openAttachment} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-2">
            <FileSignature className="h-4 w-4" /> Ver contrato do artista
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-primary">Atração / Artista</h2>
        <div className="flex gap-1 text-xs">
          <button type="button" onClick={() => setBandMode("existing")} disabled={!bands.length} className={`rounded px-2 py-1 ${bandMode === "existing" ? "bg-amber-600 text-white" : "text-ink-muted hover:bg-surface-2"} disabled:opacity-40`}>Selecionar</button>
          <button type="button" onClick={() => setBandMode("new")} className={`rounded px-2 py-1 ${bandMode === "new" ? "bg-amber-600 text-white" : "text-ink-muted hover:bg-surface-2"}`}>+ Novo</button>
        </div>
      </div>
      {bandMode === "existing" ? (
        <select value={bandId} onChange={(e) => setBandId(e.target.value)} className={INPUT_CLS}>
          <option value="">— selecione —</option>
          {bands.map((b) => (<option key={b.id} value={b.id}>{b.name} {b.cnpj_cpf ? `— ${b.cnpj_cpf}` : ""}</option>))}
        </select>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={LABEL_CLS}>Nome / Razão social</label><input value={bName} onChange={(e) => setBName(e.target.value)} className={INPUT_CLS} /></div>
          <div><label className={LABEL_CLS}>CNPJ / CPF</label><input value={bDoc} onChange={(e) => setBDoc(e.target.value)} className={INPUT_CLS} /></div>
          <div><label className={LABEL_CLS}>E-mail</label><input value={bEmail} onChange={(e) => setBEmail(e.target.value)} className={INPUT_CLS} /></div>
          <div><label className={LABEL_CLS}>Telefone</label><input value={bPhone} onChange={(e) => setBPhone(e.target.value)} className={INPUT_CLS} /></div>
          <div><label className={LABEL_CLS}>Banco</label><input value={bBanco} onChange={(e) => setBBanco(e.target.value)} className={INPUT_CLS} /></div>
          <div><label className={LABEL_CLS}>Agência</label><input value={bAgencia} onChange={(e) => setBAgencia(e.target.value)} className={INPUT_CLS} /></div>
          <div><label className={LABEL_CLS}>Conta corrente</label><input value={bConta} onChange={(e) => setBConta(e.target.value)} className={INPUT_CLS} /></div>
          <div><label className={LABEL_CLS}>Titular</label><input value={bTitular} onChange={(e) => setBTitular(e.target.value)} className={INPUT_CLS} /></div>
          <div><label className={LABEL_CLS}>CPF/CNPJ do titular</label><input value={bDocTitular} onChange={(e) => setBDocTitular(e.target.value)} className={INPUT_CLS} /></div>
          <div><label className={LABEL_CLS}>Chave PIX</label><input value={bPix} onChange={(e) => setBPix(e.target.value)} className={INPUT_CLS} /></div>
        </div>
      )}
      {detail.band_id && <p className="text-xs text-ink-muted">Atração atual: {detail.band.name}.</p>}

      <div className="mt-1 border-t border-border pt-3">
        <h3 className="text-sm font-semibold text-ink-primary">Contrato do artista + pagamento</h3>
      </div>
      <p className="text-xs text-ink-muted">Suba o contrato do artista, leia com OCR e informe o pagamento. Ao salvar, os títulos ficam pendentes; lance no Omie pelo Financeiro quando estiver assinado.</p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-ink-secondary hover:bg-surface-2">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          <span>{attachmentName || "Contrato do artista (PDF/imagem)"}</span>
          <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
        </label>
        <button type="button" onClick={handleOcr} disabled={!attachmentPath || ocrLoading || uploading} className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
          {ocrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />} Ler contrato (OCR)
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL_CLS}>Valor pago ao artista (custódia)</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">R$</span>
            <input inputMode="numeric" value={vArtista} onChange={(e) => setVArtista(maskBRL(e.target.value))} placeholder="0,00" className={INPUT_CLS + " pl-8 text-right"} />
          </div>
          {valArtista > detail.valor_atracao_cliente && (
            <p className="mt-1 text-xs text-red-500">Não pode ser maior que a atração cobrada ({brl(detail.valor_atracao_cliente)}).</p>
          )}
        </div>
      </div>

      <div className="rounded-md border border-border/70 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-ink-secondary">Parcelas a pagar ao artista</span>
          <span className={`text-xs tabular-nums ${somaOk ? "text-emerald-600 dark:text-emerald-400" : "text-ink-muted"}`}>Soma: {brl(soma)}</span>
        </div>
        <div className="space-y-2">
          {parcelas.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="date" value={r.vencimento} onChange={(e) => { const n = [...parcelas]; n[i] = { ...n[i], vencimento: e.target.value }; setParcelas(n); }} className={INPUT_CLS + " max-w-[170px]"} />
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">R$</span>
                <input inputMode="numeric" value={r.valorStr} onChange={(e) => { const n = [...parcelas]; n[i] = { ...n[i], valorStr: maskBRL(e.target.value) }; setParcelas(n); }} placeholder="0,00" className={INPUT_CLS + " pl-8 text-right"} />
              </div>
              <button type="button" onClick={() => setParcelas(parcelas.filter((_, idx) => idx !== i))} disabled={parcelas.length <= 1} className="rounded p-1.5 text-ink-muted hover:bg-surface-2 hover:text-red-500 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => setParcelas([...parcelas, { vencimento: "", valorStr: "" }])} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2"><Plus className="h-3.5 w-3.5" /> Parcela</button>
          <button type="button" onClick={() => setParcelas([{ vencimento: detail.event_date ?? "", valorStr: brlFromNumber(valArtista) }])} className="rounded border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2">Preencher 1 parcela</button>
        </div>
      </div>

      {err && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-600 dark:text-red-300">{err}</div>}
      {msg && <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-300">{msg}</div>}

      <div className="flex justify-end">
        <button onClick={submit} disabled={submitting || uploading} className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Salvar contrato da atração
        </button>
      </div>
    </section>
  );
}

// ── FINANCEIRO (consolidação — sempre visível abaixo das abas) ───────────────
const LEG_LABEL: Record<string, string> = {
  pagar_custodia: "A pagar — Artista (custódia)",
  receber_custodia: "A receber — Custódia",
  receber_servicos: "A receber — Serviços",
};
const ITEM_LABEL: Record<string, string> = { margem: "Comissão/BV", rider: "Rider", camarim: "Camarim", extras: "Extras" };

function FinanceiroPanel({ detail, signed, onChange }: { detail: ContractDetail; signed: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const titles = detail.titles;
  const receber = titles.filter((t) => t.leg !== "pagar_custodia");
  const pagar = titles.filter((t) => t.leg === "pagar_custodia");
  const atracaoOk = detail.valor_artista > 0;
  const temPendentes = titles.some((t) => t.status !== "lancado");
  const temLancados = titles.some((t) => t.status === "lancado" || t.status === "erro");
  const canLaunch = atracaoOk && signed;
  const launchHint = !atracaoOk
    ? "Salve o Contrato Atração primeiro"
    : !signed
      ? "Aguardando assinatura de todos (cliente, contratado e testemunha)"
      : "";

  async function lancar() {
    setBusy(true);
    const res = await lancarNoOmie(detail.id);
    setBusy(false);
    if ("error" in res) return alert(res.error);
    onChange();
  }
  async function resync() {
    setBusy(true);
    const res = await resyncContract(detail.id);
    setBusy(false);
    if ("error" in res) return alert(res.error);
    onChange();
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-primary">Financeiro</h2>
        <div className="flex flex-wrap items-center gap-2">
          {signed ? <StatusPill tone="ok">Assinado</StatusPill> : <StatusPill tone="muted">Não assinado</StatusPill>}
          {titles.length > 0 && temPendentes && (
            <button
              onClick={lancar}
              disabled={busy || !canLaunch}
              title={launchHint}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Lançar no Omie
            </button>
          )}
          {temLancados && (
            <button onClick={resync} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-ink-secondary hover:bg-surface-2 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Reenviar ao Omie
            </button>
          )}
        </div>
      </div>

      {titles.length > 0 && temPendentes && !canLaunch && (
        <p className="text-xs text-amber-600 dark:text-amber-400">Para lançar no Omie: {launchHint.toLowerCase()}.</p>
      )}

      {titles.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-muted"><Circle className="h-4 w-4" /> Nenhum lançamento ainda — salve o Contrato Atração para gerar os títulos (ficam pendentes até lançar).</p>
      ) : (
        <div className="space-y-4">
          <TitlesTable title="Contas a receber (cliente)" rows={receber} />
          <TitlesTable title="Contas a pagar (artista)" rows={pagar} />
        </div>
      )}
    </section>
  );
}

function TitlesTable({ title, rows }: { title: string; rows: ContractTitleRow[] }) {
  if (rows.length === 0) return null;
  const total = rows.reduce((a, r) => a + r.valor, 0);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</span>
        <span className="text-xs tabular-nums text-ink-secondary">{brl(total)}</span>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-1.5 font-medium">Lançamento</th>
              <th className="px-3 py-1.5 font-medium">Vencimento</th>
              <th className="px-3 py-1.5 text-right font-medium">Valor</th>
              <th className="px-3 py-1.5 font-medium">Cód. Omie</th>
              <th className="px-3 py-1.5 font-medium">Status</th>
              <th className="px-3 py-1.5 font-medium">Pagamento</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-1.5 text-ink-primary">
                  {LEG_LABEL[t.leg]}
                  {t.title_item ? ` · ${ITEM_LABEL[t.title_item] ?? t.title_item}` : ""}
                  <span className="text-ink-muted"> ({t.parcela_numero}/{t.parcela_total})</span>
                </td>
                <td className="px-3 py-1.5 tabular-nums text-ink-secondary">{dateBR(t.vencimento)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{brl(t.valor)}</td>
                <td className="px-3 py-1.5 tabular-nums text-ink-secondary">{t.omie_codigo ? `#${t.omie_codigo}` : "—"}</td>
                <td className="px-3 py-1.5">
                  {t.status === "lancado" ? <StatusPill tone="ok">Lançado</StatusPill> : t.status === "erro" ? <StatusPill tone="err">Erro</StatusPill> : <StatusPill tone="muted">Pendente</StatusPill>}
                </td>
                <td className="px-3 py-1.5">
                  {t.pago ? <StatusPill tone="ok">Pago{t.pago_em ? ` · ${dateBR(t.pago_em)}` : ""}</StatusPill> : t.status === "lancado" ? <StatusPill tone="wait">{t.omie_status || "Em aberto"}</StatusPill> : <StatusPill tone="muted">—</StatusPill>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
