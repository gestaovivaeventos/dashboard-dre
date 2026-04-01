"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { LogoFull } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setStatus(null);

    if (password.length < 6) {
      setStatus("A senha deve ter pelo menos 6 caracteres.");
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setStatus("As senhas nao coincidem.");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/admin`,
        data: { name },
      },
    });

    if (error) {
      setStatus(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  useEffect(() => {
    const checkSession = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        router.replace("/admin");
      }
    };

    void checkSession();
  }, [router]);

  return (
    <div className="flex min-h-screen">
      {/* Left panel — branding */}
      <div className="hidden w-1/2 flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <div>
          <LogoFull className="[&_svg]:text-white [&_span]:text-white" />
        </div>

        <div className="space-y-6">
          <h2 className="text-4xl font-bold leading-tight tracking-tight">
            Comece a controlar seus resultados hoje.
          </h2>
          <p className="max-w-md text-lg text-primary-foreground/80">
            Crie sua conta e tenha acesso imediato ao painel de controladoria mais completo do mercado.
          </p>
        </div>

        <p className="text-xs text-primary-foreground/50">
          Controll Hub &copy; {new Date().getFullYear()}
        </p>
      </div>

      {/* Right panel — signup form */}
      <div className="flex w-full flex-col items-center justify-center px-6 lg:w-1/2">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden">
            <LogoFull />
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight">Criar conta</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Preencha os dados para se cadastrar.
            </p>
          </div>

          {success ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                Conta criada com sucesso!
              </p>
              <p className="mt-1 text-sm text-green-700 dark:text-green-400">
                Verifique seu e-mail para confirmar o cadastro. Apos a confirmacao, um administrador precisara aprovar seu acesso.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium">Nome completo</label>
                <Input id="name" type="text" placeholder="Seu nome" value={name} onChange={(event) => setName(event.target.value)} required className="h-11" />
              </div>

              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">E-mail</label>
                <Input id="email" type="email" placeholder="seu-email@empresa.com" value={email} onChange={(event) => setEmail(event.target.value)} required className="h-11" />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">Senha</label>
                <Input id="password" type="password" placeholder="Min. 6 caracteres" value={password} onChange={(event) => setPassword(event.target.value)} required className="h-11" />
              </div>

              <div className="space-y-2">
                <label htmlFor="confirmPassword" className="text-sm font-medium">Confirmar senha</label>
                <Input id="confirmPassword" type="password" placeholder="Repita a senha" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required className="h-11" />
              </div>

              <Button type="submit" className="h-11 w-full text-base" disabled={loading}>
                {loading ? "Criando..." : "Criar conta"}
              </Button>

              {status ? (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30">
                  {status}
                </p>
              ) : null}
            </form>
          )}

          <p className="text-center text-sm text-muted-foreground">
            Ja tem uma conta?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Entrar
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
