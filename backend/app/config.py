from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache
from typing import List
import sys


class Settings(BaseSettings):
    # ── OpenAI ──────────────────────────────────────────────────────────────────
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    openai_temperature: float = 0.1
    openai_max_tokens: int = 2048
    openai_timeout: float = 60.0
    openai_retries: int = 3
    gemini_api_key: str = ""

    # ── Storage ───────────────────────────────────────────────────────────────
    chroma_persist_dir: str = "./app/vectorstore"

    # ── App ───────────────────────────────────────────────────────────────────
    debug_mode: bool = True

    # FIX: Added — was missing, caused AttributeError in main.py
    cors_origins: List[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
    ]

    # FIX: Added — uvicorn entrypoint config driven by settings
    host: str = "0.0.0.0"
    port: int = 8000

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    @field_validator("openai_api_key")
    @classmethod
    def warn_if_key_missing(cls, v: str) -> str:
        if not v:
            import warnings
            warnings.warn(
                "⚠  OPENAI_API_KEY is not set in .env — all extraction calls will fail",
                stacklevel=2,
            )
        return v


@lru_cache()
def get_settings() -> Settings:
    return Settings()
