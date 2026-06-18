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

export const metadata: Metadata = {
  title: "Controll Hub",
  description: "Painel DRE com autenticação Supabase",
};

// Aplica o tema salvo antes da hidratacao para nao "piscar" ao carregar.
// Padrao do Controll Hub e' o tema ESCURO (dark-tech Viva). So vai para o
// claro quando o usuario escolhe explicitamente (localStorage 'theme' = 'light').
const THEME_INIT_SCRIPT = `
(function(){try{
  var stored = localStorage.getItem('theme');
  var isDark = stored ? stored === 'dark' : true;
  if (isDark) document.documentElement.classList.add('dark');
}catch(e){}})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ToasterProvider>{children}</ToasterProvider>
      </body>
    </html>
  );
}
