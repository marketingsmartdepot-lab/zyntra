/**
 * Marca ZYNTRA — traços do arquivo original, redesenhados como componentes.
 * O símbolo é sempre champanhe sobre grafite; o logotipo herda a cor do texto
 * via currentColor.
 */

export function SimboloZ({ className }: { className?: string }) {
  return (
    <svg viewBox="112 143 288 226" className={className} aria-hidden="true">
      <path
        d="M129 160H383L129 352H383"
        fill="none"
        stroke="#D7BF96"
        strokeWidth={17}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M340 160L129 320"
        fill="none"
        stroke="#F1E3C9"
        strokeOpacity={0.34}
        strokeWidth={3}
      />
    </svg>
  );
}

export function SeloZ({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <rect width={512} height={512} rx={112} fill="#11191C" />
      <path
        d="M129 160H383L129 352H383"
        fill="none"
        stroke="#D7BF96"
        strokeWidth={17}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M340 160L129 320"
        fill="none"
        stroke="#F1E3C9"
        strokeOpacity={0.34}
        strokeWidth={3}
      />
    </svg>
  );
}

export function Logotipo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-5 -5 590 108"
      className={className}
      role="img"
      aria-label="ZYNTRA"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={7.1}
        strokeLinecap="square"
        strokeLinejoin="miter"
      >
        <path d="M0 0H78L0 98H78" />
        <path d="M100 0L139 48L178 0M139 48V98" />
        <path d="M200 98V0L278 98V0" />
        <path d="M300 0H378M339 0V98" />
        <path d="M400 98V0H445C466 0 478 11 478 27C478 44 466 54 445 54H400M444 54L480 98" />
        <path d="M500 98L539 0L578 98M517 66H561" />
      </g>
    </svg>
  );
}

export function Assinatura({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-4 ${className ?? ""}`}>
      <span className="h-[2.5px] w-10 shrink-0 bg-champanhe" />
      <span className="text-[11.5px] font-medium uppercase tracking-[0.26em] text-cinza">
        Operação em movimento
      </span>
    </div>
  );
}

export function Rodape({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center gap-[11px] text-[11px] tracking-[0.05em] text-cinza-2 ${className ?? ""}`}
    >
      <span>2026</span>
      <span className="text-grafite-linha-2">|</span>
      <span>Desenvolvido por Daniele Moreira</span>
    </div>
  );
}
