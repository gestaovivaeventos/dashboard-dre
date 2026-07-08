"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Upload, Loader2, ScanLine, FileSignature, PenLine, CheckCircle2, Circle, RefreshCw } from "lucide-react";

import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toaster";
import {
  salvarAtracao,
  removerAtracao,
  confirmarAtracoes,
  salvarVerbaRiderCamarim,
  salvarFornecedor,
  removerFornecedor,
  converterSaldoEmBv,
  gerarEnviarContrato,
  lancarNoOmie,
  salvarCadastroCliente,
} from "@/lib/case/actions/stages";
import { extractArtistContract, extractFornecedorContract } from "@/lib/case/actions/ocr";
import { getSaleContractUrl, resendSignature } from "@/lib/case/actions/contracts";
import { resyncContract } from "@/lib/case/actions/contract-launch";
import { SearchSelect } from "@/components/case/novo-contrato-form";
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

export function ContratoWorkspace({ detail, bands, fornecedorBands }: { detail: ContractDetail; bands: CaseBandRow[]; fornecedorBands: CaseBandRow[] }) {
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
          <h1 className="mt-1 text-xl font-semibold text-ink-primary">
            Contrato #{detail.contract_number} — {detail.atracoes.length > 0 ? detail.atracoes.map((a) => a.band_name).join(", ") : detail.event_name ?? detail.band.name}
          </h1>
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
          {tab === "cliente" ? <ClienteTab detail={detail} signed={signed} onChange={refresh} /> : <AtracaoTab detail={detail} bands={bands} fornecedorBands={fornecedorBands} onChange={refresh} />}
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
  const [editingCadastro, setEditingCadastro] = useState(false);
  const { showToast } = useToast();
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
    if ("error" in res) return alert(res.error);
    showToast({ title: "Assinatura reenviada", description: "O cliente receberá um novo e-mail para assinar.", variant: "success" });
  }
  async function gerarEnviar() {
    setBusy(true);
    const res = await gerarEnviarContrato(detail.id);
    setBusy(false);
    if ("error" in res) return alert(res.error);
    if (res.warning) {
      showToast({ title: "Contrato gerado", description: res.warning });
    } else {
      showToast({
        title: sent ? "Contrato reenviado para assinatura" : "Contrato enviado para assinatura",
        description: "Os signatários receberão o link por e-mail.",
        variant: "success",
      });
    }
    onChange();
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-primary">Contrato com o cliente</h2>
        {signed ? <StatusPill tone="ok">Assinado · {dateBR(detail.signed_at)}</StatusPill> : sent ? <StatusPill tone="wait">Aguardando assinatura</StatusPill> : <StatusPill tone="muted">Rascunho</StatusPill>}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <Info label="Contrato" value={brl(detail.valor_atracao_cliente)} />
        {detail.valor_rider > 0 && <Info label="Rider" value={brl(detail.valor_rider)} />}
        {detail.valor_camarim > 0 && <Info label="Camarim" value={brl(detail.valor_camarim)} />}
        {detail.valor_extras > 0 && <Info label="Extras" value={brl(detail.valor_extras)} />}
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
        {!signed && (
          <a href={`/case/contratos/${detail.id}/editar`} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-2">
            <PenLine className="h-4 w-4" /> Editar dados
          </a>
        )}
        <button
          type="button"
          onClick={() => setEditingCadastro((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-2"
        >
          <PenLine className="h-4 w-4" /> Editar cadastro do cliente
        </button>
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

      {editingCadastro && (
        <ClienteCadastroForm
          detail={detail}
          onDone={() => { setEditingCadastro(false); onChange(); }}
          onCancel={() => setEditingCadastro(false)}
        />
      )}
    </section>
  );
}

// Edita SÓ o cadastro do cliente (CNPJ, contato, endereço) — funciona mesmo com
// o contrato assinado; o PDF assinado não muda, só o cadastro usado no Omie.
function ClienteCadastroForm({ detail, onDone, onCancel }: { detail: ContractDetail; onDone: () => void; onCancel: () => void }) {
  const c = detail.client;
  const [nome, setNome] = useState(c.name === "—" ? "" : c.name);
  const [doc, setDoc] = useState(c.cnpj_cpf ?? "");
  const [email, setEmail] = useState(c.email ?? "");
  const [phone, setPhone] = useState(c.phone ?? "");
  const [respLegal, setRespLegal] = useState(c.resp_legal ?? "");
  const [cpfResp, setCpfResp] = useState(c.cpf_resp_legal ?? "");
  const [endereco, setEndereco] = useState(c.endereco ?? "");
  const [cidadeEstado, setCidadeEstado] = useState(c.cidade_estado ?? "");
  const [cep, setCep] = useState(c.cep ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    setSaving(true);
    const res = await salvarCadastroCliente(detail.id, {
      id: c.id,
      name: nome.trim(),
      cnpj_cpf: doc.trim() || null,
      pessoa_fisica: doc.replace(/\D/g, "").length === 11,
      email: email.trim() || null,
      phone: phone.trim() || null,
      resp_legal: respLegal.trim() || null,
      cpf_resp_legal: cpfResp.trim() || null,
      endereco: endereco.trim() || null,
      cidade_estado: cidadeEstado.trim() || null,
      cep: cep.trim() || null,
    });
    setSaving(false);
    if ("error" in res) return setErr(res.error);
    onDone();
  }

  return (
    <div className="space-y-3 rounded-md border border-amber-500/40 p-3">
      <p className="text-xs text-ink-muted">
        Edita o <strong>cadastro</strong> do cliente (ex.: completar o CNPJ/CPF exigido pelo Omie). O contrato assinado não é alterado.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className={LABEL_CLS}>Fundo / Razão social</label><input value={nome} onChange={(e) => setNome(e.target.value)} className={INPUT_CLS} /></div>
        <div><label className={LABEL_CLS}>CNPJ / CPF</label><input value={doc} onChange={(e) => setDoc(e.target.value)} className={INPUT_CLS} /></div>
        <div><label className={LABEL_CLS}>E-mail</label><input value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT_CLS} /></div>
        <div><label className={LABEL_CLS}>Telefone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT_CLS} /></div>
        <div><label className={LABEL_CLS}>Responsável legal</label><input value={respLegal} onChange={(e) => setRespLegal(e.target.value)} className={INPUT_CLS} /></div>
        <div><label className={LABEL_CLS}>CPF do responsável</label><input value={cpfResp} onChange={(e) => setCpfResp(e.target.value)} className={INPUT_CLS} /></div>
        <div><label className={LABEL_CLS}>Endereço</label><input value={endereco} onChange={(e) => setEndereco(e.target.value)} className={INPUT_CLS} /></div>
        <div><label className={LABEL_CLS}>Cidade / Estado</label><input value={cidadeEstado} onChange={(e) => setCidadeEstado(e.target.value)} className={INPUT_CLS} /></div>
        <div><label className={LABEL_CLS}>CEP</label><input value={cep} onChange={(e) => setCep(e.target.value)} className={INPUT_CLS} /></div>
      </div>
      {err && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-600 dark:text-red-300">{err}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-2 disabled:opacity-50">Cancelar</button>
        <button type="button" onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar cadastro
        </button>
      </div>
    </div>
  );
}

// ── ABA: Contrato Atração — múltiplas atrações por contrato ──────────────────
async function openStoragePath(path: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return alert("Não foi possível abrir o anexo.");
  window.open(data.signedUrl, "_blank");
}

function AtracaoTab({ detail, bands, fornecedorBands, onChange }: { detail: ContractDetail; bands: CaseBandRow[]; fornecedorBands: CaseBandRow[]; onChange: () => void }) {
  const launched = detail.titles.some((t) => t.status === "lancado");
  const atracoes = detail.atracoes;
  const [editing, setEditing] = useState<null | { atracaoId: string | null }>(
    atracoes.length === 0 && !launched ? { atracaoId: null } : null,
  );
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const totalAtracoes = atracoes.reduce((a, x) => a + x.valor_artista, 0);
  const confirmado = !!detail.atracoes_confirmadas_at;

  async function handleConfirm(value: boolean) {
    setConfirming(true);
    const res = await confirmarAtracoes(detail.id, value);
    setConfirming(false);
    if ("error" in res) return alert(res.error);
    onChange();
  }

  async function handleRemove(id: string, nome: string) {
    if (!confirm(`Remover a atração ${nome} deste contrato? Os títulos pendentes dela serão apagados.`)) return;
    setRemoving(id);
    const res = await removerAtracao(detail.id, id);
    setRemoving(null);
    if ("error" in res) return alert(res.error);
    onChange();
  }

  const atracaoEditando = editing?.atracaoId ? atracoes.find((a) => a.id === editing.atracaoId) ?? null : null;

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border border-border bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-primary">
            Atrações do contrato {atracoes.length > 0 && <span className="text-ink-muted">({atracoes.length})</span>}
          </h2>
          <div className="flex items-center gap-2">
            {launched && <StatusPill tone="ok">Lançado no Omie</StatusPill>}
            {!launched && !editing && (
              <button
                type="button"
                onClick={() => setEditing({ atracaoId: null })}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar atração
              </button>
            )}
          </div>
        </div>

        {atracoes.length === 0 ? (
          <p className="text-sm text-ink-muted">Nenhuma atração vinculada ainda — adicione o(s) contrato(s) de artista abaixo.</p>
        ) : (
          <div className="space-y-2">
            {atracoes.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink-primary">
                    {a.band_name}
                    {a.band_cnpj_cpf && <span className="ml-2 text-xs text-ink-muted">{a.band_cnpj_cpf}</span>}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {a.valor_artista > 0
                      ? `${brl(a.valor_artista)} em ${a.pagar_schedule.length} parcela(s)`
                      : "sem valor informado (títulos ainda não gerados)"}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {a.attachment_path && (
                    <button
                      type="button"
                      onClick={() => openStoragePath(a.attachment_path!)}
                      className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2"
                    >
                      Ver contrato
                    </button>
                  )}
                  {!launched && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing({ atracaoId: a.id })}
                        className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(a.id, a.band_name)}
                        disabled={removing === a.id}
                        className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                      >
                        {removing === a.id ? "…" : "Remover"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2 text-sm">
              <span className="text-ink-muted">Total pago às atrações</span>
              <span className={`font-semibold tabular-nums ${totalAtracoes > detail.valor_atracao_cliente ? "text-red-500" : "text-ink-primary"}`}>
                {brl(totalAtracoes)} <span className="font-normal text-ink-muted">/ {brl(detail.valor_atracao_cliente)} cobrado do cliente</span>
              </span>
            </div>
          </div>
        )}

        {atracoes.length > 0 && !launched && (
          confirmado ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                ✓ Atrações confirmadas como completas — lançamento no Omie liberado.
              </span>
              <button
                type="button"
                onClick={() => handleConfirm(false)}
                disabled={confirming}
                className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2 disabled:opacity-50"
              >
                Desfazer
              </button>
            </div>
          ) : (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                O BV (margem) é calculado com a soma de <strong>todas</strong> as atrações. O lançamento no Omie fica
                bloqueado até você confirmar que todos os contratos de artista deste evento já foram anexados.
              </p>
              <button
                type="button"
                onClick={() => handleConfirm(true)}
                disabled={confirming}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {confirming && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Confirmar: todos os contratos já subiram
              </button>
            </div>
          )
        )}
      </section>

      {editing && !launched && (
        <AtracaoForm
          key={editing.atracaoId ?? "nova"}
          detail={detail}
          bands={bands}
          atracao={atracaoEditando}
          onDone={() => { setEditing(null); onChange(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      <RiderCamarimSection detail={detail} bands={fornecedorBands} launched={launched} onChange={onChange} />
    </div>
  );
}

// ── VERBA RIDER/CAMARIM — reserva paga a fornecedores; saldo pode virar BV ──
function RiderCamarimSection({ detail, bands, launched, onChange }: { detail: ContractDetail; bands: CaseBandRow[]; launched: boolean; onChange: () => void }) {
  const verba = detail.valor_rider_camarim;
  const fornecedores = detail.fornecedores;
  const comprometido = fornecedores.reduce((a, f) => a + f.valor, 0);
  const saldo = Math.round((verba - comprometido) * 100) / 100;

  const [verbaStr, setVerbaStr] = useState(brlFromNumber(verba));
  const [savingVerba, setSavingVerba] = useState(false);
  const [editing, setEditing] = useState<null | { fornecedorId: string | null }>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  const verbaDigitada = parseBRL(verbaStr);
  const fornecedorEditando = editing?.fornecedorId ? fornecedores.find((f) => f.id === editing.fornecedorId) ?? null : null;

  async function saveVerba() {
    setSavingVerba(true);
    const res = await salvarVerbaRiderCamarim(detail.id, verbaDigitada);
    setSavingVerba(false);
    if ("error" in res) return alert(res.error);
    onChange();
  }

  async function handleRemove(id: string, nome: string) {
    if (!confirm(`Remover o fornecedor ${nome} deste contrato? As parcelas pendentes dele serão apagadas.`)) return;
    setRemoving(id);
    const res = await removerFornecedor(detail.id, id);
    setRemoving(null);
    if ("error" in res) return alert(res.error);
    onChange();
  }

  async function handleConvert() {
    if (!confirm(`Converter o saldo de ${brl(saldo)} em BV? A verba Rider/Camarim fica reduzida ao valor já comprometido com fornecedores (${brl(comprometido)}) e o saldo vira comissão/BV.`)) return;
    setConverting(true);
    const res = await converterSaldoEmBv(detail.id);
    setConverting(false);
    if ("error" in res) return alert(res.error);
    setVerbaStr(brlFromNumber(comprometido));
    onChange();
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border border-border bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-primary">
            Verba Rider/Camarim {fornecedores.length > 0 && <span className="text-ink-muted">({fornecedores.length} fornecedor{fornecedores.length > 1 ? "es" : ""})</span>}
          </h2>
          {!launched && !editing && (
            <button
              type="button"
              onClick={() => setEditing({ fornecedorId: null })}
              disabled={verba <= 0}
              title={verba <= 0 ? "Defina a verba primeiro" : ""}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar fornecedor
            </button>
          )}
        </div>
        <p className="text-xs text-ink-muted">
          Reserva do contrato para rider, camarim e produção, paga a fornecedores. O BV é calculado como: contrato do cliente − atrações − esta verba.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className={LABEL_CLS}>Valor da verba</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">R$</span>
              <input inputMode="numeric" value={verbaStr} onChange={(e) => setVerbaStr(maskBRL(e.target.value))} placeholder="0,00" disabled={launched} className={INPUT_CLS + " max-w-[180px] pl-8 text-right disabled:opacity-60"} />
            </div>
          </div>
          {!launched && Math.abs(verbaDigitada - verba) >= 0.005 && (
            <button type="button" onClick={saveVerba} disabled={savingVerba} className="inline-flex h-9 items-center gap-2 rounded-md bg-amber-600 px-3 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">
              {savingVerba && <Loader2 className="h-4 w-4 animate-spin" />} Salvar verba
            </button>
          )}
        </div>

        {fornecedores.length > 0 && (
          <div className="space-y-2">
            {fornecedores.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink-primary">
                    {f.band_name}
                    {f.band_cnpj_cpf && <span className="ml-2 text-xs text-ink-muted">{f.band_cnpj_cpf}</span>}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {f.descricao ? `${f.descricao} · ` : ""}{brl(f.valor)} em {f.pagar_schedule.length} parcela(s)
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {f.attachment_path && (
                    <button type="button" onClick={() => openStoragePath(f.attachment_path!)} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2">
                      Ver contrato
                    </button>
                  )}
                  {!launched && (
                    <>
                      <button type="button" onClick={() => setEditing({ fornecedorId: f.id })} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2">
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(f.id, f.band_name)}
                        disabled={removing === f.id}
                        className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                      >
                        {removing === f.id ? "…" : "Remover"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {verba > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm">
            <span className="text-ink-muted">
              Comprometido {brl(comprometido)} / verba {brl(verba)}
            </span>
            <span className="flex items-center gap-3">
              <span className={`font-semibold tabular-nums ${saldo > 0 ? "text-ink-primary" : "text-ink-muted"}`}>Saldo disponível: {brl(saldo)}</span>
              {!launched && saldo > 0 && (
                <button
                  type="button"
                  onClick={handleConvert}
                  disabled={converting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {converting && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Converter saldo em BV
                </button>
              )}
            </span>
          </div>
        )}
      </section>

      {editing && !launched && (
        <FornecedorForm
          key={editing.fornecedorId ?? "novo"}
          detail={detail}
          bands={bands}
          fornecedor={fornecedorEditando}
          onDone={() => { setEditing(null); onChange(); }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// Form de adicionar/editar UMA atração (identidade + anexo/OCR + valor/parcelas).
function AtracaoForm({
  detail,
  bands,
  atracao,
  onDone,
  onCancel,
}: {
  detail: ContractDetail;
  bands: CaseBandRow[];
  atracao: ContractDetail["atracoes"][number] | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [bandMode, setBandMode] = useState<"existing" | "new">(atracao || bands.length ? "existing" : "new");
  const [bandId, setBandId] = useState<string>(atracao?.band_id ?? "");
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
  const [attachmentPath, setAttachmentPath] = useState<string | null>(atracao?.attachment_path ?? null);
  const [attachmentName, setAttachmentName] = useState<string>(atracao?.attachment_path ? "Contrato anexado" : "");
  const [uploading, setUploading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [vArtista, setVArtista] = useState(atracao && atracao.valor_artista > 0 ? brlFromNumber(atracao.valor_artista) : "");
  const [parcelas, setParcelas] = useState<ParcelaRow[]>(
    atracao && atracao.pagar_schedule.length > 0
      ? atracao.pagar_schedule.map((p) => ({ vencimento: p.vencimento, valorStr: brlFromNumber(Number(p.valor)) }))
      : [{ vencimento: "", valorStr: "" }],
  );
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const valArtista = parseBRL(vArtista);
  const soma = parcelas.reduce((a, p) => a + parseBRL(p.valorStr), 0);
  const somaOk = Math.abs(soma - valArtista) < 0.005 && valArtista > 0;
  // Limite disponível: valor da atração cobrado do cliente menos as OUTRAS atrações.
  const outrasAtracoes = detail.atracoes.filter((a) => a.id !== atracao?.id).reduce((a, x) => a + x.valor_artista, 0);
  const limiteDisponivel = detail.valor_atracao_cliente - outrasAtracoes;

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
    // Se o CNPJ/CPF do contrato bate com uma atração já cadastrada, seleciona-a.
    const doc = (d.bandDoc ?? "").replace(/\D/g, "");
    const match = !atracao && doc ? bands.find((b) => (b.cnpj_cpf ?? "").replace(/\D/g, "") === doc) : undefined;
    if (match) {
      setBandMode("existing");
      setBandId(match.id);
    } else if (!atracao && d.bandName) {
      setBandMode("new");
      setBName(d.bandName);
      setBDoc(d.bandDoc ?? "");
    }
    if (d.valorCache != null) setVArtista(brlFromNumber(d.valorCache));
    const ps = (d.parcelas ?? []).filter((p) => p.data && p.valor);
    if (ps.length) setParcelas(ps.map((p) => ({ vencimento: p.data!, valorStr: brlFromNumber(p.valor!) })));
    setMsg(match ? `Contrato lido — ${match.name} já cadastrado, selecionado automaticamente. Revise valor e parcelas.` : "Contrato lido. Revise a atração, o valor e as parcelas antes de salvar.");
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
    if (valArtista > limiteDisponivel) {
      return setErr(`Com as outras atrações, o disponível é ${brl(Math.max(0, limiteDisponivel))} (atração cobrada do cliente: ${brl(detail.valor_atracao_cliente)}).`);
    }
    setSubmitting(true);
    const res = await salvarAtracao({
      contract_id: detail.id,
      atracao_id: atracao?.id ?? null,
      band: buildBandInput(),
      valor_artista: valArtista > 0 ? valArtista : undefined,
      parcelas_pagar: valArtista > 0 ? parcelas.filter((p) => p.vencimento && parseBRL(p.valorStr) > 0).map((p) => ({ vencimento: p.vencimento, valor: parseBRL(p.valorStr) })) : undefined,
      attachment_path: attachmentPath,
    });
    setSubmitting(false);
    if ("error" in res) return setErr(res.error);
    onDone();
  }

  return (
    <section className="space-y-3 rounded-lg border border-amber-500/40 bg-surface-1 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-primary">{atracao ? `Editar atração — ${atracao.band_name}` : "Nova atração"}</h2>
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
          {valArtista > limiteDisponivel && (
            <p className="mt-1 text-xs text-red-500">
              Disponível para esta atração: {brl(Math.max(0, limiteDisponivel))} (soma de todas não pode passar de {brl(detail.valor_atracao_cliente)}).
            </p>
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

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={submitting} className="rounded-md border border-border px-4 py-2 text-sm text-ink-secondary hover:bg-surface-2 disabled:opacity-50">
          Cancelar
        </button>
        <button onClick={submit} disabled={submitting || uploading} className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />} {atracao ? "Salvar alterações" : "Adicionar atração"}
        </button>
      </div>
    </section>
  );
}

// Form de adicionar/editar UM fornecedor da verba Rider/Camarim.
function FornecedorForm({
  detail,
  bands,
  fornecedor,
  onDone,
  onCancel,
}: {
  detail: ContractDetail;
  bands: CaseBandRow[];
  fornecedor: ContractDetail["fornecedores"][number] | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [bandMode, setBandMode] = useState<"existing" | "new">(fornecedor || bands.length ? "existing" : "new");
  const [bandId, setBandId] = useState<string>(fornecedor?.band_id ?? "");
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
  const [descricao, setDescricao] = useState(fornecedor?.descricao ?? "");
  const [attachmentPath, setAttachmentPath] = useState<string | null>(fornecedor?.attachment_path ?? null);
  const [attachmentName, setAttachmentName] = useState<string>(fornecedor?.attachment_path ? "Contrato anexado" : "");
  const [uploading, setUploading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [vFornecedor, setVFornecedor] = useState(fornecedor && fornecedor.valor > 0 ? brlFromNumber(fornecedor.valor) : "");
  const [parcelas, setParcelas] = useState<ParcelaRow[]>(
    fornecedor && fornecedor.pagar_schedule.length > 0
      ? fornecedor.pagar_schedule.map((p) => ({ vencimento: p.vencimento, valorStr: brlFromNumber(Number(p.valor)) }))
      : [{ vencimento: "", valorStr: "" }],
  );
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const valor = parseBRL(vFornecedor);
  const soma = parcelas.reduce((a, p) => a + parseBRL(p.valorStr), 0);
  const somaOk = Math.abs(soma - valor) < 0.005 && valor > 0;
  // Limite: verba Rider/Camarim menos os OUTROS fornecedores.
  const outros = detail.fornecedores.filter((f) => f.id !== fornecedor?.id).reduce((a, f) => a + f.valor, 0);
  const limiteDisponivel = detail.valor_rider_camarim - outros;

  async function handleUpload(file: File) {
    setErr(null);
    if (file.size > MAX_ATTACHMENT_SIZE) return setErr("Arquivo maior que 10MB.");
    setUploading(true);
    let uploadedPath: string | null = null;
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
      uploadedPath = objectPath;
    } finally {
      setUploading(false);
    }
    // Leitura automática: subiu o contrato → OCR preenche fornecedor + pagamento.
    if (uploadedPath) await handleOcr(uploadedPath);
  }

  async function handleOcr(path?: string) {
    const alvo = path ?? attachmentPath;
    if (!alvo) return setErr("Suba o contrato do fornecedor primeiro.");
    setErr(null);
    setMsg(null);
    setOcrLoading(true);
    const res = await extractFornecedorContract(alvo);
    setOcrLoading(false);
    if ("error" in res) return setErr(res.error);
    const d = res.data;

    let identidade = "";
    // Se o CNPJ/CPF do contrato bate com um fornecedor já cadastrado, seleciona-o.
    const doc = (d.doc ?? "").replace(/\D/g, "");
    const match = !fornecedor && doc ? bands.find((b) => (b.cnpj_cpf ?? "").replace(/\D/g, "") === doc) : undefined;
    if (match) {
      setBandMode("existing");
      setBandId(match.id);
      identidade = `${match.name} já cadastrado — selecionado automaticamente`;
    } else if (!fornecedor && d.nome) {
      setBandMode("new");
      setBName(d.nome);
      setBDoc(d.doc ?? "");
      if (d.email) setBEmail(d.email);
      if (d.telefone) setBPhone(d.telefone);
      if (d.banco) setBBanco(d.banco);
      if (d.agencia) setBAgencia(d.agencia);
      if (d.contaCorrente) setBConta(d.contaCorrente);
      if (d.titularBanco) setBTitular(d.titularBanco);
      if (d.docTitular) setBDocTitular(d.docTitular);
      if (d.chavePix) setBPix(d.chavePix);
      identidade = `${d.nome} preenchido como novo cadastro`;
    }

    if (d.descricao && !descricao.trim()) setDescricao(d.descricao);
    if (d.valorTotal != null && d.valorTotal > 0) setVFornecedor(brlFromNumber(d.valorTotal));
    const ps = (d.parcelas ?? []).filter((p) => p.data && p.valor);
    if (ps.length) setParcelas(ps.map((p) => ({ vencimento: p.data!, valorStr: brlFromNumber(p.valor!) })));

    const achouAlgo = identidade || d.valorTotal != null || ps.length > 0 || d.descricao;
    if (!achouAlgo) {
      return setErr("Li o documento, mas não encontrei dados de fornecedor/valor/parcelas nele — preencha manualmente ou confira se o arquivo é o contrato certo.");
    }
    setMsg(`Contrato lido${identidade ? ` — ${identidade}` : ""}. Revise valor e parcelas antes de salvar.`);
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
    if (bandMode === "existing" && !bandId) return setErr("Selecione o fornecedor.");
    if (bandMode === "new" && !bName.trim()) return setErr("Informe o nome do fornecedor.");
    if (valor <= 0) return setErr("Informe o valor pago ao fornecedor.");
    if (!somaOk) return setErr("A soma das parcelas não confere com o valor do fornecedor.");
    if (valor > limiteDisponivel + 0.005) {
      return setErr(`Com os outros fornecedores, o disponível na verba é ${brl(Math.max(0, limiteDisponivel))} (verba Rider/Camarim: ${brl(detail.valor_rider_camarim)}).`);
    }
    setSubmitting(true);
    const res = await salvarFornecedor({
      contract_id: detail.id,
      fornecedor_id: fornecedor?.id ?? null,
      band: buildBandInput(),
      descricao: descricao.trim() || null,
      valor,
      parcelas_pagar: parcelas.filter((p) => p.vencimento && parseBRL(p.valorStr) > 0).map((p) => ({ vencimento: p.vencimento, valor: parseBRL(p.valorStr) })),
      attachment_path: attachmentPath,
    });
    setSubmitting(false);
    if ("error" in res) return setErr(res.error);
    onDone();
  }

  return (
    <section className="space-y-3 rounded-lg border border-amber-500/40 bg-surface-1 p-4">
      <h2 className="text-sm font-semibold text-ink-primary">{fornecedor ? `Editar fornecedor — ${fornecedor.band_name}` : "Novo fornecedor (verba Rider/Camarim)"}</h2>

      {/* 1º: contrato (opcional) — subiu, o OCR lê e preenche fornecedor + pagamento. */}
      <p className="text-xs text-ink-muted">
        Tem o contrato/orçamento? Suba aqui que o sistema lê e preenche o fornecedor, o valor e as parcelas automaticamente.
        Sem contrato, selecione um fornecedor já cadastrado (busca abaixo) ou cadastre um novo.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-ink-secondary hover:bg-surface-2">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          <span>{attachmentName || "Contrato do fornecedor (PDF/imagem — opcional)"}</span>
          <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
        </label>
        <button type="button" onClick={() => handleOcr()} disabled={!attachmentPath || ocrLoading || uploading} className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
          {ocrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />} Reler contrato (OCR)
        </button>
      </div>
      {msg && <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-300">{msg}</div>}

      <div className="mt-1 flex items-center justify-between border-t border-border pt-3">
        <h3 className="text-sm font-semibold text-ink-primary">Fornecedor</h3>
        <div className="flex gap-1 text-xs">
          <button type="button" onClick={() => setBandMode("existing")} disabled={!bands.length} className={`rounded px-2 py-1 ${bandMode === "existing" ? "bg-amber-600 text-white" : "text-ink-muted hover:bg-surface-2"} disabled:opacity-40`}>Selecionar</button>
          <button type="button" onClick={() => setBandMode("new")} className={`rounded px-2 py-1 ${bandMode === "new" ? "bg-amber-600 text-white" : "text-ink-muted hover:bg-surface-2"}`}>+ Novo</button>
        </div>
      </div>
      {bandMode === "existing" ? (
        <SearchSelect
          items={bands.map((b) => ({ id: b.id, label: b.name, sub: b.cnpj_cpf }))}
          value={bandId}
          onChange={setBandId}
          placeholder="Buscar e selecionar o fornecedor…"
        />
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

      <div><label className={LABEL_CLS}>Descrição (o que este fornecedor cobre — ex.: som e luz, camarim)</label><input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={INPUT_CLS} /></div>

      <div className="mt-1 border-t border-border pt-3">
        <h3 className="text-sm font-semibold text-ink-primary">Pagamento</h3>
      </div>
      <p className="text-xs text-ink-muted">As parcelas saem da verba Rider/Camarim do contrato.</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL_CLS}>Valor pago ao fornecedor</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">R$</span>
            <input inputMode="numeric" value={vFornecedor} onChange={(e) => setVFornecedor(maskBRL(e.target.value))} placeholder="0,00" className={INPUT_CLS + " pl-8 text-right"} />
          </div>
          {valor > limiteDisponivel + 0.005 && (
            <p className="mt-1 text-xs text-red-500">
              Disponível na verba para este fornecedor: {brl(Math.max(0, limiteDisponivel))} (verba Rider/Camarim: {brl(detail.valor_rider_camarim)}).
            </p>
          )}
        </div>
      </div>

      <div className="rounded-md border border-border/70 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-ink-secondary">Parcelas a pagar ao fornecedor</span>
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
          <button type="button" onClick={() => setParcelas([{ vencimento: detail.event_date ?? "", valorStr: brlFromNumber(valor) }])} className="rounded border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2">Preencher 1 parcela</button>
        </div>
      </div>

      {err && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-600 dark:text-red-300">{err}</div>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={submitting} className="rounded-md border border-border px-4 py-2 text-sm text-ink-secondary hover:bg-surface-2 disabled:opacity-50">
          Cancelar
        </button>
        <button onClick={submit} disabled={submitting || uploading} className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />} {fornecedor ? "Salvar alterações" : "Adicionar fornecedor"}
        </button>
      </div>
    </section>
  );
}

// ── FINANCEIRO (consolidação — sempre visível abaixo das abas) ───────────────
const LEG_LABEL: Record<string, string> = {
  pagar_custodia: "A pagar — Custódia",
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
  const confirmado = !!detail.atracoes_confirmadas_at;
  const temPendentes = titles.some((t) => t.status !== "lancado");
  const temLancados = titles.some((t) => t.status === "lancado" || t.status === "erro");
  const canLaunch = atracaoOk && confirmado && signed;
  const launchHint = !atracaoOk
    ? "Salve o Contrato Atração primeiro"
    : !confirmado
      ? "Confirme na aba Contrato Atração que todos os contratos de artista já subiram (cálculo do BV)"
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

      <p className="text-xs text-ink-muted">
        BV (Comissão): <span className="font-semibold tabular-nums text-ink-primary">{brl(detail.valor_margem)}</span>
        {" · "}Custódia (atrações + verba): <span className="tabular-nums">{brl(detail.valor_custodia)}</span>
      </p>

      {titles.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-muted"><Circle className="h-4 w-4" /> Nenhum lançamento ainda — salve o Contrato Atração para gerar os títulos (ficam pendentes até lançar).</p>
      ) : (
        <div className="space-y-4">
          <TitlesTable title="Contas a receber (cliente)" rows={receber} />
          <TitlesTable title="Contas a pagar (artistas e fornecedores)" rows={pagar} />
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
                  {t.atracao_nome ? ` · ${t.atracao_nome}` : t.fornecedor_nome ? ` · ${t.fornecedor_nome}` : ""}
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
