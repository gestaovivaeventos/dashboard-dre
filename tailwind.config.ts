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

        // Viva Eventos — paleta direta (HEX)
        viva: {
          50:  "#FFF2E8",
          100: "#FFE0C9",
          200: "#FFC091",
          300: "#FFA05A",
          400: "#FF8636",
          500: "#FF6B1A",
          600: "#E85A0F",
          700: "#B8450B",
          800: "#8A3208",
          900: "#5C2105",
        },
        surface: {
          0: "#0F1319",
          1: "#161B24",
          2: "#1C2330",
          3: "#232C3B",
          4: "#2E3849",
        },
        ink: {
          primary:   "#F1F4F9",
          secondary: "#A8B1C1",
          muted:     "#6B7689",
          disabled:  "#454E60",
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
        // var(--font-display) e var(--font-body) injetados pelo next/font em layout.tsx
        display: ['var(--font-display)', '"Chakra Petch"', "Rajdhani", "system-ui", "sans-serif"],
        sans:    ['var(--font-body)', "Inter", "system-ui", "-apple-system", "sans-serif"],
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
        "viva-sm": "0 1px 2px rgba(0,0,0,0.3)",
        "viva-md": "0 4px 12px rgba(0,0,0,0.4)",
        "viva-lg": "0 12px 32px rgba(0,0,0,0.5)",
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
