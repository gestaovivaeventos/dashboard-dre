"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/** Chave do tema. `theme` era a anterior — lida só para migrar a escolha. */
const STORAGE_KEY = "ch-theme";
const LEGACY_KEY = "theme";

/**
 * Marca o tema no <html>. São três marcas de propósito, cada uma com um
 * consumidor (ver a nota do THEME_INIT_SCRIPT em app/layout.tsx):
 * `data-theme` para os tokens, `.dark` para as utilitárias do Tailwind das
 * telas antigas e `.ch-dark` para o fundo do html/body.
 */
function applyTheme(dark: boolean) {
  const el = document.documentElement;
  el.setAttribute("data-theme", dark ? "dark" : "light");
  el.classList.toggle("dark", dark);
  el.classList.toggle("ch-dark", dark);
}

export function ThemeToggle({ className }: { className?: string } = {}) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored =
      localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    const isDark =
      stored === "dark" ||
      (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(isDark);
    applyTheme(isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
  };

  // Lua no claro, sol no escuro: o ícone mostra para onde o clique leva.
  const label = dark ? "Tema claro" : "Tema escuro";

  return (
    <button
      type="button"
      className={`ch-iconbtn ${className ?? ""}`}
      onClick={toggle}
      title={label}
      aria-label={label}
    >
      {dark ? (
        <Sun className="h-4 w-4" strokeWidth={2} />
      ) : (
        <Moon className="h-4 w-4" strokeWidth={2} />
      )}
    </button>
  );
}
