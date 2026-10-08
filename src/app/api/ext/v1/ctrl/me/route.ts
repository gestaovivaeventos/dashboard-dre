import { NextResponse } from "next/server";

import { withExtCtrl } from "@/lib/ext-api/handler";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withExtCtrl(request, async ({ ctx }) =>
    NextResponse.json({
      user: { id: ctx.id, name: ctx.name, email: ctx.email },
      empresa: ctx.orgs[0] ? { id: ctx.orgs[0].id, nome: ctx.orgs[0].nome } : null,
      papeis: ctx.ctrlRoles,
      setorIds: ctx.sectorIds,
    }),
  );
}
