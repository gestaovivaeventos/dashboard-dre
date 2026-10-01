"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Info,
  Loader2,
  Plus,
  Search,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";

import {
  enviarViagem,
  getViagemDetalhe,
  reabrirViagem,
  salvarViagem,
  type ParadaInput,
  type ViagemDetalhe,
  type ViagemInput,
} from "@/lib/orcamento/actions/viagens";
import {
  getPreviaSetor,
  type PreviaSetorResumo,
} from "@/lib/orcamento/actions/planejamento-categoria";
import { getConversaViagem } from "@/lib/orcamento/actions/viagens-entrevista";
import { aplicarCartao, type CartaoViagem, type MensagemViagem } from "@/lib/viagens/cartao";
import { buscarPrecosDaViagem } from "@/lib/orcamento/actions/viagens-precos";
import { aplicarPrecos } from "@/lib/viagens/precos/aplicar";
import { formatBRL } from "@/lib/orcamento/format";
import { workspaceTabHref } from "@/lib/orcamento/workspace-tabs";
import { DecisaoLinha } from "@/components/orcamento/decisao-linha";
import { ViagemEntrevista } from "@/components/orcamento/viagem-entrevista";
import { PlanejamentoPreviaSetor } from "@/components/orcamento/planejamento-previa-setor";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ValidacaoEstado } from "@/lib/orcamento/validacao-diretoria";

/**
 * Tela de uma VIAGEM.
 *
 * ── Por que o custo aparece só depois de salvar ────────────────────────────
 * O número é do SERVIDOR: `salvarViagem` recalcula pelo motor com os parâmetros
 * vigentes e grava o retrato. Espelhar a conta aqui no cliente daria dois
 * lugares onde a mesma regra vive, e no dia em que divergissem a tela mostraria
 * um valor e o orçamento somaria outro — exatamente o defeito que o retrato
 * existe para impedir. Então a abertura exibida é sempre a ÚLTIMA GRAVADA, e o
 * botão avisa quando há mudança não salva.
 *
 * ── As premissas ficam à vista ────────────────────────────────────────────
 * Tudo o que o motor ARBITROU por falta de dado (diária padrão, passagem aérea
 * estimada por quilometragem) vira uma linha na caixa âmbar. É o que o diretor
 * precisa ler antes de aprovar: cotado e arbitrado não valem o mesmo.
 */

const MODAIS: Array<{ valor: string; label: string }> = [
  { valor: "carro", label: "Carro" },
  { valor: "onibus", label: "Ônibus" },
  { valor: "aviao", label: "Avião" },
  { valor: "van", label: "Van" },
  { valor: "outro", label: "Outro" },
];

/** Campo numérico opcional: vazio é `null`, não zero. */
function NumCampo({
  label,
  valor,
  onChange,
  placeholder,
  desabilitado,
  passo = "0.01",
}: {
  label: string;
  valor: number | null | undefined;
  onChange: (v: number | null) => void;
  placeholder?: string;
  desabilitado?: boolean;
  passo?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step={passo}
        min="0"
        value={valor ?? ""}
        placeholder={placeholder}
        disabled={desabilitado}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="h-9"
      />
    </div>
  );
}

function paradaVazia(): ParadaInput {
  return {
    cidade: "",
    noites: 1,
    chegadaDe: "",
    chegadaModal: "carro",
    chegadaDistanciaKm: null,
    chegadaPrecoPessoa: null,
    chegadaPrecoTotal: null,
    chegadaPedagios: null,
    chegadaVeiculos: null,
    diariaHotel: null,
    localTrajetosDia: null,
    localCustoTrajeto: null,
    localDestino: "",
    localEndereco: "",
  };
}

function inputDaViagem(v: ViagemDetalhe): ViagemInput {
  return {
    titulo: v.titulo,
    tipoId: v.tipoId,
    finalidade: v.finalidade,
    origem: v.origem,
    dataIda: v.dataIda,
    pessoas: v.pessoas,
    pessoasPorQuarto: v.pessoasPorQuarto,
    transladoCustoTrajeto: v.transladoCustoTrajeto,
    transladoTrajetos: v.transladoTrajetos,
    voltaModal: v.voltaModal,
    voltaDistanciaKm: v.voltaDistanciaKm,
    voltaPrecoPessoa: v.voltaPrecoPessoa,
    voltaPrecoTotal: v.voltaPrecoTotal,
    voltaPedagios: v.voltaPedagios,
    voltaVeiculos: v.voltaVeiculos,
    outros: v.outros,
    paradas: v.paradas.map((p) => ({ ...p })),
  };
}

export function ViagemMontagem({
  companyId,
  year,
  viagemId,
}: {
  companyId: string;
  year: number;
  viagemId: string;
}) {
  const [viagem, setViagem] = useState<ViagemDetalhe | null>(null);
  const [rascunho, setRascunho] = useState<ViagemInput | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sujo, setSujo] = useState(false);
  const [previa, setPrevia] = useState<PreviaSetorResumo | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [conversa, setConversa] = useState<MensagemViagem[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [resultadoBusca, setResultadoBusca] = useState<{
    aplicados: string[];
    ignorados: string[];
    fontes: string[];
    quando: string | null;
  } | null>(null);

  const carregarConversa = useCallback(async () => {
    const res = await getConversaViagem(companyId, year, viagemId);
    setConversa(res.conversa ?? []);
  }, [companyId, year, viagemId]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const res = await getViagemDetalhe(companyId, year, viagemId);
    if (res.error) setErro(res.error);
    if (res.viagem) {
      setViagem(res.viagem);
      setRascunho(inputDaViagem(res.viagem));
      setSujo(false);
    }
    setCarregando(false);
  }, [companyId, year, viagemId]);

  useEffect(() => {
    void carregar();
    void carregarConversa();
  }, [carregar, carregarConversa]);

  const carregarPrevia = useCallback(async () => {
    if (!viagem?.setorId) {
      setPrevia(null);
      return;
    }
    setCarregandoPrevia(true);
    const res = await getPreviaSetor(companyId, year, viagem.setorId, "");
    setPrevia(res.data ?? null);
    setCarregandoPrevia(false);
  }, [companyId, year, viagem?.setorId]);

  useEffect(() => {
    void carregarPrevia();
  }, [carregarPrevia]);

  function mexer(patch: Partial<ViagemInput>) {
    setRascunho((r) => (r ? { ...r, ...patch } : r));
    setSujo(true);
  }

  function mexerParada(i: number, patch: Partial<ParadaInput>) {
    setRascunho((r) => {
      if (!r) return r;
      const paradas = r.paradas.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
      return { ...r, paradas };
    });
    setSujo(true);
  }

  async function salvar() {
    if (!rascunho) return;
    setSalvando(true);
    setErro(null);
    const res = await salvarViagem(companyId, year, viagemId, rascunho);
    setSalvando(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    await carregar();
    void carregarPrevia();
  }

  async function enviar() {
    setSalvando(true);
    setErro(null);
    // Salva antes de enviar: enviar o que está na tela sem gravar mandaria para
    // o diretor um roteiro diferente do que ele vai ver.
    if (sujo && rascunho) {
      const s = await salvarViagem(companyId, year, viagemId, rascunho);
      if (s.error) {
        setSalvando(false);
        setErro(s.error);
        return;
      }
    }
    const res = await enviarViagem(companyId, year, viagemId);
    setSalvando(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    await carregar();
    void carregarPrevia();
  }

  /**
   * Pesquisa os preços na web e preenche o que está VAZIO.
   *
   * Não grava: mexe no rascunho, como o cartão da IA. Preço que a pessoa digitou
   * nunca é sobrescrito (`aplicarPrecos`) — quem digitou quase sempre tem a
   * cotação na mão, e trocá-la pelo menor preço da web rebaixaria o orçamento com
   * aparência de pesquisa.
   */
  async function buscarPrecos() {
    if (!rascunho) return;
    setBuscando(true);
    setErro(null);
    setResultadoBusca(null);
    const res = await buscarPrecosDaViagem(companyId, year, viagemId);
    setBuscando(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    if (res.nadaACotar) {
      setResultadoBusca({
        aplicados: [],
        ignorados: ["O roteiro não tem trecho de avião/ônibus a cotar nem noite sem diária."],
        fontes: [],
        quando: res.quando ?? null,
      });
      return;
    }
    if (!res.proposta) return;
    const r = aplicarPrecos(rascunho, res.proposta);
    setRascunho(r.roteiro);
    if (r.aplicados.length > 0) setSujo(true);
    setResultadoBusca({
      aplicados: r.aplicados,
      ignorados: r.ignorados,
      fontes: res.fontes ?? [],
      quando: res.quando ?? null,
    });
  }

  async function reabrir() {
    setSalvando(true);
    const res = await reabrirViagem(companyId, year, viagemId);
    setSalvando(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    await carregar();
    void carregarPrevia();
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando a viagem…
      </div>
    );
  }

  if (!viagem || !rascunho) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro ?? "Viagem não encontrada."}</span>
        </div>
        <Link
          href={workspaceTabHref(companyId, year, "viagens")}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Voltar às viagens
        </Link>
      </div>
    );
  }

  const editavel = !viagem.travado && !viagem.finalizado;

  return (
    <div className="space-y-5">
      {/* ── Cabeçalho ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href={workspaceTabHref(companyId, year, "viagens")}
            className={buttonVariants({
              variant: "ghost",
              size: "sm",
              className: "-ml-2 h-7 px-2",
            })}
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Viagens
          </Link>
          <h2 className="text-xl font-bold tracking-tight">{viagem.titulo}</h2>
          <p className="text-xs text-muted-foreground">
            {viagem.setorNome ? `${viagem.setorNome} · ` : ""}
            {viagem.status === "enviada" ? "No orçamento" : "Rascunho — ainda fora do orçamento"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DecisaoLinha
            companyId={companyId}
            year={year}
            alvoTipo="viagem"
            alvoId={viagem.id}
            setorId={viagem.setorId}
            rotulo={viagem.titulo}
            estado={viagem.estado as ValidacaoEstado}
            comentario={viagem.comentario}
            podeValidar={viagem.podeValidar && viagem.status === "enviada"}
            onError={(m) => setErro(m)}
            onDecidiu={() => {
              void carregar();
              void carregarPrevia();
            }}
          />
        </div>
      </div>

      {viagem.finalizado && (
        <div className="rounded-md border border-muted bg-muted/40 p-3 text-sm text-muted-foreground">
          Esta categoria foi finalizada neste setor: o valor já está no Budget e ninguém edita —
          nem o administrador — até que a fatia seja reaberta.
        </div>
      )}
      {viagem.travado && !viagem.finalizado && (
        <div className="rounded-md border border-muted bg-muted/40 p-3 text-sm text-muted-foreground">
          A diretoria já decidiu sobre esta viagem, então ela saiu das suas mãos. Se precisar
          mudar algo, peça ao diretor para marcá-la como “revisar”.
        </div>
      )}
      {erro && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ── O ROTEIRO ── */}
        <div className="space-y-4">
          {/* A conversa vem ANTES do formulário: é por ela que se começa, e o
              cartão que ela propõe preenche os campos abaixo. */}
          <ViagemEntrevista
            companyId={companyId}
            year={year}
            viagemId={viagemId}
            titulo={viagem.titulo}
            cidades={viagem.cidades}
            conversa={conversa}
            podeEscrever={editavel}
            onCartao={(c: CartaoViagem) => {
              // Só mexe no RASCUNHO. Gravar continua sendo "Salvar e calcular",
              // que é onde o custo é calculado e as travas valem.
              setRascunho((r) => (r ? aplicarCartao(r, c) : r));
              setSujo(true);
            }}
            onConversaMudou={() => void carregarConversa()}
          />

          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="text-sm font-semibold">A viagem</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Título</Label>
                <Input
                  value={rascunho.titulo}
                  disabled={!editavel}
                  onChange={(e) => mexer({ titulo: e.target.value })}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo da viagem</Label>
                <select
                  value={rascunho.tipoId ?? ""}
                  disabled={!editavel}
                  onChange={(e) => mexer({ tipoId: e.target.value || null })}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                >
                  <option value="">Escolha…</option>
                  {viagem.tiposDisponiveis.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                  {/* O tipo gravado pode não estar mais na lista (desativado ou
                      desmapeado pelo admin). Mostrá-lo evita que salvar troque o
                      tipo da viagem em silêncio por causa de um <select> vazio. */}
                  {viagem.tipoId &&
                    !viagem.tiposDisponiveis.some((t) => t.id === viagem.tipoId) && (
                      <option value={viagem.tipoId}>
                        {viagem.tipoNome ?? "tipo atual"} (fora do cadastro)
                      </option>
                    )}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  Decide a conta da DRE. Trocar o tipo e salvar reclassifica esta viagem.
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cidade de origem</Label>
                <Input
                  value={rascunho.origem}
                  disabled={!editavel}
                  placeholder="Juiz de Fora"
                  onChange={(e) => mexer({ origem: e.target.value })}
                  className="h-9"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Para que serve esta viagem?</Label>
                <Input
                  value={rascunho.finalidade ?? ""}
                  disabled={!editavel}
                  placeholder="Implantação do sistema nas duas unidades novas"
                  onChange={(e) => mexer({ finalidade: e.target.value })}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Data de ida</Label>
                <Input
                  type="date"
                  value={rascunho.dataIda ?? ""}
                  disabled={!editavel}
                  onChange={(e) => mexer({ dataIda: e.target.value || null })}
                  className="h-9"
                />
              </div>
              <NumCampo
                label="Pessoas"
                passo="1"
                valor={rascunho.pessoas}
                desabilitado={!editavel}
                onChange={(v) => mexer({ pessoas: v ?? 1 })}
              />
              <NumCampo
                label="Pessoas por quarto"
                passo="1"
                valor={rascunho.pessoasPorQuarto}
                desabilitado={!editavel}
                onChange={(v) => mexer({ pessoasPorQuarto: v ?? 1 })}
              />
              <div className="flex items-end pb-2 text-xs text-muted-foreground">
                1 = cada um no seu quarto. Muda a hospedagem em até 2×.
              </div>
            </div>
          </section>

          {/* ── Paradas ── */}
          <section className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Roteiro</h3>
              {editavel && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => mexer({ paradas: [...rascunho.paradas, paradaVazia()] })}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Parada
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Cada parada carrega o trecho de chegada até ela. Deixando a origem em branco, ela é a
              cidade anterior — a volta à origem fica no bloco abaixo.
            </p>

            {rascunho.paradas.length === 0 && (
              <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                Sem parada nenhuma a viagem não tem custo. Acrescente a primeira.
              </p>
            )}

            {rascunho.paradas.map((p, i) => (
              <div key={i} className="space-y-3 rounded-md border bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                    Parada {i + 1}
                  </span>
                  {editavel && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() =>
                        mexer({ paradas: rascunho.paradas.filter((_, idx) => idx !== i) })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Cidade</Label>
                    <Input
                      value={p.cidade}
                      disabled={!editavel}
                      onChange={(e) => mexerParada(i, { cidade: e.target.value })}
                      className="h-9"
                    />
                  </div>
                  <NumCampo
                    label="Noites"
                    passo="1"
                    valor={p.noites}
                    desabilitado={!editavel}
                    onChange={(v) => mexerParada(i, { noites: v ?? 0 })}
                  />
                  <NumCampo
                    label="Diária do hotel"
                    valor={p.diariaHotel}
                    placeholder="usa o padrão"
                    desabilitado={!editavel}
                    onChange={(v) => mexerParada(i, { diariaHotel: v })}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Sai de</Label>
                    <Input
                      value={p.chegadaDe ?? ""}
                      disabled={!editavel}
                      placeholder={i === 0 ? rascunho.origem || "origem" : "cidade anterior"}
                      onChange={(e) => mexerParada(i, { chegadaDe: e.target.value })}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Como vai</Label>
                    <select
                      value={p.chegadaModal ?? "carro"}
                      disabled={!editavel}
                      onChange={(e) => mexerParada(i, { chegadaModal: e.target.value })}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                    >
                      {MODAIS.map((m) => (
                        <option key={m.valor} value={m.valor}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <NumCampo
                    label="Distância (km)"
                    valor={p.chegadaDistanciaKm}
                    desabilitado={!editavel}
                    onChange={(v) => mexerParada(i, { chegadaDistanciaKm: v })}
                  />
                  <NumCampo
                    label="Preço por pessoa"
                    valor={p.chegadaPrecoPessoa}
                    placeholder="se já cotado"
                    desabilitado={!editavel}
                    onChange={(v) => mexerParada(i, { chegadaPrecoPessoa: v })}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <NumCampo
                    label="Preço fechado do trecho"
                    valor={p.chegadaPrecoTotal}
                    placeholder="vence os demais"
                    desabilitado={!editavel}
                    onChange={(v) => mexerParada(i, { chegadaPrecoTotal: v })}
                  />
                  <NumCampo
                    label="Pedágios"
                    valor={p.chegadaPedagios}
                    desabilitado={!editavel}
                    onChange={(v) => mexerParada(i, { chegadaPedagios: v })}
                  />
                  <NumCampo
                    label="Veículos"
                    passo="1"
                    valor={p.chegadaVeiculos}
                    placeholder="1"
                    desabilitado={!editavel}
                    onChange={(v) => mexerParada(i, { chegadaVeiculos: v })}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Destino do dia a dia</Label>
                    <Input
                      value={p.localDestino ?? ""}
                      disabled={!editavel}
                      placeholder="Viva Eventos Curitiba, salão do evento…"
                      onChange={(e) => mexerParada(i, { localDestino: e.target.value })}
                      className="h-9"
                    />
                  </div>
                  <NumCampo
                    label="Trajetos por dia"
                    passo="1"
                    valor={p.localTrajetosDia}
                    placeholder="2"
                    desabilitado={!editavel}
                    onChange={(v) => mexerParada(i, { localTrajetosDia: v })}
                  />
                  <NumCampo
                    label="Custo do trajeto"
                    valor={p.localCustoTrajeto}
                    desabilitado={!editavel}
                    onChange={(v) => mexerParada(i, { localCustoTrajeto: v })}
                  />
                </div>
              </div>
            ))}
          </section>

          {/* ── Volta e translado ── */}
          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="text-sm font-semibold">Volta à origem</h3>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">Como volta</Label>
                <select
                  value={rascunho.voltaModal ?? ""}
                  disabled={!editavel}
                  onChange={(e) => mexer({ voltaModal: e.target.value || null })}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                >
                  <option value="">Sem volta</option>
                  {MODAIS.map((m) => (
                    <option key={m.valor} value={m.valor}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <NumCampo
                label="Distância (km)"
                valor={rascunho.voltaDistanciaKm}
                desabilitado={!editavel}
                onChange={(v) => mexer({ voltaDistanciaKm: v })}
              />
              <NumCampo
                label="Preço por pessoa"
                valor={rascunho.voltaPrecoPessoa}
                desabilitado={!editavel}
                onChange={(v) => mexer({ voltaPrecoPessoa: v })}
              />
              <NumCampo
                label="Preço fechado"
                valor={rascunho.voltaPrecoTotal}
                desabilitado={!editavel}
                onChange={(v) => mexer({ voltaPrecoTotal: v })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <NumCampo
                label="Pedágios da volta"
                valor={rascunho.voltaPedagios}
                desabilitado={!editavel}
                onChange={(v) => mexer({ voltaPedagios: v })}
              />
              <NumCampo
                label="Veículos"
                passo="1"
                valor={rascunho.voltaVeiculos}
                placeholder="1"
                desabilitado={!editavel}
                onChange={(v) => mexer({ voltaVeiculos: v })}
              />
              <NumCampo
                label="Translado: custo do trajeto"
                valor={rascunho.transladoCustoTrajeto}
                desabilitado={!editavel}
                onChange={(v) => mexer({ transladoCustoTrajeto: v })}
              />
              <NumCampo
                label="Translado: trajetos"
                passo="1"
                valor={rascunho.transladoTrajetos}
                placeholder="2"
                desabilitado={!editavel}
                onChange={(v) => mexer({ transladoTrajetos: v })}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Translado é casa ↔ terminal (aeroporto, rodoviária). O deslocamento do dia a dia, na
              cidade, fica em cada parada.
            </p>
          </section>

          {/* ── Outros custos ── */}
          <section className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Outros custos</h3>
              {editavel && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    mexer({ outros: [...(rascunho.outros ?? []), { descricao: "", valor: 0 }] })
                  }
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Linha
                </Button>
              )}
            </div>
            {(rascunho.outros ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">
                Inscrição em evento, seguro, bagagem despachada.
              </p>
            )}
            {(rascunho.outros ?? []).map((o, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Descrição</Label>
                  <Input
                    value={o.descricao}
                    disabled={!editavel}
                    onChange={(e) => {
                      const outros = (rascunho.outros ?? []).map((x, idx) =>
                        idx === i ? { ...x, descricao: e.target.value } : x,
                      );
                      mexer({ outros });
                    }}
                    className="h-9"
                  />
                </div>
                <div className="w-36">
                  <NumCampo
                    label="Valor"
                    valor={o.valor}
                    desabilitado={!editavel}
                    onChange={(v) => {
                      const outros = (rascunho.outros ?? []).map((x, idx) =>
                        idx === i ? { ...x, valor: v ?? 0 } : x,
                      );
                      mexer({ outros });
                    }}
                  />
                </div>
                {editavel && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mb-0.5"
                    onClick={() =>
                      mexer({ outros: (rascunho.outros ?? []).filter((_, idx) => idx !== i) })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                )}
              </div>
            ))}
          </section>

          {/* ── Ações ── */}
          {editavel && (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void salvar()} disabled={salvando}>
                {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Salvar e calcular
              </Button>
              <Button
                variant="outline"
                onClick={() => void buscarPrecos()}
                disabled={salvando || buscando}
                title="Pesquisa passagem e hotel na web e preenche o que estiver vazio"
              >
                {buscando ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-1.5 h-4 w-4" />
                )}
                Buscar preços
              </Button>
              {viagem.status === "rascunho" ? (
                <Button variant="outline" onClick={() => void enviar()} disabled={salvando}>
                  <Send className="mr-1.5 h-4 w-4" />
                  Enviar ao orçamento
                </Button>
              ) : (
                <Button variant="outline" onClick={() => void reabrir()} disabled={salvando}>
                  <Undo2 className="mr-1.5 h-4 w-4" />
                  Voltar a rascunho
                </Button>
              )}
              {sujo && (
                <span className="text-xs text-amber-700 dark:text-amber-500">
                  Há mudanças não salvas — o custo abaixo é o do último cálculo.
                </span>
              )}
            </div>
          )}
          {/* ── O que a busca trouxe ──
              Mostrar o que FICOU DE FORA é metade do valor disto: busca que
              "não fez nada" sem dizer o motivo faz a pessoa clicar de novo. */}
          {resultadoBusca && (
            <div className="space-y-2 rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 text-xs">
              <p className="font-semibold text-sky-700 dark:text-sky-400">
                Preços pesquisados{resultadoBusca.quando ? ` para ${resultadoBusca.quando}` : ""}
              </p>
              {resultadoBusca.aplicados.length > 0 ? (
                <ul className="space-y-0.5">
                  {resultadoBusca.aplicados.map((a, i) => (
                    <li key={i}>• {a}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">Nada foi preenchido.</p>
              )}
              {resultadoBusca.ignorados.length > 0 && (
                <div className="text-muted-foreground">
                  <p className="font-medium">Não preenchido:</p>
                  <ul className="space-y-0.5">
                    {resultadoBusca.ignorados.map((x, i) => (
                      <li key={i}>• {x}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-muted-foreground">
                <strong>É referência, não cotação.</strong> Para uma viagem do ano que vem a tarifa
                ainda não foi publicada em lugar nenhum — o que se achou é o menor preço de hoje para
                a rota naquele mês. Confira antes de enviar, e salve para recalcular.
              </p>
              {resultadoBusca.fontes.length > 0 && (
                <p className="break-all text-muted-foreground">
                  Fontes:{" "}
                  {resultadoBusca.fontes.map((f, i) => (
                    <span key={f}>
                      {i > 0 ? " · " : ""}
                      <a
                        href={f}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        {new URL(f).hostname}
                      </a>
                    </span>
                  ))}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── O CUSTO (retrato gravado) ── */}
        <aside className="space-y-3">
          <div className="rounded-lg border p-4">
            <p className="text-xs uppercase text-muted-foreground">Custo da viagem</p>
            <p className="text-2xl font-bold tabular-nums">{formatBRL(viagem.custoTotal)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Calculado pelo sistema a partir do roteiro, não digitado.
            </p>

            <div className="mt-3 space-y-3">
              {viagem.grupos.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Complete o roteiro e clique em “Salvar e calcular”.
                </p>
              )}
              {viagem.grupos.map((g) => (
                <div key={g.grupo}>
                  <div className="flex items-baseline justify-between gap-2 border-b pb-1">
                    <span className="text-xs font-semibold">{g.label}</span>
                    <span className="text-xs font-semibold tabular-nums">
                      {formatBRL(g.total)}
                    </span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {g.linhas.map((l, i) => (
                      <li
                        key={i}
                        className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground"
                      >
                        <span>{l.descricao}</span>
                        <span className="shrink-0 tabular-nums">{formatBRL(l.valor)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {viagem.premissas.length > 0 && (
            <div
              className={cn(
                "rounded-lg border p-3 text-xs",
                "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
              )}
            >
              <p className="mb-1.5 flex items-center gap-1.5 font-semibold">
                <Info className="h-3.5 w-3.5" />
                O que foi estimado
              </p>
              <ul className="space-y-1">
                {viagem.premissas.map((p, i) => (
                  <li key={i}>• {p}</li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {/* ── Prévia do setor, como nas outras telas de método ── */}
      {viagem.setorId && (
        <PlanejamentoPreviaSetor
          resumo={previa}
          carregando={carregandoPrevia}
          setorNome={viagem.setorNome ?? "Setor"}
          year={year}
          companyId={companyId}
          onDecidiu={() => {
            void carregar();
            void carregarPrevia();
          }}
          metodoContagem="viagens"
        />
      )}
    </div>
  );
}
