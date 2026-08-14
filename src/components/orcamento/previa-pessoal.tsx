"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Loader2 } from "lucide-react";

import { getPrevia, type PreviaPayload } from "@/lib/orcamento/actions/pessoal";
import {
  enviarPreviaParaOrcamento,
  type EnvioBudgetResultado,
} from "@/lib/orcamento/actions/previa-budget";
import { ENCARGOS } from "@/lib/orcamento/encargos";
import { workspaceConfigSecaoHref } from "@/lib/orcamento/workspace-tabs";
import { regimeApuracaoLabel } from "@/lib/orcamento/regime-apuracao";
import { PreviaTabela } from "@/components/orcamento/previa-tabela";
import { formatBRL } from "@/lib/orcamento/format";
import { cn } from "@/lib/utils";

interface Props {
  companyId: string;
  year: number;
  /** Filtro de setor da tela (null = quadro único, SETOR_TODOS = empresa). */
  setorId: string | null;
  /** Como descrever o escopo na legenda ("todos os setores", "setor Vendas"). */
  escopoLabel: string;
}

export function PreviaPessoal({ companyId, year, setorId, escopoLabel }: Props) {
  const [payload, setPayload] = useState<PreviaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      setLoading(true);
      setError(null);
      setNeedsMigration(false);
      const res = await getPrevia(companyId, year, { setorId });
      if (cancelado) return;
      setLoading(false);
      if (res?.needsMigration) {
        setNeedsMigration(true);
        setPayload(null);
        return;
      }
      if (res?.error) {
        setError(res.error);
        setPayload(null);
        return;
      }
      setPayload(res.payload ?? null);
    }
    void carregar();
    return () => {
      cancelado = true;
    };
  }, [companyId, year, setorId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Calculando a prévia…
      </div>
    );
  }

  if (needsMigration) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Migration pendente</p>
        <p className="mt-1 text-muted-foreground">
          Rode a migration{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            20260730140000_orcamento_pessoal_admissao_encargos
          </code>{" "}
          para habilitar a prévia.
        </p>
      </div>
    );
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!payload) return null;

  const { previa, regimeApuracao, encargos, totalColaboradores } = payload;
  const caixa = regimeApuracao === "caixa";
  const totalInss = encargos.inss_patronal + encargos.rat_fap + encargos.terceiros;

  if (totalColaboradores === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        Nenhum colaborador em {escopoLabel} em {year}. Cadastre-os na aba{" "}
        <strong>Quadro</strong> para ver a prévia.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <span>
          {totalColaboradores} colaborador(es) em <strong className="text-foreground">{escopoLabel}</strong>.
          Regime de apuração:{" "}
          <strong className="text-foreground">{regimeApuracaoLabel(regimeApuracao)}</strong>.
        </span>
        <span>
          INSS <strong className="text-foreground">{totalInss.toLocaleString("pt-BR")}%</strong> +
          FGTS <strong className="text-foreground">{encargos.fgts.toLocaleString("pt-BR")}%</strong>{" "}
          —{" "}
          <Link
            href={workspaceConfigSecaoHref(companyId, year, "encargos")}
            className="underline hover:text-foreground"
          >
            ajustar
          </Link>
        </span>
      </div>

      {previa.avisos.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-2.5 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Linhas que a prévia não conseguiu posicionar no tempo
          </p>
          <ul className="list-inside list-disc text-muted-foreground">
            {previa.avisos.map((aviso, idx) => (
              <li key={idx}>{aviso}</li>
            ))}
          </ul>
        </div>
      )}

      <PreviaTabela previa={previa} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          Custo total do ano:{" "}
          <strong className="tabular-nums">{formatBRL(previa.totalAno)}</strong>
        </p>
        <EnviarParaOrcamento companyId={companyId} year={year} />
      </div>

      <details className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">Como cada linha é calculada</summary>
        <ul className={cn("mt-2 space-y-1.5 text-muted-foreground")}>
          <li>
            <strong>Salários</strong> — soma dos salários vigentes no mês, considerando admissões,
            movimentações de cargo e desligamentos. Inclui PJ e estágio, que entram no custo mas{" "}
            <em>não</em> na base de encargos.
          </li>
          <li>
            <strong>Benefícios</strong> — soma dos valores mensais da aba Benefícios dos
            colaboradores ativos no mês, em qualquer vínculo.
          </li>
          <li>
            <strong>Férias</strong> — apenas o <strong>terço constitucional</strong> mais os
            encargos sobre ele, provisionado mês a mês sobre a <strong>média corrida</strong> (ver
            abaixo): média ÷ 36 em cada mês. O salário do mês de férias já está na linha de
            Salários, então provisionar o salário inteiro aqui cobraria um salário a mais por ano.
          </li>
          <li>
            <strong>13º Salário</strong> —{" "}
            {caixa
              ? "no regime de caixa, metade em novembro e metade em dezembro, com os encargos junto."
              : "no regime de competência, provisionado mês a mês (média corrida ÷ 12), com os encargos junto."}{" "}
            Quem entra em maio acumula 8 meses de provisão, ou seja 8/12 do 13º.
          </li>
          <li>
            <strong>Média corrida</strong> — a base das duas provisões em cada mês é a média dos
            salários de <strong>janeiro (ou da admissão) até aquele mês</strong>, sempre olhando
            para trás. Nenhum salário futuro entra: um aumento previsto para outubro não pode
            inflar a provisão de março, porque não se sabe se será executado. Na prática, a
            provisão sobe gradualmente depois de uma promoção, à medida que o salário novo entra na
            média.
          </li>
          <li>
            <strong>INSS</strong> e <strong>FGTS</strong> — incidem sobre a folha CLT pura. Os
            encargos das férias e do 13º já estão dentro daquelas linhas; somá-los de novo aqui
            contaria duas vezes.
          </li>
          {caixa && (
            <li>
              <strong>Defasagem de 1 mês</strong> — no regime de caixa, <strong>Salários, INSS e
              FGTS</strong> aparecem no mês em que o dinheiro sai (folha no dia 5 e encargos no dia
              20 do mês seguinte). Janeiro usa a própria folha de janeiro como estimativa da folha
              de dezembro do ano anterior, e a folha de dezembro deste ano cai fora da prévia —
              movimentação marcada para dezembro não aparece aqui. Não defasam: Benefícios (do
              próprio mês de uso), Férias (o mês de gozo é desconhecido) e o 13º, que tem
              calendário próprio.
            </li>
          )}
          <li>
            <strong>Alíquotas</strong> —{" "}
            {ENCARGOS.map((e) => `${e.label} ${encargos[e.key].toLocaleString("pt-BR")}%`).join(
              " · ",
            )}
            .
          </li>
        </ul>
      </details>
    </div>
  );
}

/**
 * Publica a prévia no orçamento (Budget e Forecast). Sempre a empresa inteira,
 * mesmo que a tela esteja filtrada por setor — o orçamento não pode sair pela
 * metade. Por isso o botão fica fora do escopo do filtro e avisa disso.
 */
function EnviarParaOrcamento({ companyId, year }: { companyId: string; year: number }) {
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<EnvioBudgetResultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    if (
      !window.confirm(
        `Enviar a prévia de ${year} para o Budget e Forecast? Todos os setores da empresa entram somados, substituindo o envio anterior deste ano.`,
      )
    ) {
      return;
    }
    setEnviando(true);
    setErro(null);
    setResultado(null);
    const res = await enviarPreviaParaOrcamento(companyId, year);
    setEnviando(false);
    if (res?.needsMigration) {
      setErro("Migration 20260731130000_budget_uploads_raw_source ainda não aplicada.");
      return;
    }
    if (res?.error) {
      setErro(res.error);
      return;
    }
    setResultado(res.resultado ?? null);
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => void enviar()}
        disabled={enviando}
        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
      >
        {enviando ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowUpRight className="h-4 w-4" />
        )}
        Enviar para Budget e Forecast
      </button>

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {resultado && (
        <div
          className={cn(
            "w-full max-w-xl space-y-1 rounded-md border p-3 text-sm",
            resultado.naoMapeados.length > 0
              ? "border-amber-500/40 bg-amber-500/5"
              : "border-emerald-500/40 bg-emerald-500/5",
          )}
        >
          <p className="font-medium">
            {resultado.linhasGravadas} linha(s) publicada(s) — {formatBRL(resultado.totalAno)} no
            ano.
          </p>
          {resultado.naoMapeados.length > 0 ? (
            <div className="text-muted-foreground">
              <p>
                Estas linhas ainda não têm conta da DRE e por isso{" "}
                <strong>não entraram no orçamento</strong>. Ligue cada uma em{" "}
                <Link href="/mapeamento" className="underline hover:text-foreground">
                  Mapeamento → Linhas do Orçamento
                </Link>
                . Salvar o mapeamento já aplica os valores — não precisa voltar aqui.
              </p>
              <ul className="mt-1 list-inside list-disc">
                {resultado.naoMapeados.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground">
              {resultado.celulasOrcamento} célula(s) no orçamento do ano. Confira em{" "}
              <Link href="/budget-forecast" className="underline hover:text-foreground">
                Budget e Forecast
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}
