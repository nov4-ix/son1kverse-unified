// ─── SON1KVERSE — apps/api/scripts/e2e-audio.mjs ────────────────────────────
// Flujo end-to-end contra Music Lab (el único motor):
// register → login → generate → poll → descargar audio.
// Requiere la API en :3001, PostgreSQL migrado y Music Lab arriba.
//
// Por defecto corre en simulation (CI). Para el smoke real en GPU:
//   E2E_ENGINE=ace-step E2E_DURATION_S=30 node apps/api/scripts/e2e-audio.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.resolve(__dirname, '..', 'output', 'e2e')
const API_BASE = process.env.E2E_API_BASE ?? 'http://127.0.0.1:3001/api/v1'
const ENGINE = process.env.E2E_ENGINE ?? 'simulation'
const DURATION_S = Number(process.env.E2E_DURATION_S ?? 12)
const MASTER = (process.env.E2E_MASTER ?? 'true') !== 'false'
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 10 * 60 * 1000)

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getToken() {
  const credentials = {
    email:    'e2e-audio@son1kverse.local',
    alias:    'e2e_audio',
    password: 'e2e-audio-secret-2026',
  }

  let res = await fetch(`${API_BASE}/auth/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(credentials),
  })

  if (res.status === 409) {
    res = await fetch(`${API_BASE}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: credentials.email, password: credentials.password }),
    })
  }

  if (!res.ok) {
    throw new Error(`Auth falló con HTTP ${res.status}: ${await res.text()}`)
  }

  const body = await res.json()
  console.log(`  JWT obtenido para ${body.data.user.alias}`)
  return body.data.token
}

async function run() {
  console.log('='.repeat(60))
  console.log(`VERIFICACIÓN E2E — MUSIC LAB (${ENGINE.toUpperCase()})`)
  console.log('='.repeat(60))

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  console.log('\n[0/4] Autenticando...')
  const token = await getToken()
  const authHeaders = { Authorization: `Bearer ${token}` }

  const meRes = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders })
  if (meRes.ok) {
    const me = (await meRes.json()).data
    console.log(
      `  Tier: ${me.user.subscriptionTier} | Cuota: ${me.user.generationsUsedThisMonth}/${me.user.generationsLimit}`,
    )
  }

  console.log('\n[1/4] Verificando salud de Music Lab...')
  const healthRes = await fetch(`${API_BASE}/music/health`, { headers: authHeaders })
  const healthData = await healthRes.json()
  if (!healthRes.ok) {
    throw new Error(`Music Lab no está sano (HTTP ${healthRes.status}): ${JSON.stringify(healthData)}`)
  }
  console.log(`  Modo: ${healthData.data.mode} | Motor: ${healthData.data.engine?.engine ?? 'n/a'}`)

  console.log(`\n[2/4] POST /api/v1/music/generate (${DURATION_S} s, ${ENGINE})...`)
  const startJobTime = Date.now()
  const genRes = await fetch(`${API_BASE}/music/generate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      prompt:       'synthwave melancólico sobre soledad digital',
      lyrics:       null,
      duration_s:   DURATION_S,
      bpm:          112,
      key:          'Am',
      style_tags:   ['synthwave', 'melancholic', 'neon'],
      output_format:'wav',
      master:       MASTER,
      engine:       ENGINE,
    }),
  })

  if (!genRes.ok) {
    throw new Error(`Error HTTP ${genRes.status} al encolar: ${await genRes.text()}`)
  }
  const genData = await genRes.json()
  const jobId = genData.data.job_id
  console.log(`  Job encolado: ${jobId}`)

  console.log('\n[3/4] Polling de /music/jobs/:jobId...')
  let completedJob = null
  while (Date.now() - startJobTime < TIMEOUT_MS) {
    await sleep(1000)
    const elapsedSec = ((Date.now() - startJobTime) / 1000).toFixed(1)
    const statusRes = await fetch(`${API_BASE}/music/jobs/${encodeURIComponent(jobId)}`, {
      headers: authHeaders,
    })
    if (!statusRes.ok) {
      console.warn(`  [${elapsedSec}s] HTTP ${statusRes.status} consultando el job`)
      continue
    }
    const statusJson = await statusRes.json()
    const job = statusJson.data
    console.log(`  [${elapsedSec}s] Estado: ${job.status}`)
    if (job.status === 'succeeded') {
      completedJob = job
      break
    }
    if (job.status === 'failed') {
      throw new Error(`El job falló: ${JSON.stringify(job.error)}`)
    }
  }

  if (!completedJob) {
    throw new Error(`Timeout: el job no completó en ${(TIMEOUT_MS / 1000).toFixed(0)} s.`)
  }
  const totalJobDurationSec = ((Date.now() - startJobTime) / 1000).toFixed(2)

  console.log('\n[4/4] Descargando audio...')
  const wavPath = path.join(OUTPUT_DIR, `${jobId}.wav`)
  const dlRes = await fetch(`${API_BASE}/music/jobs/${encodeURIComponent(jobId)}/audio`, {
    headers: authHeaders,
  })
  if (!dlRes.ok) {
    throw new Error(`Error descargando audio: HTTP ${dlRes.status}`)
  }
  const buffer = Buffer.from(await dlRes.arrayBuffer())
  fs.writeFileSync(wavPath, buffer)
  const fileStats = fs.statSync(wavPath)

  const result = completedJob.result ?? {}
  const metadata = result.metadata ?? {}
  const ham = metadata.ham ?? null
  const compute = metadata.compute ?? null

  if (ham === null) {
    throw new Error('El pipeline no devolvió metadata.ham: HAM no se ejecutó.')
  }
  if (MASTER && metadata.mastering === undefined) {
    throw new Error('master=true pero el pipeline no devolvió metadata.mastering.')
  }

  console.log('\n' + '='.repeat(60))
  console.log('REPORTE')
  console.log('='.repeat(60))
  console.log(`Job:                 ${jobId}`)
  console.log(`Duración del job:    ${totalJobDurationSec} s`)
  console.log(`Motor / modo:        ${result.engine ?? 'n/a'} / ${result.mode ?? 'n/a'}`)
  console.log(`Duración del audio:  ${result.duration_s ?? 'n/a'} s`)
  console.log(`Audio en disco:      ${wavPath} (${(fileStats.size / 1024).toFixed(1)} KB)`)
  console.log(`HAM key / BPM:       ${ham.detected_key ?? 'n/a'} / ${ham.detected_bpm ?? 'n/a'}`)
  if (metadata.mastering) {
    console.log(`LUFS masterizado:    ${metadata.mastering.output_lufs ?? 'n/a'}`)
  }
  if (compute) {
    console.log(`GPU / VRAM pico:     ${compute.gpu_seconds ?? 'n/a'} s / ${compute.peak_vram_bytes ?? 'n/a'} bytes`)
  }
  console.log('='.repeat(60))
  console.log('E2E COMPLETADO\n')
}

run().catch(err => {
  console.error('\nERROR EN VERIFICACIÓN E2E:', err)
  process.exit(1)
})
