import asyncio
import threading
import time

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.providers.transcription import TranscriptionProvider
from app.schemas.v1 import (
    TranscriptionRequest,
    TranscriptionResult,
    TranscriptionSegment,
)


def make_client(
    settings: Settings | None = None,
    transcription_provider: TranscriptionProvider | None = None,
) -> TestClient:
    return TestClient(
        create_app(
            settings or Settings(),
            transcription_provider=transcription_provider,
        )
    )


def wait_for_task_status(
    client: TestClient, task_id: str, expected: str
) -> dict[str, object]:
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        response = client.get(f"/v1/tasks/{task_id}")
        assert response.status_code == 200
        task = response.json()["task"]
        if task["status"] == expected:
            return task
        time.sleep(0.01)
    raise AssertionError(f"Task {task_id} did not reach status {expected}")


class BlockingTranscriptionProvider(TranscriptionProvider):
    def __init__(self) -> None:
        self.release = threading.Event()
        self.calls: list[tuple[str, str]] = []

    async def transcribe(self, path: str, language: str) -> TranscriptionResult:
        self.calls.append((path, language))
        await asyncio.to_thread(self.release.wait)
        return TranscriptionResult(
            text="A completed test transcription.",
            language=language,
            segments=[
                TranscriptionSegment(
                    start=0.0,
                    end=1.0,
                    text="A completed test transcription.",
                )
            ],
        )


def test_transcription_language_defaults_to_auto() -> None:
    request = TranscriptionRequest(input={"type": "file", "path": r"C:\Media\demo.wav"})

    assert request.language == "auto"


def test_transcription_rejects_unsupported_input_type() -> None:
    with make_client() as client:
        response = client.post(
            "/v1/transcriptions",
            json={"input": {"type": "url", "path": "https://example.test/demo.wav"}},
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_create_transcription_returns_queued_task() -> None:
    with make_client() as client:
        response = client.post(
            "/v1/transcriptions",
            json={
                "input": {"type": "file", "path": r"C:\Media\demo.wav"},
                "language": "auto",
            },
        )

    assert response.status_code == 202
    task = response.json()["task"]
    assert task["id"].startswith("tsk_")
    assert task["type"] == "transcription"
    assert task["status"] == "queued"
    assert task["created_at"] == task["updated_at"]
    assert "result" not in task
    assert "error" not in task


def test_invalid_transcription_uses_v1_error_contract() -> None:
    with make_client() as client:
        response = client.post(
            "/v1/transcriptions",
            json={"input": {"type": "file", "path": ""}},
        )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "INVALID_REQUEST"
    assert body["error"]["message"] == "Request is invalid."
    assert body["error"]["details"][0]["loc"] == ["body", "input", "path"]


def test_unknown_task_returns_task_not_found() -> None:
    with make_client() as client:
        response = client.get("/v1/tasks/not-exists")

    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "TASK_NOT_FOUND",
            "message": "Task not found.",
            "details": None,
        }
    }


def test_task_moves_from_running_to_completed() -> None:
    provider = BlockingTranscriptionProvider()
    with make_client(transcription_provider=provider) as client:
        response = client.post(
            "/v1/transcriptions",
            json={
                "input": {"type": "file", "path": r"C:\Media\demo.wav"},
                "language": "zh",
            },
        )
        task_id = response.json()["task"]["id"]
        assert response.status_code == 202
        assert response.json()["task"]["status"] == "queued"

        running = wait_for_task_status(client, task_id, "running")
        assert running["result"] is None
        assert running["error"] is None
        assert provider.calls == [(r"C:\Media\demo.wav", "zh")]

        provider.release.set()
        completed = wait_for_task_status(client, task_id, "completed")

    assert completed["result"] == {
        "text": "A completed test transcription.",
        "language": "zh",
        "segments": [
            {
                "start": 0.0,
                "end": 1.0,
                "text": "A completed test transcription.",
            }
        ],
    }
    assert completed["error"] is None


def test_mock_task_completes_with_stable_result() -> None:
    settings = Settings(mock_transcription_delay=0.01)
    with make_client(settings) as client:
        response = client.post(
            "/v1/transcriptions",
            json={"input": {"type": "file", "path": "demo.wav"}},
        )
        task_id = response.json()["task"]["id"]
        completed = wait_for_task_status(client, task_id, "completed")

    assert completed["result"] == {
        "text": "This is a mock transcription.",
        "language": "en",
        "segments": [
            {
                "start": 0.0,
                "end": 2.0,
                "text": "This is a mock transcription.",
            }
        ],
    }
    assert completed["error"] is None


def test_mock_failure_moves_task_to_failed() -> None:
    settings = Settings(mock_transcription_delay=0.01, mock_transcription_fail=True)
    with make_client(settings) as client:
        response = client.post(
            "/v1/transcriptions",
            json={"input": {"type": "file", "path": "demo.wav"}},
        )
        task_id = response.json()["task"]["id"]
        failed = wait_for_task_status(client, task_id, "failed")

    assert failed["result"] is None
    assert failed["error"] == {
        "code": "TRANSCRIPTION_FAILED",
        "message": "Transcription failed.",
        "details": None,
    }


def test_translation_returns_stable_contract_stub() -> None:
    with make_client() as client:
        response = client.post(
            "/v1/translations",
            json={
                "text": "Hello world",
                "source_language": "en",
                "target_language": "zh",
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "translation": {
            "text": "[mock zh] Hello world",
            "source_language": "en",
            "target_language": "zh",
        }
    }


def test_invalid_translation_uses_v1_error_contract() -> None:
    with make_client() as client:
        response = client.post(
            "/v1/translations",
            json={
                "text": "",
                "source_language": "en",
                "target_language": "zh",
            },
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"
    assert response.json()["error"]["details"][0]["loc"] == ["body", "text"]


def test_openapi_exposes_v1_contract_without_runtime_fields() -> None:
    with make_client() as client:
        document = client.get("/openapi.json").json()

    assert set(document["paths"]) >= {
        "/v1/transcriptions",
        "/v1/tasks/{task_id}",
        "/v1/translations",
    }
    forbidden_fields = {
        "model",
        "provider",
        "device",
        "cuda",
        "compute_type",
        "beam_size",
        "mock",
    }
    v1_schema_names = set()
    for path, path_item in document["paths"].items():
        if not path.startswith("/v1/"):
            continue
        for operation in path_item.values():
            if not isinstance(operation, dict):
                continue
            for response in operation.get("responses", {}).values():
                schema_ref = (
                    response.get("content", {})
                    .get("application/json", {})
                    .get("schema", {})
                    .get("$ref")
                )
                if schema_ref:
                    v1_schema_names.add(schema_ref.rsplit("/", maxsplit=1)[-1])

    for schema_name in v1_schema_names:
        schema = document["components"]["schemas"][schema_name]
        assert not forbidden_fields.intersection(schema.get("properties", {}))
