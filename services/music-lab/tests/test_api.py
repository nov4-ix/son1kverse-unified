"""HTTP contract tests for the Music Lab API."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
import soundfile as sf

from app.audio import read_audio
from app.config import Settings
from tests.helpers import make_client, run, submit_and_wait


def settings(tmp_path: Path, **overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "music_lab_output_dir": tmp_path,
        "music_lab_mode": "simulation",
        "music_lab_api_key": None,
        "music_lab_max_concurrency": 1,
        "sim_latency_ms": 0,
    }
    values.update(overrides)
    return Settings(**values)


def test_health_and_capabilities(tmp_path: Path) -> None:
    async def scenario() -> None:
        async with make_client(settings(tmp_path)) as (_, client):
            health = await client.get("/health")
            assert health.status_code == 200
            body = health.json()
            assert body["status"] == "ok"
            assert body["engine"]["engine"] == "simulation"

            capabilities = await client.get("/v1/capabilities")
            assert capabilities.status_code == 200
            data = capabilities.json()
            assert data["active_engine"] == "simulation"
            assert set(data["methods"]) == {"generate", "repaint", "cover", "stems"}
            assert data["max_concurrency"] == 1

    run(scenario())


def test_generate_job_and_download(tmp_path: Path) -> None:
    async def scenario() -> None:
        async with make_client(settings(tmp_path)) as (_, client):
            job = await submit_and_wait(
                client,
                "/v1/generate",
                {"prompt": "test", "duration_s": 1.0, "seed": 7, "bpm": 128, "key": "Am"},
            )
            assert job["status"] == "succeeded"
            result = job["result"]
            assert result["mode"] == "simulation"
            assert Path(result["audio_path"]).is_file()
            audio, sample_rate = read_audio(Path(result["audio_path"]))
            assert sample_rate == 44100
            assert audio.shape[1] == pytest.approx(44100, abs=2)

            download = await client.get(f"/v1/jobs/{job['job_id']}/audio")
            assert download.status_code == 200
            assert download.headers["content-type"] == "audio/wav"
            assert download.content[:4] == b"RIFF"

    run(scenario())


def test_api_key_is_enforced(tmp_path: Path) -> None:
    async def scenario() -> None:
        async with make_client(settings(tmp_path, music_lab_api_key="secret")) as (_, client):
            assert (await client.get("/health")).status_code == 200
            unauthorized = await client.post("/v1/generate", json={"prompt": "x"})
            assert unauthorized.status_code == 401
            assert unauthorized.json()["code"] == "UNAUTHORIZED"

            headers = {"x-api-key": "secret"}
            job = await submit_and_wait(
                client, "/v1/generate", {"prompt": "x", "duration_s": 0.5}, headers=headers
            )
            assert job["status"] == "succeeded"
            missing = await client.get(f"/v1/jobs/{job['job_id']}")
            assert missing.status_code == 401

    run(scenario())


def test_stems_requires_stem_query(tmp_path: Path) -> None:
    async def scenario() -> None:
        async with make_client(settings(tmp_path)) as (_, client):
            job = await submit_and_wait(
                client, "/v1/stems", {"prompt": "x", "duration_s": 0.5, "seed": 2}
            )
            assert job["status"] == "succeeded"
            stems = job["result"]["stems"]
            assert set(stems) == {"drums", "bass", "other"}

            no_stem = await client.get(f"/v1/jobs/{job['job_id']}/audio")
            assert no_stem.status_code == 409
            assert no_stem.json()["code"] == "AUDIO_NOT_READY"

            drums = await client.get(f"/v1/jobs/{job['job_id']}/audio?stem=drums")
            assert drums.status_code == 200
            assert drums.content[:4] == b"RIFF"

    run(scenario())


def test_mastering_is_applied(tmp_path: Path) -> None:
    async def scenario() -> None:
        async with make_client(settings(tmp_path)) as (_, client):
            job = await submit_and_wait(
                client,
                "/v1/generate",
                {"prompt": "x", "duration_s": 1.0, "master": True},
            )
            assert job["status"] == "succeeded"
            result = job["result"]
            assert "-mastered" in result["audio_path"]
            assert abs(result["metadata"]["mastering"]["output_lufs"] + 14.0) < 0.5
            _, sample_rate = sf.read(result["audio_path"])
            assert sample_rate == 44100

    run(scenario())


def test_auto_mode_without_gpu_fails_cleanly(tmp_path: Path) -> None:
    async def scenario() -> None:
        config = settings(tmp_path, music_lab_mode="auto")
        async with make_client(config) as (_, client):
            health = (await client.get("/health")).json()
            assert health["status"] == "degraded"
            assert health["engine"] is None
            assert "ace-step" in health["reason"]

            job = await submit_and_wait(
                client, "/v1/generate", {"prompt": "x", "duration_s": 0.5}
            )
            assert job["status"] == "failed"
            assert job["error"]["code"] == "ENGINE_UNAVAILABLE"

    run(scenario())


def test_unsupported_operation_fails_in_job(tmp_path: Path) -> None:
    async def scenario() -> None:
        async with make_client(settings(tmp_path)) as (_, client):
            job = await submit_and_wait(
                client,
                "/v1/stems",
                {"prompt": "x", "duration_s": 0.5, "engine": "heartmula"},
            )
            assert job["status"] == "failed"
            assert job["error"]["code"] == "NOT_SUPPORTED"

    run(scenario())


def test_validation_and_unknown_job_are_uniform(tmp_path: Path) -> None:
    async def scenario() -> None:
        async with make_client(settings(tmp_path)) as (_, client):
            invalid = await client.post("/v1/generate", json={"prompt": "x", "duration_s": 0})
            assert invalid.status_code == 422
            assert invalid.json()["code"] == "INVALID_REQUEST"

            missing = await client.get("/v1/jobs/does-not-exist")
            assert missing.status_code == 404
            assert missing.json()["code"] == "JOB_NOT_FOUND"

    run(scenario())


def test_mp3_when_libsndfile_supports_it(tmp_path: Path) -> None:
    async def scenario() -> None:
        if "MP3" not in sf.available_formats():
            pytest.skip("libsndfile build has no MP3 support")
        async with make_client(settings(tmp_path)) as (_, client):
            job = await submit_and_wait(
                client,
                "/v1/generate",
                {"prompt": "x", "duration_s": 0.5, "output_format": "mp3"},
            )
            assert job["status"] == "succeeded"
            download = await client.get(f"/v1/jobs/{job['job_id']}/audio")
            assert download.status_code == 200
            assert download.headers["content-type"] == "audio/mpeg"

    run(scenario())


def test_job_ttl_cleanup_removes_job_and_audio(tmp_path: Path) -> None:
    async def scenario() -> None:
        config = settings(
            tmp_path,
            music_lab_job_ttl_hours=0.0001,
            music_lab_job_cleanup_interval_s=3600.0,
        )
        async with make_client(config) as (app, client):
            job = await submit_and_wait(
                client, "/v1/generate", {"prompt": "ttl", "duration_s": 0.5}
            )
            audio_path = Path(job["result"]["audio_path"])
            assert audio_path.is_file()
            await asyncio.sleep(0.5)

            removed = await app.state.manager.cleanup()
            assert removed == 1
            assert (await client.get(f"/v1/jobs/{job['job_id']}")).status_code == 404
            assert not audio_path.exists()

    run(scenario())


def test_job_cap_evicts_oldest_terminal_job(tmp_path: Path) -> None:
    async def scenario() -> None:
        config = settings(
            tmp_path,
            music_lab_max_jobs=1,
            music_lab_job_cleanup_interval_s=3600.0,
        )
        async with make_client(config) as (app, client):
            first = await submit_and_wait(
                client, "/v1/generate", {"prompt": "first", "duration_s": 0.5}
            )
            second = await submit_and_wait(
                client, "/v1/generate", {"prompt": "second", "duration_s": 0.5}
            )

            removed = await app.state.manager.cleanup()
            assert removed == 1
            assert (
                await client.get(f"/v1/jobs/{first['job_id']}")
            ).status_code == 404
            assert (
                await client.get(f"/v1/jobs/{second['job_id']}")
            ).status_code == 200

    run(scenario())
