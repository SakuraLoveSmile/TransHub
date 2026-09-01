from fastapi.testclient import TestClient

from app import __version__
from app.main import app


def test_health_contract_returns_expected_payload() -> None:
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "transferhub",
        "version": __version__,
    }
    assert response.json()["version"]


def test_legacy_health_contract_remains_available() -> None:
    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_openapi_exposes_health_contract() -> None:
    with TestClient(app) as client:
        document = client.get("/openapi.json").json()

    operation = document["paths"]["/health"]["get"]
    schema_ref = operation["responses"]["200"]["content"]["application/json"][
        "schema"
    ]["$ref"]
    schema_name = schema_ref.rsplit("/", maxsplit=1)[-1]
    schema = document["components"]["schemas"][schema_name]

    assert set(schema["properties"]) == {"status", "service", "version"}
    assert not {
        "engine",
        "provider",
        "model",
        "device",
        "mock",
        "cuda",
    }.intersection(schema["properties"])
