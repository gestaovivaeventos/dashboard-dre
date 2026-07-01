import nodemailer from "nodemailer";

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
}

// Transporter unico reaproveitado entre invocacoes (pool de conexoes SMTP).
// Criado de forma preguicosa para nao tentar conectar em build/import.
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;

  const user = process.env.GMAIL_USER;
  // App passwords vem com espacos quando copiadas do Google ("abcd efgh ...").
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!user || !pass) return null;

  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
    pool: true,
  });
  return transporter;
}

export async function sendEmail({
  to,
  subject,
  html,
}: SendEmailOptions): Promise<{ ok: boolean; error?: string }> {
  const tx = getTransporter();
  if (!tx) {
    console.warn("[email] GMAIL_USER/GMAIL_APP_PASSWORD nao configurados — emails desabilitados.");
    return { ok: false, error: "Credenciais do Gmail nao configuradas." };
  }

  // O Gmail so permite enviar com o proprio endereco autenticado no envelope;
  // usamos um display name amigavel mas mantemos o remetente real.
  const fromName = process.env.EMAIL_FROM_NAME || "Control Hub";
  const from = `${fromName} <${process.env.GMAIL_USER}>`;
  const recipients = Array.isArray(to) ? to : [to];

  try {
    console.log("[email] Sending to:", recipients.join(", "));
    const info = await tx.sendMail({ from, to: recipients, subject, html });
    console.log("[email] Sent successfully:", info.messageId);
    return { ok: true };
  } catch (error) {
    const msg = (error as Error).message;
    console.error("[email] Failed to send:", msg);
    return { ok: false, error: msg };
  }
}
