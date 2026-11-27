import { beforeAll, describe, expect, it } from 'vitest'

process.env['NODE_ENV'] = 'test'
process.env['JWT_SECRET'] = 'test-secret-0123456789-0123456789-abcdef'

let ConfigSchema: typeof import('../../src/config/env.js')['ConfigSchema']

beforeAll(async () => {
  ;({ ConfigSchema } = await import('../../src/config/env.js'))
})

const JWT_SECRET = 'test-secret-0123456789-0123456789-abcdef'

describe('ConfigSchema — secretos de producción', () => {
  it('acepta producción con todos los secretos y requisitos explícitos', () => {
    const result = ConfigSchema.safeParse({
      NODE_ENV: 'production',
      JWT_SECRET,
      DATABASE_URL: 'postgresql://user:pass@db:5432/son1kverse',
      MUSIC_LAB_API_KEY: 'music-lab-secret',
      REQUIRE_EMAIL_VERIFICATION: true,
      REQUIRE_SESSION_CLAIM: true,
      EMAIL_PROVIDER: 'resend',
      EMAIL_API_KEY: 're_test_secret',
      APP_BASE_URL: 'https://son1kvers3.com',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza producción sin DATABASE_URL', () => {
    const result = ConfigSchema.safeParse({
      NODE_ENV: 'production',
      JWT_SECRET,
      MUSIC_LAB_API_KEY: 'music-lab-secret',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'DATABASE_URL')).toBe(true)
    }
  })

  it('rechaza producción sin MUSIC_LAB_API_KEY', () => {
    const result = ConfigSchema.safeParse({
      NODE_ENV: 'production',
      JWT_SECRET,
      DATABASE_URL: 'postgresql://user:pass@db:5432/son1kverse',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'MUSIC_LAB_API_KEY')).toBe(true)
    }
  })

  it('mantiene el default local de DATABASE_URL fuera de producción', () => {
    const result = ConfigSchema.safeParse({
      NODE_ENV: 'development',
      JWT_SECRET,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.DATABASE_URL).toContain('localhost:5432')
    }
  })
})
