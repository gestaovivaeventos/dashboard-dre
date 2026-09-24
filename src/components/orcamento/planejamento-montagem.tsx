"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2, Tags } from "lucide-react";

import {
  getPlanejamentoMontagem,
  getPreviaSetor,
  type PlanejamentoMontagemDetalhe,
  type PreviaSetorResumo,
} from "@/lib/orcamento/actions/planejamento-categoria";
import { formatBRL } from "@/lib/orcamento/format";
import { workspaceConfigSecaoHref, workspaceTabHref } from "@/lib/orcamento/workspace-tabs";
import { PlanejamentoBaseEditor } from "@/components/orcamento/planejamento-base-editor";
import { PlanejamentoDespesas } from "@/components/orcamento/planejamento-despesas";
import { PlanejamentoEntrevista } from "@/components/orcamento/planejamento-entrevista";
import { PlanejamentoPreviaSetor } from "@/components/orcamento/planejamento-previa-setor";
import { cn } from "@/lib/utils";

/**
 * Tela de MONTAGEM de uma categoria do Planejamento dos gestores.
 *
 * Três blocos, nesta ordem de leitura: a BASE (o que saiu no ano anterior, e
 * que o administrador cura), a ENTREVISTA com a IA e as DESPESAS que saem dela
 * — com a PRÉVIA DO SETOR embaixo, se preenchendo a cada despesa confirmada.
 *
 * O setor vem da query (`?setor=`), não da rota: a categoria é a mesma, o que
 * muda é de qual setor é este orçamento. Quando o usuário alcança um setor só,
 * ele é escolhido sozinho e o seletor nem aparece.
 */
export function PlanejamentoMontagem({
  companyId,
  year,
  categoryCode,
}: {
  companyId: string;
  year: number;
  categoryCode: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const setorDaUrl = params.get("setor");

  const [detalhe, setDetalhe] = useState<PlanejamentoMontagemDetalhe | null>(null);
  const [previa, setPrevia] = useState<PreviaSetorResumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  const recarregar = useCallback(async () => {
    const res = await getPlanejamentoMontagem(companyId, year, categoryCode, setorDaUrl);
    if (res.needsMigration) {
      setNeedsMigration(true);
      setCarregando(false);
      return null;
    }
    if (res.error || !res.data) {
      setErro(res.error ?? "Não consegui carregar esta categoria.");
      setCarregando(false);
      return null;
    }
    setErro(null);
    setDetalhe(res.data);
    setCarregando(false);
    return res.data;
  }, [companyId, year, categoryCode, setorDaUrl]);

  const recarregarPrevia = useCallback(
    async (setorId: string | null, categoriaNome: string) => {
      setCarregandoPrevia(true);
      const res = await getPreviaSetor(companyId, year, setorId, categoriaNome);
      setCarregandoPrevia(false);
      if (res.data) setPrevia(res.data);
    },
    [companyId, year],
  );

  useEffect(() => {
    setCarregando(true);
    void recarregar().then((d) => {
      if (d && (d.setorId !== null || d.setores.length > 0)) {
        void recarregarPrevia(d.setorId, d.categoryName);
      }
    });
  }, [recarregar, recarregarPrevia]);

  /** Depois de mexer no orçamento: recarrega o detalhe E a prévia. */
  const aposMudanca = useCallback(() => {
    void recarregar().then((d) => {
      if (d) void recarregarPrevia(d.setorId, d.categoryName);
    });
  }, [recarregar, recarregarPrevia]);

  if (needsMigration) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Migration pendente</p>
        <p className="mt-1 text-muted-foreground">
          As tabelas do Planejamento dos gestores ainda não foram aplicadas no banco.
        </p>
      </div>
    );
  }

  if (carregando && !detalhe) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando categoria…
      </div>
    );
  }

  if (erro || !detalhe) {
    return (
      <div className="space-y-3">
        <Voltar companyId={companyId} year={year} />
        <p className="text-sm text-destructive">{erro ?? "Categoria indisponível."}</p>
      </div>
    );
  }

  const precisaEscolherSetor = detalhe.setorId === null && detalhe.setores.length > 1;
  const semSetor = detalhe.setores.length === 0;

  return (
    <div className="space-y-4">
      <Voltar companyId={companyId} year={year} />

      {/* ── Cabeçalho ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight">{detalhe.categoryName}</h2>
          <p className="text-sm text-muted-foreground">
            {detalhe.dreLineCode} · {detalhe.dreLineName}
            {detalhe.setorNome ? ` · ${detalhe.setorNome}` : ""}
          </p>
        </div>
        {detalhe.realizadoAnterior && (
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Gasto em {year - 1}</div>
            <div className="font-semibold tabular-nums">
              {formatBRL(detalhe.realizadoAnterior.total)}
            </div>
          </div>
        )}
      </div>

      {/* ── Grupos disponíveis ─────────────────────────────────────────────── */}
      {detalhe.grupos.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/20 px-3 py-2">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Tags className="h-3.5 w-3.5" /> Grupos disponíveis:
          </span>
          {detalhe.grupos.map((g) => (
            <span
              key={g.id}
              className="rounded-full border bg-background px-2 py-0.5 text-[11px]"
            >
              {g.name}
            </span>
          ))}
          {/* O cadastro fica em Configuração › Grupos de despesas, e ninguém o
              acha estando aqui — é aqui que a falta dele aparece. */}
          {detalhe.isAdmin && (
            <Link
              href={workspaceConfigSecaoHref(companyId, year, "grupos-despesa")}
              className="ml-1 text-[11px] font-medium text-emerald-700 underline-offset-2 hover:underline"
            >
              cadastrar grupos
            </Link>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>
            Esta empresa ainda não tem <strong>grupos de despesas</strong> cadastrados — as despesas
            vão cair em &quot;Sem grupo&quot; na prévia, e a IA não vai ter o que perguntar.{" "}
            {detalhe.isAdmin ? (
              <Link
                href={workspaceConfigSecaoHref(companyId, year, "grupos-despesa")}
                className="font-medium text-amber-900 underline underline-offset-2"
              >
                Cadastrar agora em Configuração › Grupos de despesas
              </Link>
            ) : (
              <>
                O administrador cadastra em <strong>Configuração › Grupos de despesas</strong>.
              </>
            )}
          </span>
        </div>
      )}

      {/* ── Seletor de setor ───────────────────────────────────────────────── */}
      {detalhe.setores.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Setor:</span>
          {detalhe.setores.map((s) => (
            <button
              key={s.id ?? "nulo"}
              onClick={() =>
                router.replace(
                  `?setor=${encodeURIComponent(s.id ?? "")}`,
                  { scroll: false },
                )
              }
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                detalhe.setorId === s.id
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "bg-background hover:bg-muted",
              )}
            >
              {s.name}
              {!s.podeEscrever && " (leitura)"}
            </button>
          ))}
        </div>
      )}

      {semSetor ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Esta categoria não está atribuída a nenhum setor que você alcança. O administrador define
          isso em <strong>Configuração › Método por categoria</strong>.
        </div>
      ) : precisaEscolherSetor ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Escolha o setor acima para montar o orçamento desta categoria. Cada setor tem a própria
          base, a própria conversa e as próprias despesas.
        </div>
      ) : (
        <>
          <PlanejamentoBaseEditor
            companyId={companyId}
            year={year}
            categoryCode={categoryCode}
            categoryName={detalhe.categoryName}
            setorId={detalhe.setorId}
            base={detalhe.base}
            baseSalva={detalhe.baseSalva}
            contextoAdmin={detalhe.contextoAdmin}
            grupos={detalhe.grupos}
            isAdmin={detalhe.isAdmin}
            onMudou={aposMudanca}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <PlanejamentoEntrevista
              companyId={companyId}
              year={year}
              categoryCode={categoryCode}
              categoryName={detalhe.categoryName}
              setorId={detalhe.setorId}
              conversa={detalhe.conversa}
              justificativa={detalhe.justificativa}
              grupos={detalhe.grupos}
              baseSalva={detalhe.baseSalva}
              podeEscrever={detalhe.podeEscrever}
              realizadoMeses={detalhe.realizadoAnterior?.meses ?? null}
              onDespesaAdicionada={aposMudanca}
              onConversaMudou={aposMudanca}
            />

            <PlanejamentoDespesas
              companyId={companyId}
              year={year}
              despesas={detalhe.despesas}
              grupos={detalhe.grupos}
              podeEscrever={detalhe.podeEscrever}
              onMudou={aposMudanca}
            />
          </div>

          <PlanejamentoPreviaSetor
            resumo={previa}
            carregando={carregandoPrevia}
            setorNome={detalhe.setorNome}
            year={year}
          />
        </>
      )}
    </div>
  );
}

function Voltar({ companyId, year }: { companyId: string; year: number }) {
  return (
    <Link
      href={workspaceTabHref(companyId, year, "planejamento_socios")}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Voltar às categorias
    </Link>
  );
}
