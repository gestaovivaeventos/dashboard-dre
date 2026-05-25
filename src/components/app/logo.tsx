interface LogoProps {
  className?: string;
  size?: number;
}

export function Logo({ className, size = 32 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Rounded square background */}
      <rect width="40" height="40" rx="10" fill="currentColor" className="text-primary" />
      {/* Bar chart icon representing financial control */}
      <rect x="8" y="22" width="5" height="10" rx="1.5" fill="white" opacity="0.9" />
      <rect x="17.5" y="14" width="5" height="18" rx="1.5" fill="white" />
      <rect x="27" y="8" width="5" height="24" rx="1.5" fill="white" opacity="0.9" />
    </svg>
  );
}

export function LogoFull({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <Logo size={36} />
      <div className="leading-tight flex items-center gap-1.5">
        <div>
          <span className="text-lg font-bold tracking-tight">Controll</span>
          <span className="text-lg font-light tracking-tight text-primary"> Hub</span>
        </div>
        <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
          beta
        </span>
      </div>
    </div>
  );
}
