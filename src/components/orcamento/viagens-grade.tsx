"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

import {
  getGradeViagens,
  salvarGradeViagens,
  type GradeSetup,
  type LinhaGrade,
} from "@/lib/orcamento/actions/viagens-grade";
import { removerViagem } from "@/lib/orcamento/actions/viagens";
import { PESSOAS_POR_QUARTO_PADRAO, type LinhaViagemInput } from "@/lib/viagens/grade";
import type { LinhaResolvida } from "@/lib/viagens/plano";
import { formatBRL } from "@/lib/orcamento/format";
import { workspaceConfigSecaoHref, viagemHref } from "@/lib/orcamento/workspace-tabs";
import { DecisaoLinha } from "@/components/orcamento/decisao-linha";
import { MigrationAviso } from "@/components/orcamento/migration-aviso";
import { ViagensFinalizar } from "@/components/orcamento/viagens-finalizar";
import { ViagensPlanoIntake } from "@/components/orcamento/viagens-plano-intake";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ValidacaoEstado } from "@/lib/orcamento/validacao-diretoria";

/**
 * A GRADE de viagens — uma linha por viagem.
 *
 * ── Por que ela substituiu a conversa como caminho principal ──────────────
 * Um gestor de Consultoria orça ~50 viagens por ano, a destinos que quase não se
 * repetem. Uma conversa e um formulário de 40 campos por viagem custavam minutos
 * por linha, o que dá horas. Aqui ele digita QUATRO coisas por viagem — destino,
 * mês, noites, pessoas — e o resto é derivado (ver `grade.ts`).
 *
 * ── A árvore abre NA LINHA ────────────────────────────────────────────────
 * O diretor aprova cada viagem, e precisa ver o custo separado por grupo. Então a
 * linha expande para a abertura que o motor já produz. A decisão continua sendo
 * da VIAGEM — a árvore é exibição. Tornar o grupo decidível devolveria os 50
 * cliques multiplicados por seis.
 *
 * ── Não há prévia do setor aqui, de propósito ────────────────────────────
 * Nos outros métodos a validação acontece na prévia do setor. Aqui a grade já É a
 * lista com a árvore e o ✓ na linha; repetir a prévia embaixo renderizaria o
 * conjunto duas vezes numa tela de 50 linhas, e o diretor decidiria no mesmo
 * lugar duas vezes. O conjunto do setor continua a um clique, na Prévia.
 */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const MODAIS = [
  { valor: "", label: "(da faixa)" },
  { valor: "aviao", label: "Avião" },
  { valor: "onibus", label: "Ônibus" },
  { valor: "carro", label: "Carro" },
  { valor: "van", label: "Van" },
  { valor: "outro", label: "Outro" },
];

/** Uma linha no estado da TELA: a do servidor + o que foi digitado. */
interface Rascunho extends LinhaViagemInput {
  /** Chave estável de render. Linha nova não tem id ainda. */
  key: string;
  sujo: boolean;
  erro?: string | null;
  /** O que veio do servidor — some quando a linha é nova. */
  servidor?: LinhaGrade;
}

let seq = 0;
function novaKey(): string {
  seq += 1;
  return `nova-${seq}`;
}

function doServidor(l: LinhaGrade): Rascunho {
  return {
    key: l.id,
    id: l.id,
    destino: l.destino,
    mesIda: l.mesIda,
    noites: l.noites,
    pessoas: l.pessoas,
    pessoasPorQuarto: l.pessoasPorQuarto,
    tipoId: l.tipoId ?? "",
    faixaPassagemId: l.faixaPassagemId,
    faixaHospedagemId: l.faixaHospedagemId,
    modal: l.modal,
    distanciaKm: l.distanciaKm,
    finalidade: l.finalidade,
    sujo: false,
    servidor: l,
  };
}

function linhaVazia(padroes: { tipoId: string; faixaPassagemId: string; faixaHospedagemId: string }): Rascunho {
  return {
    key: novaKey(),
    destino: "",
    mesIda: null,
    noites: 1,
    pessoas: 1,
    pessoasPorQuarto: PESSOAS_POR_QUARTO_PADRAO,
    tipoId: padroes.tipoId,
    faixaPassagemId: padroes.faixaPassagemId || null,
    faixaHospedagemId: padroes.faixaHospedagemId || null,
    sujo: true,
  };
}

/**
 * Linha lida pela IA → rascunho da grade.
 *
 * Ela nasce SUJA: é o que faz "Salvar e calcular" enxergá-la. E nasce sem `id`,
 * porque leitura cria viagem nova — nunca sobrescreve a que já está na grade.
 */
function doPlano(
  l: LinhaResolvida,
  padroes: { tipoId: string; faixaPassagemId: string; faixaHospedagemId: string },
): Rascunho {
  return {
    key: novaKey(),
    destino: l.destino,
    mesIda: l.mesIda,
    noites: l.noites,
    pessoas: l.pessoas,
    pessoasPorQuarto: l.pessoasPorQuarto ?? PESSOAS_POR_QUARTO_PADRAO,
    tipoId: l.tipoId || padroes.tipoId,
    faixaPassagemId: l.faixaPassagemId ?? (padroes.faixaPassagemId || null),
    faixaHospedagemId: l.noites > 0 ? l.faixaHospedagemId ?? (padroes.faixaHospedagemId || null) : null,
    modal: l.modal,
    finalidade: l.finalidade,
    sujo: true,
  };
}

const ESTADO_MARCA: Record<string, { texto: string; classe: string }> = {
  aprovado: { texto: "aprovada", classe: "text-emerald-700 dark:text-emerald-400" },
  reprovado: { texto: "reprovada", classe: "text-red-700 dark:text-red-400" },
  revisar: { texto: "revisar", classe: "text-amber-700 dark:text-amber-500" },
};

const SEM_SETOR = "__todos__";

export function ViagensGrade({ companyId, year }: { companyId: string; year: number }) {
  const [setup, setSetup] = useState<GradeSetup | null>(null);
  const [setorId, setSetorId] = useState<string>(SEM_SETOR);
  const [linhas, setLinhas] = useState<Rascunho[]>([]);
  const [origem, setOrigem] = useState("");
  const [translado, setTranslado] = useState<number | null>(null);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const setorEscolhido = setorId === SEM_SETOR ? null : setorId;

  const carregar = useCallback(async () => {
    setCarregando(true);
    const res = await getGradeViagens(companyId, year, setorEscolhido);
    if (res.error) setErro(res.error);
    setSetup(res);
    setLinhas((res.linhas ?? []).map(doServidor));
    setOrigem(res.origemPadrao ?? "");
    setTranslado(res.transladoPadrao ?? null);
    setCarregando(false);
  }, [companyId, year, setorEscolhido]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const tipos = setup?.tipos ?? [];
  const faixasPassagem = useMemo(
    () => (setup?.faixas ?? []).filter((f) => f.tipo === "passagem"),
    [setup?.faixas],
  );
  const faixasHospedagem = useMemo(
    () => (setup?.faixas ?? []).filter((f) => f.tipo === "hospedagem"),
    [setup?.faixas],
  );

  /** Padrões da linha nova: o primeiro de cada cadastro. Evita três cliques por linha. */
  const padroes = {
    tipoId: tipos[0]?.id ?? "",
    faixaPassagemId: faixasPassagem[0]?.id ?? "",
    faixaHospedagemId: faixasHospedagem[0]?.id ?? "",
  };

  function mexer(key: string, patch: Partial<LinhaViagemInput>) {
    setLinhas((ls) =>
      ls.map((l) => (l.key === key ? { ...l, ...patch, sujo: true, erro: null } : l)),
    );
  }

  function acrescentar(quantas = 1) {
    setLinhas((ls) => [...ls, ...Array.from({ length: quantas }, () => linhaVazia(padroes))]);
  }

  /**
   * O plano lido pela IA entra no FIM da grade, sem tocar no que já está lá.
   *
   * Substituir seria perder o que o gestor já digitou, e casar linha a linha com
   * o que existe exigiria adivinhar qual viagem é qual — duas idas a São Paulo
   * são indistinguíveis. Acrescentar é reversível: linha a mais ele exclui.
   */
  function receberPlano(lidas: LinhaResolvida[]) {
    if (lidas.length === 0) return;
    setErro(null);
    setLinhas((ls) => [...ls, ...lidas.map((l) => doPlano(l, padroes))]);
  }

  async function salvar() {
    const paraSalvar = linhas.filter((l) => l.sujo);
    if (paraSalvar.length === 0) {
      setAviso("Nada mudou.");
      return;
    }
    if (!origem.trim()) {
      setErro("Informe a cidade de partida do time, no topo.");
      return;
    }
    setSalvando(true);
    setErro(null);
    setAviso(null);

    const res = await salvarGradeViagens(
      companyId,
      year,
      setorEscolhido,
      origem.trim(),
      translado,
      paraSalvar.map((l) => ({
        id: l.id,
        destino: l.destino,
        mesIda: l.mesIda,
        noites: l.noites,
        pessoas: l.pessoas,
        pessoasPorQuarto: l.pessoasPorQuarto,
        tipoId: l.tipoId,
        faixaPassagemId: l.faixaPassagemId,
        faixaHospedagemId: l.faixaHospedagemId,
        modal: l.modal,
        distanciaKm: l.distanciaKm,
        finalidade: l.finalidade,
      })),
    );
    setSalvando(false);

    if (res.needsMigration) {
      setErro("Falta aplicar a migration das faixas de viagem.");
      return;
    }
    if (res.error) {
      setErro(res.error);
      return;
    }

    // O erro volta por ÍNDICE: a tela o devolve à linha que o causou, em vez de
    // mostrar "3 linhas falharam" sem dizer quais.
    const porIndice = new Map(res.resultados.map((r) => [r.indice, r] as const));
    setLinhas((ls) => {
      let i = -1;
      return ls.map((l) => {
        if (!l.sujo) return l;
        i += 1;
        const r = porIndice.get(i);
        if (r?.erro) return { ...l, erro: r.erro };
        return l;
      });
    });

    const { gravadas, comErro } = res.resumo;
    setAviso(
      comErro === 0
        ? `${gravadas} viagem(ns) salva(s).`
        : `${gravadas} salva(s), ${comErro} com problema — veja as linhas marcadas.`,
    );
    // Recarrega para trazer o custo recalculado e a árvore de cada linha.
    if (gravadas > 0) await carregar();
  }

  async function excluir(l: Rascunho) {
    if (!l.id) {
      setLinhas((ls) => ls.filter((x) => x.key !== l.key));
      return;
    }
    if (!window.confirm(`Excluir a viagem para ${l.destino || "(sem destino)"}?`)) return;
    const res = await removerViagem(companyId, year, l.id);
    if (res.error) {
      setErro(res.error);
      return;
    }
    void carregar();
  }

  if (carregando && !setup) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando a grade…
      </div>
    );
  }

  if (setup?.needsMigration) {
    return (
      <MigrationAviso
        migration="20261002140000_orcamento_viagem_faixas.sql"
        tabela="orcamento_viagem_faixas"
      />
    );
  }

  // Vocabulário do ditado: as cidades que já estão na grade. Nome próprio é
  // exatamente para o que o vocabulário serve.
  const cidadesConhecidas = Array.from(
    new Set(linhas.map((l) => l.destino.trim()).filter((d) => d !== "")),
  );
  const totalGrade = linhas.reduce((a, l) => a + (l.servidor?.custoTotal ?? 0), 0);
  const sujas = linhas.filter((l) => l.sujo).length;
  const podeEditarRecorte = setorEscolhido
    ? setup?.setores.find((s) => s.id === setorEscolhido)?.podeEscrever ?? false
    : (setup?.podeEditar ?? false);

  return (
    <div className="space-y-4">
      {/* ── Contexto do time: origem e translado valem para a grade inteira ── */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        {setup?.orcaPorSetor && (
          <div className="space-y-1">
            <Label htmlFor="grade-setor" className="text-xs">
              Setor
            </Label>
            <select
              id="grade-setor"
              value={setorId}
              onChange={(e) => setSetorId(e.target.value)}
              className="h-9 min-w-[14rem] rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value={SEM_SETOR}>Todos os setores</option>
              {setup.setores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.podeEscrever ? "" : " (somente leitura)"}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="grade-origem" className="text-xs">
            Partem de
          </Label>
          <Input
            id="grade-origem"
            value={origem}
            onChange={(e) => setOrigem(e.target.value)}
            placeholder="Juiz de Fora"
            className="h-9 w-48"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="grade-translado" className="text-xs">
            Translado (um trajeto)
          </Label>
          <Input
            id="grade-translado"
            type="number"
            step="0.01"
            min="0"
            value={translado ?? ""}
            onChange={(e) => setTranslado(e.target.value === "" ? null : Number(e.target.value))}
            placeholder="casa ↔ aeroporto"
            className="h-9 w-40"
          />
        </div>
        <p className="pb-2 text-xs text-muted-foreground">
          Valem para todas as linhas. O translado entra só nas viagens aéreas.
        </p>
      </div>

      {erro && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}
      {aviso && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">{aviso}</div>
      )}

      {/* ── Cadastros que faltam: sem eles toda linha sai zerada ── */}
      {tipos.length === 0 && (
        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <p className="font-semibold">Nenhum tipo de viagem mapeado.</p>
          <p className="mt-1 text-muted-foreground">
            A viagem entra na DRE pelo tipo.{" "}
            <Link
              href={workspaceConfigSecaoHref(companyId, year, "viagem-tipos")}
              className="font-medium underline underline-offset-2"
            >
              Configuração › Tipos de viagem
            </Link>
            .
          </p>
        </div>
      )}
      {setup?.semFaixas && tipos.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-semibold">Nenhuma faixa de custo tem valor cadastrado.</p>
          <p className="mt-1 text-muted-foreground">
            Destino com <strong>histórico</strong> de viagem realizada é precificado mesmo assim (a
            etiqueta <em>hist</em> marca quais). Os outros saem com custo zero — dito em premissa,
            nunca escondido. A faixa é a rede para eles, em{" "}
            <Link
              href={workspaceConfigSecaoHref(companyId, year, "viagem-faixas")}
              className="font-medium underline underline-offset-2"
            >
              Configuração › Faixas de custo
            </Link>
            .
          </p>
        </div>
      )}

      {/* ── O caminho principal com 50 viagens: ditar ou colar o plano ── */}
      {podeEditarRecorte && tipos.length > 0 && (
        <ViagensPlanoIntake
          companyId={companyId}
          year={year}
          setorId={setorEscolhido}
          origem={origem}
          cidadesConhecidas={cidadesConhecidas}
          disabled={salvando}
          onLinhas={receberPlano}
        />
      )}

      {/* ── A grade ── */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-6 px-1 py-2" />
              <th className="px-2 py-2 text-left font-medium">Destino</th>
              <th className="px-2 py-2 text-left font-medium">Mês</th>
              <th className="px-2 py-2 text-right font-medium">Noites</th>
              <th className="px-2 py-2 text-right font-medium">Pessoas</th>
              <th className="px-2 py-2 text-right font-medium">Quartos</th>
              <th className="px-2 py-2 text-left font-medium">Tipo</th>
              <th className="px-2 py-2 text-left font-medium">Faixa</th>
              <th className="px-2 py-2 text-left font-medium">Hotel</th>
              <th className="px-2 py-2 text-left font-medium">Modal</th>
              <th className="px-2 py-2 text-right font-medium">Custo</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const s = l.servidor;
              const bloqueada = Boolean(s?.travado || s?.finalizado);
              const editavel = podeEditarRecorte && !bloqueada;
              const aberta = abertas.has(l.key);
              const quartos = Math.ceil(
                Math.max(1, Number(l.pessoas) || 1) /
                  Math.max(1, Number(l.pessoasPorQuarto) || PESSOAS_POR_QUARTO_PADRAO),
              );
              const marca = s ? ESTADO_MARCA[s.estado] : undefined;

              return (
                <>
                  <tr key={l.key} className={cn("border-t", l.erro && "bg-red-500/5")}>
                    <td className="px-1 py-1 align-middle">
                      <button
                        type="button"
                        onClick={() =>
                          setAbertas((a) => {
                            const n = new Set(a);
                            if (n.has(l.key)) n.delete(l.key);
                            else n.add(l.key);
                            return n;
                          })
                        }
                        className="text-muted-foreground hover:text-foreground"
                        title="Abrir a abertura de custos"
                        disabled={!s}
                      >
                        {aberta ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className={cn("h-4 w-4", !s && "opacity-30")} />
                        )}
                      </button>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={l.destino}
                          disabled={!editavel}
                          onChange={(e) => mexer(l.key, { destino: e.target.value })}
                          placeholder="Cidade"
                          className="h-8 min-w-[9rem]"
                        />
                        {/* Custo OBSERVADO naquele destino, não estimado por região:
                            é a leitura que diz quanto do orçamento está ancorado em
                            fato. A premissa da linha tem a conta inteira. */}
                        {s?.temHistorico && (
                          <span
                            title="O custo deste destino vem do histórico de viagens realizadas, reajustado."
                            className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-400"
                          >
                            hist
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={l.mesIda ?? ""}
                        disabled={!editavel}
                        onChange={(e) =>
                          mexer(l.key, { mesIda: e.target.value === "" ? null : Number(e.target.value) })
                        }
                        className="h-8 rounded-md border border-input bg-background px-1 text-sm disabled:opacity-50"
                      >
                        <option value="">—</option>
                        {MESES.map((m, i) => (
                          <option key={m} value={i + 1}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={l.noites}
                        disabled={!editavel}
                        onChange={(e) => mexer(l.key, { noites: Number(e.target.value) })}
                        className="h-8 w-16 text-right"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={l.pessoas}
                        disabled={!editavel}
                        onChange={(e) => mexer(l.key, { pessoas: Number(e.target.value) })}
                        className="h-8 w-16 text-right"
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      {/* Derivado, mas editável pela coluna de pessoas por quarto. */}
                      <span className="tabular-nums text-muted-foreground" title="pessoas por quarto">
                        {quartos}
                      </span>
                      <select
                        value={l.pessoasPorQuarto ?? PESSOAS_POR_QUARTO_PADRAO}
                        disabled={!editavel}
                        onChange={(e) => mexer(l.key, { pessoasPorQuarto: Number(e.target.value) })}
                        className="ml-1 h-8 rounded-md border border-input bg-background px-1 text-xs disabled:opacity-50"
                        title="Pessoas por quarto"
                      >
                        <option value={1}>1/q</option>
                        <option value={2}>2/q</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={l.tipoId}
                        disabled={!editavel}
                        onChange={(e) => mexer(l.key, { tipoId: e.target.value })}
                        className="h-8 min-w-[8rem] rounded-md border border-input bg-background px-1 text-sm disabled:opacity-50"
                      >
                        <option value="">—</option>
                        {tipos.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.nome}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={l.faixaPassagemId ?? ""}
                        disabled={!editavel}
                        onChange={(e) => mexer(l.key, { faixaPassagemId: e.target.value || null })}
                        className="h-8 min-w-[9rem] rounded-md border border-input bg-background px-1 text-sm disabled:opacity-50"
                      >
                        <option value="">—</option>
                        {faixasPassagem.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.nome}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={l.faixaHospedagemId ?? ""}
                        disabled={!editavel || Number(l.noites) <= 0}
                        onChange={(e) => mexer(l.key, { faixaHospedagemId: e.target.value || null })}
                        className="h-8 min-w-[7rem] rounded-md border border-input bg-background px-1 text-sm disabled:opacity-50"
                      >
                        <option value="">—</option>
                        {faixasHospedagem.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.nome}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={l.modal ?? ""}
                        disabled={!editavel}
                        onChange={(e) => mexer(l.key, { modal: e.target.value || null })}
                        className="h-8 rounded-md border border-input bg-background px-1 text-sm disabled:opacity-50"
                      >
                        {MODAIS.map((m) => (
                          <option key={m.valor} value={m.valor}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-right">
                      <span className="tabular-nums font-medium">
                        {s ? formatBRL(s.custoTotal) : "—"}
                      </span>
                      {l.sujo && (
                        <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-500">•</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center justify-end gap-1">
                        {s && s.status === "enviada" && (
                          <DecisaoLinha
                            companyId={companyId}
                            year={year}
                            alvoTipo="viagem"
                            alvoId={s.id}
                            setorId={s.setorId}
                            rotulo={l.destino || "viagem"}
                            estado={s.estado as ValidacaoEstado}
                            comentario={s.comentario}
                            podeValidar={setup?.podeValidar ?? false}
                            onError={(m) => setErro(m)}
                            onDecidiu={() => void carregar()}
                          />
                        )}
                        {marca && !setup?.podeValidar && (
                          <span className={cn("text-[11px]", marca.classe)}>{marca.texto}</span>
                        )}
                        {editavel && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-1.5"
                            onClick={() => void excluir(l)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {l.erro && (
                    <tr key={`${l.key}-erro`} className="bg-red-500/5">
                      <td />
                      <td colSpan={11} className="px-2 pb-2 text-xs text-red-700 dark:text-red-400">
                        {l.erro}
                      </td>
                    </tr>
                  )}

                  {aberta && s && (
                    <tr key={`${l.key}-arvore`} className="border-t bg-muted/20">
                      <td />
                      <td colSpan={11} className="px-3 py-2">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs font-semibold">Abertura do custo</p>
                            {s.grupos.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                Nada calculado ainda — salve a linha.
                              </p>
                            ) : (
                              <ul className="space-y-1">
                                {s.grupos.map((g) => (
                                  <li key={g.grupo}>
                                    <div className="flex items-baseline justify-between gap-2 border-b pb-0.5">
                                      <span className="text-xs font-medium">{g.label}</span>
                                      <span className="text-xs font-medium tabular-nums">
                                        {formatBRL(g.total)}
                                      </span>
                                    </div>
                                    <ul className="mt-0.5">
                                      {g.linhas.map((x, i) => (
                                        <li
                                          key={i}
                                          className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground"
                                        >
                                          <span>{x.descricao}</span>
                                          <span className="shrink-0 tabular-nums">
                                            {formatBRL(x.valor)}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div className="space-y-2">
                            {s.premissas.length > 0 && (
                              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-900 dark:text-amber-200">
                                <p className="mb-1 flex items-center gap-1 font-semibold">
                                  <Info className="h-3 w-3" />O que foi estimado
                                </p>
                                <ul className="space-y-0.5">
                                  {s.premissas.map((p, i) => (
                                    <li key={i}>• {p}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {s.comentario && (
                              <p className="text-[11px] text-amber-700 dark:text-amber-500">
                                Diretoria: {s.comentario}
                              </p>
                            )}
                            {bloqueada && (
                              <p className="text-[11px] text-muted-foreground">
                                {s.finalizado
                                  ? "Categoria finalizada neste setor — reabra para editar."
                                  : "A diretoria já decidiu sobre esta viagem."}
                              </p>
                            )}
                            <Link
                              href={viagemHref(companyId, year, s.id)}
                              className="text-[11px] underline underline-offset-2 text-muted-foreground hover:text-foreground"
                            >
                              Abrir a viagem (roteiro multi-destino, cotação à mão, conversa)
                            </Link>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
          <tfoot className="border-t bg-muted/30">
            <tr>
              <td colSpan={10} className="px-2 py-2 text-xs text-muted-foreground">
                {linhas.length} viagem(ns){sujas > 0 ? ` · ${sujas} não salva(s)` : ""}
              </td>
              <td className="px-2 py-2 text-right text-sm font-semibold tabular-nums">
                {formatBRL(totalGrade)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Finalizar: a fatia é (categoria × setor) ── */}
      <ViagensFinalizar
        companyId={companyId}
        year={year}
        setorId={setorEscolhido}
        setorNome={
          setorEscolhido
            ? setup?.setores.find((s) => s.id === setorEscolhido)?.name ?? "Setor"
            : "Todos os setores"
        }
        categorias={setup?.categorias ?? []}
        codigosEmUso={Array.from(
          new Set(linhas.map((l) => l.servidor?.categoryCode ?? "").filter(Boolean)),
        )}
        isAdmin={setup?.isAdmin ?? false}
        onMudou={() => void carregar()}
      />

      {podeEditarRecorte && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void salvar()} disabled={salvando || sujas === 0}>
            {salvando ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Salvar e calcular {sujas > 0 ? `(${sujas})` : ""}
          </Button>
          <Button variant="outline" onClick={() => acrescentar(1)} disabled={tipos.length === 0}>
            <Plus className="mr-1.5 h-4 w-4" />
            Linha
          </Button>
          <Button variant="ghost" onClick={() => acrescentar(10)} disabled={tipos.length === 0}>
            + 10 linhas
          </Button>
        </div>
      )}
    </div>
  );
}
