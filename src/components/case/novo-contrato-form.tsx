"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Upload, Loader2, Copy, ScanLine } from "lucide-react";

import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { createContract } from "@/lib/case/actions/contracts";
import { extractArtistContract } from "@/lib/case/actions/ocr";
import type { CaseBandRow, CaseClientRow, CaseParcelaInput } from "@/lib/case/types";

const INPUT_CLS =
  "h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-amber-500/40";
const LABEL_CLS = "block text-xs font-medium text-ink-secondary mb-1";
const SECTION_CLS = "rounded-lg border border-border bg-surface-1 p-4 space-y-3";

const ATTACHMENT_BUCKET = "case-attachments";
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatBRL(digits: string): string {
  const clean = digits.replace(/\D/g, "");
  if (!clean) return "";
  return fmt.format(parseInt(clean, 10) / 100);
}
function parseBRL(masked: string): number {
  const clean = masked.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "");
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}
const brlFromNumber = (n: number) => (n > 0 ? formatBRL(String(Math.round(n * 100))) : "");
const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

interface ParcelaRow {
  vencimento: string;
  valorStr: string;
}
const emptyParcela = (): ParcelaRow => ({ vencimento: "", valorStr: "" });

function ParcelasEditor({
  title,
  rows,
  onChange,
  total,
  onFillSingle,
  onMirror,
}: {
  title: string;
  rows: ParcelaRow[];
  onChange: (rows: ParcelaRow[]) => void;
  total: number;
  onFillSingle: () => void;
  onMirror?: () => void;
}) {
  const soma = rows.reduce((acc, r) => acc + parseBRL(r.valorStr), 0);
  const diff = Math.round((soma - total) * 100) / 100;
  const ok = Math.abs(diff) < 0.005 && total > 0;

  return (
    <div className="rounded-md border border-border/70 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-secondary">{title}</span>
        <span className="text-xs text-ink-muted">
          Total: <span className="tabular-nums">R$ {fmt.format(total)}</span>
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="date"
              value={r.vencimento}
              onChange={(e) => {
                const next = [...rows];
                next[i] = { ...next[i], vencimento: e.target.value };
                onChange(next);
              }}
              className={INPUT_CLS + " max-w-[170px]"}
            />
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">R$</span>
              <input
                inputMode="numeric"
                value={r.valorStr}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...next[i], valorStr: formatBRL(e.target.value) };
                  onChange(next);
                }}
                placeholder="0,00"
                className={INPUT_CLS + " pl-8 text-right"}
              />
            </div>
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
              disabled={rows.length <= 1}
              className="rounded p-1.5 text-ink-muted hover:bg-surface-2 hover:text-red-500 disabled:opacity-40"
              title="Remover parcela"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onChange([...rows, emptyParcela()])} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2">
          <Plus className="h-3.5 w-3.5" /> Parcela
        </button>
        <button type="button" onClick={onFillSingle} className="rounded border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2">
          Preencher 1 parcela
        </button>
        {onMirror && (
          <button type="button" onClick={onMirror} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2">
            <Copy className="h-3.5 w-3.5" /> Espelhar do artista
          </button>
        )}
        <span className={`ml-auto text-xs tabular-nums ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-ink-muted"}`}>
          Soma: R$ {fmt.format(soma)}
          {total > 0 && !ok ? ` (dif. ${diff > 0 ? "+" : ""}${fmt.format(diff)})` : ""}
        </span>
      </div>
    </div>
  );
}

export function NovoContratoForm({ clients, bands }: { clients: CaseClientRow[]; bands: CaseBandRow[] }) {
  const router = useRouter();

  const [bandsList, setBandsList] = useState<CaseBandRow[]>(bands);

  // Artista/contrato + OCR
  const [attachmentPath, setAttachmentPath] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrMsg, setOcrMsg] = useState<string | null>(null);

  // Cliente
  const [clientMode, setClientMode] = useState<"existing" | "new">(clients.length ? "existing" : "new");
  const [clientId, setClientId] = useState<string>(clients[0]?.id ?? "");
  const [cName, setCName] = useState("");
  const [cDoc, setCDoc] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cRespLegal, setCRespLegal] = useState("");
  const [cCpfResp, setCCpfResp] = useState("");
  const [cEndereco, setCEndereco] = useState("");
  const [cCidadeEstado, setCCidadeEstado] = useState("");
  const [cCep, setCCep] = useState("");

  // Banda
  const [bandMode, setBandMode] = useState<"existing" | "new">(bands.length ? "existing" : "new");
  const [bandId, setBandId] = useState<string>(bands[0]?.id ?? "");
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

  // Evento / objeto
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [showTime, setShowTime] = useState("");
  const [showDuration, setShowDuration] = useState("");
  const [passagemSom, setPassagemSom] = useState("");
  const [localName, setLocalName] = useState("");
  const [localAddress, setLocalAddress] = useState("");
  const [localCity, setLocalCity] = useState("");
  const [localCep, setLocalCep] = useState("");
  const [especificacoes, setEspecificacoes] = useState("");

  // Valores
  const [vArtista, setVArtista] = useState("");
  const [vAtracao, setVAtracao] = useState("");
  const [vRider, setVRider] = useState("");
  const [vCamarim, setVCamarim] = useState("");
  const [vExtras, setVExtras] = useState("");
  const [observacao, setObservacao] = useState("");

  // Parcelas
  const [pagarCustodia, setPagarCustodia] = useState<ParcelaRow[]>([emptyParcela()]);
  const [receberCustodia, setReceberCustodia] = useState<ParcelaRow[]>([emptyParcela()]);
  const [receberServicos, setReceberServicos] = useState<ParcelaRow[]>([emptyParcela()]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const valArtista = parseBRL(vArtista);
  const valAtracao = parseBRL(vAtracao);
  const valRider = parseBRL(vRider);
  const valCamarim = parseBRL(vCamarim);
  const valExtras = parseBRL(vExtras);
  const custodia = valArtista;
  const margem = Math.max(0, valAtracao - valArtista);
  const servicos = useMemo(() => margem + valRider + valCamarim + valExtras, [margem, valRider, valCamarim, valExtras]);

  async function handleUpload(file: File) {
    setError(null);
    if (file.size > MAX_ATTACHMENT_SIZE) return setError("Arquivo maior que 10MB.");
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

  async function handleOcr() {
    if (!attachmentPath) return setError("Suba o contrato do artista primeiro.");
    setError(null);
    setOcrMsg(null);
    setOcrLoading(true);
    const res = await extractArtistContract(attachmentPath);
    setOcrLoading(false);
    if ("error" in res) return setError(res.error);
    const d = res.data;

    if (d.bandId) {
      if (!bandsList.find((b) => b.id === d.bandId)) {
        setBandsList((prev) => [
          ...prev,
          {
            id: d.bandId!,
            name: d.bandName ?? "Artista",
            cnpj_cpf: d.bandDoc,
            pessoa_fisica: onlyDigits(d.bandDoc).length === 11,
            email: null, phone: null, banco: null, agencia: null,
            conta_corrente: null, titular_banco: null, doc_titular: null, chave_pix: null,
          },
        ]);
      }
      setBandMode("existing");
      setBandId(d.bandId);
    } else if (d.bandName) {
      setBandMode("new");
      setBName(d.bandName);
      setBDoc(d.bandDoc ?? "");
    }

    if (d.valorCache != null) setVArtista(brlFromNumber(d.valorCache));
    const parcelas = (d.parcelas ?? []).filter((p) => p.data && p.valor);
    if (parcelas.length) setPagarCustodia(parcelas.map((p) => ({ vencimento: p.data!, valorStr: brlFromNumber(p.valor!) })));
    if (d.dataShow) setEventDate(d.dataShow);
    if (d.horario) setShowTime(d.horario);
    if (d.duracao) setShowDuration(d.duracao);
    if (d.local) setLocalName(d.local);
    if (d.endereco) setLocalAddress(d.endereco);
    if (d.cidade) setLocalCity(d.cidade);
    setOcrMsg(`Contrato lido${d.bandCreated ? " — artista cadastrado automaticamente" : ""}. Revise os campos antes de enviar.`);
  }

  function fillSingle(setter: (r: ParcelaRow[]) => void, total: number) {
    setter([{ vencimento: eventDate, valorStr: brlFromNumber(total) }]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (clientMode === "existing" && !clientId) return setError("Selecione o cliente.");
    if (clientMode === "new" && !cName.trim()) return setError("Informe o nome do cliente.");
    if (bandMode === "existing" && !bandId) return setError("Selecione a banda/artista.");
    if (bandMode === "new" && !bName.trim()) return setError("Informe o nome da banda/artista.");
    if (valAtracao <= 0) return setError("Informe o valor da atração cobrado do cliente.");

    const toParcelas = (rows: ParcelaRow[]): CaseParcelaInput[] =>
      rows.filter((r) => r.vencimento && parseBRL(r.valorStr) > 0).map((r) => ({ vencimento: r.vencimento, valor: parseBRL(r.valorStr) }));

    const selectedClient = clients.find((c) => c.id === clientId);
    const selectedBand = bandsList.find((b) => b.id === bandId);

    const input = {
      client:
        clientMode === "existing" && selectedClient
          ? {
              id: selectedClient.id,
              name: selectedClient.name,
              cnpj_cpf: selectedClient.cnpj_cpf,
              pessoa_fisica: selectedClient.pessoa_fisica,
              email: selectedClient.email,
              phone: selectedClient.phone,
              resp_legal: selectedClient.resp_legal,
              cpf_resp_legal: selectedClient.cpf_resp_legal,
              endereco: selectedClient.endereco,
              cidade_estado: selectedClient.cidade_estado,
              cep: selectedClient.cep,
            }
          : {
              name: cName.trim(),
              cnpj_cpf: cDoc.trim() || null,
              pessoa_fisica: onlyDigits(cDoc).length === 11,
              email: cEmail.trim() || null,
              phone: cPhone.trim() || null,
              resp_legal: cRespLegal.trim() || null,
              cpf_resp_legal: cCpfResp.trim() || null,
              endereco: cEndereco.trim() || null,
              cidade_estado: cCidadeEstado.trim() || null,
              cep: cCep.trim() || null,
            },
      band:
        bandMode === "existing" && selectedBand
          ? {
              id: selectedBand.id,
              name: selectedBand.name,
              cnpj_cpf: selectedBand.cnpj_cpf,
              pessoa_fisica: selectedBand.pessoa_fisica,
              email: selectedBand.email,
              phone: selectedBand.phone,
              banco: selectedBand.banco,
              agencia: selectedBand.agencia,
              conta_corrente: selectedBand.conta_corrente,
              titular_banco: selectedBand.titular_banco,
              doc_titular: selectedBand.doc_titular,
              chave_pix: selectedBand.chave_pix,
            }
          : {
              name: bName.trim(),
              cnpj_cpf: bDoc.trim() || null,
              pessoa_fisica: onlyDigits(bDoc).length === 11,
              email: bEmail.trim() || null,
              phone: bPhone.trim() || null,
              banco: bBanco.trim() || null,
              agencia: bAgencia.trim() || null,
              conta_corrente: bConta.trim() || null,
              titular_banco: bTitular.trim() || null,
              doc_titular: bDocTitular.trim() || null,
              chave_pix: bPix.trim() || null,
            },
      event_name: eventName.trim() || null,
      event_date: eventDate || null,
      show_time: showTime.trim() || null,
      show_duration: showDuration.trim() || null,
      passagem_som: passagemSom.trim() || null,
      local_name: localName.trim() || null,
      local_address: localAddress.trim() || null,
      local_city: localCity.trim() || null,
      local_cep: localCep.trim() || null,
      especificacoes: especificacoes.trim() || null,
      valor_artista: valArtista,
      valor_atracao_cliente: valAtracao,
      valor_rider: valRider,
      valor_camarim: valCamarim,
      valor_extras: valExtras,
      observacao: observacao.trim() || null,
      attachment_path: attachmentPath,
      parcelas_pagar_custodia: toParcelas(pagarCustodia),
      parcelas_receber_custodia: toParcelas(receberCustodia),
      parcelas_receber_servicos: toParcelas(receberServicos),
    };

    setSubmitting(true);
    const res = await createContract(input);
    setSubmitting(false);

    if ("error" in res) return setError(res.error);
    if (res.warning) {
      setNotice(res.warning);
      return;
    }
    router.push("/case/contratos");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* 1. Contrato do artista + OCR */}
      <div className={SECTION_CLS}>
        <h2 className="text-sm font-semibold text-ink-primary">1. Contrato do artista</h2>
        <p className="text-xs text-ink-muted">Suba o contrato do artista e leia com OCR para pré-preencher artista, valores, datas e dados do show.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-ink-secondary hover:bg-surface-2">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            <span>{attachmentName || "Selecionar PDF/imagem (até 10MB)"}</span>
            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
          </label>
          <button
            type="button"
            onClick={handleOcr}
            disabled={!attachmentPath || ocrLoading || uploading}
            className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {ocrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
            Ler contrato (OCR)
          </button>
        </div>
        {ocrMsg && <p className="text-xs text-emerald-600 dark:text-emerald-400">{ocrMsg}</p>}
      </div>

      {/* Cliente */}
      <div className={SECTION_CLS}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-primary">Cliente (contratante)</h2>
          <ModeToggle mode={clientMode} setMode={setClientMode} hasExisting={clients.length > 0} />
        </div>
        {clientMode === "existing" ? (
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={INPUT_CLS}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name} {c.cnpj_cpf ? `— ${c.cnpj_cpf}` : ""}</option>
            ))}
          </select>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Fundo / Razão social" value={cName} onChange={setCName} />
            <Field label="CNPJ / CPF" value={cDoc} onChange={setCDoc} />
            <Field label="E-mail (para assinatura)" value={cEmail} onChange={setCEmail} />
            <Field label="Telefone" value={cPhone} onChange={setCPhone} />
            <Field label="Responsável legal" value={cRespLegal} onChange={setCRespLegal} />
            <Field label="CPF do responsável" value={cCpfResp} onChange={setCCpfResp} />
            <Field label="Endereço" value={cEndereco} onChange={setCEndereco} />
            <Field label="Cidade / Estado" value={cCidadeEstado} onChange={setCCidadeEstado} />
            <Field label="CEP" value={cCep} onChange={setCCep} />
          </div>
        )}
      </div>

      {/* Banda */}
      <div className={SECTION_CLS}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-primary">Banda / Artista (fornecedor)</h2>
          <ModeToggle mode={bandMode} setMode={setBandMode} hasExisting={bandsList.length > 0} />
        </div>
        {bandMode === "existing" ? (
          <select value={bandId} onChange={(e) => setBandId(e.target.value)} className={INPUT_CLS}>
            {bandsList.map((b) => (
              <option key={b.id} value={b.id}>{b.name} {b.cnpj_cpf ? `— ${b.cnpj_cpf}` : ""}</option>
            ))}
          </select>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nome / Razão social" value={bName} onChange={setBName} />
            <Field label="CNPJ / CPF" value={bDoc} onChange={setBDoc} />
            <Field label="E-mail" value={bEmail} onChange={setBEmail} />
            <Field label="Telefone" value={bPhone} onChange={setBPhone} />
            <Field label="Banco" value={bBanco} onChange={setBBanco} />
            <Field label="Agência" value={bAgencia} onChange={setBAgencia} />
            <Field label="Conta corrente" value={bConta} onChange={setBConta} />
            <Field label="Titular" value={bTitular} onChange={setBTitular} />
            <Field label="CPF/CNPJ do titular" value={bDocTitular} onChange={setBDocTitular} />
            <Field label="Chave PIX" value={bPix} onChange={setBPix} />
          </div>
        )}
      </div>

      {/* Evento / objeto */}
      <div className={SECTION_CLS}>
        <h2 className="text-sm font-semibold text-ink-primary">Evento (objeto do contrato)</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nome do evento / atração" value={eventName} onChange={setEventName} />
          <div>
            <label className={LABEL_CLS}>Data do evento</label>
            <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className={INPUT_CLS} />
          </div>
          <Field label="Horário da apresentação" value={showTime} onChange={setShowTime} />
          <Field label="Duração" value={showDuration} onChange={setShowDuration} />
          <Field label="Passagem de som" value={passagemSom} onChange={setPassagemSom} />
          <Field label="Local" value={localName} onChange={setLocalName} />
          <Field label="Endereço do local" value={localAddress} onChange={setLocalAddress} />
          <Field label="Cidade / Estado" value={localCity} onChange={setLocalCity} />
          <Field label="CEP" value={localCep} onChange={setLocalCep} />
          <Field label="Especificações (palco/trio/área)" value={especificacoes} onChange={setEspecificacoes} />
        </div>
      </div>

      {/* Valores */}
      <div className={SECTION_CLS}>
        <h2 className="text-sm font-semibold text-ink-primary">Valores</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MoneyField label="Valor pago ao artista (custódia)" value={vArtista} onChange={setVArtista} />
          <MoneyField label="Valor da atração cobrado do cliente" value={vAtracao} onChange={setVAtracao} />
          <MoneyField label="Rider" value={vRider} onChange={setVRider} />
          <MoneyField label="Camarim" value={vCamarim} onChange={setVCamarim} />
          <MoneyField label="Extras" value={vExtras} onChange={setVExtras} />
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-md bg-surface-2 p-3 text-center text-xs">
          <div>
            <div className="text-ink-muted">Custódia (repasse)</div>
            <div className="mt-0.5 font-semibold tabular-nums text-ink-primary">R$ {fmt.format(custodia)}</div>
          </div>
          <div>
            <div className="text-ink-muted">Margem</div>
            <div className="mt-0.5 font-semibold tabular-nums text-ink-primary">R$ {fmt.format(margem)}</div>
          </div>
          <div>
            <div className="text-ink-muted">Serviços (receita)</div>
            <div className="mt-0.5 font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">R$ {fmt.format(servicos)}</div>
          </div>
        </div>
        {valArtista > valAtracao && valAtracao > 0 && (
          <p className="text-xs text-red-500">O valor pago ao artista não pode ser maior que o valor cobrado do cliente pela atração.</p>
        )}
      </div>

      {/* Parcelas */}
      <div className={SECTION_CLS}>
        <h2 className="text-sm font-semibold text-ink-primary">Parcelas</h2>
        <p className="text-xs text-ink-muted">Cada parcela vira um título no Omie ao assinar. Custódia usa a categoria de custódia; serviços usam a de serviços prestados.</p>
        <ParcelasEditor title="A pagar ao artista — Custódia" rows={pagarCustodia} onChange={setPagarCustodia} total={custodia} onFillSingle={() => fillSingle(setPagarCustodia, custodia)} />
        <ParcelasEditor title="A receber do cliente — Custódia" rows={receberCustodia} onChange={setReceberCustodia} total={custodia} onFillSingle={() => fillSingle(setReceberCustodia, custodia)} onMirror={() => setReceberCustodia(pagarCustodia.map((r) => ({ ...r })))} />
        <ParcelasEditor title="A receber do cliente — Serviços (margem + rider + camarim + extras)" rows={receberServicos} onChange={setReceberServicos} total={servicos} onFillSingle={() => fillSingle(setReceberServicos, servicos)} />
      </div>

      <div>
        <label className={LABEL_CLS}>Observação</label>
        <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-amber-500/40" />
      </div>

      {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">{error}</div>}
      {notice && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">{notice}</div>}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => router.push("/case/contratos")} className="rounded-md border border-border px-4 py-2 text-sm text-ink-secondary hover:bg-surface-2">
          Cancelar
        </button>
        <button type="submit" disabled={submitting || uploading || ocrLoading} className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Gerar contrato e enviar para assinatura
        </button>
      </div>
    </form>
  );
}

function ModeToggle({ mode, setMode, hasExisting }: { mode: "existing" | "new"; setMode: (m: "existing" | "new") => void; hasExisting: boolean }) {
  return (
    <div className="flex gap-1 text-xs">
      <button type="button" onClick={() => setMode("existing")} disabled={!hasExisting} className={`rounded px-2 py-1 ${mode === "existing" ? "bg-amber-600 text-white" : "text-ink-muted hover:bg-surface-2"} disabled:opacity-40`}>
        Selecionar
      </button>
      <button type="button" onClick={() => setMode("new")} className={`rounded px-2 py-1 ${mode === "new" ? "bg-amber-600 text-white" : "text-ink-muted hover:bg-surface-2"}`}>
        + Novo
      </button>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={INPUT_CLS} />
    </div>
  );
}

function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">R$</span>
        <input inputMode="numeric" value={value} onChange={(e) => onChange(formatBRL(e.target.value))} placeholder="0,00" className={INPUT_CLS + " pl-8 text-right"} />
      </div>
    </div>
  );
}
