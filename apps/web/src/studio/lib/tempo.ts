export function clampBpm(value: number): number {
  if (!Number.isFinite(value)) return 120
  return Math.min(300, Math.max(30, Math.round(value)))
}
