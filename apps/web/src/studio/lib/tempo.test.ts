import { describe, expect, it } from 'vitest'
import { clampBpm } from './tempo'

describe('clampBpm', () => {
  it('clampea al rango 30..300 y redondea', () => {
    expect(clampBpm(29)).toBe(30)
    expect(clampBpm(301)).toBe(300)
    expect(clampBpm(120.6)).toBe(121)
  })

  it('usa 120 para valores no finitos', () => {
    expect(clampBpm(Number.NaN)).toBe(120)
    expect(clampBpm(Number.POSITIVE_INFINITY)).toBe(120)
  })
})
