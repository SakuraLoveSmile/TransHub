"""Stable health-check response models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: Literal["transferhub"]
    version: str = Field(min_length=1)


class LegacyHealthResponse(BaseModel):
    """Response kept for the original demo health endpoint."""

    status: Literal["ok"]
