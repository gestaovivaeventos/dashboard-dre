import { NextResponse } from "next/server";

import { sendPasswordRecoveryEmail } from "@/lib/auth/password-recovery";

// Rota pública (a tela é usada por quem está deslogado). A resposta é sempre
// genérica para não revelar quais e-mails têm conta — o erro real só vai para o
// log do servidor, quando é falha de infraestrutura.

export const runtime = "nodejs";

/**
 * Freio simples por e-mail, em memória do processo. Não substitui um rate limit
 * de verdade, mas evita que um clique repetido (ou um script bobo) dispare uma
 * enxurrada de e-mails e invalide o token anterior a cada disparo.
 */
const RESEND_INTERVAL_MS = 60_000;
const lastSentAt = new Map<string, number>();

function throttled(email: string, now: number): boolean {
  const previous = lastSentAt.get(email);
  if (previous && now - previous < RESEND_INTERVAL_MS) return true;
  lastSentAt.set(email, now);
  // Poda preguiçosa para o Map não crescer sem limite em processo longo.
  if (lastSentAt.size > 500) {
    lastSentAt.forEach((at, key) => {
      if (now - at > RESEND_INTERVAL_MS) lastSentAt.delete(key);
    });
  }
  return false;
}

export async function POST(request: Request) {
  let email = "";
  try {
    const body = (await request.json()) as { email?: string };
    email = body.email?.trim().toLowerCase() ?? "";
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
  }

  if (throttled(email, Date.now())) {
    // Mesma resposta do caminho feliz: quem está esperando o e-mail já tem um
    // link válido na caixa de entrada.
    return NextResponse.json({ ok: true });
  }

  const result = await sendPasswordRecoveryEmail(email);

  if (!result.ok) {
    console.error("[recuperar-senha] Falha ao enviar o link:", result.error);
    return NextResponse.json(
      {
        error:
          "Não foi possível enviar o e-mail de recuperação agora. Tente novamente em alguns minutos.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
