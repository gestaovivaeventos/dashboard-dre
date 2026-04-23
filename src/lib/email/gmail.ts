import { Resend } from "resend";

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — emails disabled.");
    return { ok: false, error: "RESEND_API_KEY nao configurada." };
  }

  const from = process.env.RESEND_FROM || "Controll Hub <noreply@controllhub.com.br>";
  const recipients = Array.isArray(to) ? to : [to];
  const resend = new Resend(apiKey);

  try {
    console.log("[email] Sending to:", recipients.join(", "));
    const { data, error } = await resend.emails.send({
      from,
      to: recipients,
      subject,
      html,
    });

    if (error) {
      console.error("[email] Resend error:", error.message);
      return { ok: false, error: error.message };
    }

    console.log("[email] Sent successfully:", data?.id);
    return { ok: true };
  } catch (error) {
    const msg = (error as Error).message;
    console.error("[email] Failed to send:", msg);
    return { ok: false, error: msg };
  }
}
