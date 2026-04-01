"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { LogoFull } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setStatus(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setStatus(error.message);
      setLoading(false);
      return;
    }

    router.replace("/dashboard");
  };

  useEffect(() => {
    const checkSession = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        router.replace("/dashboard");
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
            Controladoria inteligente para sua empresa.
          </h2>
          <p className="max-w-md text-lg text-primary-foreground/80">
            Consolide resultados financeiros, acompanhe KPIs e gerencie multiplos segmentos de negocio em uma unica plataforma.
          </p>

          <div className="flex gap-8 pt-4">
            <div>
              <p className="text-3xl font-bold">DRE</p>
              <p className="text-sm text-primary-foreground/70">Consolidado</p>
            </div>
            <div>
              <p className="text-3xl font-bold">KPIs</p>
              <p className="text-sm text-primary-foreground/70">Em tempo real</p>
            </div>
            <div>
              <p className="text-3xl font-bold">Multi</p>
              <p className="text-sm text-primary-foreground/70">Segmentos</p>
            </div>
          </div>
        </div>

        <p className="text-xs text-primary-foreground/50">
          Controll Hub &copy; {new Date().getFullYear()}
        </p>
      </div>

      {/* Right panel — login form */}
      <div className="flex w-full flex-col items-center justify-center px-6 lg:w-1/2">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden">
            <LogoFull />
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight">Entrar</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Acesse sua conta para continuar.
            </p>
          </div>

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

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Senha
              </label>
              <Input
                id="password"
                type="password"
                placeholder="Sua senha"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="h-11"
              />
            </div>

            <Button type="submit" className="h-11 w-full text-base" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>

            {status ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30">
                {status}
              </p>
            ) : null}
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Ainda nao tem conta?{" "}
            <Link href="/signup" className="font-medium text-primary hover:underline">
              Criar conta
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
