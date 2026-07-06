import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  ACTIVE_MODULE_COOKIE,
  ACTIVE_SEGMENT_COOKIE,
  CONTEXT_COOKIE_OPTIONS,
  VALID_MODULES,
} from "@/lib/context/active-context";
import { getCurrentSessionContext } from "@/lib/auth/session";

interface ContextUpdateBody {
  module?: "dre" | "ctrl" | "case" | "viagens";
  segmentSlug?: string;
}

export async function POST(request: Request) {
  // Check authentication
  const { user } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  let body: ContextUpdateBody;
  try {
    body = (await request.json()) as ContextUpdateBody;
  } catch {
    return NextResponse.json({ error: "Corpo invalido" }, { status: 400 });
  }

  const store = await cookies();

  if (body.module !== undefined) {
    if (!(VALID_MODULES as readonly string[]).includes(body.module)) {
      return NextResponse.json({ error: "Modulo invalido" }, { status: 400 });
    }
    store.set(ACTIVE_MODULE_COOKIE, body.module, CONTEXT_COOKIE_OPTIONS);
  }

  if (body.segmentSlug !== undefined) {
    if (typeof body.segmentSlug !== "string" || body.segmentSlug.length === 0 || body.segmentSlug.length > 64) {
      return NextResponse.json({ error: "Slug de segmento invalido" }, { status: 400 });
    }
    store.set(ACTIVE_SEGMENT_COOKIE, body.segmentSlug, CONTEXT_COOKIE_OPTIONS);
  }

  return NextResponse.json({ ok: true });
}
