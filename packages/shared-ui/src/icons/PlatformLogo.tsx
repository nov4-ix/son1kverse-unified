import type { SVGProps } from 'react'

type PlatformLogoProps = SVGProps<SVGSVGElement> & {
  title?: string
}

export function PlatformLogo({
  title = 'SON1KVERSE',
  ...props
}: PlatformLogoProps) {
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
      <polygon
        points="32,6 58,56 6,56"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="miter"
      />
      <polygon
        points="32,14 51,50 13,50"
        stroke="currentColor"
        strokeWidth="0.8"
        opacity="0.45"
      />
      <ellipse
        cx="32"
        cy="36"
        rx="11"
        ry="6.4"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="32" cy="36" r="3.2" fill="currentColor" />
      <circle cx="33.4" cy="34.8" r="0.9" fill="#0A0B0E" />
      <line
        x1="21"
        y1="36"
        x2="26"
        y2="36"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <line
        x1="38"
        y1="36"
        x2="43"
        y2="36"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}
