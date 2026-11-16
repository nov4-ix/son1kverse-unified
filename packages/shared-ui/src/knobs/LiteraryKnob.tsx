import { useCallback, useId, useRef } from 'react'

export type LiteraryKnobProps = {
  label: string
  hint: string
  value: number
  onChange: (next: number) => void
  accent?: string
  disabled?: boolean
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function valueFromPointer(clientY: number, rect: DOMRect): number {
  const ratio = (rect.bottom - clientY) / rect.height
  return clamp01(ratio)
}

export function LiteraryKnob({
  label,
  hint,
  value,
  onChange,
  accent = '#D4A359',
  disabled = false,
}: LiteraryKnobProps) {
  const id = useId()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const rotation = -135 + clamp01(value) * 270

  const applyPointer = useCallback(
    (clientY: number) => {
      const node = surfaceRef.current
      if (node === null || disabled) return
      onChange(valueFromPointer(clientY, node.getBoundingClientRect()))
    },
    [disabled, onChange],
  )

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div
        ref={surfaceRef}
        role="slider"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        className="relative h-24 w-24 cursor-ns-resize touch-none select-none"
        onPointerDown={(event) => {
          if (disabled) return
          event.currentTarget.setPointerCapture(event.pointerId)
          applyPointer(event.clientY)
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          applyPointer(event.clientY)
        }}
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
            event.preventDefault()
            onChange(clamp01(value + 0.05))
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
            event.preventDefault()
            onChange(clamp01(value - 0.05))
          }
        }}
      >
        <svg viewBox="0 0 96 96" className="h-full w-full">
          <circle
            cx="48"
            cy="48"
            r="38"
            fill="#0A0B0E"
            stroke="#12151C"
            strokeWidth="6"
          />
          <circle
            cx="48"
            cy="48"
            r="30"
            fill="none"
            stroke={accent}
            strokeWidth="2"
            opacity="0.85"
          />
          <g transform={`rotate(${rotation} 48 48)`}>
            <line
              x1="48"
              y1="48"
              x2="48"
              y2="22"
              stroke={accent}
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="48" cy="48" r="4" fill={accent} />
          </g>
        </svg>
      </div>
      <p id={id} className="font-terminal text-[11px] uppercase tracking-[0.18em] text-alvae-gold">
        {label}
      </p>
      <p className="font-terminal text-[10px] text-alvae-muted">{hint}</p>
      <p className="font-terminal text-xs text-alvae-terminal">{value.toFixed(2)}</p>
    </div>
  )
}
