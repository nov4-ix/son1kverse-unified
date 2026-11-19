#!/usr/bin/env bash
# Launch the Music Lab in ACE-Step 1.5 mode on Google Colab with a public
# Cloudflare quick tunnel (no Cloudflare account or token required).
#
# Usage (from anywhere):
#   bash services/music-lab/scripts/colab_run.sh
#
# Optional environment variables:
#   PYTHON=python3                  Python interpreter/pip target
#   ACE_STEP_MODEL_PATH=...         Checkpoint dir (default: /content/ace-step-models)
#   ACE_STEP_DEVICE=cuda            cuda | cpu | auto
#   ACE_STEP_USE_LM=false           true also loads the 5Hz LM (heavier)
#   ACE_STEP_OFFLOAD=true           CPU offload for 16 GB cards (T4)
#   ACE_STEP_DTYPE=bfloat16         bfloat16 | float16 | float32
#   MUSIC_LAB_OUTPUT_DIR=...        Generated audio dir (default: <repo>/outputs)
#   MUSIC_LAB_API_KEY=...           Enables x-api-key auth on /v1/*
#   PORT=8002                       Local HTTP port
#   CLOUDFLARED_BIN=/tmp/cloudflared
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-python3}"
PORT="${PORT:-8002}"
LOG_DIR="${MUSIC_LAB_LOG_DIR:-$ROOT/outputs/colab-logs}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-/tmp/cloudflared}"

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "[music-lab] No se encontró nvidia-smi: este script requiere una GPU (T4 o superior)." >&2
  echo "[music-lab] Para CPU usa MUSIC_LAB_MODE=simulation y 'make lab-dev'." >&2
  exit 1
fi
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true

if [[ -d /content ]]; then
  DEFAULT_MODELS="/content/ace-step-models"
else
  DEFAULT_MODELS="$ROOT/models/ace-step"
fi

export MUSIC_LAB_MODE="ace-step"
export MUSIC_LAB_OUTPUT_DIR="${MUSIC_LAB_OUTPUT_DIR:-$ROOT/outputs}"
export MUSIC_LAB_API_KEY="${MUSIC_LAB_API_KEY:-}"
export ACE_STEP_MODEL_PATH="${ACE_STEP_MODEL_PATH:-$DEFAULT_MODELS}"
export ACE_STEP_DEVICE="${ACE_STEP_DEVICE:-cuda}"
export ACE_STEP_DTYPE="${ACE_STEP_DTYPE:-bfloat16}"
export ACE_STEP_OFFLOAD="${ACE_STEP_OFFLOAD:-true}"
export ACE_STEP_USE_LM="${ACE_STEP_USE_LM:-false}"
export ACE_STEP_CONFIG_PATH="${ACE_STEP_CONFIG_PATH:-acestep-v15-turbo}"
export ACE_STEP_AUTO_DOWNLOAD="${ACE_STEP_AUTO_DOWNLOAD:-true}"

mkdir -p "$LOG_DIR" "$ACE_STEP_MODEL_PATH"

echo "[music-lab] Installing CPU requirements..."
"$PYTHON" -m pip install --upgrade pip
"$PYTHON" -m pip install -r requirements.txt

echo "[music-lab] Installing GPU requirements (torch CUDA, ACE-Step runtime)..."
"$PYTHON" -m pip install -r requirements-gpu.txt

# Upstream pins its own torch wheel and vendors nano-vllm outside PyPI, so the
# official package must be installed without dependency resolution. The real
# runtime dependencies were installed by requirements-gpu.txt.
echo "[music-lab] Installing official ACE-Step 1.5 package (--no-deps)..."
"$PYTHON" -m pip install --no-deps -r requirements-ace-step.txt

"$PYTHON" - <<'PY'
from acestep.handler import AceStepHandler
from acestep.inference import GenerationConfig, GenerationParams, generate_music

assert AceStepHandler and GenerationParams and GenerationConfig and generate_music
print("[music-lab] acestep imports verified")
PY

if [[ ! -x "$CLOUDFLARED_BIN" ]]; then
  case "$(uname -m)" in
    x86_64 | amd64) CLOUDFLARED_ARCH="amd64" ;;
    aarch64 | arm64) CLOUDFLARED_ARCH="arm64" ;;
    *)
      echo "[music-lab] Unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
  echo "[music-lab] Downloading cloudflared-linux-${CLOUDFLARED_ARCH}..."
  curl -fsSL \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CLOUDFLARED_ARCH}" \
    -o "$CLOUDFLARED_BIN"
  chmod +x "$CLOUDFLARED_BIN"
fi

UVICORN_LOG="$LOG_DIR/uvicorn.log"
TUNNEL_LOG="$LOG_DIR/cloudflared.log"
rm -f "$UVICORN_LOG" "$TUNNEL_LOG"

cleanup() {
  echo
  echo "[music-lab] Shutting down..."
  kill "${TUNNEL_PID:-}" "${UVICORN_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[music-lab] Starting uvicorn in MUSIC_LAB_MODE=$MUSIC_LAB_MODE on :$PORT..."
(
  export MUSIC_LAB_MODE MUSIC_LAB_OUTPUT_DIR MUSIC_LAB_API_KEY
  export ACE_STEP_MODEL_PATH ACE_STEP_DEVICE ACE_STEP_DTYPE ACE_STEP_OFFLOAD
  export ACE_STEP_USE_LM ACE_STEP_CONFIG_PATH ACE_STEP_AUTO_DOWNLOAD
  exec "$PYTHON" -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
) >"$UVICORN_LOG" 2>&1 &
UVICORN_PID=$!

for _ in $(seq 1 90); do
  if ! kill -0 "$UVICORN_PID" 2>/dev/null; then
    echo "[music-lab] uvicorn exited early:" >&2
    tail -n 60 "$UVICORN_LOG" >&2
    exit 1
  fi
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "[music-lab] uvicorn did not become healthy in time:" >&2
  tail -n 60 "$UVICORN_LOG" >&2
  exit 1
fi

echo "[music-lab] Starting Cloudflare quick tunnel..."
"$CLOUDFLARED_BIN" tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" \
  >"$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

PUBLIC_URL=""
for _ in $(seq 1 60); do
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "[music-lab] cloudflared exited early:" >&2
    tail -n 60 "$TUNNEL_LOG" >&2
    exit 1
  fi
  PUBLIC_URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -n 1 || true)"
  if [[ -n "$PUBLIC_URL" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$PUBLIC_URL" ]]; then
  echo "[music-lab] Could not read the public URL from cloudflared:" >&2
  tail -n 60 "$TUNNEL_LOG" >&2
  exit 1
fi

cat <<EOF

============================================================
 Music Lab is live (ACE-Step 1.5)
 Public URL: ${PUBLIC_URL}
 Health:     ${PUBLIC_URL}/health
 Docs:       ${PUBLIC_URL}/docs
 Logs:       ${LOG_DIR}
============================================================

Generate:
  curl -X POST "${PUBLIC_URL}/v1/generate" \\
    -H 'Content-Type: application/json' \\
    -d '{"prompt":"dark reggaeton with 808 bass","lyrics":"[verse]\n...","duration_s":30,"bpm":92,"key":"Am","seed":42,"style_tags":["reggaeton","dark"]}'

Poll:
  curl "${PUBLIC_URL}/v1/jobs/<job_id>"
  curl -o out.wav "${PUBLIC_URL}/v1/jobs/<job_id>/audio"

The first generation downloads ~8 GB of ACE-Step checkpoints from
https://huggingface.co/ACE-Step/Ace-Step1.5 into ${ACE_STEP_MODEL_PATH}.
Keep this terminal open while the tunnel is in use (Ctrl+C to stop).
EOF

while kill -0 "$UVICORN_PID" 2>/dev/null && kill -0 "$TUNNEL_PID" 2>/dev/null; do
  wait -n || true
done
