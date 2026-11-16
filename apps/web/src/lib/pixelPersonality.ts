import type { JobStatus } from './api'

export type LiteraryKnobs = {
  creativeIntensity: number
  emotionalDepth: number
  experimentalLevel: number
  narrativeStyle: number
  humanImperfection: number
}

export const PIXEL_SIGNATURE = [
  'Cuida tu ruido',
  'No perfecto. Correcto.',
  'Lo imperfecto también es sagrado',
  'El silencio es el enemigo',
  'No soy asistente. Soy cómplice',
] as const

export function signalForKnobs(knobs: LiteraryKnobs): string {
  if (knobs.humanImperfection >= 0.72) return 'Lo imperfecto también es sagrado'
  if (knobs.experimentalLevel >= 0.75) return 'Rompe el filtro. Deja la grieta'
  if (knobs.emotionalDepth >= 0.7) return 'Profundo no es ruidoso. Cuida tu ruido'
  if (knobs.narrativeStyle >= 0.7) return 'Cuenta, no decora'
  if (knobs.creativeIntensity >= 0.8) return 'Intensidad sin anestesia'
  if (knobs.creativeIntensity <= 0.2) return 'Clínico. Demasiado limpio'
  return 'No perfecto. Correcto.'
}

export function signalForJob(status: JobStatus | 'idle'): string {
  switch (status) {
    case 'queued':
      return 'En cola. El silencio espera'
    case 'running':
      return 'Generando. No interrumpas el pulso'
    case 'succeeded':
      return 'Listo. No perfecto. Correcto.'
    case 'failed':
      return 'Fallo. La grieta también informa'
    default:
      return 'Cuida tu ruido'
  }
}

export const DEFAULT_KNOBS: LiteraryKnobs = {
  creativeIntensity: 0.62,
  emotionalDepth: 0.55,
  experimentalLevel: 0.38,
  narrativeStyle: 0.48,
  humanImperfection: 0.42,
}

export function knobsToStyleTags(knobs: LiteraryKnobs): string[] {
  const tags: string[] = []
  if (knobs.creativeIntensity >= 0.6) tags.push('intense')
  if (knobs.emotionalDepth >= 0.6) tags.push('emotional')
  if (knobs.experimentalLevel >= 0.55) tags.push('experimental')
  if (knobs.narrativeStyle >= 0.55) tags.push('narrative')
  if (knobs.humanImperfection >= 0.45) tags.push('human-scar', 'imperfect')
  return tags.slice(0, 32)
}

export function composeLiteraryPrompt(prompt: string, knobs: LiteraryKnobs): string {
  const lines = [
    prompt.trim(),
    `Intensidad creativa ${knobs.creativeIntensity.toFixed(2)}`,
    `Profundidad emocional ${knobs.emotionalDepth.toFixed(2)}`,
    `Nivel experimental ${knobs.experimentalLevel.toFixed(2)}`,
    `Estilo narrativo ${knobs.narrativeStyle.toFixed(2)}`,
  ]
  if (knobs.humanImperfection >= 0.4) {
    lines.push('Quinto acorde activo. Lo imperfecto también es sagrado.')
  }
  return lines.join('. ')
}
