import type { LiteraryKnobs } from './pixelPersonality'
import { traducirPerillas, type Estilo } from './perillasDictionary'

export type AandRDirection = {
  duration_s: number
  bpm: number
  key: string
  structure: string[]
  structuredLyrics: string | null
  styleTags: string[]
  arNote: string
}

const MINOR_ROOTS = ['Dm', 'Am', 'Fm', 'Cm', 'Em', 'Gm'] as const
const MAJOR_ROOTS = ['C', 'G', 'D', 'F', 'Bb'] as const

function mapNarrativeToEstilo(narrative: number, prompt: string): Estilo {
  const lower = prompt.toLowerCase()
  if (/urban|trap|808|calle|beat|rap|hip/.test(lower)) return 'urbano'
  if (/cine|pel[ií]cula|banda sonora|paisaje|score/.test(lower)) return 'cinematografico'
  if (narrative < 0.25) return 'confesional'
  if (narrative < 0.5) return 'poetico'
  if (narrative < 0.75) return 'cinematografico'
  return 'epico'
}

function hydrateLyrics(rawLyrics: string, skeleton: string): string | null {
  const trimmed = rawLyrics.trim()
  if (trimmed === '') return null
  if (/\[(intro|verse|verso|chorus|coro|bridge|puente|outro)\]/i.test(trimmed)) return trimmed
  const userLines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  let lineIdx = 0
  return skeleton.replace(/\{linea_\d+_\d+[^}]*\}/g, () => {
    const chosen = userLines[lineIdx % userLines.length] ?? ''
    lineIdx += 1
    return chosen
  })
}

export function orchestrateAandR(
  prompt: string,
  lyrics: string,
  knobs: LiteraryKnobs,
  historyCount: number,
): AandRDirection {
  const estilo = mapNarrativeToEstilo(knobs.narrativeStyle, prompt)
  const isEnglish = /\b(the|and|night|love|heart|broken|shadow|light)\b/i.test(prompt + ' ' + lyrics)
  const duracionSeg = Math.round(165 + knobs.narrativeStyle * 30 + knobs.experimentalLevel * 15)

  const plan = traducirPerillas({
    intensidad: Math.round(knobs.creativeIntensity * 100),
    profundidad: Math.round(knobs.emotionalDepth * 100),
    experimental: Math.round(knobs.experimentalLevel * 100),
    estilo,
    imperfeccion: Math.round(knobs.humanImperfection * 100),
    lang: isEnglish ? 'en' : 'es',
    duracionSeg,
    pedido: prompt,
  })

  const seedHash = Array.from(prompt + ':' + lyrics).reduce((acc, ch) => acc + ch.charCodeAt(0), historyCount)
  const isMinor = /minor|menor|dorian|phrygian/i.test(plan.key_scale)
  const pool = isMinor ? MINOR_ROOTS : MAJOR_ROOTS
  const key = pool[seedHash % pool.length] ?? 'Dm'

  const structure = Array.from(plan.lyrics_skeleton.matchAll(/^\[([^\]]+)\]/gm)).map((m) => m[1] ?? 'Verse')
  const styleTags = plan.caption.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
  const instrMode = plan.capas.instrumentacion.modo === "hibrido"
    ? 'Híbrido (Analógico + Urbano)'
    : 'Acústico Orgánico'

  const min = Math.floor(plan.duration / 60)
  const sec = String(plan.duration % 60).padStart(2, '0')
  const arNote = 'A&R Pixel · ' + plan.bpm + ' BPM · ' + key + ' · ' + min + ':' + sec + ' · ' + instrMode

  return {
    duration_s: plan.duration,
    bpm: plan.bpm,
    key,
    structure: structure.length > 0 ? structure : ['Intro', 'Verso', 'Coro', 'Puente', 'Outro'],
    structuredLyrics: hydrateLyrics(lyrics, plan.lyrics_skeleton),
    styleTags,
    arNote,
  }
}
