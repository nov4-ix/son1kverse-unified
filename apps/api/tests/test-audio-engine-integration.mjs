// ─── Test de Integración: Node.js ↔ Audio Engine Python ───────────────────────

import { AudioEngineClient } from '../dist/services/AudioEngineClient.js'

async function run() {
  console.log('⬡ Probando conexión con Audio Engine Python...')
  const client = new AudioEngineClient('http://127.0.0.1:8001')

  const healthy = await client.isHealthy()
  console.log(`  Audio Engine online: ${healthy ? '✅ Sí' : '⚠️ No (el servidor Python no está corriendo en :8001)'}`)

  if (healthy) {
    console.log('  Encolando generación de prueba...')
    const job = await client.generate({
      genre:            'latin pop',
      mood:             'romantic',
      language:         'spanish',
      duration_seconds: 15,
      skip_mastering:   false,
      skip_analysis:    false,
    })
    console.log(`  ✓ Track encolado: ${job.track_id} (Status: ${job.status})`)
    console.log(`  ✓ URL de descarga: ${client.getDownloadUrl(job.track_id)}`)

    const status = await client.getStatus(job.track_id)
    console.log(`  ✓ Estado inicial verificado: ${status.status}`)
  } else {
    console.log('  ℹ️  Para probar en vivo, inicia el audio engine con:')
    console.log('      cd audio_engine && .\\venv\\Scripts\\python.exe -m uvicorn main:app --port 8001')
  }

  console.log('🎉 Test de cliente AudioEngine completado.')
}

run().catch(err => {
  console.error('❌ Error en test de integración:', err)
  process.exit(1)
})
