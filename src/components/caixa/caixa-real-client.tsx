"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  Download,
  Landmark,
  ListPlus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { CaixaHistoryChart } from "@/components/caixa/caixa-history-chart";
import { CompanyPicker, type PickerCompany } from "@/components/caixa/company-picker";
import { SyncAlertBanner } from "@/components/caixa/sync-alert-banner";
import { FilterTable, type FilterColumn } from "@/components/data-table/filter-table";
import { BANCOS_BR } from "@/lib/ctrl/bancos";
import type { CaixaSyncAlert } from "@/lib/caixa/health";
import { CAIXA_CRON_SLOTS_LABEL } from "@/lib/caixa/schedule";
import {
  CAIXA_TIPOS_LIQUIDOS,
  OMIE_BANCO_SEM_BANCO,
  tipoLabel,
  type CaixaAccountRow,
} from "@/lib/caixa/types";

const BANCO_NOMES = new Map(BANCOS_BR.map((b) => [b.codigo, b.nome]));

/** Rótulos dos tipos que a tela mostra ao abrir (ver CAIXA_TIPOS_LIQUIDOS). */
const LIQUIDOS_LABEL = new Set(CAIXA_TIPOS_LIQUIDOS.map((t) => tipoLabel(t)));

function ehLiquida(row: CaixaAccountRow): boolean {
  return LIQUIDOS_LABEL.has(tipoLabel(row.tipo));
}

const STATUS_ATIVA = "Ativa";
const STATUS_INATIVA = "Inativa";

/** Espelha `inativo` da Omie: conta encerrada some do cadastro de lá. */
function statusLabel(row: CaixaAccountRow): string {
  return row.ativo ? STATUS_ATIVA : STATUS_INATIVA;
}

/** O recorte com que a tela abre: dinheiro E conta ativa. */
function ehPadrao(row: CaixaAccountRow): boolean {
  return row.ativo && ehLiquida(row);
}

const brl = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

/** "341 · Itaú Unibanco", "450" (código desconhecido) ou "—" (caixa físico). */
function bancoLabel(row: CaixaAccountRow): string {
  const codigo = row.bancoCodigo;
  if (!codigo || codigo === OMIE_BANCO_SEM_BANCO) return "—";
  const nome = BANCO_NOMES.get(codigo);
  return nome ? `${codigo} · ${nome}` : codigo;
}

function contaLabel(row: CaixaAccountRow): string {
  const partes = [row.agencia, row.conta].filter(Boolean);
  return partes.length > 0 ? partes.join(" / ") : "—";
}

/** Dia da última captura, em rótulo grosso — é o que serve de filtro. */
function atualizadoBucket(row: CaixaAccountRow, hoje: string, ontem: string): string {
  if (!row.saldoAt) return "Nunca";
  const dia = dayKey(row.saldoAt);
  if (dia === hoje) return "Hoje";
  if (dia === ontem) return "Ontem";
  return formatDay(dia);
}

function dayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function formatDay(isoDay: string): string {
  const [y, m, d] = isoDay.split("-");
  return `${d}/${m}/${y}`;
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function shiftDay(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

interface Props {
  rows: CaixaAccountRow[];
  /**
   * Empresas que entram na varredura (ativas e com credencial Omie). Vem do
   * servidor, não das linhas: uma empresa nova ainda não tem conta nenhuma
   * aqui, e é exatamente ela que precisa do "Sincronizar contas".
   */
  companies: PickerCompany[];
  /** Hoje em Brasília ('YYYY-MM-DD'), resolvido no servidor. */
  today: string;
  lastUpdate: string | null;
  /** Falha/atraso da atualização, se houver (ver @/lib/caixa/health). */
  syncAlert: CaixaSyncAlert | null;
}

type Progress = { label: string; done: number; total: number } | null;

export function CaixaRealClient({ rows, companies, today, lastUpdate, syncAlert }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Começa no MESMO recorte que a tabela vai aplicar. A FilterTable só reporta
  // as linhas visíveis num efeito, isto é, depois da primeira pintura: iniciar
  // com `rows` faria o card mostrar o total de tudo (R$ 58,4 mi, com aplicações
  // e cartões) por um frame antes de corrigir para o caixa (R$ 3,2 mi). Piscar
  // um número de dinheiro errado é pior que demorar a mostrá-lo.
  const [visible, setVisible] = useState<CaixaAccountRow[]>(() => rows.filter(ehPadrao));
  const [progress, setProgress] = useState<Progress>(null);
  /** Escopo das ações. `null` = todas (ver CompanyPicker). */
  const [scope, setScope] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const ontem = useMemo(() => shiftDay(today, -1), [today]);

  // A tela abre mostrando só DINHEIRO (conta corrente, caixa físico, conta de
  // pagamento). Aplicação, cartão de crédito e garantia continuam na tabela,
  // a um clique no chip "Tipo" — o total nunca deixa de ser a soma do que está
  // na tela. Sem isto, "Caixa Real" somaria fatura de cartão (que é dívida) ao
  // dinheiro em conta e responderia outra pergunta.
  const initialValues = useMemo(
    () => ({
      tipo: CAIXA_TIPOS_LIQUIDOS.map((t) => tipoLabel(t)),
      // Contas encerradas na Omie continuam na tabela (o histórico de saldo
      // delas é fato), mas fora do recorte de abertura: o saldo delas não é
      // mais atualizado, então somá-las daria um caixa que não existe.
      status: [STATUS_ATIVA],
    }),
    [],
  );


  // Memoizado: a FilterTable recalcula tudo quando `columns` muda de
  // identidade, e ela reporta as linhas visíveis de volta para cá — um array
  // novo a cada render viraria laço infinito.
  const columns = useMemo<FilterColumn<CaixaAccountRow>[]>(
    () => [
      {
        key: "empresa",
        label: "Empresa",
        plain: (r) => r.companyName,
        sortVal: (r) => r.companyName.toLowerCase(),
        cell: (r) => <span className="font-medium text-ink-primary">{r.companyName}</span>,
      },
      {
        key: "status",
        label: "Status",
        plain: statusLabel,
        sortVal: (r) => statusLabel(r),
        className: "whitespace-nowrap",
        cell: (r) => (
          <span
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${
              r.ativo
                ? "bg-status-success/10 text-status-success"
                : "bg-surface-3 text-ink-muted"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                r.ativo ? "bg-status-success" : "bg-ink-disabled"
              }`}
            />
            {statusLabel(r)}
          </span>
        ),
      },
      {
        key: "conta",
        label: "Conta Corrente",
        plain: (r) => r.descricao,
        sortVal: (r) => r.descricao.toLowerCase(),
        cell: (r) => (
          <div className="min-w-0">
            <div className="truncate text-ink-primary">{r.descricao}</div>
            {contaLabel(r) !== "—" && (
              <div className="truncate text-xs text-ink-muted">Ag. {contaLabel(r)}</div>
            )}
          </div>
        ),
      },
      {
        key: "banco",
        label: "Banco",
        plain: bancoLabel,
        sortVal: (r) => bancoLabel(r),
        cell: (r) => <span className="text-ink-secondary">{bancoLabel(r)}</span>,
      },
      {
        key: "tipo",
        label: "Tipo",
        plain: (r) => tipoLabel(r.tipo),
        sortVal: (r) => tipoLabel(r.tipo),
        cell: (r) => (
          <span className="inline-flex whitespace-nowrap rounded-full bg-surface-3 px-2 py-0.5 text-xs text-ink-secondary">
            {tipoLabel(r.tipo)}
          </span>
        ),
      },
      {
        key: "saldo",
        label: "Saldo",
        kind: "number",
        align: "right",
        plain: (r) => brl(r.saldo),
        numeric: (r) => r.saldo,
        sortVal: (r) => r.saldo ?? Number.NEGATIVE_INFINITY,
        cell: (r) => (
          <span
            className={`font-semibold tabular-nums ${
              r.saldo === null
                ? "text-ink-disabled"
                : r.saldo < 0
                ? "text-status-critical"
                : "text-ink-primary"
            }`}
          >
            {brl(r.saldo)}
          </span>
        ),
      },
      {
        key: "variacao",
        label: "Variação no dia",
        kind: "number",
        align: "right",
        plain: (r) => (r.variacaoDia === null ? "—" : brl(r.variacaoDia)),
        numeric: (r) => r.variacaoDia,
        sortVal: (r) => r.variacaoDia ?? 0,
        cell: (r) => {
          if (r.variacaoDia === null) return <span className="text-ink-disabled">—</span>;
          if (r.variacaoDia === 0) return <span className="text-ink-muted">—</span>;
          const up = r.variacaoDia > 0;
          return (
            <span
              className={`inline-flex items-center justify-end gap-1 tabular-nums ${
                up ? "text-status-success" : "text-status-critical"
              }`}
            >
              {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {brl(Math.abs(r.variacaoDia))}
            </span>
          );
        },
      },
      {
        key: "atualizado",
        label: "Atualizado",
        plain: (r) => atualizadoBucket(r, today, ontem),
        sortVal: (r) => r.saldoAt ?? "",
        className: "whitespace-nowrap",
        cell: (r) => {
          const bucket = atualizadoBucket(r, today, ontem);
          const stale = bucket !== "Hoje";
          return (
            <span
              title={r.saldoError ?? (r.saldoAt ? `Capturado em ${formatDay(dayKey(r.saldoAt))}` : "")}
              className={`inline-flex items-center gap-1 text-xs ${
                stale ? "text-status-warning" : "text-ink-muted"
              }`}
            >
              {(stale || r.saldoError) && <AlertTriangle className="h-3.5 w-3.5" />}
              {bucket === "Hoje" && r.saldoAt ? formatTime(r.saldoAt) : bucket}
            </span>
          );
        },
      },
    ],
    [today, ontem],
  );

  const rowKey = useCallback((r: CaixaAccountRow) => r.id, []);

  const totalVisivel = visible.reduce((s, r) => s + (r.saldo ?? 0), 0);
  // "Saldo em caixa" quando o recorte é exatamente o padrão (todo dinheiro e
  // só dinheiro); "(filtrado)" quando o usuário mexeu; "total" quando tudo
  // está à vista. O rótulo tem que contar qual pergunta o número responde.
  const contasPadrao = rows.filter(ehPadrao);
  const ehVisaoDeCaixa =
    visible.length === contasPadrao.length && visible.every(ehPadrao);
  const saldoLabel =
    visible.length === rows.length
      ? "Saldo total"
      : ehVisaoDeCaixa
      ? "Saldo em caixa"
      : "Saldo (filtrado)";
  const variacaoVisivel = visible.reduce((s, r) => s + (r.variacaoDia ?? 0), 0);
  const selecionadas = visible.filter((r) => selected.has(r.id));
  const totalSelecionado = selecionadas.reduce((s, r) => s + (r.saldo ?? 0), 0);
  const empresasVisiveis = new Set(visible.map((r) => r.companyId)).size;

  // O que o recorte atual está deixando de fora, por tipo. Existe porque o
  // filtro padrão esconde R$ 55 mi em aplicações: um total menor sem dizer o
  // que ficou fora é o tipo de número que faz alguém tomar decisão errada.
  const foraDoRecorte = useMemo(() => {
    const visiveis = new Set(visible.map((r) => r.id));
    const porTipo = new Map<string, number>();
    for (const r of rows) {
      if (visiveis.has(r.id) || r.saldo === null) continue;
      // Conta encerrada aparece como "contas inativas", não pelo tipo dela —
      // o motivo de estar fora do total é o encerramento, não ser aplicação.
      const label = r.ativo ? tipoLabel(r.tipo) : "contas inativas";
      porTipo.set(label, (porTipo.get(label) ?? 0) + r.saldo);
    }
    return Array.from(porTipo.entries())
      .filter(([, total]) => Math.abs(total) >= 0.01)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  }, [rows, visible]);
  const desatualizadas = visible.filter(
    (r) => r.ativo && atualizadoBucket(r, today, ontem) !== "Hoje",
  ).length;

  // Empresas com alguma conta sem saldo de hoje — alimenta o atalho "só as
  // desatualizadas" do seletor. Olha TODAS as linhas, não as visíveis: o
  // escopo é sobre o trabalho a fazer, não sobre o recorte da tela.
  const staleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of rows) {
      // Só contas ATIVAS: as inativas nunca são atualizadas (a varredura de
      // saldos as ignora), então incluí-las marcaria quase toda empresa como
      // desatualizada e o atalho "só as desatualizadas" perderia a utilidade.
      if (!r.ativo) continue;
      if (atualizadoBucket(r, today, ontem) !== "Hoje") ids.add(r.companyId);
    }
    return ids;
  }, [rows, today, ontem]);

  // Ids visíveis, memoizados: o gráfico usa como chave de busca.
  const visibleIds = useMemo(() => visible.map((r) => r.id), [visible]);

  const alvo = useMemo(
    () => (scope === null ? companies : companies.filter((c) => scope.has(c.id))),
    [companies, scope],
  );

  // ── Varredura empresa a empresa, com progresso ──────────────────────────
  async function sweep(kind: "cadastro" | "saldos") {
    if (alvo.length === 0) return;
    setError(null);
    try {
      const falhas: string[] = [];
      for (let i = 0; i < alvo.length; i += 1) {
        const company = alvo[i];
        setProgress({ label: company.name, done: i, total: alvo.length });
        try {
          const r = await fetch("/api/caixa/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind, companyId: company.id }),
          });
          const body = await r.json();
          if (!r.ok || body?.result?.ok === false) {
            falhas.push(`${company.name}: ${body?.result?.error ?? body?.error ?? "falhou"}`);
          }
        } catch (err) {
          falhas.push(`${company.name}: ${err instanceof Error ? err.message : "falhou"}`);
        }
      }

      setProgress({ label: "Concluído", done: alvo.length, total: alvo.length });
      if (falhas.length > 0) {
        setError(
          `${falhas.length} empresa(s) com problema — ${falhas.slice(0, 3).join(" · ")}${
            falhas.length > 3 ? " …" : ""
          }`,
        );
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na sincronização.");
    } finally {
      setTimeout(() => setProgress(null), 1200);
    }
  }

  // ── Export ───────────────────────────────────────────────────────────────
  async function handleExport() {
    if (visible.length === 0) return;
    setExporting(true);
    try {
      const XLSX = await import("xlsx-js-style");

      const MONEY = 'R$ #,##0.00;[Red]-R$ #,##0.00';
      const header = ["Empresa", "Status", "Conta Corrente", "Agência / Conta", "Banco", "Tipo", "Saldo", "Variação no dia", "Atualizado"];
      // Índices das colunas de dinheiro. Constante porque já mudaram uma vez
      // (ao inserir "Status") e estavam escritos à mão em três lugares.
      const MONEY_COLS = [6, 7];
      const body = visible.map((r) => [
        r.companyName,
        statusLabel(r),
        r.descricao,
        contaLabel(r),
        bancoLabel(r),
        tipoLabel(r.tipo),
        r.saldo,
        r.variacaoDia,
        atualizadoBucket(r, today, ontem),
      ]);
      const totalRow = ["TOTAL", "", `${visible.length} conta(s)`, "", "", "", totalVisivel, variacaoVisivel, ""];

      const ws = XLSX.utils.aoa_to_sheet([header, ...body, totalRow]);
      ws["!cols"] = [{ wch: 26 }, { wch: 10 }, { wch: 30 }, { wch: 18 }, { wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 12 }];
      // Autofiltro: o arquivo abre com os menus de filtro do próprio Excel,
      // então quem recebe continua fatiando como fazia na tela.
      //
      // NÃO tente congelar o cabeçalho aqui: o xlsx-js-style 1.2.0 ignora
      // `!freeze` (string OU objeto) e `!panes` — conferido gerando o arquivo e
      // lendo o XML, nenhum deles emite <pane>. A linha existia e foi removida
      // por ser decoração morta.
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: header.length - 1 } }) };

      const lastRow = body.length + 1;
      for (let c = 0; c < header.length; c += 1) {
        const head = ws[XLSX.utils.encode_cell({ r: 0, c })];
        if (head) {
          head.s = {
            font: { bold: true, color: { rgb: "FFFFFF" } },
            fill: { fgColor: { rgb: "AE1800" } },
            alignment: { horizontal: MONEY_COLS.includes(c) ? "right" : "left" },
          };
        }
        const total = ws[XLSX.utils.encode_cell({ r: lastRow, c })];
        if (total) {
          total.s = {
            font: { bold: true },
            border: { top: { style: "thin", color: { rgb: "999999" } } },
          };
          if (MONEY_COLS.includes(c)) total.z = MONEY;
        }
      }
      for (let r = 1; r <= body.length; r += 1) {
        for (const c of MONEY_COLS) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell && typeof cell.v === "number") cell.z = MONEY;
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Caixa Real");

      // Aba de contexto: um XLSX solto na mão de outra pessoa não diz por si só
      // que está filtrado. Aqui fica o recorte e a hora da extração.
      const meta: string[][] = [
        ["Caixa Real — Grupo Viva"],
        ["Gerado em", new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date())],
        ["Contas no arquivo", String(visible.length)],
        ["Contas cadastradas", String(rows.length)],
        ["Empresas", String(empresasVisiveis)],
        [],
        [
          visible.length === rows.length
            ? "Sem filtros: o arquivo traz todas as contas."
            : "ATENÇÃO: a tabela está FILTRADA — o total abaixo não é o caixa do grupo inteiro.",
        ],
        ["Total do arquivo", brl(totalVisivel)],
      ];
      const wsMeta = XLSX.utils.aoa_to_sheet(meta);
      wsMeta["!cols"] = [{ wch: 24 }, { wch: 40 }];
      if (wsMeta["A1"]) wsMeta["A1"].s = { font: { bold: true, sz: 14 } };
      XLSX.utils.book_append_sheet(wb, wsMeta, "Sobre este arquivo");

      XLSX.writeFile(wb, `caixa-real-${today}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  const busy = progress !== null;

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-primary">
            Caixa Real
          </h1>
          <p className="text-sm text-ink-muted">
            {lastUpdate ? (
              <>
                Saldos atualizados em{" "}
                <strong className="font-medium text-ink-secondary">
                  {formatDay(dayKey(lastUpdate))} às {formatTime(lastUpdate)}
                </strong>{" "}
                · automático às {CAIXA_CRON_SLOTS_LABEL}
              </>
            ) : (
              "Nenhum saldo capturado ainda — use “Atualizar saldos”."
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CompanyPicker
            companies={companies}
            selected={scope}
            onChange={setScope}
            staleIds={staleIds}
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => sweep("cadastro")}
            disabled={busy || alvo.length === 0}
            title="Busca na Omie as contas correntes cadastradas"
            className="inline-flex items-center gap-1.5 rounded-viva-md border border-border bg-surface-1 px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <ListPlus className="h-4 w-4" />
            Sincronizar contas
          </button>
          <button
            type="button"
            onClick={() => sweep("saldos")}
            disabled={busy || alvo.length === 0}
            title="Busca o saldo de agora de cada conta"
            className="inline-flex items-center gap-1.5 rounded-viva-md bg-viva-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-viva-600 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            Atualizar saldos
          </button>
        </div>
      </div>

      {syncAlert && <SyncAlertBanner alert={syncAlert} today={today} />}

      {alvo.length !== companies.length && (
        <p className="-mt-2 text-xs text-ink-muted">
          As ações acima vão rodar em{" "}
          <strong className="font-medium text-viva-700">
            {alvo.length} de {companies.length} empresas
          </strong>
          . A tabela continua mostrando todas.
        </p>
      )}

      {/* Progresso da varredura */}
      {progress && (
        <div className="rounded-viva-lg border border-border bg-surface-1 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-secondary">{progress.label}</span>
            <span className="tabular-nums text-ink-muted">
              {progress.total > 0 ? `${progress.done}/${progress.total}` : "…"}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-viva-500 transition-all duration-300"
              style={{
                width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : "10%",
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-viva-lg border border-status-warning/40 bg-status-warning/10 p-3 text-sm text-ink-secondary">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
          <span>{error}</span>
        </div>
      )}

      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<Wallet className="h-4 w-4" />}
          label={saldoLabel}
          value={brl(totalVisivel)}
          hint={
            ehVisaoDeCaixa
              ? `${visible.length} contas · sem aplicação/cartão`
              : `${visible.length} de ${rows.length} contas`
          }
          tone={totalVisivel < 0 ? "negative" : "default"}
          emphasis
        />
        <StatCard
          icon={<Landmark className="h-4 w-4" />}
          label="Selecionado"
          value={selected.size === 0 ? "—" : brl(totalSelecionado)}
          hint={
            selected.size === 0
              ? "Marque contas para somar"
              : `${selecionadas.length} conta(s) marcada(s)`
          }
          tone={selected.size > 0 ? "accent" : "muted"}
          emphasis
        />
        <StatCard
          icon={<Building2 className="h-4 w-4" />}
          label="Empresas"
          value={String(empresasVisiveis)}
          hint={desatualizadas > 0 ? `${desatualizadas} conta(s) sem saldo de hoje` : "Todas de hoje"}
          tone={desatualizadas > 0 ? "warning" : "default"}
        />
        <StatCard
          icon={
            variacaoVisivel < 0 ? (
              <TrendingDown className="h-4 w-4" />
            ) : (
              <TrendingUp className="h-4 w-4" />
            )
          }
          label="Variação no dia"
          value={variacaoVisivel === 0 ? "—" : brl(variacaoVisivel)}
          hint="Desde a última captura de ontem"
          tone={variacaoVisivel < 0 ? "negative" : variacaoVisivel > 0 ? "positive" : "muted"}
        />
      </div>

      {foraDoRecorte.length > 0 && (
        <p className="text-xs text-ink-muted">
          Fora deste total:{" "}
          {foraDoRecorte.map(([label, total], i) => (
            <span key={label}>
              {i > 0 && " · "}
              <strong className="font-medium text-ink-secondary">{brl(total)}</strong> em{" "}
              {label.toLowerCase()}
            </span>
          ))}
          . Remova o filtro <strong className="font-medium text-ink-secondary">Tipo</strong> acima
          da tabela para incluir.
        </p>
      )}

      {/* Evolução: obedece ao mesmo recorte da tabela (recebe os ids visíveis). */}
      <CaixaHistoryChart accountIds={visibleIds} totalAccounts={rows.length} />

      {/* Tabela */}
      <FilterTable
        rows={rows}
        columns={columns}
        rowKey={rowKey}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        onVisibleChange={setVisible}
        initialValues={initialValues}
        emptyMessage={
          rows.length === 0
            ? "Nenhuma conta cadastrada. Use “Sincronizar contas” para buscar na Omie."
            : "Nenhuma conta corresponde aos filtros."
        }
        footer={(visibleRows) => (
          <>
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-label text-ink-muted">
              Total
            </td>
            <td colSpan={4} className="px-3 py-2.5 text-xs text-ink-muted">
              {visibleRows.length} conta(s)
            </td>
            <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink-primary">
              {brl(visibleRows.reduce((s, r) => s + (r.saldo ?? 0), 0))}
            </td>
            <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
              {brl(visibleRows.reduce((s, r) => s + (r.variacaoDia ?? 0), 0))}
            </td>
            <td className="px-3 py-2.5" />
          </>
        )}
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || visible.length === 0}
          className="inline-flex items-center gap-1.5 rounded-viva-md border border-border bg-surface-1 px-4 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {exporting ? "Exportando…" : "Exportar XLSX"}
        </button>
      </div>
    </div>
  );
}

// ── Card de indicador ──────────────────────────────────────────────────────

type Tone = "default" | "accent" | "positive" | "negative" | "warning" | "muted";

const TONE_VALUE: Record<Tone, string> = {
  default: "text-ink-primary",
  accent: "text-viva-700",
  positive: "text-status-success",
  negative: "text-status-critical",
  warning: "text-status-warning",
  muted: "text-ink-disabled",
};

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "default",
  emphasis = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-viva-lg border p-3 transition-colors ${
        tone === "accent"
          ? "border-viva-200 bg-viva-50"
          : "border-border bg-surface-1"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-label text-ink-muted">
        <span className={tone === "accent" ? "text-viva-600" : "text-ink-disabled"}>{icon}</span>
        {label}
      </div>
      <div
        className={`mt-1 font-semibold tabular-nums ${emphasis ? "text-xl" : "text-lg"} ${
          TONE_VALUE[tone]
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}
