"""Archivado en R2 desde Music Lab: subida, clave, degradación y no fallar el job."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.config import Settings
from app.storage import R2Uploader, uploader_from_settings
from tests.helpers import make_client, run, submit_and_wait


class FakeS3:
    def __init__(self, fail: bool = False) -> None:
        self.calls: list[dict[str, Any]] = []
        self.fail = fail

    def put_object(self, **kwargs: Any) -> None:
        if self.fail:
            raise ConnectionError("R2 caído")
        body = kwargs["Body"].read()
        self.calls.append({**kwargs, "Body": body})


def _settings(tmp_path: Path, **overrides: Any) -> Settings:
    base: dict[str, Any] = {
        "_env_file": None,
        "music_lab_mode": "simulation",
        "music_lab_output_dir": tmp_path,
        "sim_latency_ms": 0,
    }
    base.update(overrides)
    return Settings(**base)


def test_upload_builds_key_and_content_type(tmp_path: Path) -> None:
    audio = tmp_path / "x.wav"
    audio.write_bytes(b"RIFFdata")
    fake = FakeS3()
    info = R2Uploader(fake, "son1k-audio", "/generations/").upload(audio, "job 1/../x")
    assert info["status"] == "uploaded" and info["bucket"] == "son1k-audio"
    assert info["key"] == "generations/job_1____x.wav"
    assert info["size_bytes"] == 8 and info["content_type"] == "audio/wav"
    assert fake.calls[0]["ContentType"] == "audio/wav" and fake.calls[0]["Body"] == b"RIFFdata"


def test_mp3_and_unknown_suffix(tmp_path: Path) -> None:
    uploader = R2Uploader(FakeS3(), "b")
    assert uploader.key_for("j", ".MP3") == "generations/j.mp3"
    assert uploader.key_for("j", ".exe") == "generations/j.wav"


def test_uploader_none_without_full_config() -> None:
    assert uploader_from_settings(_settings(Path("."))) is None
    partial = _settings(Path("."), r2_account_id="a", r2_access_key_id="k", r2_secret_access_key="s")
    assert partial.r2_bucket is None and uploader_from_settings(partial) is None


def test_job_gets_storage_metadata(tmp_path: Path) -> None:
    async def scenario() -> None:
        async with make_client(_settings(tmp_path)) as (app, client):
            fake = FakeS3()
            app.state.manager._uploader = R2Uploader(fake, "son1k-audio")
            job = await submit_and_wait(client, "/v1/generate", {"prompt": "x", "duration_s": 0.5})
            assert job["status"] == "succeeded"
            storage = job["result"]["metadata"]["storage"]
            assert storage["status"] == "uploaded" and storage["key"] == f"generations/{job['job_id']}.wav"
            assert len(fake.calls) == 1 and fake.calls[0]["Key"] == storage["key"]

    run(scenario())


def test_failed_upload_does_not_fail_job(tmp_path: Path) -> None:
    async def scenario() -> None:
        async with make_client(_settings(tmp_path)) as (app, client):
            app.state.manager._uploader = R2Uploader(FakeS3(fail=True), "son1k-audio")
            job = await submit_and_wait(client, "/v1/generate", {"prompt": "x", "duration_s": 0.5})
            assert job["status"] == "succeeded"
            assert job["result"]["metadata"]["storage"] == {
                "backend": "r2", "status": "failed", "error": "ConnectionError",
            }
            audio = await client.get(f"/v1/jobs/{job['job_id']}/audio")
            assert audio.status_code == 200  # el audio local sigue disponible

    run(scenario())


def test_no_storage_block_when_r2_not_configured(tmp_path: Path) -> None:
    async def scenario() -> None:
        async with make_client(_settings(tmp_path)) as (_, client):
            job = await submit_and_wait(client, "/v1/generate", {"prompt": "x", "duration_s": 0.5})
            assert job["status"] == "succeeded"
            assert "storage" not in job["result"]["metadata"]

    run(scenario())
