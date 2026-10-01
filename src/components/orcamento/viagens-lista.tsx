"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Loader2, Plane, Plus, Trash2 } from "lucide-react";

import {
  criarViagem,
  getViagensSetup,
  removerViagem,
  type ViagemResumo,
  type ViagensSetup,
} from "@/lib/orcamento/actions/viagens";
import { getPreviaSetor, type PreviaSetorResumo } from "@/lib/orcamento/actions/planejamento-categoria";
import { getFinalizacoes } from "@/lib/orcamento/actions/finalizacao";
import { finalizacaoDe, indexarFinalizacoes, type Finalizacao } from "@/lib/orcamento/finalizacao";
import { formatBRL } from "@/lib/orcamento/format";
import { viagemHref, workspaceConfigSecaoHref } from "@/lib/orcamento/workspace-tabs";
import { BotaoFinalizar } from "@/components/orcamento/botao-finalizar";
import { PlanejamentoPreviaSetor } from "@/components/orcamento/planejamento-previa-setor";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Aba Viagens — a LISTA.
 *
 * O caminho é: escolher o setor → criar a viagem → montar o roteiro na tela da
 * viagem. A prévia do setor fica embaixo, como nas outras telas de método, e é a
 * MESMA (`getPreviaSetor`): uma segunda soma divergiria no dia em que uma regra
 * mudasse.
 *
 * Duas coisas que a tela deixa explícitas de propósito:
 *
 *  - **o custo não é digitado**: a coluna de valor é o retrato calculado pelo
 *    motor a partir do roteiro, e quem monta vê isso na tela da viagem;
 *  - **rascunho não conta**: a etiqueta diz quais viagens já estão no orçamento
 *    e quais ainda não, porque o total da lista inclui as duas e o da Prévia não.
 */

const MESES_CURTO = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/** "04/05/2027" → "4 mai 2027". Data ISO vem sem fuso: não usar `new Date`. */
function dataCurta(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return "sem data";
  return `${Number(m[3])} ${MESES_CURTO[Number(m[2]) - 1]} ${m[1]}`;
}

const ESTADO_ETIQUETA: Record<string, { texto: string; classe: string }> = {
  pendente: { texto: "Aguardando o diretor", classe: "bg-muted text-muted-foreground" },
  aprovado: { texto: "Aprovada", classe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  reprovado: { texto: "Reprovada", classe: "bg-red-500/15 text-red-700 dark:text-red-400" },
  revisar: { texto: "Revisar", classe: "bg-amber-500/15 text-amber-700 dark:text-amber-500" },
};

const SEM_SETOR = "__todos__";

export function ViagensLista({ companyId, year }: { companyId: string; year: number }) {
  const [setup, setSetup] = useState<ViagensSetup | null>(null);
  const [setorId, setSetorId] = useState<string>(SEM_SETOR);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  const [novoAberto, setNovoAberto] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [novoTipo, setNovoTipo] = useState("");
  const [criando, setCriando] = useState(false);

  const [finalizacoes, setFinalizacoes] = useState<Finalizacao[]>([]);
  const [previa, setPrevia] = useState<PreviaSetorResumo | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);

  const router = useRouter();
  const setorEscolhido = setorId === SEM_SETOR ? null : setorId;

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const res = await getViagensSetup(companyId, year, setorEscolhido);
    if (res.needsMigration) setNeedsMigration(true);
    if (res.error) setErro(res.error);
    setSetup(res);
    setCarregando(false);
  }, [companyId, year, setorEscolhido]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    let vivo = true;
    void getFinalizacoes(companyId, year).then((r) => {
      if (vivo) setFinalizacoes(r.items ?? []);
    });
    return () => {
      vivo = false;
    };
  }, [companyId, year]);

  // A prévia do setor só faz sentido com um setor escolhido — é o recorte que
  // ela mostra. Em "Todos", a leitura do conjunto é a Prévia da empresa.
  const carregarPrevia = useCallback(async () => {
    if (!setorEscolhido) {
      setPrevia(null);
      return;
    }
    setCarregandoPrevia(true);
    const res = await getPreviaSetor(companyId, year, setorEscolhido, "");
    setPrevia(res.data ?? null);
    setCarregandoPrevia(false);
  }, [companyId, year, setorEscolhido]);

  useEffect(() => {
    void carregarPrevia();
  }, [carregarPrevia]);

  async function criar() {
    if (!novoTitulo.trim()) {
      setErro("Dê um título à viagem.");
      return;
    }
    if (!novoTipo) {
      setErro("Escolha o tipo da viagem.");
      return;
    }
    setCriando(true);
    setErro(null);
    const res = await criarViagem(companyId, year, {
      titulo: novoTitulo.trim(),
      tipoId: novoTipo,
      setorId: setorEscolhido,
    });
    setCriando(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    if (res.id) router.push(viagemHref(companyId, year, res.id));
  }

  async function excluir(v: ViagemResumo) {
    if (!window.confirm(`Excluir a viagem "${v.titulo}"? O roteiro inteiro sai junto.`)) return;
    const res = await removerViagem(companyId, year, v.id);
    if (res.error) {
      setErro(res.error);
      return;
    }
    void carregar();
    void carregarPrevia();
  }

  if (needsMigration) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <p className="font-semibold">Falta aplicar a migration das viagens.</p>
        <p className="text-muted-foreground">
          As tabelas <code>orcamento_viagens</code> e companhia ainda não existem neste banco.
        </p>
      </div>
    );
  }

  const setores = setup?.setores ?? [];
  const categorias = setup?.categorias ?? [];
  const tipos = setup?.tipos ?? [];
  const viagens = setup?.viagens ?? [];
  const totalEnviado = viagens
    .filter((v) => v.status === "enviada")
    .reduce((a, v) => a + v.custoTotal, 0);
  const totalRascunho = viagens
    .filter((v) => v.status === "rascunho")
    .reduce((a, v) => a + v.custoTotal, 0);

  // Categorias que já têm viagem neste recorte — é por elas que se finaliza.
  const categoriasComViagem = Array.from(new Set(viagens.map((v) => v.categoryCode))).filter(
    Boolean,
  );

  const setorNome = setorEscolhido
    ? setores.find((s) => s.id === setorEscolhido)?.name ?? "Setor"
    : "Todos os setores";
  const podeEscreverNoRecorte = setorEscolhido
    ? setores.find((s) => s.id === setorEscolhido)?.podeEscrever ?? false
    : (setup?.podeEditar ?? false);

  return (
    <div className="space-y-5">
      {/* ── Filtro de setor ── */}
      {setup?.orcaPorSetor && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="viagem-setor" className="text-xs">
              Setor
            </Label>
            <select
              id="viagem-setor"
              value={setorId}
              onChange={(e) => setSetorId(e.target.value)}
              className="h-9 min-w-[16rem] rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value={SEM_SETOR}>Todos os setores</option>
              {setores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.podeEscrever ? "" : " (somente leitura)"}
                </option>
              ))}
            </select>
          </div>
          {!setorEscolhido && (
            <p className="pb-2 text-xs text-muted-foreground">
              Escolha um setor para criar viagens e ver a prévia dele.
            </p>
          )}
        </div>
      )}

      {erro && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {/* ── Rodando com os padrões do sistema ──
          O admin precisa SABER disso: o custo de toda viagem da empresa sai
          destes números, e o aviso é o único lugar onde a tela conta de onde
          eles vêm. Para quem não é admin não há o que fazer, então não há aviso. */}
      {!carregando && setup?.parametrosPadrao && setup?.isAdmin && tipos.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Esta empresa ainda não tem parâmetros de viagem para {year}.</p>
          <p className="mt-1 text-muted-foreground">
            A alimentação e o km de carro próprio estão usando os padrões do sistema (R${" "}
            {setup.parametros.diariaAlimentacao.toFixed(2).replace(".", ",")}/dia e R${" "}
            {setup.parametros.rsPorKm.toFixed(2).replace(".", ",")}/km).{" "}
            <Link
              href={workspaceConfigSecaoHref(companyId, year, "viagem-parametros")}
              className="font-medium underline underline-offset-2"
            >
              Cadastrar os desta empresa
            </Link>
            .
          </p>
        </div>
      )}

      {/* ── Sem TIPO cadastrado não há como criar viagem ──
          O tipo é o que resolve a categoria da DRE: oferecer o cadastro sem ele
          produziria viagem que não entra em conta nenhuma. O aviso nomeia o
          cadastro que falta, em vez de deixar a tela só sem botão. */}
      {!carregando && tipos.length === 0 && (
        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <p className="font-semibold">
            {(setup?.tiposSemMapeamento ?? 0) > 0
              ? "Os tipos de viagem cadastrados ainda não têm categoria mapeada."
              : "Nenhum tipo de viagem cadastrado nesta empresa."}
          </p>
          <p className="mt-1 text-muted-foreground">
            A viagem entra na DRE pelo <strong>tipo</strong> (consultoria, treinamento, visita a
            cliente…), e cada tipo aponta para uma categoria de despesa. Enquanto o de-para não
            existir, não há como orçar viagem.{" "}
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

      {/* ── Nova viagem ── */}
      {tipos.length > 0 && podeEscreverNoRecorte && (
        <div className="rounded-lg border p-4">
          {!novoAberto ? (
            <Button size="sm" onClick={() => setNovoAberto(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Nova viagem
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="viagem-titulo" className="text-xs">
                    Título
                  </Label>
                  <Input
                    id="viagem-titulo"
                    value={novoTitulo}
                    onChange={(e) => setNovoTitulo(e.target.value)}
                    placeholder="Consultoria em Curitiba e Florianópolis"
                    autoFocus
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="viagem-tipo" className="text-xs">
                    Tipo da viagem
                  </Label>
                  <select
                    id="viagem-tipo"
                    value={novoTipo}
                    onChange={(e) => setNovoTipo(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Escolha…</option>
                    {tipos.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    O tipo decide em que conta da DRE a viagem entra — o de-para é mantido na
                    configuração da empresa.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void criar()} disabled={criando}>
                  {criando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Criar e montar o roteiro
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNovoAberto(false);
                    setNovoTitulo("");
                    setNovoTipo("");
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── A lista ── */}
      {carregando ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando as viagens…
        </div>
      ) : viagens.length === 0 ? (
        tipos.length > 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            <Plane className="mx-auto mb-2 h-6 w-6 opacity-50" />
            Nenhuma viagem orçada {setorEscolhido ? "neste setor" : "nesta empresa"} ainda.
          </div>
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Viagem</th>
                <th className="px-3 py-2 text-left font-medium">Roteiro</th>
                <th className="px-3 py-2 text-left font-medium">Ida</th>
                <th className="px-3 py-2 text-right font-medium">Pessoas</th>
                <th className="px-3 py-2 text-right font-medium">Custo</th>
                <th className="px-3 py-2 text-left font-medium">Situação</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {viagens.map((v) => {
                const etiqueta = ESTADO_ETIQUETA[v.estado] ?? ESTADO_ETIQUETA.pendente;
                return (
                  <tr key={v.id} className="border-t">
                    <td className="px-3 py-2">
                      <Link
                        href={viagemHref(companyId, year, v.id)}
                        className="font-medium hover:underline"
                      >
                        {v.titulo}
                      </Link>
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {v.tipoNome ?? "sem tipo"}
                        {v.setorNome && !setorEscolhido ? ` · ${v.setorNome}` : ""}
                      </span>
                      {v.comentario && (
                        <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-500">
                          {v.comentario}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {v.cidades.length > 0 ? (
                        <>
                          {v.origem ? `${v.origem} → ` : ""}
                          {v.cidades.join(" → ")}
                          {v.noites > 0 && (
                            <span className="ml-1 text-xs">
                              ({v.noites} noite{v.noites === 1 ? "" : "s"})
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs italic">roteiro ainda vazio</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {dataCurta(v.dataIda)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{v.pessoas}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {formatBRL(v.custoTotal)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[11px] font-medium",
                            v.status === "enviada"
                              ? "bg-sky-500/15 text-sky-700 dark:text-sky-400"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {v.status === "enviada" ? "No orçamento" : "Rascunho"}
                        </span>
                        {v.status === "enviada" && (
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[11px] font-medium",
                              etiqueta.classe,
                            )}
                          >
                            {etiqueta.texto}
                          </span>
                        )}
                        {v.finalizado && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                            Finalizada
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={viagemHref(companyId, year, v.id)}
                          className={buttonVariants({ variant: "ghost", size: "sm" })}
                        >
                          Abrir
                          <ArrowRight className="ml-1 h-3.5 w-3.5" />
                        </Link>
                        {!v.travado && !v.finalizado && podeEscreverNoRecorte && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void excluir(v)}
                            title="Excluir a viagem"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t bg-muted/30 text-xs">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-muted-foreground">
                  No orçamento
                  {totalRascunho > 0 && ` · ${formatBRL(totalRascunho)} ainda em rascunho`}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {formatBRL(totalEnviado)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── Finalizar: a fatia é (categoria × setor), como nos outros métodos ── */}
      {setorEscolhido && categoriasComViagem.length > 0 && (
        <div className="space-y-2 rounded-lg border p-4">
          <p className="text-sm font-semibold">Finalizar</p>
          <p className="text-xs text-muted-foreground">
            Fecha a categoria neste setor e publica no Budget o que a diretoria aprovou. Depois de
            finalizar, ninguém edita — nem o administrador — até reabrir.
          </p>
          <div className="divide-y">
            {categoriasComViagem.map((code) => {
              const nome =
                categorias.find((c) => c.categoryCode === code)?.categoryName ?? code;
              return (
                <div key={code} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm">{nome}</span>
                  <BotaoFinalizar
                    companyId={companyId}
                    year={year}
                    metodo="viagens"
                    categoryCode={code}
                    setorId={setorEscolhido}
                    rotulo={`${nome} · ${setorNome}`}
                    finalizacao={finalizacaoDe(indexarFinalizacoes(finalizacoes), {
                      metodo: "viagens",
                      categoryCode: code,
                      setorId: setorEscolhido,
                    })}
                    isAdmin={setup?.isAdmin ?? false}
                    onMudou={() => {
                      void carregar();
                      void carregarPrevia();
                      void getFinalizacoes(companyId, year).then((r) =>
                        setFinalizacoes(r.items ?? []),
                      );
                    }}
                    compacto
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Prévia do setor: a MESMA das outras telas de método ── */}
      {setorEscolhido && (
        <PlanejamentoPreviaSetor
          resumo={previa}
          carregando={carregandoPrevia}
          setorNome={setorNome}
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
