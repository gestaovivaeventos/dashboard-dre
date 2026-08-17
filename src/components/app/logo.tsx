interface LogoProps {
  className?: string;
  size?: number;
}

/**
 * Símbolo do Control Hub: quadrado vermelho com três barras crescentes
 * (gráfico de barras). Tamanho canônico 22px — o do topo da sidebar;
 * `size` existe para os usos maiores (login, etc.).
 *
 * As cores saem de tokens (--ch-mark-*) porque o símbolo muda de
 * tratamento no tema escuro: o quadrado vermelho cheio vira superfície
 * tingida com contorno, e as barras passam a ser vermelhas.
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
      <rect
        x="0.5"
        y="0.5"
        width="21"
        height="21"
        rx="4.5"
        fill="var(--ch-mark-bg)"
        stroke="var(--ch-mark-stroke)"
      />
      <rect x="5" y="12" width="3" height="5" rx="1" fill="var(--ch-mark-ink)" />
      <rect x="9.5" y="9" width="3" height="8" rx="1" fill="var(--ch-mark-ink)" />
      <rect x="14" y="6" width="3" height="11" rx="1" fill="var(--ch-mark-ink)" />
    </svg>
  );
}

/** Símbolo + wordmark "ControlHub" ("Hub" em vermelho) + tag BETA. */
export function LogoFull({
  className,
  size = 22,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <span className={`ch-brand ${className ?? ""}`}>
      <Logo size={size} />
      <span className="ch-brand__word">
        Control<em>Hub</em>
      </span>
      <span className="ch-brand__beta">Beta</span>
    </span>
  );
}
