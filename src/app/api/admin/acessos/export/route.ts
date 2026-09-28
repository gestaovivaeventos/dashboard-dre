import { NextResponse } from "next/server";

import {
  ACCESS_EVENT_LABEL,
  ACCESS_SOURCE_LABEL,
  csvCell,
  describeUserAgent,
  fetchAllAccessLogRows,
  formatBrasiliaDateTime,
  parseAccessLogFilters,
} from "@/lib/auth/access-log";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const HEADER = ["data_hora", "nome", "email", "tipo", "ip", "navegador", "user_agent", "origem"];

export async function GET(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (!profile || profile.profile !== "admin") {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const filters = parseAccessLogFilters(new URL(request.url).searchParams);
  const adminClient = createAdminClient();

  try {
    const [rows, { data: usersData }] = await Promise.all([
      fetchAllAccessLogRows(adminClient, filters),
      adminClient.from("users").select("id,name"),
    ]);
    const nameById = new Map(
      (usersData ?? []).map((u) => [u.id as string, (u.name as string | null) ?? ""]),
    );

    const lines = [HEADER.join(";")];
    for (const row of rows) {
      lines.push(
        [
          formatBrasiliaDateTime(row.occurred_at),
          row.user_id ? nameById.get(row.user_id) ?? "" : "",
          row.email,
          ACCESS_EVENT_LABEL[row.event],
          row.ip,
          describeUserAgent(row.user_agent),
          row.user_agent,
          ACCESS_SOURCE_LABEL[row.source],
        ]
          .map(csvCell)
          .join(";"),
      );
    }

    // BOM: sem ele o Excel abre o UTF-8 como Latin-1 e quebra os acentos.
    const body = "﻿" + lines.join("\r\n") + "\r\n";
    const filename = `acessos_${filters.from}_a_${filters.to}.csv`;
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[admin/acessos/export]", err);
    return NextResponse.json({ error: "Falha ao gerar o CSV." }, { status: 500 });
  }
}
