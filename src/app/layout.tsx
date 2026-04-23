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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`dark ${display.variable} ${body.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ToasterProvider>{children}</ToasterProvider>
      </body>
    </html>
  );
}
