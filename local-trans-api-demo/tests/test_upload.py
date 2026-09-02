"""Tests for the browser upload endpoint (POST /api/upload)."""

from __future__ import annotations

import uuid
from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.core.config import load_config
from app.main import create_app

FLAC_STEM_RE = r"^[0-9a-f]{32}-[A-Za-z0-9._-]*\.flac$"


def make_client(tmp_path: Path) -> TestClient:
    config = replace(load_config(), upload_directory=tmp_path)
    return TestClient(create_app(Settings(), config=config))


def test_upload_saves_media_file(tmp_path) -> None:
    with make_client(tmp_path) as client:
        response = client.post(
            "/api/upload",
            files={"file": ("interview.flac", b"fake flac bytes", "audio/flac")},
        )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"path", "name"}
    assert body["path"].endswith(".flac")
    assert body["name"] == Path(body["path"]).name
    assert body["name"].endswith("-interview.flac")

    saved = Path(body["path"])
    assert saved.is_file()
    assert saved.read_bytes() == b"fake flac bytes"
    assert saved.parent == tmp_path.resolve()

    # Upload names are unique even for the same source filename.
    with make_client(tmp_path) as client:
        same = client.post(
            "/api/upload",
            files={"file": ("interview.flac", b"again", "audio/flac")},
        )
    assert same.status_code == 200
    assert same.json()["name"] != body["name"]
    assert Path(same.json()["path"]).is_file()


def test_upload_returned_path_feeds_transcribe(tmp_path) -> None:
    with make_client(tmp_path) as client:
        upload_response = client.post(
            "/api/upload",
            files={"file": ("demo.flac", b"fake flac bytes", "audio/flac")},
        )
        assert upload_response.status_code == 200
        result = client.post(
            "/api/transcribe", json={"path": upload_response.json()["path"]}
        )

    assert result.status_code == 200
    assert result.json()["success"] is True
    assert result.json()["segments"]


def test_upload_rejects_unsupported_suffix(tmp_path) -> None:
    with make_client(tmp_path) as client:
        response = client.post(
            "/api/upload",
            files={"file": ("notes.txt", b"not audio", "text/plain")},
        )

    assert response.status_code == 400
    assert response.json()["code"] == "UNSUPPORTED_FILE"
    assert isinstance(response.json()["detail"], str)
    assert no_new_files_in(tmp_path)


def test_upload_sanitizes_suffix_case(tmp_path) -> None:
    with make_client(tmp_path) as client:
        response = client.post(
            "/api/upload", files={"file": ("TALK.FLAC", b"data", "audio/flac")}
        )

    assert response.status_code == 200
    assert response.json()["path"].endswith(".flac")


def test_upload_cannot_escape_directory(tmp_path) -> None:
    with make_client(tmp_path) as client:
        response = client.post(
            "/api/upload", files={"file": ("../../evil.flac", b"data", "audio/flac")}
        )

    assert response.status_code == 200
    saved = Path(response.json()["path"]).resolve()
    assert saved.parent == tmp_path.resolve()
    assert not (tmp_path.parent / "evil.flac").exists()


def test_upload_handles_empty_and_weird_filenames(tmp_path) -> None:
    with make_client(tmp_path) as client:
        # An empty filename is encoded as a plain form field, so FastAPI
        # rejects it with its standard 422 validation shape instead of our
        # error contract. Either way it is a clean 4xx, never a 500.
        empty = client.post("/api/upload", files={"file": ("", b"data")})
        # A request without the file part reaches the handler and gets 400.
        missing = client.post("/api/upload")
        weird = client.post(
            "/api/upload",
            files={"file": ("a b?c*d<e>:|\\\".flac", b"data", "audio/flac")},
        )

    assert empty.status_code == 422
    assert isinstance(empty.json()["detail"], list)

    assert missing.status_code == 400
    assert missing.json()["code"] == "UNSUPPORTED_FILE"

    # Unusual characters are stripped; only safe [A-Za-z0-9._-] remain.
    assert weird.status_code == 200
    name = weird.json()["name"]
    assert set(name) <= set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
    assert name.endswith(".flac")
    assert name.startswith(uuid.UUID(name[:32]).hex)
    assert Path(weird.json()["path"]).is_file()


def no_new_files_in(directory: Path) -> bool:
    return not any(path.is_file() for path in directory.iterdir())