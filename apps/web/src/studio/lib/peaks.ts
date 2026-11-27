export type PeakData = { min: Float32Array; max: Float32Array; bins: number }

export function computePeaks(channel: Float32Array, bins: number): PeakData {
  const count = Math.max(1, Math.floor(bins))
  const min = new Float32Array(count)
  const max = new Float32Array(count)
  if (channel.length === 0) return { min, max, bins: count }

  const seen = new Uint8Array(count)
  for (let i = 0; i < channel.length; i += 1) {
    const bin = Math.min(count - 1, Math.floor((i * count) / channel.length))
    const value = channel[i]!
    if (!seen[bin]) {
      min[bin]! = value
      max[bin]! = value
      seen[bin] = 1
    } else {
      if (value < min[bin]!) min[bin]! = value
      if (value > max[bin]!) max[bin]! = value
    }
  }
  return { min, max, bins: count }
}
