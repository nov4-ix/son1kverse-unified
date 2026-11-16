#!/bin/bash
# ─── SON1KVERSE — Script de despliegue rápido en GPU en la nube ───
# Uso: ./deploy-gpu.sh [runpod|lambda|vast|local]
#
# Requisitos previos:
#   - Docker instalado con soporte NVIDIA (nvidia-docker2)
#   - Acceso SSH a la instancia GPU
#   - Claves SSH configuradas

set -e

PROVIDER=${1:-local}
INSTANCE_IP=${2:-}
SSH_USER=${3:-root}
SSH_KEY=${4:-~/.ssh/id_rsa}

echo "=============================================="
echo "  SON1KVERSE — Despliegue Audio Engine GPU"
echo "=============================================="
echo ""

if [ -z "$INSTANCE_IP" ]; then
  echo "❌ Error: Debes especificar la IP de la instancia"
  echo "   Uso: $0 runpod <IP_DE_TU_INSTANCIA>"
  echo ""
  echo "Ejemplos:"
  echo "   $0 runpod 123.45.67.89"
  echo "   $0 lambda 10.20.30.40 ubuntu"
  exit 1
fi

echo "📦 Paso 1: Construyendo imagen Docker..."
docker build -f son1kverse/Dockerfile.audio-engine -t son1kverse-audio-engine .

echo ""
echo "🚀 Paso 2: Subiendo código a la instancia..."
rsync -avz -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
  --exclude='node_modules' --exclude='.git' --exclude='dist' \
  --exclude='__pycache__' --exclude='venv' \
  C:/dev/son1kverse/ $SSH_USER@$INSTANCE_IP:/home/$SSH_USER/son1kverse/

echo ""
echo "🔧 Paso 3: Desplegando en la instancia GPU..."
ssh -i $SSH_KEY -o StrictHostKeyChecking=no $SSH_USER@$INSTANCE_IP << EOF
  cd /home/$SSH_USER/son1kverse
  
  # Detener contenedor anterior si existe
  docker-compose -f son1kverse/docker-compose.audio-engine.yml down 2>/dev/null || true
  
  # Construir y levantar
  docker-compose -f son1kverse/docker-compose.audio-engine.yml up --build -d
  
  echo ""
  echo "⏳ Esperando a que el engine esté listo (puede tardar 5-10 min en cargar el modelo)..."
  for i in \$(seq 1 60); do
    if curl -sf http://localhost:8001/health > /dev/null 2>&1; then
      echo "✅ Engine está listo!"
      curl -s http://localhost:8001/health | python3 -m json.tool 2>/dev/null || true
      break
    fi
    echo "   Esperando... (\$i/60)"
    sleep 10
  done
EOF

echo ""
echo "=============================================="
echo "  ✅ DESPLIEGUE COMPLETADO"
echo "=============================================="
echo ""
echo "🔗 URLs importantes:"
echo "   Engine Health:  http://$INSTANCE_IP:8001/health"
echo "   Engine Docs:    http://$INSTANCE_IP:8001/docs"
echo ""
echo "📝 Próximos pasos:"
echo "   1. Actualiza .env del frontend:"
echo "      VITE_BACKEND_URL=http://localhost:3000"
echo "      (el backend Node se comunica con el engine en la nube)"
echo ""
echo "   2. O si despliegas TODO en la nube, actualiza:"
echo "      VITE_BACKEND_URL=http://$INSTANCE_IP:3000"
echo ""
echo "   3. Lanza el frontend:"
echo "      cd apps/the-generator && npm run dev"
echo ""
echo "   4. Prueba en: http://localhost:3004"
echo ""
