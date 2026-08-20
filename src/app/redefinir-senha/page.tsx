"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { LogoFull } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export default function RedefinirSenhaPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Como a sessão de recovery chega aqui, em ordem de preferência:
  //
  //   1. `?token_hash=...&type=recovery` — o formato dos links que o app passou
  //      a enviar (ver src/lib/auth/password-recovery.ts). Trocamos o token por
  //      sessão com `verifyOtp`. Não depende de Site URL, allowlist de Redirect
  //      URLs nem de PKCE, então funciona até em outro navegador/celular.
  //   2. `?code=` (PKCE) ou `#access_token` (implícito) — formato dos links
  //      antigos, ainda em caixas de entrada. O browser client
  //      (detectSessionInUrl) resolve sozinho e dispara onAuthStateChange.
  //   3. `#error=...` / `?error=...` — o GoTrue recusou o link (expirado ou já
  //      usado). Antes isso terminava numa tela de login muda; aqui vira uma
  //      mensagem explícita.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

    const errorDescription =
      params.get("error_description") ??
      hashParams.get("error_description") ??
      params.get("error") ??
      hashParams.get("error");

    if (errorDescription) {
      setLinkError(
        "O link expirou ou já foi utilizado. Solicite um novo link de recuperação.",
      );
      setChecking(false);
      return;
    }

    const tokenHash = params.get("token_hash");
    if (tokenHash) {
      // Limpa a URL antes de consumir: o token é de uso único, e deixá-lo na
      // barra de endereços faz um F5 tentar reusar um token já gasto.
      window.history.replaceState({}, "", window.location.pathname);

      void supabase.auth
        .verifyOtp({ type: "recovery", token_hash: tokenHash })
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error || !data.session) {
            setLinkError(
              "O link expirou ou já foi utilizado. Solicite um novo link de recuperação.",
            );
          } else {
            setHasSession(true);
          }
          setChecking(false);
        });
      return () => {
        cancelled = true;
      };
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setHasSession(true);
        setChecking(false);
      }
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setHasSession(true);
        setChecking(false);
      }
    });
    // Sem sinal em ~3s: link antigo inválido/expirado.
    const timeout = setTimeout(() => setChecking(false), 3000);
    return () => {
      cancelled = true;
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);

    if (password.length < 6) {
      setStatus("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setStatus("As senhas nao coincidem.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setStatus(error.message);
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);
    // Já autenticado com a nova senha — a raiz decide o destino correto.
    setTimeout(() => router.push("/"), 1800);
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8">
        <LogoFull />

        <div>
          <h1 className="text-2xl font-bold tracking-tight">Redefinir senha</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Escolha uma nova senha para sua conta.
          </p>
        </div>

        {checking ? (
          <p className="text-sm text-muted-foreground">Validando o link...</p>
        ) : done ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
            <p className="text-sm font-medium text-green-800 dark:text-green-300">
              Senha redefinida com sucesso!
            </p>
            <p className="mt-1 text-sm text-green-700 dark:text-green-400">
              Redirecionando para o painel...
            </p>
          </div>
        ) : !hasSession ? (
          <div className="space-y-4">
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30">
              {linkError ??
                "Link inválido ou expirado. Solicite um novo link de recuperação."}
            </div>
            <Link
              href="/recuperar-senha"
              className="block text-center text-sm font-medium text-primary hover:underline"
            >
              Solicitar novo link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Nova senha
              </label>
              <Input
                id="password"
                type="password"
                placeholder="Min. 6 caracteres"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="text-sm font-medium">
                Confirmar nova senha
              </label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Repita a nova senha"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                className="h-11"
              />
            </div>

            <Button type="submit" className="h-11 w-full text-base" disabled={loading}>
              {loading ? "Salvando..." : "Salvar nova senha"}
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
