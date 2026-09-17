"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, ScanLine, Plus, Trash2 } from "lucide-react";

import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { extractArtistContract } from "@/lib/case/actions/ocr";
import { salvarBvArtistico } from "@/lib/case/actions/bv";
import { SearchSelect } from "@/components/case/novo-contrato-form";
import { BandCadastroFields, emptyBandCadastro, bandCadastroToInput, artistOcrToBandPatch, type BandCadastro } from "@/components/case/band-cadastro-fields";
import type { CaseBandRow } from "@/lib/case/types";

const ATTACHMENT_BUCKET = "case-attachments";
const INPUT_CLS =
  "h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-amber-500/40";
const LABEL_CLS = "block text-xs font-medium text-ink-secondary mb-1";
const SECTION_CLS = "rounded-lg border border-border bg-surface-1 p-4 space-y-3";

const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const maskBRL = (digits: string) => {
  const clean = digits.replace(/\D/g, "");
  return clean ? fmt.format(parseInt(clean, 10) / 100) : "";
};
const parseBRL = (masked: string) => {
  const n = parseFloat(masked.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const brlFromNumber = (n: number) => (n > 0 ? maskBRL(String(Math.round(n * 100))) : "");

interface ParcelaRow {
  vencimento: string;
  valorStr: string;
}

/**
 * BV artístico: comissão que a Case recebe do artista indicado. Não tem cliente
 * nem contrato de venda — o contrato anexado é o do artista com o contratante
 * dele, e serve de prova/anexo do título. O valor da comissão quase nunca está
 * nesse documento, então é digitado.
 */
export function BvArtisticoForm({ bands }: { bands: CaseBandRow[] }) {
  const router = useRouter();

  const [bandMode, setBandMode] = useState<"existing" | "new">(bands.length ? "existing" : "new");
  const [bandId, setBandId] = useState("");
  const [band, setBand] = useState<BandCadastro>(emptyBandCadastro());
  const patchBand = (p: Partial<BandCadastro>) => setBand((v) => ({ ...v, ...p }));

  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [valorStr, setValorStr] = useState("");
  const [parcelas, setParcelas] = useState<ParcelaRow[]>([{ vencimento: "", valorStr: "" }]);
  const [observacao, setObservacao] = useState("");

  const [attachmentPath, setAttachmentPath] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const valor = parseBRL(valorStr);
  const somaParcelas = parcelas.reduce((a, p) => a + parseBRL(p.valorStr), 0);
  const somaOk = valor > 0 && Math.abs(somaParcelas - valor) < 0.005;

  async function handleUpload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const supabase = createSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return setError("Sessão expirada.");
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const objectPath = `${user.id}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(objectPath, file, { contentType: file.type, upsert: false });
      if (upErr) return setError(`Falha no upload: ${upErr.message}`);
      setAttachmentPath(objectPath);
      setAttachmentName(file.name);
    } finally {
      setUploading(false);
    }
  }

  /** OCR só para identificar o artista (quem nos paga) — o valor da comissão não vem no documento. */
  async function handleOcr() {
    if (!attachmentPath) return setError("Suba o contrato do artista primeiro.");
    setError(null);
    setMsg(null);
    setOcrLoading(true);
    const res = await extractArtistContract(attachmentPath);
    setOcrLoading(false);
    if ("error" in res) return setError(res.error);
    const d = res.data;
    const doc = (d.bandDoc ?? "").replace(/\D/g, "");
    const match = doc ? bands.find((b) => (b.cnpj_cpf ?? "").replace(/\D/g, "") === doc) : undefined;
    if (match) {
      setBandMode("existing");
      setBandId(match.id);
      setMsg(`Contrato lido — ${match.name} já cadastrado, selecionado. Informe o valor da comissão.`);
      return;
    }
    if (d.bandName) {
      setBandMode("new");
      patchBand(artistOcrToBandPatch(d));
    }
    if (!eventName.trim() && d.artistName) setEventName(d.artistName);
    if (!eventDate && d.dataShow) setEventDate(d.dataShow);
    setMsg("Contrato lido. Confira o artista e informe o valor da comissão — ele não costuma estar no documento.");
  }

  function setParcela(i: number, patch: Partial<ParcelaRow>) {
    setParcelas((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    setError(null);
    if (bandMode === "existing" && !bandId) return setError("Selecione o artista que vai pagar a comissão.");
    if (bandMode === "new" && !band.name.trim()) return setError("Informe o nome do artista.");
    if (bandMode === "new" && !band.doc.replace(/\D/g, "")) {
      return setError("Informe o CNPJ ou CPF do artista — o Omie precisa do documento para emitir o título.");
    }
    if (valor <= 0) return setError("Informe o valor da comissão.");
    if (!somaOk) return setError("A soma das parcelas não confere com o valor da comissão.");

    const sel = bands.find((b) => b.id === bandId);
    const bandInput =
      bandMode === "existing" && sel
        ? {
            id: sel.id, name: sel.name, cnpj_cpf: sel.cnpj_cpf, pessoa_fisica: sel.pessoa_fisica, email: sel.email, phone: sel.phone,
            banco: sel.banco, agencia: sel.agencia, conta_corrente: sel.conta_corrente, titular_banco: sel.titular_banco,
            doc_titular: sel.doc_titular, chave_pix: sel.chave_pix, chave_pix_tipo: sel.chave_pix_tipo,
          }
        : bandCadastroToInput(band);

    setSubmitting(true);
    const res = await salvarBvArtistico({
      band: bandInput,
      event_name: eventName.trim() || null,
      event_date: eventDate || null,
      valor_comissao: valor,
      receber_schedule: parcelas
        .filter((p) => p.vencimento && parseBRL(p.valorStr) > 0)
        .map((p) => ({ vencimento: p.vencimento, valor: parseBRL(p.valorStr) })),
      attachment_path: attachmentPath,
      observacao: observacao.trim() || null,
    });
    setSubmitting(false);
    if ("error" in res) return setError(res.error);
    router.push(`/case/contratos/${res.contractId}`);
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-5">
      <div className={SECTION_CLS}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-primary">Artista que paga a comissão</h2>
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
            placeholder="Buscar e selecionar o artista…"
          />
        ) : (
          <BandCadastroFields value={band} onChange={patchBand} />
        )}
        <p className="text-xs text-ink-muted">Os dados bancários não são obrigatórios aqui — quem paga é o artista. O documento (CNPJ/CPF) é, porque o Omie exige para emitir o título.</p>
      </div>

      <div className={SECTION_CLS}>
        <h2 className="text-sm font-semibold text-ink-primary">Contrato do artista (anexo)</h2>
        <p className="text-xs text-ink-muted">Suba o contrato que o artista fechou. Ele vai junto do título no Omie e a leitura identifica o artista — o valor da comissão você digita abaixo.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-ink-secondary hover:bg-surface-2">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            <span>{attachmentName || "Contrato (PDF/imagem)"}</span>
            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
          </label>
          <button type="button" onClick={handleOcr} disabled={!attachmentPath || ocrLoading || uploading} className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
            {ocrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />} Ler contrato (OCR)
          </button>
        </div>
        {msg && <p className="text-xs text-emerald-600 dark:text-emerald-400">{msg}</p>}
      </div>

      <div className={SECTION_CLS}>
        <h2 className="text-sm font-semibold text-ink-primary">Comissão</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLS}>Valor da comissão</label>
            <input
              value={valorStr}
              onChange={(e) => setValorStr(maskBRL(e.target.value))}
              inputMode="numeric"
              placeholder="0,00"
              className={`${INPUT_CLS} text-right tabular-nums`}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Evento (referência, opcional)</label>
            <input value={eventName} onChange={(e) => setEventName(e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Data do evento (opcional)</label>
            <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className={INPUT_CLS} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className={LABEL_CLS}>Recebimento</span>
            {valor > 0 && (
              <button type="button" onClick={() => setParcelas([{ vencimento: parcelas[0]?.vencimento ?? "", valorStr: brlFromNumber(valor) }])} className="text-xs text-amber-700 hover:underline dark:text-amber-400">
                Uma parcela com o valor total
              </button>
            )}
          </div>
          {parcelas.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="date" value={p.vencimento} onChange={(e) => setParcela(i, { vencimento: e.target.value })} className={INPUT_CLS} />
              <input
                value={p.valorStr}
                onChange={(e) => setParcela(i, { valorStr: maskBRL(e.target.value) })}
                inputMode="numeric"
                placeholder="0,00"
                className={`${INPUT_CLS} text-right tabular-nums`}
              />
              <button type="button" onClick={() => setParcelas((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows))} className="rounded-md border border-border p-2 text-ink-muted hover:bg-surface-2" aria-label="Remover parcela">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setParcelas((rows) => [...rows, { vencimento: "", valorStr: "" }])} className="inline-flex items-center gap-1 text-xs text-amber-700 hover:underline dark:text-amber-400">
            <Plus className="h-3.5 w-3.5" /> Adicionar parcela
          </button>
          {valor > 0 && !somaOk && (
            <p className="text-xs text-red-500">As parcelas somam R$ {fmt.format(somaParcelas)} e a comissão é R$ {fmt.format(valor)}.</p>
          )}
        </div>

        <div>
          <label className={LABEL_CLS}>Observação</label>
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-amber-500/40" />
        </div>
      </div>

      {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">{error}</div>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={() => router.push("/case/contratos")} className="rounded-md border border-border px-4 py-2 text-sm text-ink-secondary hover:bg-surface-2">Cancelar</button>
        <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Salvar BV
        </button>
      </div>
    </form>
  );
}
