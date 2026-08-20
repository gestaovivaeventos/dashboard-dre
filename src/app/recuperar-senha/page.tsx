"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { LogoFull } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setStatus(null);

    // O e-mail sai pelo NOSSO servidor (POST abaixo), não pelo
    // `resetPasswordForEmail` do Supabase. Motivo em
    // src/lib/auth/password-recovery.ts: o link do GoTrue passa por
    // `/auth/v1/verify?...&redirect_to=`, e quando o destino não está na
    // allowlist de Redirect URLs do projeto ele é trocado pelo Site URL sem
    // aviso — foi assim que o link de recuperação passou a cair na tela de
    // login. O link que montamos aponta direto para /redefinir-senha.
    let failed = false;
    try {
      const response = await fetch("/api/auth/recuperar-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStatus(payload?.error ?? "Não foi possível enviar o e-mail agora.");
        failed = true;
      }
    } catch {
      setStatus("Não foi possível enviar o e-mail agora. Verifique sua conexão.");
      failed = true;
    }

    if (failed) {
      setLoading(false);
      return;
    }

    // Mensagem genérica (não revela se o e-mail existe na base).
    setSent(true);
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8">
        <LogoFull />

        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recuperar senha</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Informe seu e-mail e enviaremos um link para redefinir sua senha.
          </p>
        </div>

        {sent ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
            <p className="text-sm font-medium text-green-800 dark:text-green-300">
              Link enviado.
            </p>
            <p className="mt-1 text-sm text-green-700 dark:text-green-400">
              Se houver uma conta com <strong>{email}</strong>, enviamos um link para redefinir a senha.
              Verifique sua caixa de entrada (e a pasta de spam).
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                E-mail
              </label>
              <Input
                id="email"
                type="email"
                placeholder="seu-email@empresa.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="h-11"
              />
            </div>

            <Button type="submit" className="h-11 w-full text-base" disabled={loading}>
              {loading ? "Enviando..." : "Enviar link de recuperação"}
            </Button>

            {status ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30">
                {status}
              </p>
            ) : null}
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-primary hover:underline">
            Voltar para o login
          </Link>
        </p>
      </div>
    </div>
  );
}
