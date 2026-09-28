"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, Loader2, ShieldCheck } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ACCESS_EVENT_LABEL,
  ACCESS_LOG_PAGE_SIZE,
  ACCESS_SOURCE_LABEL,
  describeUserAgent,
  formatBrasiliaDateTime,
  type AccessLogFilters,
  type AccessLogSummary,
} from "@/lib/auth/access-log";
import type { AuthAccessLogRow } from "@/lib/supabase/types";

interface UserOption {
  id: string;
  name: string | null;
  email: string;
}

interface Props {
  filters: AccessLogFilters;
  page: number;
  totalRows: number;
  rows: AuthAccessLogRow[];
  summary: AccessLogSummary;
  users: UserOption[];
}

const ALL = "all";

function buildQuery(filters: AccessLogFilters, page?: number): string {
  const params = new URLSearchParams({ de: filters.from, ate: filters.to });
  if (filters.userId) params.set("usuario", filters.userId);
  if (filters.event) params.set("tipo", filters.event);
  if (page && page > 1) params.set("pagina", String(page));
  return params.toString();
}

export function AccessLogClient({ filters, page, totalRows, rows, summary, users }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<AccessLogFilters>(filters);

  const userById = new Map(users.map((u) => [u.id, u]));
  const totalPages = Math.max(1, Math.ceil(totalRows / ACCESS_LOG_PAGE_SIZE));

  const navigate = (next: AccessLogFilters, nextPage?: number) => {
    startTransition(() => {
      router.push(`${pathname}?${buildQuery(next, nextPage)}`);
    });
  };

  const summaryLabel =
    filters.event === "logout" ? "Sessões encerradas no período" : "Acessos no período";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ShieldCheck className="h-5 w-5" />
          Acessos
        </h1>
        <p className="text-sm text-muted-foreground">
          Registro de cada entrada no sistema e de cada sessão encerrada (pelo botão Sair ou
          porque expirou). O registro é gravado pelo banco e não pode ser editado nem apagado.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div className="space-y-1">
            <Label htmlFor="acessos-de">De</Label>
            <Input
              id="acessos-de"
              type="date"
              value={draft.from}
              max={draft.to}
              onChange={(e) => e.target.value && setDraft({ ...draft, from: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="acessos-ate">Até</Label>
            <Input
              id="acessos-ate"
              type="date"
              value={draft.to}
              min={draft.from}
              onChange={(e) => e.target.value && setDraft({ ...draft, to: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Usuário</Label>
            <Select
              value={draft.userId ?? ALL}
              onValueChange={(v) => setDraft({ ...draft, userId: v === ALL ? null : v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os usuários</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name || u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Tipo</Label>
            <Select
              value={draft.event ?? ALL}
              onValueChange={(v) =>
                setDraft({ ...draft, event: v === "login" || v === "logout" ? v : null })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos</SelectItem>
                <SelectItem value="login">{ACCESS_EVENT_LABEL.login}</SelectItem>
                <SelectItem value="logout">{ACCESS_EVENT_LABEL.logout}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={pending} onClick={() => navigate(draft)}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Filtrar
            </Button>
            {/* Exporta o filtro APLICADO (o da URL), não o rascunho do formulário. */}
            <a
              href={`/api/admin/acessos/export?${buildQuery(filters)}`}
              className={buttonVariants({ variant: "outline" })}
            >
              <Download className="mr-2 h-4 w-4" />
              CSV
            </a>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{summaryLabel}</CardDescription>
            <CardTitle className="text-2xl">{summary.total.toLocaleString("pt-BR")}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Usuários únicos</CardDescription>
            <CardTitle className="text-2xl">
              {summary.uniqueUsers.toLocaleString("pt-BR")}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              {filters.event === "logout" ? "Último encerramento" : "Último acesso"}
            </CardDescription>
            <CardTitle className="text-2xl">
              {summary.lastAt ? formatBrasiliaDateTime(summary.lastAt) : "—"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data e hora (Brasília)</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Navegador</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const u = row.user_id ? userById.get(row.user_id) : undefined;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatBrasiliaDateTime(row.occurred_at)}
                      {row.source === "backfill" && (
                        <div className="text-xs text-muted-foreground">
                          {ACCESS_SOURCE_LABEL.backfill}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium">{u?.name || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.email ?? u?.email ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{ACCESS_EVENT_LABEL[row.event]}</TableCell>
                    <TableCell className="font-mono text-xs">{row.ip ?? "—"}</TableCell>
                    <TableCell className="text-sm" title={row.user_agent ?? undefined}>
                      {describeUserAgent(row.user_agent)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum acesso no período.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalRows > ACCESS_LOG_PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {totalRows.toLocaleString("pt-BR")} registros · página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending || page <= 1}
              onClick={() => navigate(filters, page - 1)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending || page >= totalPages}
              onClick={() => navigate(filters, page + 1)}
            >
              Próxima
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
