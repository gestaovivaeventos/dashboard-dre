// TESTE PONTUAL — envia para UM destinatario as requisicoes que hoje estao
// aguardando aprovacao na tela de Aprovacoes, usando o mesmo template do
// lembrete diario. Serve para validar layout/conteudo antes de a rotina entrar.
//
// Nao grava em ctrl_approval_email_log de proposito: e um teste, nao pode ocupar
// a linha do dia de ninguem nem interferir na trava de duplicidade da rotina.
//
// Uso:
//   npx tsx tmp-teste-email.ts --para=fulano@x.com                 (simula)
//   npx tsx tmp-teste-email.ts --para=fulano@x.com --enviar        (envia)
//   npx tsx tmp-teste-email.ts --para=fulano@x.com --escopo=gerente

import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { createClient } from "@supabase/supabase-js";
import { pickFortune } from "@/lib/ctrl/approval-reminders/fortunes";
import type { PendingApprovalRequest } from "@/lib/ctrl/approval-reminders/recipients";
import { approvalReminderSubject, renderApprovalReminderEmail } from "@/lib/ctrl/approval-reminders/template";
import { todayBR } from "@/lib/ctrl/datetime";
import { isForcedDirectorRouting } from "@/lib/ctrl/routing";
import { resendConfigStatus, sendEmailViaResend } from "@/lib/email/resend";
import { writeFileSync } from "fs";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const DESTINATARIO = arg("para");
const ENVIAR = process.argv.includes("--enviar");
// 'todos' (padrao) = etapa gerente + etapa diretor; 'gerente' = so 'pendente'.
const ESCOPO = (arg("escopo") ?? "todos") as "todos" | "gerente" | "diretor";

if (!DESTINATARIO) {
  console.error("Informe o destinatario: --para=email@dominio");
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function relatedName(value: unknown): string | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const name = (row as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

async function main() {
  const statuses =
    ESCOPO === "gerente" ? ["pendente"] : ESCOPO === "diretor" ? ["pendente_diretor"] : ["pendente", "pendente_diretor"];

  // Mesma consulta da rotina.
  const { data, error } = await db
    .from("ctrl_requests")
    .select(
      `id, request_number, title, amount, due_date, created_at, status, approval_tier,
       sector_id, created_by, expense_type_id, favorecido,
       ctrl_sectors(name), ctrl_expense_types(name), ctrl_suppliers(name)`,
    )
    .in("status", statuses)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

  const requests: PendingApprovalRequest[] = rows.map((row) => {
    const forcedDirector = isForcedDirectorRouting({
      sector_id: row.sector_id as string,
      created_by: (row.created_by as string) ?? null,
    });
    return {
      id: row.id as string,
      requestNumber: Number(row.request_number ?? 0),
      title: (row.title as string) ?? "Requisição",
      category: relatedName(row.ctrl_expense_types) ?? "Não informada",
      sectorName: relatedName(row.ctrl_sectors) ?? "Setor nao informado",
      supplier: relatedName(row.ctrl_suppliers) ?? ((row.favorecido as string)?.trim() || "Não informado"),
      amount: Number(row.amount ?? 0),
      dueDate: (row.due_date as string) ?? null,
      createdAt: (row.created_at as string) ?? "",
      stage: (row.status as string) === "pendente_diretor" ? "diretor" : "gerente",
      outOfBudget: (row.approval_tier as string) === "nivel_3" && !forcedDirector,
      forcedDirector,
    };
  });

  console.log(`=== ${requests.length} requisicao(oes) aguardando aprovacao em ${todayBR()} (escopo: ${ESCOPO}) ===`);
  for (const r of requests) {
    console.log(
      `   #${r.requestNumber} [${r.stage}] | ${r.sectorName} | ${r.category} | ${BRL.format(r.amount)} | venc ${r.dueDate} | ${r.supplier}` +
        (r.outOfBudget ? " | FORA DO ORCAMENTO" : "") + (r.forcedDirector ? " | DIRETO AO DIRETOR" : ""),
    );
  }
  if (requests.length === 0) {
    console.log("Nada pendente — nada a enviar.");
    return;
  }

  const { data: user } = await db
    .from("users")
    .select("id, name")
    .ilike("email", DESTINATARIO!)
    .maybeSingle();
  const nome = (user?.name as string) ?? DESTINATARIO!;
  const seed = (user?.id as string) ?? DESTINATARIO!;

  const subject = approvalReminderSubject(requests.length);
  const html = renderApprovalReminderEmail({
    recipientName: nome,
    fortune: pickFortune(seed, todayBR(), []),
    requests,
  });

  const slug = DESTINATARIO!.split("@")[0].replace(/[^a-z0-9]/gi, "-");
  const out = `${process.env.SCRATCH}/teste-${slug}.html`;
  writeFileSync(out, html, "utf8");
  console.log(`\ndestinatario: ${DESTINATARIO} (${nome})`);
  console.log(`assunto: ${subject}`);
  console.log(`HTML: ${out}`);

  const cfg = resendConfigStatus();
  console.log(`\nResend: ${cfg.ok ? "configurado" : "INDISPONIVEL — falta " + cfg.missing.join(" e ")} | remetente: ${cfg.from}`);

  if (!ENVIAR) {
    console.log("\nModo simulacao. Rode com --enviar para disparar.");
    return;
  }

  const result = await sendEmailViaResend({ to: DESTINATARIO!, subject, html });
  console.log(`\n=== ENVIO ===`);
  console.log(result.ok ? `OK — id do Resend: ${result.id}` : `FALHOU — ${result.error}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
