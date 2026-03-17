from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache
from typing import List
import os
import sys


class Settings(BaseSettings):
    # ── OpenAI ────────────────────────────────────────────────────────────────
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    openai_temperature: float = 0.1
    openai_max_tokens: int = 2048
    openai_timeout: float = 60.0
    openai_retries: int = 3
    gemini_api_key: str = ""

    # ── Storage ───────────────────────────────────────────────────────────────
    # On Render, use /tmp — it's the only writable directory on free tier
    chroma_persist_dir: str = "/tmp/vectorstore"

    # ── App ───────────────────────────────────────────────────────────────────
    debug_mode: bool = False  # always False in production

    cors_origins: List[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
    ]

    host: str = "0.0.0.0"
    port: int = 8000

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v):
        """
        Safely parse CORS_ORIGINS from env var.
        Accepts both JSON array and comma-separated string:
          - '["https://foo.vercel.app"]'   ← JSON (Render default)
          - 'https://foo.vercel.app'        ← plain string
          - 'https://a.com,https://b.com'  ← comma-separated
        """
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                import json
                try:
                    return json.loads(v)
                except Exception:
                    pass
            # fallback: comma-separated or single URL
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @field_validator("openai_api_key")
    @classmethod
    def warn_if_key_missing(cls, v: str) -> str:
        if not v:
            import warnings
            warnings.warn(
                "OPENAI_API_KEY is not set — all extraction calls will fail",
                stacklevel=2,
            )
        return v


@lru_cache()
def get_settings() -> Settings:
    return Settings()
