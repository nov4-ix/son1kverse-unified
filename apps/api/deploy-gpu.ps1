# ─── SON1KVERSE — Script de despliegue rápido en GPU (PowerShell) ───
# Uso: .\deploy-gpu.ps1 <IP_DE_TU_INSTANCIA> [USUARIO_SSH] [RUTA_SSH_KEY]
#
# Requisitos:
#   - Docker Desktop con WSL2 y soporte NVIDIA
#   - Acceso SSH a la instancia GPU
#   - Clave SSH configurada

param(
    [Parameter(Mandatory=$true)]
    [string]$InstanceIp,
    [string]$SshUser = 'root',
    [string]$SshKey = "$env:USERPROFILE\.ssh\id_rsa",
    [string]$ProjectRoot = 'C:\dev\son1kverse'
)

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  SON1KVERSE — Despliegue Audio Engine GPU" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# Verificar que Docker esté disponible
Write-Host "📦 Paso 1: Verificando Docker..."
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Docker no está instalado. Instala Docker Desktop con soporte WSL2." -ForegroundColor Red
    exit 1
}
Write-Host "   Docker encontrado" -ForegroundColor Green

# Construir imagen
Write-Host ""
Write-Host "📦 Paso 2: Construyendo imagen Docker..."
docker build -f "$ProjectRoot\Dockerfile.audio-engine" -t son1kverse-audio-engine "$ProjectRoot"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error construyendo la imagen" -ForegroundColor Red
    exit 1
}
Write-Host "   Imagen construida" -ForegroundColor Green

# Subir código
Write-Host ""
Write-Host "🚀 Paso 3: Subiendo código a la instancia ($InstanceIp)..."
$rsyncCmd = "rsync -avz -e 'ssh -i $SshKey -o StrictHostKeyChecking=no' --exclude='node_modules' --exclude='.git' --exclude='dist' --exclude='__pycache__' --exclude='venv' '$ProjectRoot/' $SshUser@$InstanceIp:/home/$SshUser/son1kverse/"
Write-Host "   Ejecutando: $rsyncCmd"
& $rsyncCmd
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error subiendo código" -ForegroundColor Red
    exit 1
}
Write-Host "   Código subido" -ForegroundColor Green

# Desplegar en la instancia
Write-Host ""
Write-Host "🔧 Paso 4: Desplegando en la instancia GPU..."
$deployScript = @"
cd /home/$SshUser/son1kverse
docker-compose -f son1kverse/docker-compose.audio-engine.yml down 2>/dev/null || true
docker-compose -f son1kverse/docker-compose.audio-engine.yml up --build -d
"@

ssh -i $SshKey -o StrictHostKeyChecking=no $SshUser@$InstanceIp $deployScript
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error desplegando" -ForegroundColor Red
    exit 1
}

# Esperar a que el engine esté listo
Write-Host ""
Write-Host "⏳ Esperando a que el engine esté listo (puede tardar 5-10 min)..."
for ($i = 1; $i -le 60; $i++) {
    try {
        $resp = Invoke-WebRequest "http://$InstanceIp:8001/health" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            Write-Host "✅ Engine está listo!" -ForegroundColor Green
            break
        }
    } catch {
        Write-Host "   Esperando... ($i/60)" -ForegroundColor Yellow
        Start-Sleep -Seconds 10
    }
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  ✅ DESPLIEGUE COMPLETADO" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "🔗 URLs importantes:" -ForegroundColor Yellow
Write-Host "   Engine Health:  http://$InstanceIp:8001/health"
Write-Host "   Engine Docs:    http://$InstanceIp:8001/docs"
Write-Host ""
Write-Host "📝 Próximos pasos:" -ForegroundColor Yellow
Write-Host "   1. Actualiza apps/the-generator/.env:"
Write-Host "      VITE_BACKEND_URL=http://localhost:3000"
Write-Host "      (el backend Node se comunica con el engine en la nube)"
Write-Host ""
Write-Host "   2. Lanza el frontend:"
Write-Host "      cd apps/the-generator && npm run dev"
Write-Host ""
Write-Host "   3. Prueba en: http://localhost:3004"
Write-Host ""
