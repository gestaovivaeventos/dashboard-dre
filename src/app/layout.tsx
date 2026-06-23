import type { Metadata } from "next";
import { Chakra_Petch, Inter } from "next/font/google";

import { ToasterProvider } from "@/components/ui/toaster";
import "./globals.css";

const display = Chakra_Petch({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const body = Inter({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

// NOTA: as fontes do Relatório Financeiro Mensal (IBM Plex Sans/Mono) NÃO sao
// carregadas via next/font de proposito. O next/font baixa o arquivo da fonte
// em TEMPO DE BUILD; se o build da Vercel nao alcançar o Google Fonts, o
// `next build` falha inteiro e o deploy antigo permanece no ar. Por isso o
// IBM Plex e carregado via <link> em runtime (head abaixo) + variaveis CSS
// definidas em globals.css. O documento do relatorio referencia
// var(--font-plex-sans)/(--font-plex-mono) com fallback para o nome da familia.

export const metadata: Metadata = {
  title: "Controll Hub",
  description: "Painel DRE com autenticação Supabase",
};

// Aplica o tema salvo antes da hidratacao para nao "piscar" ao carregar.
// Se nao houver preferencia salva, usa a do sistema operacional.
const THEME_INIT_SCRIPT = `
(function(){try{
  var stored = localStorage.getItem('theme');
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var isDark = stored === 'dark' || (!stored && prefersDark);
  if (isDark) document.documentElement.classList.add('dark');
}catch(e){}})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${display.variable} ${body.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* IBM Plex carregado em runtime (não no build) — ver nota acima. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* App Router: o <link> no root layout carrega em todas as páginas — a
            regra no-page-custom-font (pensada para Pages Router) é falso positivo. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ToasterProvider>{children}</ToasterProvider>
      </body>
    </html>
  );
}
