import type { SVGProps } from 'react'

type AlvaeSymbolProps = SVGProps<SVGSVGElement> & {
  title?: string
}

export function AlvaeSymbol({
  title = 'ALVAE — La Liga del No Silencio',
  ...props
}: AlvaeSymbolProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      {...props}
    >
      <title>{title}</title>
      <path
        d="M50.2 18.4 A22 22 0 1 1 46.8 14.8"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M44 8 L38 24 L46 26 L30 56 L36 34 L27 32 Z"
        fill="currentColor"
      />
      <path
        d="M18 22 L46 42"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.55"
      />
    </svg>
  )
}
