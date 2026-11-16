# ─── SON1KVERSE — Guía de Despliegue en GPU en la nube (Fase 2) ───
#
# Objetivo: Desplegar el Audio Engine (HeartMuLa + HeartCodec) en una GPU
# en la nube para reducir el tiempo de generación de ~45 min (CPU) a ~2-5 min (GPU).
#
# Proveedores recomendados:
#   - RunPod (RTX 4090, ~$0.70/hora) — https://runpod.io
#   - Lambda Labs (A100/A6000, ~$1.10/hora) — https://lambdalabs.com
#   - Vast.ai (RTX 4090, ~$0.40/hora) — https://vast.ai
#   - Google Colab Pro (T4, ~$10/mes) — https://colab.research.google.com
#
# Tiempos estimados con GPU:
#   CPU local : ~45 min por fragmento de 15s (INVIABLE)
#   GPU RTX 4090: ~2-3 min por fragmento de 15s
#   Canción completa (3 min, ~12 fragmentos): ~30-40 min con GPU vs ~6-10 horas con CPU
#
# ============================================================================
# PASO 1: Elegir proveedor y crear instancia GPU
# ============================================================================
#
# Opción A — RunPod (recomendado, fácil):
#   1. Crear cuenta en https://runpod.io
#   2. Deploy → GPU Pod → RTX 4090 o A6000
#   3. Template: PyTorch 2.4 + CUDA 12.1
#   4. Puerto: 8001 (HTTP)
#   5. Volumen: 50+ GB para checkpoints + outputs
#
# Opción B — Lambda Labs:
#   1. Crear cuenta en https://lambdalabs.com
#   2. Launch Instance → GPU Cloud → A6000 o RTX 4090
#   3. Imagen: Ubuntu 22.04 + PyTorch
#
# Opción C — Vast.ai (más barato):
#   1. Crear cuenta en https://vast.ai
#   2. Buscar RTX 4090 con buen score de confiabilidad
#   3. Alquilar instancia
#
# ============================================================================
# PASO 2: Subir el código a la instancia
# ============================================================================
#
# En tu máquina local:
#   scp -r C:\dev\son1kverse\ usuario@ip-de-la-instancia:/home/usuario/son1kverse
#
# O usa git:
#   git clone https://github.com/tu-usuario/son1kverse.git
#   cd son1kverse
#
# ============================================================================
# PASO 3: Construir y ejecutar el contenedor
# ============================================================================
#
# En la instancia GPU:
#   cd /home/usuario/son1kverse
#
#   # Opción A: docker-compose (recomendado)
#   docker-compose -f son1kverse/docker-compose.audio-engine.yml up --build
#
#   # Opción B: docker run directo
#   docker build -f son1kverse/Dockerfile.audio-engine -t son1kverse-audio-engine .
#   docker run --gpus all \
#     -p 8001:8001 \
#     -e HEARTMULA_AUTO_DOWNLOAD=1 \
#     -e HEARTMULA_LAZY_LOAD=1 \
#     -v $(pwd)/son1kverse/audio_engine/ckpt:/app/ckpt \
#     -v $(pwd)/son1kverse/audio_engine/outputs:/app/outputs \
#     son1kverse-audio-engine
#
# El motor estará disponible en: http://IP_DE_LA_INSTANCIA:8001
# Health check: http://IP_DE_LA_INSTANCIA:8001/health
# Docs: http://IP_DE_LA_INSTANCIA:8001/docs
#
# Nota: El primer despliegue tarda 10-20 min en descargar checkpoints (~6 GB).
# Los siguientes arranques son instantáneos si montas el volumen de ckpt.
#
# ============================================================================
# PASO 4: Configurar el frontend para usar la nube
# ============================================================================
#
# Edita: apps/the-generator/.env
#
#   VITE_BACKEND_URL=http://IP_DE_LA_INSTANCIA:3000
#
# El backend Node (localhost:3000) se queda en tu máquina local y se comunica
# con el engine Python en la nube a través de AudioEngineClient.
#
# Si prefieres desplegar TODO en la nube (Node + Python), despliega también
# el backend Node y apunta el frontend a esa URL.
#
# ============================================================================
# PASO 5: Verificar que todo funcione
# ============================================================================
#
# 1. Health check del engine:
#      curl http://IP_DE_LA_INSTANCIA:8001/health
#      → {"status": "ok", "pixel_state": "IDLE", "model_loaded": true, ...}
#
# 2. Health check del backend:
#      curl http://localhost:3000/health
#
# 3. Lanzar el frontend:
#      cd apps/the-generator
#      npm run dev
#      → http://localhost:3004
#
# 4. Probar generación:
#      - Abre http://localhost:3004
#      - Escribe prompt musical
#      - Genera letras → aprueba → orquestar
#      - Espera el polling (con GPU: ~2-5 min por fragmento)
#      - Descarga el WAV final
#
# ============================================================================
# PASO 6: Optimizar costos (opcional)
# ============================================================================
#
#   - Detén la instancia cuando no estés generando (solo pagas cuando la usas)
#   - Guarda los checkpoints en un volumen persistente para no volver a descargarlos
#   - Usa spot instances en Vast.ai para reducir costos un 60-90%
#   - Para producción, considera una instancia reservada en Lambda Labs
#
# ============================================================================
# TIEMPOS ESTIMADOS CON GPU RTX 4090
# ============================================================================
#
#   Carga del modelo HeartMuLa-3B: ~2-4 min (primera vez)
#   Generación fragmento 15s:     ~2-3 min
#   Canción completa (3 min, ~12 fragmentos): ~30-40 min
#   Concatenación final:          ~10-30 seg
#   Descarga WAV:                 ~1-2 seg
#
#   TOTAL: ~35-50 min por canción completa (vs 6-10 horas en CPU)
#
# ============================================================================
