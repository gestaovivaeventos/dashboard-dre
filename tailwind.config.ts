import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // shadcn/ui (HSL via CSS vars em globals.css)
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // Control Hub — acento unico (vermelho). A escala mantem o
        // nome `viva` para nao quebrar as telas que ja usam
        // bg-viva-500 / text-viva-700; o valor e que passou a ser o
        // vermelho do design system (--color-accent / -700).
        viva: {
          50:  "#FDECE9",
          100: "#FBD5CE",
          200: "#F7AA9D",
          300: "#F27F6C",
          400: "#EF553B",
          500: "#EC3013",
          600: "#CF250C",
          700: "#AE1800",
          800: "#841200",
          900: "#560C00",
        },
        // Surfaces e textos seguem as CSS vars — alternam entre tema
        // claro (:root) e escuro (.dark) definidos em viva-tokens.css.
        surface: {
          0: "var(--surface-0)",
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
          4: "var(--surface-4)",
        },
        ink: {
          primary:   "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted:     "var(--text-muted)",
          disabled:  "var(--text-disabled)",
        },
        status: {
          critical: "#F04438",
          warning:  "#F79009",
          progress: "#3B82F6",
          success:  "#12B76A",
          info:     "#06AED4",
        },
      },
      fontFamily: {
        // Archivo (var(--font-archivo), injetada pelo next/font em layout.tsx)
        // e a fonte unica do design system: headings e corpo. `display` e
        // `sans` apontam para ela para que as telas antigas acompanhem.
        display: ['var(--font-archivo)', "Archivo", "system-ui", "sans-serif"],
        sans:    ['var(--font-archivo)', "Archivo", "system-ui", "-apple-system", "sans-serif"],
      },
      borderRadius: {
        // shadcn
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // Viva (fixos)
        "viva-sm": "4px",
        "viva-md": "8px",
        "viva-lg": "12px",
        "viva-xl": "16px",
      },
      boxShadow: {
        // Sombras muito discretas — nada de elevacao dramatica.
        "viva-sm": "0 1px 2px rgba(32,30,29,0.10)",
        "viva-md": "0 3px 8px rgba(32,30,29,0.14)",
        "viva-lg": "0 8px 20px rgba(32,30,29,0.16)",
      },
      letterSpacing: {
        display: "0.08em",
        label:   "0.12em",
      },
      backgroundImage: {
        "grad-critical": "linear-gradient(135deg, rgba(240,68,56,0.25) 0%, rgba(240,68,56,0.05) 100%)",
        "grad-warning":  "linear-gradient(135deg, rgba(247,144,9,0.25) 0%, rgba(247,144,9,0.05) 100%)",
        "grad-progress": "linear-gradient(135deg, rgba(59,130,246,0.25) 0%, rgba(59,130,246,0.05) 100%)",
        "grad-success":  "linear-gradient(135deg, rgba(18,183,106,0.25) 0%, rgba(18,183,106,0.05) 100%)",
      },
    },
  },
  plugins: [],
};
export default config;
