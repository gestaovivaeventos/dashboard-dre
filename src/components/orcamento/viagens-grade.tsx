"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";

import {
  getGradeViagens,
  lancarValoresViagens,
  moverFluxoViagens,
  removerViagemDaGrade,
  salvarGradeViagens,
  type GradeSetup,
  type LinhaGrade,
} from "@/lib/orcamento/actions/viagens-grade";
import {
  ESTADOS_VIAGEM,
  ESTADO_VIAGEM_DONO,
  ESTADO_VIAGEM_LABEL,
  GRUPOS_COTACAO,
  alvosDoLote,
  rotuloDaAcao,
  totalCotado,
  type AcaoFluxo,
  type EstadoViagem,
  type ValoresCotacao,
} from "@/lib/viagens/fluxo";
import { GRUPO_LABEL } from "@/lib/viagens/custo/tipos";
import { PESSOAS_POR_QUARTO_PADRAO, type LinhaViagemInput } from "@/lib/viagens/grade";
import type { LinhaResolvida } from "@/lib/viagens/plano";
import { formatBRL } from "@/lib/orcamento/format";
import { workspaceConfigSecaoHref } from "@/lib/orcamento/workspace-tabs";
import { DecisaoLinha } from "@/components/orcamento/decisao-linha";
import type { DecisaoAplicada } from "@/lib/orcamento/previa-setor-decisao";
import { MigrationAviso } from "@/components/orcamento/migration-aviso";
import { ValidacaoSetorPainel } from "@/components/orcamento/validacao-setor-painel";
import { ViagensFinalizar } from "@/components/orcamento/viagens-finalizar";
import { ViagensPlanoIntake } from "@/components/orcamento/viagens-plano-intake";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * A GRADE de viagens — o fluxo, numa tela (06/10/2026).
 *
 * ── Não é um wizard de cinco passos ───────────────────────────────────────
 * O fluxo tem cinco etapas, mas as ~50 viagens nunca andam juntas: umas esperam o
 * OK do gestor, outras estão em cotação, outras já na diretoria, ao mesmo tempo.
 * Uma tela em passos sequenciais mentiria sobre isso. O que serve é a grade com o
 * ESTADO em cada linha, contadores no topo que também filtram, e as ações em lote
 * agindo sobre o recorte visível.
 *
 * ── Uma cor só, e o resto em texto ───────────────────────────────────────
 * Só `aguardando_cotacao` recebe fundo (amarelo claro, como pedido). Quatro cores
 * sutis competiriam entre si e nenhuma seria legível; a etiqueta de texto é o sinal
 * de verdade, e a cor marca o único estado que pede ação de outra pessoa.
 *
 * ── O que a tela NÃO decide ──────────────────────────────────────────────
 * Quem pode editar, lançar valor, decidir e quais ações existem vem resolvido do
 * servidor (`LinhaGrade.podeEditarBasico`, `.acoes`…). Recalcular a regra aqui a
 * faria divergir da action — e a tela ofereceria botão que o servidor recusa.
 */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const MODAIS = [
  { valor: "", label: "—" },
  { valor: "aviao", label: "Avião" },
  { valor: "onibus", label: "Ônibus" },
  { valor: "carro", label: "Carro" },
  { valor: "van", label: "Van" },
  { valor: "outro", label: "Outro" },
];

/** Só o estado que espera ação de OUTRA pessoa recebe cor. Ver o cabeçalho. */
const FUNDO_DO_ESTADO: Partial<Record<EstadoViagem, string>> = {
  aguardando_cotacao: "bg-amber-50/70 dark:bg-amber-950/20",
};

const ETIQUETA_DO_ESTADO: Record<EstadoViagem, string> = {
  rascunho: "text-muted-foreground",
  aguardando_cotacao: "text-amber-700 dark:text-amber-500",
  em_cotacao: "text-sky-700 dark:text-sky-400",
  cotada: "text-emerald-700 dark:text-emerald-400",
  em_aprovacao: "text-violet-700 dark:text-violet-400",
};

const DECISAO_MARCA: Record<string, { texto: string; classe: string }> = {
  aprovado: { texto: "aprovada", classe: "text-emerald-700 dark:text-emerald-400" },
  reprovado: { texto: "reprovada", classe: "text-red-700 dark:text-red-400" },
  revisar: { texto: "revisar", classe: "text-amber-700 dark:text-amber-500" },
};

/** Uma linha no estado da TELA: a do servidor + o que foi digitado. */
interface Rascunho extends LinhaViagemInput {
  key: string;
  sujo: boolean;
  erro?: string | null;
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
    uf: l.uf,
    mesIda: l.mesIda,
    noites: l.noites,
    pessoas: l.pessoas,
    pessoasPorQuarto: l.pessoasPorQuarto,
    tipoId: l.tipoId ?? "",
    modal: l.modal,
    finalidade: l.finalidade,
    sujo: false,
    servidor: l,
  };
}

function linhaVazia(tipoId: string): Rascunho {
  return {
    key: novaKey(),
    destino: "",
    uf: null,
    mesIda: null,
    noites: 1,
    pessoas: 1,
    pessoasPorQuarto: PESSOAS_POR_QUARTO_PADRAO,
    tipoId,
    sujo: true,
  };
}

function doPlano(l: LinhaResolvida, tipoId: string): Rascunho {
  return {
    key: novaKey(),
    destino: l.destino,
    uf: null,
    mesIda: l.mesIda,
    noites: l.noites,
    pessoas: l.pessoas,
    pessoasPorQuarto: l.pessoasPorQuarto ?? PESSOAS_POR_QUARTO_PADRAO,
    tipoId: l.tipoId || tipoId,
    modal: l.modal,
    finalidade: l.finalidade,
    sujo: true,
  };
}

const SEM_SETOR = "__todos__";

function moeda(v: string): number | null {
  const t = v.trim().replace(/\./g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function paraCampo(v: number | null | undefined): string {
  return v == null ? "" : String(v).replace(".", ",");
}

export function ViagensGrade({ companyId, year }: { companyId: string; year: number }) {
  const [setup, setSetup] = useState<GradeSetup | null>(null);
  const [setorId, setSetorId] = useState<string>(SEM_SETOR);
  const [linhas, setLinhas] = useState<Rascunho[]>([]);
  const [origem, setOrigem] = useState("");
  const [filtro, setFiltro] = useState<EstadoViagem | null>(null);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [recusas, setRecusas] = useState<string[]>([]);
  const [decisaoSeq, setDecisaoSeq] = useState(0);
  const [decisao, setDecisao] = useState<(DecisaoAplicada & { seq: number }) | undefined>();
  const [cotacao, setCotacao] = useState<
    Record<string, { valores: Record<string, string>; dataBase: string; observacao: string }>
  >({});

  const setorEscolhido = setorId === SEM_SETOR ? null : setorId;

  const carregar = useCallback(async () => {
    setCarregando(true);
    const res = await getGradeViagens(companyId, year, setorEscolhido);
    if (res.error) setErro(res.error);
    setSetup(res);
    setLinhas((res.linhas ?? []).map(doServidor));
    setOrigem(res.origemPadrao ?? "");
    setCotacao({});
    setCarregando(false);
  }, [companyId, year, setorEscolhido]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const tipos = setup?.tipos ?? [];
  const isAdmin = setup?.isAdmin ?? false;
  const tipoPadrao = tipos[0]?.id ?? "";

  const visiveis = filtro ? linhas.filter((l) => l.servidor?.estado === filtro) : linhas;
  const sujas = linhas.filter((l) => l.sujo).length;
  const podeEditarRecorte = setorEscolhido
    ? setup?.setores.find((s) => s.id === setorEscolhido)?.podeEscrever ?? false
    : setup?.podeEditar ?? false;

  function mexer(key: string, patch: Partial<LinhaViagemInput>) {
    setLinhas((ls) =>
      ls.map((l) => (l.key === key ? { ...l, ...patch, sujo: true, erro: null } : l)),
    );
  }

  function acrescentar(quantas = 1) {
    setLinhas((ls) => [...ls, ...Array.from({ length: quantas }, () => linhaVazia(tipoPadrao))]);
  }

  /**
   * O plano lido pela IA entra no FIM da grade, sem tocar no que já está lá.
   * Substituir perderia o que o gestor digitou, e casar linha a linha exigiria
   * adivinhar qual viagem é qual — duas idas a São Paulo são indistinguíveis.
   */
  function receberPlano(lidas: LinhaResolvida[]) {
    if (lidas.length === 0) return;
    setErro(null);
    setLinhas((ls) => [...ls, ...lidas.map((l) => doPlano(l, tipoPadrao))]);
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
    setOcupado(true);
    setErro(null);
    setAviso(null);
    setRecusas([]);

    const res = await salvarGradeViagens(
      companyId,
      year,
      setorEscolhido,
      origem.trim(),
      paraSalvar.map((l) => ({
        id: l.id,
        destino: l.destino,
        uf: l.uf,
        mesIda: l.mesIda,
        noites: l.noites,
        pessoas: l.pessoas,
        pessoasPorQuarto: l.pessoasPorQuarto,
        tipoId: l.tipoId,
        modal: l.modal,
        finalidade: l.finalidade,
      })),
    );
    setOcupado(false);

    if (res.needsMigration) {
      setErro("Falta aplicar a migration 20261006120000_orcamento_viagem_fluxo.sql.");
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
    if (gravadas > 0) await carregar();
  }

  /** Move uma viagem ou o lote visível. O servidor recusa por linha, com motivo. */
  async function mover(acao: AcaoFluxo, ids: string[]) {
    if (ids.length === 0) return;
    if (sujas > 0) {
      setErro("Salve as alterações antes de mover as viagens no fluxo.");
      return;
    }
    setOcupado(true);
    setErro(null);
    setAviso(null);
    setRecusas([]);
    const res = await moverFluxoViagens(companyId, year, ids, acao);
    setOcupado(false);
    if (res.needsMigration) {
      setErro("Falta aplicar a migration 20261006120000_orcamento_viagem_fluxo.sql.");
      return;
    }
    if (res.error) {
      setErro(res.error);
      return;
    }
    setRecusas(res.recusadas.map((r) => r.motivo));
    setAviso(
      res.movidas > 0
        ? `${res.movidas} viagem(ns) movida(s).`
        : "Nenhuma viagem pôde ser movida — veja os motivos.",
    );
    await carregar();
  }

  async function gravarCotacao(l: LinhaGrade) {
    const c = cotacao[l.id];
    if (!c) return;
    const valores: ValoresCotacao = {};
    for (const g of GRUPOS_COTACAO) valores[g] = moeda(c.valores[g] ?? "");
    setOcupado(true);
    setErro(null);
    setAviso(null);
    const res = await lancarValoresViagens(companyId, year, [
      { id: l.id, valores, dataBase: c.dataBase || null, observacao: c.observacao || null },
    ]);
    setOcupado(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    if (res.recusadas.length > 0) {
      setRecusas(res.recusadas.map((r) => r.motivo));
      return;
    }
    setAviso(`Cotação de ${l.destino} lançada: ${formatBRL(totalCotado(valores))}.`);
    await carregar();
  }

  function rascunhoCotacao(l: LinhaGrade) {
    const atual = cotacao[l.id];
    if (atual) return atual;
    const valores: Record<string, string> = {};
    for (const g of GRUPOS_COTACAO) valores[g] = paraCampo(l.valores[g]);
    return {
      valores,
      dataBase: l.cotacaoDataBase ?? "",
      observacao: l.cotacaoObservacao ?? "",
    };
  }

  function mexerCotacao(
    id: string,
    patch: Partial<{ valores: Record<string, string>; dataBase: string; observacao: string }>,
    base: { valores: Record<string, string>; dataBase: string; observacao: string },
  ) {
    setCotacao((c) => ({ ...c, [id]: { ...base, ...patch } }));
  }

  async function excluir(l: Rascunho) {
    if (!l.id) {
      setLinhas((ls) => ls.filter((x) => x.key !== l.key));
      return;
    }
    if (!window.confirm(`Excluir a viagem para ${l.destino || "(sem destino)"}?`)) return;
    const res = await removerViagemDaGrade(companyId, year, l.id);
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
        migration="20261006120000_orcamento_viagem_fluxo.sql"
        tabela="orcamento_viagens (colunas do fluxo e da cotação)"
      />
    );
  }

  const contagem = setup?.contagem;
  const setorNome = setorEscolhido
    ? setup?.setores.find((s) => s.id === setorEscolhido)?.name ?? ""
    : "";
  const codigosEmUso = Array.from(
    new Set(linhas.map((l) => l.servidor?.categoryCode).filter((c): c is string => Boolean(c))),
  );

  return (
    <div className="space-y-4">
      {/* ── Contexto do time: origem e setor valem para a grade inteira ── */}
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
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value={SEM_SETOR}>Todos os setores</option>
              {(setup?.setores ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="grade-origem" className="text-xs">
            Cidade de partida
          </Label>
          <Input
            id="grade-origem"
            value={origem}
            onChange={(e) => setOrigem(e.target.value)}
            placeholder="Juiz de Fora"
            className="h-9 w-48"
          />
        </div>
        <p className="flex-1 text-xs text-muted-foreground">
          A partida é a mesma para a grade inteira — é sempre o mesmo time saindo da mesma cidade.
        </p>
      </div>

      {/* ── Contadores por estado, que também filtram ── */}
      {contagem && linhas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltro(null)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs",
              filtro === null ? "border-foreground font-medium" : "text-muted-foreground",
            )}
          >
            Todas ({linhas.length})
          </button>
          {ESTADOS_VIAGEM.filter((e) => contagem[e] > 0).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setFiltro(filtro === e ? null : e)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs",
                filtro === e ? "border-foreground font-medium" : "text-muted-foreground",
                ETIQUETA_DO_ESTADO[e],
              )}
              title={ESTADO_VIAGEM_DONO[e]}
            >
              {ESTADO_VIAGEM_LABEL[e]} ({contagem[e]})
            </button>
          ))}
        </div>
      )}

      {erro && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {erro}
        </div>
      )}
      {aviso && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">{aviso}</div>
      )}
      {recusas.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="font-medium">
            {recusas.length === 1 ? "1 viagem não pôde andar" : `${recusas.length} viagens não puderam andar`}:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {recusas.slice(0, 12).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Cadastro que falta: sem tipo não há categoria da DRE ── */}
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

      {/* ── O caminho rápido para montar as 50: ditar ou colar o plano ── */}
      {podeEditarRecorte && tipos.length > 0 && (
        <ViagensPlanoIntake
          companyId={companyId}
          year={year}
          setorId={setorEscolhido}
          origem={origem}
          cidadesConhecidas={Array.from(
            new Set(linhas.map((l) => l.destino.trim()).filter((d) => d !== "")),
          )}
          disabled={ocupado}
          onLinhas={receberPlano}
        />
      )}

      {/* ── As ações em LOTE, sobre o recorte visível ── */}
      {linhas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
          <span className="text-xs font-medium text-muted-foreground">
            {filtro ? `Sobre as ${visiveis.length} em "${ESTADO_VIAGEM_LABEL[filtro]}"` : "Sobre as viagens visíveis"}:
          </span>
          {(["ok", "fechar", "seguir", "reabrir", "voltar", "editar"] as AcaoFluxo[]).map((acao) => {
            const alvos = alvosDoLote(
              visiveis
                .filter((l) => l.servidor)
                .map((l) => ({ id: l.id!, estado: l.servidor!.estado })),
              acao,
              isAdmin ? "admin" : "gestor",
            );
            if (alvos.length === 0) return null;
            return (
              <Button
                key={acao}
                type="button"
                size="sm"
                variant={acao === "ok" || acao === "fechar" || acao === "seguir" ? "default" : "outline"}
                disabled={ocupado}
                onClick={() => void mover(acao, alvos.map((a) => a.id))}
              >
                {rotuloDaAcao(acao)} ({alvos.length})
              </Button>
            );
          })}
          {isAdmin && (
            <>
              <a
                href={`/api/orcamento/viagens/cotacao/template?companyId=${companyId}&year=${year}${
                  setorEscolhido ? `&setorId=${setorEscolhido}` : ""
                }`}
                className="inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium hover:bg-muted"
                title="Baixa SÓ as viagens fechadas para cotação"
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Baixar .xls para cotar
              </a>
              <CotacaoUpload
                companyId={companyId}
                year={year}
                disabled={ocupado}
                onPronto={(msg, problemas) => {
                  setAviso(msg);
                  setRecusas(problemas);
                  void carregar();
                }}
                onErro={(m) => setErro(m)}
              />
            </>
          )}
        </div>
      )}

      {/* ── A grade ── */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-6 px-1 py-2" />
              <th className="px-2 py-2 text-left font-medium">Estado</th>
              <th className="px-2 py-2 text-left font-medium">Destino</th>
              <th className="px-2 py-2 text-left font-medium">UF</th>
              <th className="px-2 py-2 text-left font-medium">Mês</th>
              <th className="px-2 py-2 text-right font-medium">Dias</th>
              <th className="px-2 py-2 text-right font-medium">Pess.</th>
              <th className="px-2 py-2 text-right font-medium">p/ quarto</th>
              <th className="px-2 py-2 text-left font-medium">Tipo</th>
              <th className="px-2 py-2 text-left font-medium">Modal</th>
              <th className="px-2 py-2 text-left font-medium">Para que serve</th>
              <th className="px-2 py-2 text-right font-medium">Custo</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => {
              const s = l.servidor;
              const estado = s?.estado ?? "rascunho";
              const editavel = s ? s.podeEditarBasico : podeEditarRecorte;
              const aberta = abertas.has(l.key);
              const marca = s ? DECISAO_MARCA[s.decisao] : undefined;
              return (
                <>
                  <tr
                    key={l.key}
                    className={cn("border-t align-middle", FUNDO_DO_ESTADO[estado], l.erro && "bg-destructive/5")}
                  >
                    <td className="px-1 py-1">
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
                        title="Abrir a abertura por grupo e as premissas"
                      >
                        {aberta ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className={cn("h-4 w-4", !s && "opacity-30")} />
                        )}
                      </button>
                    </td>
                    <td className="px-2 py-1">
                      <span
                        className={cn("whitespace-nowrap text-xs font-medium", ETIQUETA_DO_ESTADO[estado])}
                        title={ESTADO_VIAGEM_DONO[estado]}
                      >
                        {ESTADO_VIAGEM_LABEL[estado]}
                      </span>
                      {marca && (
                        <span className={cn("ml-1 block text-[10px] uppercase", marca.classe)}>
                          {marca.texto}
                        </span>
                      )}
                      {s?.roteiroMudou && (
                        <span
                          className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-500"
                          title="Os dados mudaram depois de a cotação ter sido feita — os valores podem não valer mais."
                        >
                          <AlertTriangle className="h-3 w-3" />
                          cotação antiga
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        value={l.destino}
                        disabled={!editavel || ocupado}
                        onChange={(e) => mexer(l.key, { destino: e.target.value })}
                        placeholder="Cidade"
                        className="h-8 min-w-[9rem]"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        value={l.uf ?? ""}
                        disabled={!editavel || ocupado}
                        onChange={(e) =>
                          mexer(l.key, { uf: e.target.value.toUpperCase().slice(0, 2) || null })
                        }
                        placeholder="UF"
                        className="h-8 w-14"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={l.mesIda ?? ""}
                        disabled={!editavel || ocupado}
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
                        value={String(l.noites ?? 0)}
                        disabled={!editavel || ocupado}
                        onChange={(e) => mexer(l.key, { noites: Number(e.target.value) || 0 })}
                        className="h-8 w-14 text-right"
                        inputMode="numeric"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        value={String(l.pessoas ?? 1)}
                        disabled={!editavel || ocupado}
                        onChange={(e) => mexer(l.key, { pessoas: Number(e.target.value) || 1 })}
                        className="h-8 w-14 text-right"
                        inputMode="numeric"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        value={String(l.pessoasPorQuarto ?? PESSOAS_POR_QUARTO_PADRAO)}
                        disabled={!editavel || ocupado}
                        onChange={(e) =>
                          mexer(l.key, { pessoasPorQuarto: Number(e.target.value) || 1 })
                        }
                        className="h-8 w-14 text-right"
                        inputMode="numeric"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={l.tipoId}
                        disabled={!editavel || ocupado}
                        onChange={(e) => mexer(l.key, { tipoId: e.target.value })}
                        className="h-8 min-w-[9rem] rounded-md border border-input bg-background px-1 text-sm disabled:opacity-50"
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
                        value={l.modal ?? ""}
                        disabled={!editavel || ocupado}
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
                    <td className="px-2 py-1">
                      <Input
                        value={l.finalidade ?? ""}
                        disabled={!editavel || ocupado}
                        onChange={(e) => mexer(l.key, { finalidade: e.target.value || null })}
                        placeholder="é o que a diretoria lê"
                        className="h-8 min-w-[12rem]"
                      />
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {s && s.custoTotal > 0 ? (
                        formatBRL(s.custoTotal)
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center justify-end gap-1">
                        {s?.podeDecidir && (
                          <DecisaoLinha
                            companyId={companyId}
                            year={year}
                            alvoTipo="viagem"
                            alvoId={s.id}
                            setorId={s.setorId}
                            rotulo={s.destino || "viagem"}
                            estado={s.decisao}
                            comentario={s.comentario}
                            podeValidar={s.podeDecidir}
                            onError={(m) => setErro(m)}
                            onDecidiu={(d) => {
                              // A prévia do setor é um componente IRMÃO: sem avisá-la
                              // da decisão ela ficaria parada até alguém sair e voltar
                              // da tela. O `seq` é o gatilho, não o conteúdo — aprovar,
                              // desfazer e aprovar produz decisões idênticas e as três
                              // precisam valer.
                              setDecisao({ ...d, seq: decisaoSeq + 1 });
                              setDecisaoSeq((n) => n + 1);
                              void carregar();
                            }}
                          />
                        )}
                        {(s?.acoes ?? []).map((acao) => (
                          <Button
                            key={acao}
                            type="button"
                            size="sm"
                            variant={acao === "ok" ? "default" : "ghost"}
                            disabled={ocupado}
                            onClick={() => void mover(acao, [s!.id])}
                            title={
                              acao === "ok" && s?.faltaParaOk
                                ? s.faltaParaOk
                                : rotuloDaAcao(acao)
                            }
                          >
                            {rotuloDaAcao(acao)}
                          </Button>
                        ))}
                        {editavel && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={ocupado}
                            onClick={() => void excluir(l)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {l.erro && (
                    <tr key={`${l.key}-erro`} className="border-t bg-destructive/5">
                      <td />
                      <td colSpan={12} className="px-2 py-1 text-xs text-destructive">
                        {l.erro}
                      </td>
                    </tr>
                  )}

                  {aberta && s && (
                    <tr key={`${l.key}-detalhe`} className="border-t bg-muted/20">
                      <td />
                      <td colSpan={12} className="px-3 py-3">
                        <div className="space-y-3">
                          {s.comentario && (
                            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                              <strong>A diretoria pediu:</strong> {s.comentario}
                            </p>
                          )}

                          {/* ── A cotação: só a Controladoria, e só depois do fecho ── */}
                          {s.podeLancarValores && (
                            <CotacaoDaLinha
                              rascunho={rascunhoCotacao(s)}
                              ocupado={ocupado}
                              onMexer={(patch, base) => mexerCotacao(s.id, patch, base)}
                              onGravar={() => void gravarCotacao(s)}
                            />
                          )}

                          {s.grupos.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold uppercase text-muted-foreground">
                                Custo por grupo
                              </p>
                              <ul className="mt-1 space-y-0.5 text-xs">
                                {s.grupos.map((g) => (
                                  <li key={g.grupo} className="flex justify-between gap-4">
                                    <span>{g.label}</span>
                                    <span className="tabular-nums">{formatBRL(g.total)}</span>
                                  </li>
                                ))}
                                <li className="flex justify-between gap-4 border-t pt-0.5 font-medium">
                                  <span>Total</span>
                                  <span className="tabular-nums">{formatBRL(s.custoTotal)}</span>
                                </li>
                              </ul>
                            </div>
                          )}

                          {s.premissas.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold uppercase text-muted-foreground">
                                Premissas
                              </p>
                              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                                {s.premissas.map((p) => (
                                  <li key={p}>{p}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {visiveis.length === 0 && (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {filtro
                    ? "Nenhuma viagem neste estado."
                    : "Nenhuma viagem ainda. Acrescente uma linha ou dite o plano do ano."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {podeEditarRecorte && tipos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void salvar()} disabled={ocupado || sujas === 0}>
            {ocupado ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Salvar {sujas > 0 ? `(${sujas})` : ""}
          </Button>
          <Button variant="outline" onClick={() => acrescentar(1)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Linha
          </Button>
          <Button variant="ghost" onClick={() => acrescentar(10)}>
            + 10 linhas
          </Button>
        </div>
      )}

      {setup && (
        <ViagensFinalizar
          companyId={companyId}
          year={year}
          setorId={setorEscolhido}
          setorNome={setorNome}
          categorias={setup.categorias}
          codigosEmUso={codigosEmUso}
          isAdmin={isAdmin}
          onMudou={() => void carregar()}
        />
      )}

      {/* ── A prévia do setor, como em todas as telas de orçamento ── */}
      <ValidacaoSetorPainel
        companyId={companyId}
        year={year}
        setorId={setorEscolhido}
        setorNome={setorNome}
        decisaoExterna={decisao}
        metodoContagem="viagens"
      />
    </div>
  );
}

/**
 * Os valores da cotação de uma linha.
 *
 * Fica dentro da linha expandida e não numa tela à parte: quem lança o valor está
 * olhando a viagem que acabou de cotar, e trocar de tela a cada uma seriam 50 idas
 * e voltas. A planilha existe para o lote.
 */
function CotacaoDaLinha({
  rascunho,
  ocupado,
  onMexer,
  onGravar,
}: {
  rascunho: { valores: Record<string, string>; dataBase: string; observacao: string };
  ocupado: boolean;
  onMexer: (
    patch: Partial<{ valores: Record<string, string>; dataBase: string; observacao: string }>,
    base: { valores: Record<string, string>; dataBase: string; observacao: string },
  ) => void;
  onGravar: () => void;
}) {
  const total = GRUPOS_COTACAO.reduce((a, g) => {
    const n = moeda(rascunho.valores[g] ?? "");
    return a + (n ?? 0);
  }, 0);

  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      <p className="text-xs font-semibold uppercase text-muted-foreground">
        Cotação — valores por grupo
      </p>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {GRUPOS_COTACAO.map((g) => (
          <div key={g} className="space-y-1">
            <label className="block truncate text-[11px] text-muted-foreground" title={GRUPO_LABEL[g]}>
              {GRUPO_LABEL[g]}
            </label>
            <Input
              value={rascunho.valores[g] ?? ""}
              disabled={ocupado}
              onChange={(e) =>
                onMexer({ valores: { ...rascunho.valores, [g]: e.target.value } }, rascunho)
              }
              placeholder="0,00"
              className="h-8 text-right"
              inputMode="decimal"
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="block text-[11px] text-muted-foreground">Data-base da cotação</label>
          <Input
            type="date"
            value={rascunho.dataBase}
            disabled={ocupado}
            onChange={(e) => onMexer({ dataBase: e.target.value }, rascunho)}
            className="h-8 w-36"
          />
        </div>
        <div className="flex-1 space-y-1">
          <label className="block text-[11px] text-muted-foreground">Fonte / observação</label>
          <Input
            value={rascunho.observacao}
            disabled={ocupado}
            onChange={(e) => onMexer({ observacao: e.target.value }, rascunho)}
            placeholder="cotação CVC, Decolar, agência…"
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <span className="block text-[11px] text-muted-foreground">Total</span>
          <span className="block h-8 pt-1.5 text-sm font-semibold tabular-nums">
            {formatBRL(total)}
          </span>
        </div>
        <Button type="button" size="sm" className="h-8" disabled={ocupado} onClick={onGravar}>
          Lançar cotação
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        O mês é do gestor; a <strong>data-base</strong> é o dia que você cotou — sem ela, meses
        adiante ninguém sabe se a tarifa era de alta ou de baixa estação.
      </p>
    </div>
  );
}

/** Upload da planilha de cotação — o mesmo caminho da digitação, em lote. */
function CotacaoUpload({
  companyId,
  year,
  disabled,
  onPronto,
  onErro,
}: {
  companyId: string;
  year: number;
  disabled?: boolean;
  onPronto: (msg: string, problemas: string[]) => void;
  onErro: (m: string) => void;
}) {
  const [enviando, setEnviando] = useState(false);

  return (
    <label
      className={cn(
        "inline-flex h-8 cursor-pointer items-center rounded-md border px-2.5 text-xs font-medium hover:bg-muted",
        (disabled || enviando) && "pointer-events-none opacity-50",
      )}
    >
      {enviando ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Upload className="mr-1.5 h-3.5 w-3.5" />
      )}
      Subir cotação
      <input
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setEnviando(true);
          const form = new FormData();
          form.set("file", file);
          form.set("companyId", companyId);
          form.set("year", String(year));
          try {
            const res = await fetch("/api/orcamento/viagens/cotacao/import", {
              method: "POST",
              body: form,
            });
            const json = (await res.json()) as {
              ok?: boolean;
              error?: string;
              gravadas?: number;
              problemas?: string[];
            };
            if (!res.ok || !json.ok) {
              onErro(json.error ?? "Não consegui ler a planilha.");
              return;
            }
            onPronto(
              `${json.gravadas ?? 0} cotação(ões) lançada(s) pela planilha.`,
              json.problemas ?? [],
            );
          } catch {
            onErro("Não consegui enviar a planilha.");
          } finally {
            setEnviando(false);
            e.target.value = "";
          }
        }}
      />
    </label>
  );
}
