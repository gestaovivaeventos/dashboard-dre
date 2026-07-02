"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Plus, Save, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toaster";

// ─── Constantes de domínio (espelham os CHECKs da migration / whitelist da API)
const MESES: { value: number; label: string }[] = [
  { value: 1, label: "Janeiro" },
  { value: 2, label: "Fevereiro" },
  { value: 3, label: "Março" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Maio" },
  { value: 6, label: "Junho" },
  { value: 7, label: "Julho" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Setembro" },
  { value: 10, label: "Outubro" },
  { value: 11, label: "Novembro" },
  { value: 12, label: "Dezembro" },
];

const TIPOS_EVENTO = ["Corporativo", "Show", "Licitação"] as const;
const FECHAMENTOS = [
  "Realizado",
  "Em aberto",
  "Evento previsto e não realizado",
] as const;

// Sentinela para "limpar" um Select — Radix não aceita SelectItem com value=""
// e não oferece deseleção nativa, então mapeamos essa opção de volta para "".
const SELECT_NONE = "__none__";

interface ServerRow {
  id: string;
  year: number;
  month: number;
  projeto: string;
  tipo_evento: string | null;
  resultado_previsto: number | null;
  resultado_realizado: number | null;
  fechamento: string | null;
}

interface ClientRow {
  // id=null enquanto a linha ainda não foi persistida (rascunho).
  id: string | null;
  yearText: string;
  month: number;
  projeto: string;
  tipoEvento: string;
  resultadoPrevistoText: string;
  resultadoRealizadoText: string;
  fechamento: string;
  dirty: boolean;
}

interface SettingsFeatProjetosTableProps {
  companyId: string;
}

function formatNumberPtBr(n: number): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseNumberPtBr(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Aceita "1.234,56" (pt-BR) e "1234.56" (programador).
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function serverToClient(s: ServerRow): ClientRow {
  return {
    id: s.id,
    yearText: String(s.year),
    month: s.month,
    projeto: s.projeto ?? "",
    tipoEvento: s.tipo_evento ?? "",
    resultadoPrevistoText:
      s.resultado_previsto !== null ? formatNumberPtBr(s.resultado_previsto) : "",
    resultadoRealizadoText:
      s.resultado_realizado !== null ? formatNumberPtBr(s.resultado_realizado) : "",
    fechamento: s.fechamento ?? "",
    dirty: false,
  };
}

function monthLabel(month: number): string {
  return MESES.find((m) => m.value === month)?.label ?? String(month);
}

function emptyDraft(): ClientRow {
  return {
    id: null,
    yearText: "2026",
    month: new Date().getMonth() + 1,
    projeto: "",
    tipoEvento: "",
    resultadoPrevistoText: "",
    resultadoRealizadoText: "",
    fechamento: "",
    dirty: true,
  };
}

export function SettingsFeatProjetosTable({
  companyId,
}: SettingsFeatProjetosTableProps) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  // chave de linha em salvamento/exclusão (index para rascunhos, id p/ persistidas)
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/companies/${companyId}/feat-projetos`, {
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const payload = (await r.json()) as { rows?: ServerRow[] };
        if (!active) return;
        setRows((payload.rows ?? []).map(serverToClient));
      } catch (err) {
        if (!active) return;
        showToast({
          title: "Falha ao carregar projetos",
          description: err instanceof Error ? err.message : "Erro inesperado.",
          variant: "destructive",
        });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [companyId, showToast]);

  const updateRow = (index: number, patch: Partial<ClientRow>) => {
    setRows((prev) =>
      prev.map((row, i) =>
        i === index ? { ...row, ...patch, dirty: true } : row,
      ),
    );
  };

  const addRow = () => {
    setRows((prev) => [...prev, emptyDraft()]);
  };

  const rowKeyFor = (row: ClientRow, index: number): string =>
    row.id ?? `draft-${index}`;

  // Cria (POST) ou atualiza (PATCH) a linha conforme tenha id.
  const saveRow = async (index: number) => {
    const row = rows[index];
    if (!row) return;

    const year = Number(row.yearText);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      showToast({
        title: "Ano inválido",
        description: "Informe um ano válido (ex.: 2026).",
        variant: "destructive",
      });
      return;
    }

    const payload = {
      id: row.id ?? undefined,
      year,
      month: row.month,
      projeto: row.projeto.trim(),
      tipo_evento: row.tipoEvento || null,
      resultado_previsto: parseNumberPtBr(row.resultadoPrevistoText),
      resultado_realizado: parseNumberPtBr(row.resultadoRealizadoText),
      fechamento: row.fechamento || null,
    };

    const key = rowKeyFor(row, index);
    setSavingKey(key);
    try {
      const r = await fetch(`/api/companies/${companyId}/feat-projetos`, {
        method: row.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${r.status}`);
      }
      const body = (await r.json()) as { row?: ServerRow };
      if (body.row) {
        const saved = serverToClient(body.row);
        setRows((prev) => prev.map((existing, i) => (i === index ? saved : existing)));
      }
      showToast({ title: "Projeto salvo", variant: "success" });
    } catch (err) {
      showToast({
        title: "Falha ao salvar",
        description: err instanceof Error ? err.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setSavingKey((current) => (current === key ? null : current));
    }
  };

  const deleteRow = async (index: number) => {
    const row = rows[index];
    if (!row) return;

    // Rascunho ainda não persistido — só remove do estado local.
    if (!row.id) {
      setRows((prev) => prev.filter((_, i) => i !== index));
      return;
    }

    if (!window.confirm("Excluir este projeto/evento?")) return;

    setDeletingId(row.id);
    try {
      const r = await fetch(
        `/api/companies/${companyId}/feat-projetos?id=${encodeURIComponent(row.id)}`,
        { method: "DELETE" },
      );
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${r.status}`);
      }
      setRows((prev) => prev.filter((_, i) => i !== index));
      showToast({ title: "Projeto excluído", variant: "success" });
    } catch (err) {
      showToast({
        title: "Falha ao excluir",
        description: err instanceof Error ? err.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setDeletingId((current) => (current === row.id ? null : current));
    }
  };

  // Exporta as linhas atualmente carregadas para um arquivo .xlsx.
  const exportExcel = () => {
    if (rows.length === 0) {
      showToast({
        title: "Nada para exportar",
        description: "Cadastre ao menos um projeto/evento.",
        variant: "destructive",
      });
      return;
    }

    const sheetRows = rows.map((row) => ({
      Ano: Number(row.yearText) || row.yearText,
      "Mês": monthLabel(row.month),
      Projeto: row.projeto,
      "Tipo de evento": row.tipoEvento,
      "Result. previsto": parseNumberPtBr(row.resultadoPrevistoText) ?? "",
      "Result. realizado": parseNumberPtBr(row.resultadoRealizadoText) ?? "",
      Fechamento: row.fechamento,
    }));

    const worksheet = XLSX.utils.json_to_sheet(sheetRows);
    // Formata as colunas de resultado como moeda BRL — mesmo padrão dos demais
    // exports (DRE / Fluxo de Caixa).
    const rangeRef = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1:A1");
    for (let rowIndex = 1; rowIndex <= rangeRef.e.r; rowIndex += 1) {
      for (const colIndex of [4, 5]) {
        const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        const cell = worksheet[cellAddress];
        if (!cell || typeof cell.v !== "number") continue;
        cell.z = "R$ #,##0.00";
      }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Projetos Feat");
    XLSX.writeFile(workbook, "Projetos_Feat_Producoes.xlsx");
    showToast({ title: "Exportação concluída", variant: "success" });
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border bg-background">
        <div className="grid min-w-[920px] grid-cols-[90px_140px_1fr_150px_140px_140px_180px_88px] items-center gap-x-2 border-b bg-muted px-3 py-2 text-xs font-semibold uppercase leading-tight text-muted-foreground">
          <span>Ano</span>
          <span>Mês</span>
          <span>Projeto</span>
          <span>Tipo de evento</span>
          <span className="text-right">Result. previsto</span>
          <span className="text-right">Result. realizado</span>
          <span>Fechamento</span>
          <span className="text-right">Ações</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-6 text-sm text-muted-foreground">
            Nenhum projeto cadastrado. Clique em &quot;Adicionar projeto&quot;.
          </div>
        ) : (
          rows.map((row, index) => {
            const key = rowKeyFor(row, index);
            const isSaving = savingKey === key;
            // row.id === null em rascunhos não salvos; sem este guard,
            // `null === null` marcaria todo rascunho como "excluindo" — o que
            // travava o spinner e desabilitava o botão Salvar.
            const isDeleting = row.id !== null && deletingId === row.id;
            return (
              <div
                key={key}
                className="grid min-w-[920px] grid-cols-[90px_140px_1fr_150px_140px_140px_180px_88px] items-center gap-x-2 border-b px-3 py-2 text-sm last:border-b-0"
              >
                <Input
                  className="h-8"
                  type="number"
                  inputMode="numeric"
                  placeholder="2026"
                  value={row.yearText}
                  onChange={(e) => updateRow(index, { yearText: e.target.value })}
                />
                <Select
                  value={String(row.month)}
                  onValueChange={(v) => updateRow(index, { month: Number(v) })}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Mês" />
                  </SelectTrigger>
                  <SelectContent>
                    {MESES.map((m) => (
                      <SelectItem key={m.value} value={String(m.value)}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="h-8"
                  placeholder="Nome do projeto/evento"
                  value={row.projeto}
                  onChange={(e) => updateRow(index, { projeto: e.target.value })}
                />
                <Select
                  value={row.tipoEvento || undefined}
                  onValueChange={(v) => updateRow(index, { tipoEvento: v })}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_EVENTO.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="h-8 text-right"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={row.resultadoPrevistoText}
                  onChange={(e) =>
                    updateRow(index, { resultadoPrevistoText: e.target.value })
                  }
                />
                <Input
                  className="h-8 text-right"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={row.resultadoRealizadoText}
                  onChange={(e) =>
                    updateRow(index, { resultadoRealizadoText: e.target.value })
                  }
                />
                <Select
                  value={row.fechamento || undefined}
                  onValueChange={(v) =>
                    updateRow(index, {
                      fechamento: v === SELECT_NONE ? "" : v,
                    })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>
                      <span className="text-muted-foreground">
                        Sem preenchimento
                      </span>
                    </SelectItem>
                    {FECHAMENTOS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    title="Salvar"
                    onClick={() => void saveRow(index)}
                    disabled={isSaving || isDeleting || !row.dirty}
                  >
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                    title="Excluir"
                    onClick={() => void deleteRow(index)}
                    disabled={isSaving || isDeleting}
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Cadastro gerencial de projetos/eventos. Não afeta DRE, Fluxo de Caixa,
          KPIs nem integrações.
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={exportExcel}
            disabled={loading || rows.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar Excel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addRow}
            disabled={loading}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Adicionar projeto
          </Button>
        </div>
      </div>
    </div>
  );
}
