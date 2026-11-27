import { describe, expect, it } from 'vitest'
import { formatBarsBeats, formatTimecode } from './timecode'

describe('formatTimecode', () => {
  it('formatea MM:SS.mmm con ancho fijo', () => {
    expect(formatTimecode(0)).toBe('00:00.000')
    expect(formatTimecode(61.234)).toBe('01:01.234')
    expect(formatTimecode(600.9999)).toBe('10:00.999')
  })

  it('clampea valores inválidos a cero', () => {
    expect(formatTimecode(-1)).toBe('00:00.000')
    expect(formatTimecode(Number.NaN)).toBe('00:00.000')
  })
})

describe('formatBarsBeats', () => {
  it('mapea 120 BPM 4/4 a bar.beat.tick', () => {
    expect(formatBarsBeats(0, 120, 4, 4)).toBe('001.01.000')
    expect(formatBarsBeats(1, 120, 4, 4)).toBe('001.03.000')
    expect(formatBarsBeats(2, 120, 4, 4)).toBe('002.01.000')
  })

  it('respeta el denominador 8', () => {
    expect(formatBarsBeats(1.5, 120, 6, 8)).toBe('002.01.000')
  })
})
