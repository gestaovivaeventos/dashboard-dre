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
  const [done, setDone] = useState(false);

  // Ao chegar do link do e-mail, o /auth/callback já trocou o code por uma
  // sessão de recovery (cookies). Aqui só conferimos que ela existe — sem ela,
  // não há como redefinir (link inválido/expirado).
  useEffect(() => {
    const check = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      setHasSession(Boolean(data.user));
      setChecking(false);
    };
    void check();
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
              Link invalido ou expirado. Solicite um novo link de recuperacao.
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
