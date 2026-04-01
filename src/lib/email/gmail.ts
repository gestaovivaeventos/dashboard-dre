import nodemailer from "nodemailer";

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
}

function getGmailConfig() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.warn("[email] GMAIL_USER or GMAIL_APP_PASSWORD not set — emails disabled.");
    return null;
  }
  return { user, pass };
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<boolean> {
  const config = getGmailConfig();
  if (!config) return false;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: config.user, pass: config.pass },
  });

  const recipients = Array.isArray(to) ? to.join(", ") : to;

  try {
    await transporter.sendMail({
      from: `"Controll Hub" <${config.user}>`,
      to: recipients,
      subject,
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send:", error);
    return false;
  }
}
