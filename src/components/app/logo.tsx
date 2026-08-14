interface LogoProps {
  className?: string;
  size?: number;
}

/**
 * Símbolo do Control Hub: quadrado vermelho com três barras brancas
 * crescentes (gráfico de barras). Tamanho canônico 22px — o mesmo do
 * topo da sidebar; `size` existe para os usos maiores (login, etc.).
 */
export function Logo({ className, size = 22 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect width="22" height="22" rx="5" fill="var(--color-accent)" />
      <rect x="5" y="12" width="3" height="5" rx="1" fill="#fff" />
      <rect x="9.5" y="9" width="3" height="8" rx="1" fill="#fff" />
      <rect x="14" y="6" width="3" height="11" rx="1" fill="#fff" />
    </svg>
  );
}

/** Símbolo + wordmark "ControlHub" ("Hub" em vermelho) + tag BETA. */
export function LogoFull({ className }: { className?: string }) {
  return (
    <span className={`ch-brand ${className ?? ""}`}>
      <Logo size={22} />
      <span className="ch-brand__word">
        Control<em>Hub</em>
      </span>
      <span className="ch-brand__beta">Beta</span>
    </span>
  );
}
