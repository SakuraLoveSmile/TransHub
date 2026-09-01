from app.config import Settings
from app.main import create_app
from app.providers.mock.transcription import MockTranscriptionProvider
from app.providers.mock.translation import MockTranslationProvider


def test_settings_read_transferhub_environment(monkeypatch) -> None:
    monkeypatch.setenv("TRANSFERHUB_HOST", "127.0.0.2")
    monkeypatch.setenv("TRANSFERHUB_PORT", "9876")
    monkeypatch.setenv("TRANSFERHUB_LOG_LEVEL", "debug")
    monkeypatch.setenv("TRANSFERHUB_MOCK_TRANSCRIPTION_DELAY", "0.35")
    monkeypatch.setenv("TRANSFERHUB_MOCK_TRANSCRIPTION_FAIL", "true")

    settings = Settings.from_environment()

    assert settings.host == "127.0.0.2"
    assert settings.port == 9876
    assert settings.log_level == "DEBUG"
    assert settings.mock_transcription_delay == 0.35
    assert settings.mock_transcription_fail is True


def test_create_app_uses_mock_providers_by_default() -> None:
    application = create_app(Settings())

    assert isinstance(
        application.state.transcription_provider, MockTranscriptionProvider
    )
    assert isinstance(application.state.translation_provider, MockTranslationProvider)
