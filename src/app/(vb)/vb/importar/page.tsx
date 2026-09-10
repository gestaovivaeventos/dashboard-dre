import Link from "next/link";
import { redirect } from "next/navigation";

import { VbImportUpload } from "@/components/vb/import-upload";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTimeBR } from "@/lib/ctrl/datetime";
import { createClient } from "@/lib/supabase/server";
import { getVbUser } from "@/lib/vb/auth";
import { listBatches } from "@/lib/vb/queries";
import type { VbBatchStatus } from "@/lib/vb/types";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<VbBatchStatus, string> = {
  pendente: "Pendente de revisão",
  aprovado: "Aprovado",
  descartado: "Descartado",
};

const STATUS_VARIANT: Record<VbBatchStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pendente: "default",
  aprovado: "secondary",
  descartado: "outline",
};

export default async function VbImportPage() {
  const user = await getVbUser();
  if (!user) redirect("/");
  if (user.role !== "gestor") redirect("/vb");

  const db = await createClient();
  const batches = await listBatches(db);
  const pending = batches.find((b) => b.status === "pendente") ?? null;
  // A planilha entra uma vez só: com o histórico aprovado, esta tela vira
  // arquivo — o que vier depois é lançamento manual na tela do credor.
  const alreadyImported = batches.some((b) => b.status === "aprovado");

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Importar histórico</h1>
        <p className="text-sm text-ink-muted">
          Feito uma única vez, a partir do arquivo .xlsx. Depois disso, os lançamentos são feitos aqui no sistema.
        </p>
      </div>

      {alreadyImported ? (
        <div className="rounded-md border border-border bg-surface-1 px-4 py-3 text-sm text-ink-secondary">
          O histórico já foi importado e aprovado. Novas importações não são necessárias — os
          lançamentos são feitos na tela de cada credor.
        </div>
      ) : (
        <VbImportUpload pendingBatchId={pending?.id ?? null} />
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Histórico de importações</CardTitle>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhuma importação ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Enviado em</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Credores</TableHead>
                  <TableHead className="text-right">Lançamentos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link href={`/vb/importar/${b.id}`} className="font-medium underline-offset-2 hover:underline">
                        {b.file_name}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDateTimeBR(b.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[b.status]}>{STATUS_LABEL[b.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.summary.creditors.length}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {b.summary.creditors.reduce((acc, c) => acc + c.entries, 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
