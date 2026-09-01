from fastapi.testclient import TestClient

from app import __version__
from app.config import Settings
from app.main import create_app


def test_health_returns_ok() -> None:
    application = create_app(Settings())

    with TestClient(application) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "transferhub",
        "version": __version__,
    }
    assert response.json()["version"]


def test_legacy_health_remains_available() -> None:
    application = create_app(Settings())

    with TestClient(application) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_openapi_exposes_stable_health_contract() -> None:
    application = create_app(Settings())

    with TestClient(application) as client:
        document = client.get("/openapi.json").json()

    assert document["paths"]["/health"]["get"]["responses"]["200"]
    health_schema_ref = document["paths"]["/health"]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"]["$ref"]
    health_schema_name = health_schema_ref.rsplit("/", maxsplit=1)[-1]
    assert set(document["components"]["schemas"][health_schema_name]["properties"]) == {
        "status",
        "service",
        "version",
    }
