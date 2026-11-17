// ─── SON1KVERSE — Límites y planes por SubscriptionTier ─────────────────────
// Fuente única para API y UI. El schema Prisma replica el default FREE (3),
// pero el valor efectivo se escribe desde este módulo al registrar un usuario.

export type SubscriptionTierName = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE'

export type SubscriptionLimits = {
  generationsPerMonth: number
  storageLimitBytes: number
}

export type SubscriptionPlan = SubscriptionLimits & {
  tier: SubscriptionTierName
  name: string
  priceMonthlyUsd: number | null
  priceLabel: string
  period: string
  description: string
  features: readonly string[]
  highlighted: boolean
}

// Prisma Int es int4; este valor funciona como "sin límite" práctico.
export const UNLIMITED_GENERATIONS = 2_147_483_647

export const SUBSCRIPTION_LIMITS: Record<SubscriptionTierName, SubscriptionLimits> = {
  FREE: {
    generationsPerMonth: 3,
    storageLimitBytes: 1_073_741_824,
  },
  STARTER: {
    generationsPerMonth: 100,
    storageLimitBytes: 10_737_418_240,
  },
  PRO: {
    generationsPerMonth: 500,
    storageLimitBytes: 53_687_091_200,
  },
  ENTERPRISE: {
    generationsPerMonth: UNLIMITED_GENERATIONS,
    storageLimitBytes: 536_870_912_000,
  },
}

export const DEFAULT_SUBSCRIPTION_TIER: SubscriptionTierName = 'FREE'

export function generationLimitForTier(tier: SubscriptionTierName): number {
  return SUBSCRIPTION_LIMITS[tier].generationsPerMonth
}

export function storageLimitForTier(tier: SubscriptionTierName): number {
  return SUBSCRIPTION_LIMITS[tier].storageLimitBytes
}

export function isUnlimitedTier(tier: SubscriptionTierName): boolean {
  return SUBSCRIPTION_LIMITS[tier].generationsPerMonth >= UNLIMITED_GENERATIONS
}

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  {
    tier: 'FREE',
    name: 'Free',
    priceMonthlyUsd: 0,
    priceLabel: '$0',
    period: '/mes',
    description: 'Comienza tu viaje musical',
    ...SUBSCRIPTION_LIMITS.FREE,
    features: ['3 generaciones/mes', 'Calidad estándar', 'Uso personal'],
    highlighted: false,
  },
  {
    tier: 'STARTER',
    name: 'Pro',
    priceMonthlyUsd: 29,
    priceLabel: '$29',
    period: '/mes',
    description: 'Para creadores activos',
    ...SUBSCRIPTION_LIMITS.STARTER,
    features: ['100 generaciones/mes', 'Calidad alta', 'Uso comercial'],
    highlighted: false,
  },
  {
    tier: 'PRO',
    name: 'Premium',
    priceMonthlyUsd: 69,
    priceLabel: '$69',
    period: '/mes',
    description: 'Para profesionales',
    ...SUBSCRIPTION_LIMITS.PRO,
    features: ['500 generaciones/mes', 'Descarga de stems', 'API incluida'],
    highlighted: true,
  },
  {
    tier: 'ENTERPRISE',
    name: 'Enterprise',
    priceMonthlyUsd: null,
    priceLabel: 'Contacto',
    period: '',
    description: 'Soluciones a medida',
    ...SUBSCRIPTION_LIMITS.ENTERPRISE,
    features: ['Ilimitado', 'API dedicada', 'Soporte 24/7'],
    highlighted: false,
  },
]

export const FREE_GENERATIONS_PER_MONTH = SUBSCRIPTION_LIMITS.FREE.generationsPerMonth
