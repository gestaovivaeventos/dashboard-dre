import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function getEncryptionSecret() {
  const secret = process.env.ENCRYPTION_KEY ?? process.env.APP_SECRETS_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("Defina ENCRYPTION_KEY (ou APP_SECRETS_ENCRYPTION_KEY) no ambiente.");
  }
  return secret;
}

function getEncryptionKey() {
  return crypto.createHash("sha256").update(getEncryptionSecret()).digest();
}

export function encryptSecret(plainText: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${encrypted.toString("base64")}:${authTag.toString("base64")}`;
}

export function decryptSecret(cipherText: string) {
  const [ivBase64, encryptedBase64, authTagBase64] = cipherText.split(":");
  if (!ivBase64 || !encryptedBase64 || !authTagBase64) {
    throw new Error("Formato de segredo criptografado inválido.");
  }

  const iv = Buffer.from(ivBase64, "base64");
  const encrypted = Buffer.from(encryptedBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
