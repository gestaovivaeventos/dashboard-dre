import { NextResponse } from "next/server";

import { drainOmieLaunchQueue } from "@/lib/ctrl/omie-launch-queue";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  try {
    const result = await drainOmieLaunchQueue(db);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[omie-queue] drain falhou:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// "Rodar agora" pela UI/manual, com o mesmo Bearer.
export async function POST(request: Request) {
  return GET(request);
}
