import { redirect } from "next/navigation";

import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { todayBR } from "@/lib/ctrl/datetime";
import { getDpUser } from "@/lib/dp/auth";
import { calcularIndicadores, ROTULO_CONTRATO, SEM_EMPRESA, type DpIndicadorLinha } from "@/lib/dp/indicadores";
import { DpNaoInstaladoError, listDpIndicadorEntradas } from "@/lib/dp/queries";
import { formatBRL } from "@/lib/orcamento/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function rotuloMes(m: string): string {
  const [y, mm] = m.split("-");
  return `${MES[Number(mm) - 1]}/${y.slice(2)}`;
}

function tempoDeCasa(meses: number | null): string {
  if (meses === null) return "—";
  const anos = Math.floor(meses / 12);
  const resto = Math.round(meses - anos * 12);
  if (anos === 0) return `${resto} m`;
  return resto === 0 ? `${anos} a` : `${anos} a ${resto} m`;
}

/**
 * Indicadores do quadro. Server component de ponta a ponta: o salário de cada
 * pessoa é somado aqui e só os totais chegam ao navegador.
 */
export default async function DpIndicadoresPage() {
  const user = await getDpUser();
  if (!user) redirect("/");

  let rows;
  try {
    rows = await listDpIndicadorEntradas(createAdminClient());
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado />;
    throw error;
  }

  const hoje = todayBR();
  const ind = calcularIndicadores(rows, hoje);
  const t = ind.total;
  const maxMes = Math.max(1, ...ind.admissoesPorMes.map((m) => m.quantidade));

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Indicadores do quadro</h1>
        <p className="text-sm text-ink-muted">Colaboradores ativos na Sólides, por empresa.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Colaboradores ativos" value={String(t.ativos)} />
        <Stat
          label="Folha mensal (salário informado)"
          value={formatBRL(t.folha)}
          nota={t.semSalario > 0 ? `${t.semSalario} sem salário na Sólides, fora da soma` : undefined}
        />
        <Stat label="Salário médio CLT" value={t.salarioMedioClt === null ? "—" : formatBRL(t.salarioMedioClt)} />
        <Stat label="Admitidos nos últimos 12 meses" value={String(t.admitidos12m)} nota={`${ind.desligados12m} desligamento(s) percebidos`} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Por empresa</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-left text-ink-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-medium">Empresa</th>
                <th className="py-2 pr-3 text-right font-medium">Ativos</th>
                {(Object.keys(ROTULO_CONTRATO) as Array<keyof typeof ROTULO_CONTRATO>).map((k) => (
                  <th key={k} className="py-2 pr-3 text-right font-medium">{ROTULO_CONTRATO[k]}</th>
                ))}
                <th className="py-2 pr-3 text-right font-medium">Folha</th>
                <th className="py-2 pr-3 text-right font-medium">Sem salário</th>
                <th className="py-2 pr-3 text-right font-medium">Média CLT</th>
                <th className="py-2 pr-3 text-right font-medium">Tempo de casa</th>
                <th className="py-2 text-right font-medium">Admitidos 12m</th>
              </tr>
            </thead>
            <tbody>
              {ind.porEmpresa.map((l) => (
                <Linha key={l.empresa} l={l} />
              ))}
              <Linha l={t} total />
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Admissões por mês (de quem está ativo hoje)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-12 gap-1 text-center text-xs">
            {ind.admissoesPorMes.map((m) => (
              <div key={m.mes} className="flex flex-col items-center gap-1">
                <div className="flex h-20 w-full items-end justify-center">
                  <div
                    className="w-4/5 rounded-t-sm bg-teal-600/70 dark:bg-teal-400/60"
                    style={{ height: `${(m.quantidade / maxMes) * 100}%` }}
                    title={`${rotuloMes(m.mes)}: ${m.quantidade}`}
                  />
                </div>
                <span className="tabular-nums text-ink-primary">{m.quantidade}</span>
                <span className="text-ink-muted">{rotuloMes(m.mes)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-1 text-xs text-ink-muted">
        <p>
          <strong>Folha</strong> é a soma do salário cadastrado na Sólides: sem encargos, benefícios ou variáveis. Quem está
          sem salário lá fica fora da soma e aparece em “Sem salário”.
        </p>
        <p>
          <strong>Média CLT</strong> considera só CLT com salário informado — pró-labore de sócio e valor de prestador
          distorceriam a média.
        </p>
        <p>
          <strong>Admissões por mês</strong> vêm da data de admissão de quem está ativo hoje: quem entrou e já saiu não
          aparece, então os meses mais antigos ficam menores do que foram. Desligamentos só são percebidos desde
          29/09/2026, quando o espelho da Sólides começou.
        </p>
      </div>
    </div>
  );
}

function Linha({ l, total }: { l: DpIndicadorLinha; total?: boolean }) {
  const sem = l.empresa === SEM_EMPRESA;
  return (
    <tr className={`border-b border-border last:border-0 ${total ? "font-semibold" : ""}`}>
      <td className={`py-1.5 pr-3 ${sem ? "text-amber-700 dark:text-amber-400" : "text-ink-primary"}`}>{l.empresa}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{l.ativos}</td>
      {(Object.keys(ROTULO_CONTRATO) as Array<keyof typeof ROTULO_CONTRATO>).map((k) => (
        <td key={k} className="py-1.5 pr-3 text-right tabular-nums text-ink-muted">{l.porContrato[k] || "—"}</td>
      ))}
      <td className="py-1.5 pr-3 text-right tabular-nums">{formatBRL(l.folha)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-ink-muted">{l.semSalario || "—"}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{l.salarioMedioClt === null ? "—" : formatBRL(l.salarioMedioClt)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{tempoDeCasa(l.tempoMedioMeses)}</td>
      <td className="py-1.5 text-right tabular-nums">{l.admitidos12m || "—"}</td>
    </tr>
  );
}

function Stat({ label, value, nota }: { label: string; value: string; nota?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-sm text-ink-muted">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-ink-primary">{value}</p>
        {nota && <p className="mt-0.5 text-xs text-ink-muted">{nota}</p>}
      </CardContent>
    </Card>
  );
}
