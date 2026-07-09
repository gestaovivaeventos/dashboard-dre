"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Upload, ScanLine, CheckCircle2, Circle, Search, Check, ChevronsUpDown } from "lucide-react";

import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toaster";
import { salvarCliente, gerarEnviarContrato, salvarAtracao } from "@/lib/case/actions/stages";
import { extractArtistContract } from "@/lib/case/actions/ocr";
import type { CaseBandRow, CaseClientRow, CaseParcelaInput, Etapa1Input } from "@/lib/case/types";
import type { ContractEditData } from "@/lib/case/queries";

const INPUT_CLS =
  "h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-amber-500/40";
const LABEL_CLS = "block text-xs font-medium text-ink-secondary mb-1";
const SECTION_CLS = "rounded-lg border border-border bg-surface-1 p-4 space-y-3";

const ATTACHMENT_BUCKET = "case-attachments";
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatBRL(digits: string): string {
  const clean = digits.replace(/\D/g, "");
  return clean ? fmt.format(parseInt(clean, 10) / 100) : "";
}
function parseBRL(masked: string): number {
  const n = parseFloat(masked.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
const brlFromNumber = (n: number) => (n > 0 ? formatBRL(String(Math.round(n * 100))) : "");
const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

interface ParcelaRow {
  vencimento: string;
  valorStr: string;
}
const emptyParcela = (): ParcelaRow => ({ vencimento: "", valorStr: "" });

function ParcelasEditor({ label, rows, onChange, total, onFillSingle }: {
  label: string;
  rows: ParcelaRow[];
  onChange: (rows: ParcelaRow[]) => void;
  total: number;
  onFillSingle: () => void;
}) {
  const soma = rows.reduce((acc, r) => acc + parseBRL(r.valorStr), 0);
  const diff = Math.round((soma - total) * 100) / 100;
  const ok = Math.abs(diff) < 0.005 && total > 0;
  return (
    <div className="rounded-md border border-border/70 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-secondary">{label}</span>
        <span className="text-xs text-ink-muted">Total: <span className="tabular-nums">R$ {fmt.format(total)}</span></span>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="date" value={r.vencimento} onChange={(e) => { const n = [...rows]; n[i] = { ...n[i], vencimento: e.target.value }; onChange(n); }} className={INPUT_CLS + " max-w-[170px]"} />
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">R$</span>
              <input inputMode="numeric" value={r.valorStr} onChange={(e) => { const n = [...rows]; n[i] = { ...n[i], valorStr: formatBRL(e.target.value) }; onChange(n); }} placeholder="0,00" className={INPUT_CLS + " pl-8 text-right"} />
            </div>
            <button type="button" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} disabled={rows.length <= 1} className="rounded p-1.5 text-ink-muted hover:bg-surface-2 hover:text-red-500 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onChange([...rows, emptyParcela()])} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2"><Plus className="h-3.5 w-3.5" /> Parcela</button>
        <button type="button" onClick={onFillSingle} className="rounded border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2">Preencher 1 parcela</button>
        <span className={`ml-auto text-xs tabular-nums ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-ink-muted"}`}>
          Soma: R$ {fmt.format(soma)}{total > 0 && !ok ? ` (dif. ${diff > 0 ? "+" : ""}${fmt.format(diff)})` : ""}
        </span>
      </div>
    </div>
  );
}

export function NovoContratoForm({ clients, bands, edit }: { clients: CaseClientRow[]; bands: CaseBandRow[]; edit?: ContractEditData }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [tab, setTab] = useState<"cliente" | "atracao">("cliente");
  const [bandsList] = useState<CaseBandRow[]>(bands);

  // Cliente
  const initialClient = edit ? clients.find((c) => c.id === edit.client_id) ?? null : null;
  const [clientMode, setClientMode] = useState<"existing" | "new">(edit || clients.length ? "existing" : "new");
  const [clientId, setClientId] = useState<string>(edit?.client_id ?? "");
  const [cName, setCName] = useState(initialClient?.name ?? "");
  const [cDoc, setCDoc] = useState(initialClient?.cnpj_cpf ?? "");
  const [cEmail, setCEmail] = useState(initialClient?.email ?? "");
  const [cPhone, setCPhone] = useState(initialClient?.phone ?? "");
  const [cRespLegal, setCRespLegal] = useState(initialClient?.resp_legal ?? "");
  const [cCpfResp, setCCpfResp] = useState(initialClient?.cpf_resp_legal ?? "");
  const [cEndereco, setCEndereco] = useState(initialClient?.endereco ?? "");
  const [cCidadeEstado, setCCidadeEstado] = useState(initialClient?.cidade_estado ?? "");
  const [cCep, setCCep] = useState(initialClient?.cep ?? "");

  // Na edição, trocar o cliente selecionado recarrega os campos do cadastro.
  function selectClient(id: string) {
    setClientId(id);
    if (!edit) return;
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    setCName(c.name);
    setCDoc(c.cnpj_cpf ?? "");
    setCEmail(c.email ?? "");
    setCPhone(c.phone ?? "");
    setCRespLegal(c.resp_legal ?? "");
    setCCpfResp(c.cpf_resp_legal ?? "");
    setCEndereco(c.endereco ?? "");
    setCCidadeEstado(c.cidade_estado ?? "");
    setCCep(c.cep ?? "");
  }

  // Evento / objeto
  const [eventName, setEventName] = useState(edit?.event_name ?? "");
  const [eventDate, setEventDate] = useState(edit?.event_date ?? "");
  const [showTime, setShowTime] = useState(edit?.show_time ?? "");
  const [showDuration, setShowDuration] = useState(edit?.show_duration ?? "");
  const [passagemSom, setPassagemSom] = useState(edit?.passagem_som ?? "");
  const [localName, setLocalName] = useState(edit?.local_name ?? "");
  const [localAddress, setLocalAddress] = useState(edit?.local_address ?? "");
  const [localCity, setLocalCity] = useState(edit?.local_city ?? "");
  const [localCep, setLocalCep] = useState(edit?.local_cep ?? "");
  const [especificacoes, setEspecificacoes] = useState(edit?.especificacoes ?? "");

  // Modelo CASE
  const [especAreaInterna, setEspecAreaInterna] = useState(edit?.espec_area_interna ?? false);
  const [especAreaExterna, setEspecAreaExterna] = useState(edit?.espec_area_externa ?? false);
  const [especPalco, setEspecPalco] = useState(edit?.espec_palco ?? false);
  const [especTrio, setEspecTrio] = useState(edit?.espec_trio ?? false);
  const [extraTransporte, setExtraTransporte] = useState(edit?.extra_transporte_cidade ?? false);
  const [extraTranslado, setExtraTranslado] = useState(edit?.extra_translado_local ?? false);
  const [extraDiaria, setExtraDiaria] = useState(edit?.extra_diaria_alimentacao ?? false);
  const [extraHospedagem, setExtraHospedagem] = useState(edit?.extra_hospedagem ?? false);
  const [extraOutros, setExtraOutros] = useState(edit?.extra_outros ?? "");
  const [riderTecnico, setRiderTecnico] = useState(edit?.rider_tecnico ?? false);
  const [riderCamarim, setRiderCamarim] = useState(edit?.rider_camarim ?? false);
  const [riderPreProducao, setRiderPreProducao] = useState(edit?.rider_pre_producao ?? false);
  const [tipoEvento, setTipoEvento] = useState<"aberto" | "fechado" | "">(edit?.tipo_evento ?? "");
  const [cortesias, setCortesias] = useState(edit?.cortesias ?? "");
  const [dataAssinatura, setDataAssinatura] = useState(edit?.data_assinatura ?? "");
  const [test1Nome, setTest1Nome] = useState(edit?.testemunha_1_nome ?? "");
  const [test1Cpf, setTest1Cpf] = useState(edit?.testemunha_1_cpf ?? "");
  const [test1Email, setTest1Email] = useState(edit?.testemunha_1_email ?? "");
  const [test2Nome, setTest2Nome] = useState(edit?.testemunha_2_nome ?? "");
  const [test2Cpf, setTest2Cpf] = useState(edit?.testemunha_2_cpf ?? "");

  // Valor cobrado do cliente (campo único "Contrato" → valor_atracao_cliente)
  const [vAtracao, setVAtracao] = useState(edit ? brlFromNumber(edit.valor_atracao_cliente) : "");
  const [observacao, setObservacao] = useState(edit?.observacao ?? "");
  const [receberCliente, setReceberCliente] = useState<ParcelaRow[]>(
    edit && edit.receber_schedule.length > 0
      ? edit.receber_schedule.map((p) => ({ vencimento: p.vencimento, valorStr: brlFromNumber(Number(p.valor)) }))
      : [emptyParcela()],
  );

  // Aba Atração — identidade + anexo/OCR + pagamento
  const [bandMode, setBandMode] = useState<"existing" | "new">(bands.length ? "existing" : "new");
  const [bandId, setBandId] = useState<string>("");
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
  const [attachmentPath, setAttachmentPath] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrMsg, setOcrMsg] = useState<string | null>(null);
  const [vArtista, setVArtista] = useState("");
  const [pagarArtista, setPagarArtista] = useState<ParcelaRow[]>([emptyParcela()]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const valAtracao = parseBRL(vAtracao);
  const totalCliente = valAtracao;
  const valArtista = parseBRL(vArtista);
  const bandFilled = (bandMode === "existing" && !!bandId) || (bandMode === "new" && !!bName.trim());

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
      const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(objectPath, file, { contentType: file.type, upsert: false });
      if (error) return setError(`Falha no upload: ${error.message}`);
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
    if (d.bandName && bandMode === "new") { setBName(d.bandName); setBDoc(d.bandDoc ?? ""); }
    if (d.valorCache != null) setVArtista(brlFromNumber(d.valorCache));
    const ps = (d.parcelas ?? []).filter((p) => p.data && p.valor);
    if (ps.length) setPagarArtista(ps.map((p) => ({ vencimento: p.data!, valorStr: brlFromNumber(p.valor!) })));
    setOcrMsg("Contrato lido — revise os dados da atração.");
  }

  function buildClientInput(): Etapa1Input {
    const receber_schedule: CaseParcelaInput[] = receberCliente
      .filter((r) => r.vencimento && parseBRL(r.valorStr) > 0)
      .map((r) => ({ vencimento: r.vencimento, valor: parseBRL(r.valorStr) }));
    const selectedClient = clients.find((c) => c.id === clientId);
    return {
      contract_id: edit?.id ?? null,
      client:
        clientMode === "existing" && selectedClient
          ? edit
            ? {
                // Edição: os campos na tela atualizam o CADASTRO do cliente (corrige CNPJ etc.).
                id: selectedClient.id, name: cName.trim() || selectedClient.name, cnpj_cpf: cDoc.trim() || null,
                pessoa_fisica: onlyDigits(cDoc).length === 11, email: cEmail.trim() || null, phone: cPhone.trim() || null,
                resp_legal: cRespLegal.trim() || null, cpf_resp_legal: cCpfResp.trim() || null,
                endereco: cEndereco.trim() || null, cidade_estado: cCidadeEstado.trim() || null, cep: cCep.trim() || null,
              }
            : {
                id: selectedClient.id, name: selectedClient.name, cnpj_cpf: selectedClient.cnpj_cpf,
                pessoa_fisica: selectedClient.pessoa_fisica, email: selectedClient.email, phone: selectedClient.phone,
                resp_legal: selectedClient.resp_legal, cpf_resp_legal: selectedClient.cpf_resp_legal,
                endereco: selectedClient.endereco, cidade_estado: selectedClient.cidade_estado, cep: selectedClient.cep,
              }
          : {
              name: cName.trim(), cnpj_cpf: cDoc.trim() || null, pessoa_fisica: onlyDigits(cDoc).length === 11,
              email: cEmail.trim() || null, phone: cPhone.trim() || null, resp_legal: cRespLegal.trim() || null,
              cpf_resp_legal: cCpfResp.trim() || null, endereco: cEndereco.trim() || null,
              cidade_estado: cCidadeEstado.trim() || null, cep: cCep.trim() || null,
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
      espec_area_interna: especAreaInterna, espec_area_externa: especAreaExterna, espec_palco: especPalco, espec_trio: especTrio,
      extra_transporte_cidade: extraTransporte, extra_translado_local: extraTranslado,
      extra_diaria_alimentacao: extraDiaria, extra_hospedagem: extraHospedagem,
      extra_outros: extraOutros.trim() || null,
      rider_tecnico: riderTecnico, rider_camarim: riderCamarim, rider_pre_producao: riderPreProducao,
      tipo_evento: tipoEvento || null,
      cortesias: cortesias.trim() || null,
      data_assinatura: dataAssinatura || null,
      testemunha_1_nome: test1Nome.trim() || null, testemunha_1_cpf: test1Cpf.trim() || null, testemunha_1_email: test1Email.trim() || null,
      testemunha_2_nome: test2Nome.trim() || null, testemunha_2_cpf: test2Cpf.trim() || null,
      valor_atracao_cliente: valAtracao,
      // Contratos antigos podem ter esses valores — a edição preserva; novos vão zerados.
      valor_rider: edit?.valor_rider ?? 0,
      valor_camarim: edit?.valor_camarim ?? 0,
      valor_extras: edit?.valor_extras ?? 0,
      observacao: observacao.trim() || null,
      receber_schedule,
    };
  }

  function buildBandInput() {
    const selectedBand = bandsList.find((b) => b.id === bandId);
    return bandMode === "existing" && selectedBand
      ? {
          id: selectedBand.id, name: selectedBand.name, cnpj_cpf: selectedBand.cnpj_cpf, pessoa_fisica: selectedBand.pessoa_fisica,
          email: selectedBand.email, phone: selectedBand.phone, banco: selectedBand.banco, agencia: selectedBand.agencia,
          conta_corrente: selectedBand.conta_corrente, titular_banco: selectedBand.titular_banco, doc_titular: selectedBand.doc_titular, chave_pix: selectedBand.chave_pix,
        }
      : {
          name: bName.trim(), cnpj_cpf: bDoc.trim() || null, pessoa_fisica: onlyDigits(bDoc).length === 11,
          email: bEmail.trim() || null, phone: bPhone.trim() || null, banco: bBanco.trim() || null, agencia: bAgencia.trim() || null,
          conta_corrente: bConta.trim() || null, titular_banco: bTitular.trim() || null, doc_titular: bDocTitular.trim() || null, chave_pix: bPix.trim() || null,
        };
  }

  async function handleSalvar(enviar: boolean) {
    if (submittingRef.current) return;
    setError(null);
    if (clientMode === "existing" && !clientId) return setError("Selecione o cliente.");
    if (clientMode === "new") {
      if (!cName.trim()) return setError("Informe o Fundo / Razão social do cliente.");
      // Cliente novo entra no Omie como PF do responsável (fundo vira nome fantasia).
      if (!cRespLegal.trim()) return setError("Informe o responsável legal (nome completo) — obrigatório para cadastrar o cliente.");
      if (onlyDigits(cCpfResp).length !== 11) return setError("Informe o CPF do responsável legal (11 dígitos) — obrigatório para cadastrar o cliente.");
    }
    if (valAtracao <= 0) return setError("Informe o valor do contrato cobrado do cliente (aba Contrato Cliente).");

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const res = await salvarCliente(buildClientInput());
      if ("error" in res) { submittingRef.current = false; setSubmitting(false); return setError(res.error); }
      const contractId = res.contractId;

      if (!edit && bandFilled) {
        const pagar = pagarArtista.filter((p) => p.vencimento && parseBRL(p.valorStr) > 0).map((p) => ({ vencimento: p.vencimento, valor: parseBRL(p.valorStr) }));
        const atr = await salvarAtracao({ contract_id: contractId, band: buildBandInput(), attachment_path: attachmentPath, valor_artista: valArtista > 0 ? valArtista : undefined, parcelas_pagar: valArtista > 0 ? pagar : undefined });
        if ("error" in atr) { setError(atr.error); router.push(`/case/contratos/${contractId}`); return; }
      }

      if (enviar) {
        const g = await gerarEnviarContrato(contractId);
        if ("error" in g) {
          showToast({ title: "Contrato salvo, mas o envio falhou", description: g.error, variant: "destructive" });
          router.push(`/case/contratos/${contractId}`);
          return;
        }
        if (g.warning) {
          showToast({ title: "Contrato gerado", description: g.warning });
        } else {
          showToast({ title: "Contrato enviado para assinatura", description: "Os signatários receberão o link por e-mail.", variant: "success" });
        }
      }
      router.push(`/case/contratos/${contractId}`);
      router.refresh();
    } catch (err) {
      submittingRef.current = false;
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "Falha ao salvar o contrato.");
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSalvar(false); }} className="space-y-5">
      {/* Abas (na edição só existe a aba Cliente — atrações ficam no workspace) */}
      {!edit && (
        <div className="flex gap-1 border-b border-border">
          <TabBtn active={tab === "cliente"} done={valAtracao > 0} label="Contrato Cliente" onClick={() => setTab("cliente")} />
          <TabBtn active={tab === "atracao"} done={bandFilled} label="Contrato Atração" onClick={() => setTab("atracao")} />
        </div>
      )}

      {edit || tab === "cliente" ? (
        <>
          <div className={SECTION_CLS}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-primary">Cliente (contratante)</h2>
              <ModeToggle mode={clientMode} setMode={setClientMode} hasExisting={clients.length > 0} />
            </div>
            {clientMode === "existing" ? (
              <>
                <SearchSelect
                  items={clients.map((c) => ({ id: c.id, label: c.name, sub: c.cnpj_cpf }))}
                  value={clientId}
                  onChange={selectClient}
                  placeholder="Buscar e selecionar o cliente…"
                />
                {edit && clientId && (
                  <div className="space-y-3 rounded-md border border-border/70 p-3">
                    <p className="text-xs text-ink-muted">Dados do cadastro do cliente — editar aqui atualiza o cadastro (ex.: completar o CNPJ/CPF exigido pelo Omie).</p>
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
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Fundo / Razão social (nome fantasia no Omie)" value={cName} onChange={setCName} />
                  <Field label="CNPJ (opcional)" value={cDoc} onChange={setCDoc} />
                  <Field label="Responsável legal — nome completo *" value={cRespLegal} onChange={setCRespLegal} />
                  <Field label="CPF do responsável *" value={cCpfResp} onChange={setCCpfResp} />
                  <Field label="E-mail (para assinatura)" value={cEmail} onChange={setCEmail} />
                  <Field label="Telefone" value={cPhone} onChange={setCPhone} />
                  <Field label="Endereço" value={cEndereco} onChange={setCEndereco} />
                  <Field label="Cidade / Estado" value={cCidadeEstado} onChange={setCCidadeEstado} />
                  <Field label="CEP" value={cCep} onChange={setCCep} />
                </div>
                <p className="text-xs text-ink-muted">
                  No Omie, o cliente é cadastrado como <strong>pessoa física do responsável legal</strong> (razão social = nome completo, documento = CPF) e o Fundo/Razão social vira o <strong>nome fantasia</strong>. Informe o CNPJ só se o contratante tiver um.
                </p>
              </>
            )}
          </div>

          <div className={SECTION_CLS}>
            <h2 className="text-sm font-semibold text-ink-primary">Evento (objeto do contrato)</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Nome do evento / atração" value={eventName} onChange={setEventName} />
              <div><label className={LABEL_CLS}>Data do evento</label><input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className={INPUT_CLS} /></div>
              <Field label="Horário da apresentação" value={showTime} onChange={setShowTime} />
              <Field label="Duração" value={showDuration} onChange={setShowDuration} />
              <Field label="Passagem de som" value={passagemSom} onChange={setPassagemSom} />
              <Field label="Local" value={localName} onChange={setLocalName} />
              <Field label="Endereço do local" value={localAddress} onChange={setLocalAddress} />
              <Field label="Cidade / Estado" value={localCity} onChange={setLocalCity} />
              <Field label="CEP" value={localCep} onChange={setLocalCep} />
              <Field label="Especificações (texto livre — opcional)" value={especificacoes} onChange={setEspecificacoes} />
            </div>
            <div>
              <label className={LABEL_CLS}>Especificações do local</label>
              <div className="flex flex-wrap gap-4">
                <CheckField label="Área interna" checked={especAreaInterna} onChange={setEspecAreaInterna} />
                <CheckField label="Área externa" checked={especAreaExterna} onChange={setEspecAreaExterna} />
                <CheckField label="Palco" checked={especPalco} onChange={setEspecPalco} />
                <CheckField label="Trio" checked={especTrio} onChange={setEspecTrio} />
              </div>
            </div>
          </div>

          <div className={SECTION_CLS}>
            <h2 className="text-sm font-semibold text-ink-primary">Contrato (modelo CASE Shows)</h2>
            <div>
              <label className={LABEL_CLS}>Extras inclusos (custo da CONTRATADA se marcado)</label>
              <div className="flex flex-wrap gap-4">
                <CheckField label="Transporte até a cidade" checked={extraTransporte} onChange={setExtraTransporte} />
                <CheckField label="Translado local" checked={extraTranslado} onChange={setExtraTranslado} />
                <CheckField label="Diária de alimentação" checked={extraDiaria} onChange={setExtraDiaria} />
                <CheckField label="Hospedagem" checked={extraHospedagem} onChange={setExtraHospedagem} />
              </div>
              <div className="mt-2">
                <Field label="Outro extra incluso (texto livre — ex.: DJ residente)" value={extraOutros} onChange={setExtraOutros} />
              </div>
            </div>
            <div>
              <label className={LABEL_CLS}>Rider e afins (custo da CONTRATADA se marcado)</label>
              <div className="flex flex-wrap gap-4">
                <CheckField label="Rider técnico" checked={riderTecnico} onChange={setRiderTecnico} />
                <CheckField label="Rider de camarim" checked={riderCamarim} onChange={setRiderCamarim} />
                <CheckField label="Pré-produção, produção de palco e de camarins" checked={riderPreProducao} onChange={setRiderPreProducao} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL_CLS}>Tipo de evento</label>
                <div className="flex gap-4 pt-1">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-secondary"><input type="radio" name="tipo_evento" checked={tipoEvento === "aberto"} onChange={() => setTipoEvento("aberto")} /> Aberto</label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-secondary"><input type="radio" name="tipo_evento" checked={tipoEvento === "fechado"} onChange={() => setTipoEvento("fechado")} /> Fechado</label>
                  {tipoEvento && <button type="button" onClick={() => setTipoEvento("")} className="text-xs text-ink-muted hover:text-red-500">limpar</button>}
                </div>
              </div>
              <Field label="Cortesias" value={cortesias} onChange={setCortesias} />
              <div><label className={LABEL_CLS}>Data de assinatura</label><input type="date" value={dataAssinatura} onChange={(e) => setDataAssinatura(e.target.value)} className={INPUT_CLS} /></div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Testemunha 1 — nome" value={test1Nome} onChange={setTest1Nome} />
              <Field label="Testemunha 1 — CPF" value={test1Cpf} onChange={setTest1Cpf} />
              <Field label="Testemunha 1 — e-mail (para assinar)" value={test1Email} onChange={setTest1Email} />
              <Field label="Testemunha 2 — nome" value={test2Nome} onChange={setTest2Nome} />
              <Field label="Testemunha 2 — CPF" value={test2Cpf} onChange={setTest2Cpf} />
            </div>
            <p className="text-xs text-ink-muted">Assinam: cliente, contratado (CS Agência) e a testemunha 1 (por isso o e-mail dela).</p>
          </div>

          <div className={SECTION_CLS}>
            <h2 className="text-sm font-semibold text-ink-primary">Valores cobrados do cliente</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MoneyField label="Contrato" value={vAtracao} onChange={setVAtracao} />
            </div>
            <div className="rounded-md bg-surface-2 p-3 text-center text-sm">
              <div className="text-xs text-ink-muted">Total cobrado do cliente</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink-primary">R$ {fmt.format(totalCliente)}</div>
            </div>
            <ParcelasEditor label="Parcelas a receber do cliente" rows={receberCliente} onChange={setReceberCliente} total={totalCliente} onFillSingle={() => setReceberCliente([{ vencimento: eventDate, valorStr: brlFromNumber(totalCliente) }])} />
          </div>

          <div>
            <label className={LABEL_CLS}>Observação</label>
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-amber-500/40" />
          </div>
        </>
      ) : (
        <>
          <div className={SECTION_CLS}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-primary">Atração / Artista</h2>
              <ModeToggle mode={bandMode} setMode={setBandMode} hasExisting={bandsList.length > 0} />
            </div>
            {bandMode === "existing" ? (
              <SearchSelect
                items={bandsList.map((b) => ({ id: b.id, label: b.name, sub: b.cnpj_cpf }))}
                value={bandId}
                onChange={setBandId}
                placeholder="Buscar e selecionar a atração/artista…"
              />
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

          <div className={SECTION_CLS}>
            <h2 className="text-sm font-semibold text-ink-primary">Contrato do artista + pagamento</h2>
            <p className="text-xs text-ink-muted">Suba o contrato do artista e leia com OCR para pré-preencher valor e parcelas. Os títulos ficam pendentes até você lançar no Omie (contrato assinado).</p>
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
            {ocrMsg && <p className="text-xs text-emerald-600 dark:text-emerald-400">{ocrMsg}</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MoneyField label="Valor pago ao artista (custódia)" value={vArtista} onChange={setVArtista} />
            </div>
            {valArtista > valAtracao && valAtracao > 0 && <p className="text-xs text-red-500">Não pode ser maior que o valor do contrato cobrado do cliente (R$ {fmt.format(valAtracao)}).</p>}
            <ParcelasEditor label="Parcelas a pagar ao artista" rows={pagarArtista} onChange={setPagarArtista} total={valArtista} onFillSingle={() => setPagarArtista([{ vencimento: eventDate, valorStr: brlFromNumber(valArtista) }])} />
          </div>
        </>
      )}

      {/* Financeiro (placeholder até salvar/gerar títulos) */}
      {!edit && (
        <section className="rounded-lg border border-border bg-surface-1 p-4">
          <h2 className="text-sm font-semibold text-ink-primary">Financeiro</h2>
          <p className="mt-2 flex items-center gap-2 text-sm text-ink-muted"><Circle className="h-4 w-4" /> Os lançamentos aparecem aqui depois de salvar, no contrato.</p>
        </section>
      )}

      {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">{error}</div>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={() => router.push(edit ? `/case/contratos/${edit.id}` : "/case/contratos")} className="rounded-md border border-border px-4 py-2 text-sm text-ink-secondary hover:bg-surface-2">Cancelar</button>
        <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-md border border-amber-600 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60 dark:text-amber-400 dark:hover:bg-amber-950/30">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />} {edit ? "Salvar alterações" : "Salvar rascunho"}
        </button>
        <button type="button" onClick={() => handleSalvar(true)} disabled={submitting} className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />} {edit ? "Salvar e enviar para assinatura" : "Gerar e enviar para assinatura"}
        </button>
      </div>
    </form>
  );
}

function TabBtn({ active, done, label, onClick }: { active: boolean; done: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${active ? "border-amber-600 text-ink-primary" : "border-transparent text-ink-muted hover:text-ink-secondary"}`}>
      {done ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4 text-ink-muted" />}
      {label}
    </button>
  );
}

export function SearchSelect({ items, value, onChange, placeholder }: {
  items: Array<{ id: string; label: string; sub?: string | null }>;
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = items.find((i) => i.id === value);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((i) => `${i.label} ${i.sub ?? ""}`.toLowerCase().includes(q))
    : items;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={INPUT_CLS + " flex items-center justify-between gap-2 text-left"}
      >
        <span className={"truncate " + (selected ? "text-ink-primary" : "text-ink-muted")}>
          {selected ? `${selected.label}${selected.sub ? ` — ${selected.sub}` : ""}` : placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-ink-muted" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-border bg-surface-1 shadow-lg">
          <div className="p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome ou documento…" className={INPUT_CLS + " pl-8"} />
            </div>
          </div>
          <div className="max-h-64 overflow-auto pb-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-ink-muted">Nenhum resultado.</div>
            ) : (
              filtered.slice(0, 50).map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => { onChange(i.id); setQuery(""); setOpen(false); }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2 ${i.id === value ? "text-amber-600 dark:text-amber-400" : "text-ink-secondary"}`}
                >
                  <Check className={`h-4 w-4 shrink-0 ${i.id === value ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate">{i.label}{i.sub ? <span className="text-ink-muted"> — {i.sub}</span> : null}</span>
                </button>
              ))
            )}
            {filtered.length > 50 && (
              <div className="px-3 py-1.5 text-xs text-ink-muted">Mostrando 50 de {filtered.length} — refine a busca.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModeToggle({ mode, setMode, hasExisting }: { mode: "existing" | "new"; setMode: (m: "existing" | "new") => void; hasExisting: boolean }) {
  return (
    <div className="flex gap-1 text-xs">
      <button type="button" onClick={() => setMode("existing")} disabled={!hasExisting} className={`rounded px-2 py-1 ${mode === "existing" ? "bg-amber-600 text-white" : "text-ink-muted hover:bg-surface-2"} disabled:opacity-40`}>Selecionar</button>
      <button type="button" onClick={() => setMode("new")} className={`rounded px-2 py-1 ${mode === "new" ? "bg-amber-600 text-white" : "text-ink-muted hover:bg-surface-2"}`}>+ Novo</button>
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

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-secondary">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-border" />
      {label}
    </label>
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
