"""Archivado del audio final en Cloudflare R2 (S3-compatible).

El worker de GPU puede apagarse (serverless) justo después de terminar un job, y su disco
es efímero: si el audio solo existe ahí, se pierde. Por eso Music Lab lo sube a R2 por sí
mismo ANTES de marcar el job como terminado. Una subida fallida no hace fallar el job: el
audio sigue en disco y la API conserva su camino de respaldo (descargarlo y archivarlo).
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

from app.config import Settings

logger = logging.getLogger(__name__)

_CONTENT_TYPES = {".wav": "audio/wav", ".mp3": "audio/mpeg"}


class R2Uploader:
    def __init__(self, client: Any, bucket: str, key_prefix: str = "generations") -> None:
        self._client = client
        self.bucket = bucket
        self._prefix = key_prefix.strip("/") or "generations"

    def key_for(self, job_id: str, suffix: str) -> str:
        safe_job = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in job_id)
        ext = suffix.lower() if suffix.lower() in _CONTENT_TYPES else ".wav"
        return f"{self._prefix}/{safe_job}{ext}"

    def upload(self, path: Path, job_id: str) -> dict[str, Any]:
        """Sube el archivo. Devuelve el bloque `storage` para el metadata del job."""
        started = time.perf_counter()
        key = self.key_for(job_id, path.suffix)
        content_type = _CONTENT_TYPES.get(path.suffix.lower(), "audio/wav")
        size = path.stat().st_size
        with path.open("rb") as handle:
            self._client.put_object(Bucket=self.bucket, Key=key, Body=handle, ContentType=content_type)
        return {
            "backend": "r2",
            "status": "uploaded",
            "bucket": self.bucket,
            "key": key,
            "size_bytes": size,
            "content_type": content_type,
            "upload_seconds": round(time.perf_counter() - started, 3),
        }


def uploader_from_settings(settings: Settings) -> R2Uploader | None:
    """None si R2 no está configurado por completo (el audio solo queda en disco)."""
    needed = (settings.r2_account_id, settings.r2_access_key_id, settings.r2_secret_access_key, settings.r2_bucket)
    if not all((value or "").strip() for value in needed):
        return None
    import boto3  # import perezoso: solo se necesita si R2 está configurado
    from botocore.config import Config

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, retries={"max_attempts": 3}),
    )
    return R2Uploader(client, str(settings.r2_bucket), settings.r2_key_prefix)
