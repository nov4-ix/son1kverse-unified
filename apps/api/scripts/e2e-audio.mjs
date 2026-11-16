// ─── SON1KVERSE — scripts/e2e-audio.mjs ─────────────────────────────────────────
// Script de Verificación End-to-End para el flujo de Audio de PIXEL.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.resolve(__dirname, '..', 'output', 'e2e')

const API_BASE = 'http://127.0.0.1:3000/api/v1'

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Auth ──────────────────────────────────────────────────────────────────────
// /api/v1/audio/* exige Bearer JWT. Registramos (o logueamos) un usuario de
// prueba y usamos el token en TODAS las llamadas siguientes.
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
    // Ya registrado en una corrida anterior → login
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
  console.log(`  ✓ JWT obtenido para ${body.data.user.alias}`)
  return body.data.token
}

async function run() {
  console.log('=' .repeat(60))
  console.log('🧪 INICIANDO VERIFICACIÓN E2E DE AUDIO (FASE A)')
  console.log('=' .repeat(60))

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  console.log('\n[0/4] Autenticando...')
  const token = await getToken()
  const authHeaders = { Authorization: `Bearer ${token}` }

  // 1. Verificar salud del endpoint de audio
  console.log('\n[1/4] Verificando salud del motor de audio vía Node.js...')
  const healthRes = await fetch(`${API_BASE}/audio/health`, { headers: authHeaders })
  if (!healthRes.ok) {
    throw new Error(`Health check falló con status HTTP ${healthRes.status}`)
  }
  const healthData = await healthRes.json()
  console.log('  ✓ Audio Engine status:', healthData.data)

  // 2. Disparar generación de 15 segundos
  console.log('\n[2/4] Enviando solicitud POST /api/v1/audio/generate (15 segundos)...')
  const generatePayload = {
    genre:            'electronic',
    mood:             'energetic',
    language:         'spanish',
    duration_seconds: 15,
    bpm:              128,
    skip_mastering:   false,
    skip_analysis:    false,
  }

  const startJobTime = Date.now()
  const genRes = await fetch(`${API_BASE}/audio/generate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body:    JSON.stringify(generatePayload),
  })

  if (!genRes.ok) {
    const errorText = await genRes.text()
    throw new Error(`Error HTTP ${genRes.status} al encolar audio: ${errorText}`)
  }

  const genData = await genRes.json()
  const trackId = genData.data.track_id
  const downloadUrl = genData.data.download_url
  console.log(`  ✓ Job encolado exitosamente. Track ID: ${trackId}`)
  console.log(`  ✓ Download URL esperada: ${downloadUrl}`)

  // 3. Polling a /status/:trackId cada 3 segundos
  // (45 min: en CPU sin GPU, HeartMuLa-3B tarda ~20-25 min por pista de 15s)
  console.log('\n[3/4] Haciendo polling de estado cada 3s (timeout 45 min)...')
  const timeoutMs = 45 * 60 * 1000
  let completedJob = null

  while (Date.now() - startJobTime < timeoutMs) {
    await sleep(3000)
    const elapsedSec = ((Date.now() - startJobTime) / 1000).toFixed(1)

    try {
      const statusRes = await fetch(`${API_BASE}/audio/status/${encodeURIComponent(trackId)}`, {
        headers: authHeaders,
      })
      if (!statusRes.ok) {
        console.warn(`  [${elapsedSec}s] HTTP ${statusRes.status} consultando status...`)
        continue
      }
      const statusJson = await statusRes.json()
      const job = statusJson.data
      console.log(`  [${elapsedSec}s] Estado: ${job.status}`)

      if (job.status === 'done') {
        completedJob = job
        break
      }
      if (job.status === 'error') {
        throw new Error(`El job de audio terminó con error: ${job.error}`)
      }
    } catch (pollErr) {
      if (pollErr.message.includes('terminó con error')) throw pollErr
      console.warn(`  [${elapsedSec}s] Error temporal de polling: ${pollErr.message}`)
    }
  }

  if (!completedJob) {
    throw new Error('Timeout: El job no completó en 45 minutos.')
  }

  const totalJobDurationSec = ((Date.now() - startJobTime) / 1000).toFixed(2)
  console.log(`\n  ✓ Job finalizado en estado "done" tras ${totalJobDurationSec}s`)

  // 4. Descargar el archivo WAV a output/e2e/
  console.log('\n[4/4] Descargando archivo WAV masterizado a output/e2e/...')
  const wavPath = path.join(OUTPUT_DIR, `${trackId}.wav`)
  // download_url viene relativa (/api/v1/audio/download/<id>): Node fetch
  // necesita URL absoluta, la resolvemos contra API_BASE.
  const absoluteDownloadUrl = new URL(downloadUrl, API_BASE)
  const dlRes = await fetch(absoluteDownloadUrl, { headers: authHeaders })
  if (!dlRes.ok) {
    throw new Error(`Error descargando audio desde ${downloadUrl}: HTTP ${dlRes.status}`)
  }

  const arrayBuffer = await dlRes.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  fs.writeFileSync(wavPath, buffer)
  const fileStats = fs.statSync(wavPath)
  console.log(`  ✓ Archivo guardado en: ${wavPath}`)
  console.log(`  ✓ Tamaño del WAV: ${(fileStats.size / 1024).toFixed(1)} KB`)

  // 5. Imprimir informe y métricas
  const result = completedJob.result || {}
  const metrics = result.metrics || {}
  const engineUsed = result.engine_used || 'desconocido'

  console.log('\n' + '=' .repeat(60))
  console.log('📊 REPORTE DE RESULTADOS REALES — FASE A')
  console.log('=' .repeat(60))
  console.log(`• Track ID:                 ${trackId}`)
  console.log(`• Duración real del job:    ${totalJobDurationSec} s (tiempo de procesamiento reportado: ${result.total_time_s || 'N/A'} s)`)
  console.log(`• Motor utilizado:          ${engineUsed === 'heartmula' ? 'HeartMuLa (Red Neuronal)' : 'Fallback Sintético Armónico'}`)
  console.log(`• Estado final del pipeline: ${completedJob.status}`)
  console.log(`• Path en disco:            ${wavPath} (${(fileStats.size / 1024).toFixed(1)} KB)`)
  console.log('\n📈 Métricas de Audio DSP:')
  console.log(`  - LUFS Integrado:          ${metrics.lufs !== undefined ? `${metrics.lufs} LUFS` : 'N/A'}`)
  console.log(`  - True Peak:               ${metrics.true_peak_db !== undefined ? `${metrics.true_peak_db} dBTP` : 'N/A'}`)
  console.log(`  - Centroide Espectral:     ${metrics.spectral_centroid_hz !== undefined ? `${metrics.spectral_centroid_hz} Hz` : 'N/A'}`)
  console.log(`  - Rango Dinámico (DR):     ${metrics.dynamic_range_db !== undefined ? `${metrics.dynamic_range_db} dB` : 'N/A'}`)
  console.log(`  - Score de Calidad:        ${metrics.quality_score !== undefined ? `${metrics.quality_score}/100` : 'N/A'}`)
  console.log(`  - Production Ready:        ${metrics.production_ready ? '✅ Sí' : '❌ No'}`)
  console.log('=' .repeat(60))
  console.log('🎉 FASE A VERIFICADA CON ÉXITO\n')
}

run().catch(err => {
  console.error('\n❌ ERROR EN VERIFICACIÓN E2E:', err)
  process.exit(1)
})
