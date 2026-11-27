import { describe, expect, it } from 'vitest'
import { computePeaks } from './peaks'

describe('computePeaks', () => {
  it('reduce muestras a bins min/max', () => {
    const peaks = computePeaks(new Float32Array([0.5, -0.5, 0.25, -0.75, 0, 0, 0, 0]), 4)
    expect(Array.from(peaks.min)).toEqual([-0.5, -0.75, 0, 0])
    expect(Array.from(peaks.max)).toEqual([0.5, 0.25, 0, 0])
    expect(peaks.bins).toBe(4)
  })

  it('devuelve bins en cero para input vacío', () => {
    const peaks = computePeaks(new Float32Array(0), 3)
    expect(Array.from(peaks.min)).toEqual([0, 0, 0])
    expect(Array.from(peaks.max)).toEqual([0, 0, 0])
  })

  it('clampea bins a uno', () => {
    const peaks = computePeaks(new Float32Array([0.1, -0.2]), 0)
    expect(peaks.bins).toBe(1)
    expect(peaks.min[0]).toBeCloseTo(-0.2)
    expect(peaks.max[0]).toBeCloseTo(0.1)
  })
})
