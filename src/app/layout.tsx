import type { Metadata } from "next";
import { Chakra_Petch, IBM_Plex_Mono, IBM_Plex_Sans, Inter } from "next/font/google";

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

// Fontes do Relatório Financeiro Mensal (One Page Report). Expostas como
// variaveis CSS proprias (--font-plex-sans / --font-plex-mono) e aplicadas
// SOMENTE no documento do relatorio — o resto do app continua em Inter.
const plexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
});

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
      className={`${display.variable} ${body.variable} ${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ToasterProvider>{children}</ToasterProvider>
      </body>
    </html>
  );
}
