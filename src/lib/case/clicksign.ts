import crypto from "crypto";

// Integração ClickSign (API v1 REST). Auth via ?access_token=TOKEN.
// Docs: https://developers.clicksign.com/docs
const BASE_URL = process.env.CLICKSIGN_BASE_URL || "https://app.clicksign.com";

export function clicksignEnabled(): boolean {
  return Boolean(process.env.CLICKSIGN_API_TOKEN);
}

export interface ClickSignSigner {
  name: string;
  email: string;
  cpf: string | null;
  /** Papel no ClickSign: "contractor" (parte), "witness" (testemunha)… */
  signAs?: string;
}

export interface SignatureRequest {
  documentKey: string;
  signerKey: string;
  requestKey: string;
  signUrl: string;
}

async function csFetch(path: string, body: unknown): Promise<Record<string, unknown>> {
  const token = process.env.CLICKSIGN_API_TOKEN;
  if (!token) throw new Error("ClickSign não configurado (CLICKSIGN_API_TOKEN ausente).");
  const url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const detail = json?.errors ? JSON.stringify(json.errors) : text.slice(0, 300);
    throw new Error(`ClickSign HTTP ${res.status} em ${path}: ${detail}`);
  }
  return json;
}

/**
 * Cria o documento no ClickSign, adiciona TODOS os signatários (o 1º é o
 * cliente, cujas chaves são retornadas), e dispara os e-mails de assinatura.
 * Com `auto_close: true`, o documento só fecha (evento no webhook) quando todos
 * assinam. Retorna as chaves do 1º signatário (cliente) para reenvio/URL.
 */
export async function createSignatureRequest(
  pdf: Buffer,
  fileName: string,
  signers: ClickSignSigner[],
  message: string,
): Promise<SignatureRequest> {
  const validSigners = signers.filter((s) => s.email?.trim());
  if (validSigners.length === 0) throw new Error("Nenhum signatário com e-mail para o contrato.");

  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 30);

  // 1) Documento
  const docRes = await csFetch("/api/v1/documents", {
    document: {
      path: `/${fileName}`,
      content_base64: `data:application/pdf;base64,${pdf.toString("base64")}`,
      deadline_at: deadline.toISOString(),
      auto_close: true,
      locale: "pt-BR",
    },
  });
  const documentKey = String((docRes.document as Record<string, unknown> | undefined)?.key ?? "");
  if (!documentKey) throw new Error("ClickSign não retornou a chave do documento.");

  let first: { signerKey: string; requestKey: string } | null = null;

  for (const signer of validSigners) {
    // 2) Signatário
    const signerRes = await csFetch("/api/v1/signers", {
      signer: {
        email: signer.email,
        name: signer.name,
        documentation: (signer.cpf ?? "").replace(/\D/g, "") || undefined,
        auths: ["email"],
        delivery: "email",
      },
    });
    const signerKey = String((signerRes.signer as Record<string, unknown> | undefined)?.key ?? "");
    if (!signerKey) throw new Error("ClickSign não retornou a chave do signatário.");

    // 3) Vincula signatário ao documento
    const listRes = await csFetch("/api/v1/lists", {
      list: {
        document_key: documentKey,
        signer_key: signerKey,
        sign_as: signer.signAs ?? "contractor",
        message,
      },
    });
    const requestKey = String((listRes.list as Record<string, unknown> | undefined)?.request_signature_key ?? "");

    // 4) Dispara o e-mail de solicitação para este signatário.
    if (requestKey) {
      await csFetch("/api/v1/notifications", { request_signature_key: requestKey, message });
    }
    if (!first) first = { signerKey, requestKey };
  }

  const f = first!;
  return {
    documentKey,
    signerKey: f.signerKey,
    requestKey: f.requestKey,
    signUrl: f.requestKey ? `${BASE_URL}/sign/${f.requestKey}` : "",
  };
}

/** Reenvia o e-mail de assinatura para o signatário (notificação ClickSign). */
export async function resendNotification(requestKey: string, message: string): Promise<void> {
  await csFetch("/api/v1/notifications", {
    request_signature_key: requestKey,
    message,
  });
}

/**
 * Valida o webhook do ClickSign: HMAC-SHA256 do corpo cru com CLICKSIGN_HMAC_SECRET,
 * comparado ao header `Content-Hmac` (formato "sha256=<hex>").
 */
export function verifyWebhook(rawBody: string, hmacHeader: string | null): boolean {
  const secret = process.env.CLICKSIGN_HMAC_SECRET;
  if (!secret || !hmacHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(hmacHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
