"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { LogoFull } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { createClient } from "@/lib/supabase/client";

/**
 * Módulos anunciados na coluna da marca. Lista curta e literal — o que
 * o usuário vai encontrar no menu depois de entrar.
 */
const MODULES = [
  { name: "Financeiro", detail: "DRE · Fluxo de caixa · BI" },
  { name: "Compras", detail: "Requisições · Aprovações · Contas a pagar" },
  { name: "Orçamento", detail: "Budget · Forecast · Previsto x Realizado" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // NÃO reintroduza um "manter conectado" aqui sem implementar a persistência
  // junto: a duração da sessão vem do cookie que o @supabase/ssr grava, não
  // desta tela. O controle chegou a existir e saiu por prometer o que não
  // entregava.
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

    // Navega pra raiz. A root page faz redirect inteligente baseado em
    // profile + active (single source of truth) — evita loop com /home
    // hard-coded quando o user está inativo ou sem permissão.
    router.push("/");
  };

  useEffect(() => {
    // Link de recuperação que chegou aqui com a sessão no fragmento
    // (#access_token=...&type=recovery), quando o Supabase usa o Site URL no
    // lugar do redirect_to. O fragmento sobrevive ao redirect da raiz mas não
    // chega ao servidor, então o desvio é feito aqui — e ANTES de instanciar o
    // client, que consumiria o hash (detectSessionInUrl) e o descartaria,
    // deixando o usuário parado nesta tela.
    const hash = window.location.hash;
    if (hash.includes("type=recovery") || hash.includes("type=invite")) {
      window.location.replace(`/redefinir-senha${hash}`);
      return;
    }

    const checkSession = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        router.push("/");
      }
    };

    void checkSession();
  }, [router]);

  return (
    <div className="ch-auth">
      {/* Coluna da marca — a superfície do menu, o mesmo degrau da sidebar.
          Nada de campo vermelho cheio aqui: no design system o vermelho é
          raro e significa ação/atenção; quem o usa nesta tela é o botão
          Entrar, que é justamente a ação. */}
      <aside className="ch-auth__aside">
        <LogoFull size={26} />

        <div className="ch-auth__lead">
          <p className="ch-kicker ch-kicker--accent">
            Controladoria inteligente para sua empresa
          </p>
          <h1 className="ch-auth__pitch">
            Resultados, orçamento
            <br />
            e pagamentos —
            <br />
            tudo em um só lugar.
          </h1>
          <p className="ch-auth__lede">
            DRE gerencial, fluxo de caixa, Relatório financeiro, orçamento e
            requisições de compra para sua empresa.
          </p>

          <div className="ch-auth__modules">
            {MODULES.map((m) => (
              <div key={m.name} className="ch-auth__module">
                <b>{m.name}</b>
                <span>{m.detail}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="ch-kicker ch-auth__foot">
          Control Hub · Beta · {new Date().getFullYear()}
        </p>
      </aside>

      {/* Coluna do formulário */}
      <main className="ch-auth__main">
        <div className="ch-auth__theme">
          <ThemeToggle className="ch-iconbtn--outline" />
        </div>

        <div className="ch-auth__mobile-brand">
          <LogoFull size={26} />
        </div>

        <div className="ch-authcard">
          <div>
            <p className="ch-kicker ch-kicker--accent">Acesso ao sistema</p>
            <h2 className="ch-authcard__title">Entrar</h2>
          </div>

          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 16 }}
          >
            <div className="ch-field">
              <label htmlFor="email" className="ch-label">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="ch-input"
                placeholder="nome@empresa.com.br"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>

            <div className="ch-field">
              <div className="ch-field__head">
                <label htmlFor="password" className="ch-label">
                  Senha
                </label>
                <Link href="/recuperar-senha" className="ch-link">
                  Esqueci minha senha
                </Link>
              </div>
              <div className="ch-field__wrap">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className="ch-input"
                  placeholder="Sua senha"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  type="button"
                  className="ch-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  title={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" strokeWidth={2} />
                  ) : (
                    <Eye className="h-4 w-4" strokeWidth={2} />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="ch-btn ch-btn--primary ch-btn--lg"
              disabled={loading}
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>

            {status ? <p className="ch-alertbox">{status}</p> : null}
          </form>
        </div>

        <div className="ch-auth__signup">
          <span>Ainda não tem acesso?</span>
          <Link href="/signup" className="ch-btn ch-btn--secondary ch-btn--md">
            Criar conta
          </Link>
        </div>

        <p className="ch-auth__note">
          Ambiente restrito · Acessos são registrados e auditados
        </p>
      </main>
    </div>
  );
}
