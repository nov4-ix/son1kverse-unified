import type { LiteraryKnobs } from './pixelPersonality'

export type AandRDirection = {
  duration_s: number
  bpm: number
  key: string
  structure: string[]
  structuredLyrics: string | null
  arNote: string
}

const MINOR_KEYS = ['Dm', 'Am', 'Fm', 'Cm', 'Em', 'Gm'] as const
const MAJOR_KEYS = ['C', 'G', 'D', 'F', 'Bb'] as const

function detectMoodProfile(prompt: string, lyrics: string): { energy: number; darkness: number } {
  const text = `${prompt} ${lyrics}`.toLowerCase()
  let energy = 0.5
  let darkness = 0.5
  if (/industrial|hormig[oó]n|rabia|fuego|metal|distorsi[oó]n|rápido|pulso|electro|techno|rock/.test(text)) energy += 0.28
  if (/nocturno|silencio|grieta|lluvia|piano|lento|melancol[ií]a|nostalgia|sombra|herida/.test(text)) {
    darkness += 0.25
    energy -= 0.15
  }
  if (/luz|amanecer|canto|esperanza|cielo|semilla|abierto/.test(text)) darkness -= 0.22
  return { energy: Math.max(0.1, Math.min(1, energy)), darkness: Math.max(0.1, Math.min(1, darkness)) }
}

function buildFullSongLyrics(rawLyrics: string, structure: string[]): string | null {
  const trimmed = rawLyrics.trim()
  if (trimmed === '') return null
  if (/\[(intro|verse|verso|chorus|coro|bridge|puente|outro)\]/i.test(trimmed)) return trimmed

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length <= 2) {
    return `[Intro]\n(Instrumental)\n\n[Verse 1]\n${lines.join('\n')}\n\n[Chorus]\n${lines.join('\n')}\n\n[Bridge]\n(Variación)\n\n[Chorus]\n${lines.join('\n')}\n\n[Outro]\n(Quinto acorde)`
  }
  const chunk = Math.max(2, Math.ceil(lines.length / 4))
  const v1 = lines.slice(0, chunk).join('\n')
  const chorus = lines.slice(chunk, chunk * 2).join('\n') || v1
  const v2 = lines.slice(chunk * 2, chunk * 3).join('\n') || v1
  const bridge = lines.slice(chunk * 3).join('\n') || chorus
  return `[${structure[0] ?? 'Intro'}]\n(Apertura)\n\n[${structure[1] ?? 'Verso 1'}]\n${v1}\n\n[${structure[3] ?? 'Coro'}]\n${chorus}\n\n[${structure[4] ?? 'Verso 2'}]\n${v2}\n\n[${structure[5] ?? 'Puente'}]\n${bridge}\n\n[${structure[6] ?? 'Coro Final'}]\n${chorus}\n\n[${structure[7] ?? 'Outro'}]\n(Cierre)`
}

export function orchestrateAandR(prompt: string, lyrics: string, knobs: LiteraryKnobs, historyCount: number): AandRDirection {
  const mood = detectMoodProfile(prompt, lyrics)
  const bpm = Math.round(Math.max(68, Math.min(148, 76 + mood.energy * 48 + knobs.creativeIntensity * 16)))
  const seedHash = Array.from(`${prompt}:${lyrics}`).reduce((acc, ch) => acc + ch.charCodeAt(0), historyCount)
  const keyPool = mood.darkness >= 0.42 || knobs.emotionalDepth >= 0.45 ? MINOR_KEYS : MAJOR_KEYS
  const key = keyPool[seedHash % keyPool.length] ?? 'Dm'
  const structure = knobs.narrativeStyle >= 0.55
    ? ['Intro', 'Verso 1', 'Pre-Coro', 'Coro', 'Verso 2', 'Puente', 'Coro Final', 'Outro']
    : ['Intro', 'Verso 1', 'Coro', 'Verso 2', 'Puente', 'Coro Final', 'Outro']
  const duration_s = Math.round(165 + knobs.narrativeStyle * 30 + knobs.experimentalLevel * 15)
  const min = Math.floor(duration_s / 60)
  const sec = String(duration_s % 60).padStart(2, '0')
  const imp = knobs.humanImperfection >= 0.5 ? 'quinto acorde abierto' : 'afinación orgánica'
  return {
    duration_s,
    bpm,
    key,
    structure,
    structuredLyrics: buildFullSongLyrics(lyrics, structure),
    arNote: `A&R Pixel · ${bpm} BPM · ${key} · ${min}:${sec} (${structure.length} secciones) · ${imp}`,
  }
}
