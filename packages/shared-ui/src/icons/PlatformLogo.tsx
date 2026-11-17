import type { SVGProps } from 'react'

export function PlatformLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 200 200" fill="none" aria-label="SON1KVERS3" {...props}>
      <defs>
        <linearGradient id="son1kLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#B858FE" stopOpacity="1" />
          <stop offset="50%" stopColor="#047AF6" stopOpacity="1" />
          <stop offset="100%" stopColor="#40FDAE" stopOpacity="1" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="90" stroke="url(#son1kLogoGrad)" strokeWidth="2.5" fill="none" opacity="0.35" />
      <path d="M 100 30 L 170 150 L 30 150 Z" stroke="url(#son1kLogoGrad)" strokeWidth="2.5" fill="none" />
      <circle cx="100" cy="100" r="25" stroke="url(#son1kLogoGrad)" strokeWidth="2.5" fill="none" />
      <circle cx="100" cy="100" r="8" fill="url(#son1kLogoGrad)" />
      <line x1="100" y1="30" x2="100" y2="70" stroke="url(#son1kLogoGrad)" strokeWidth="1.5" opacity="0.6" />
      <line x1="30" y1="150" x2="60" y2="110" stroke="url(#son1kLogoGrad)" strokeWidth="1.5" opacity="0.6" />
      <line x1="170" y1="150" x2="140" y2="110" stroke="url(#son1kLogoGrad)" strokeWidth="1.5" opacity="0.6" />
    </svg>
  )
}
