import asyncio
import os
import sys
import warnings
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.config import get_settings
from app.logger import setup_logger
from app.routes.advisor import router as advisor_router
from app.routes.audit import router as audit_router
from app.routes.chat import router as chat_router
from app.routes.sip import router as sip_router
from app.services.compliance_rag import get_chroma_collection

# ── Suppress noisy warnings ──────────────────────────────────────────────────
try:
    from requests import RequestsDependencyWarning
    warnings.filterwarnings("ignore", category=RequestsDependencyWarning)
except Exception:
    pass

warnings.filterwarnings(
    "ignore",
    message=r"<built-in function any> is not a Python type.*",
    category=UserWarning,
)

# ── Windows event loop policy (dev only) ─────────────────────────────────────
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

settings = get_settings()

# ── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logger()

    # On Render, the working directory is the repo root or the service root.
    # Always use an absolute path so logs land in a predictable location.
    log_dir = os.path.join(os.path.dirname(__file__), "..", "logs")
    os.makedirs(log_dir, exist_ok=True)

    logger.info("LoanGuard starting...")
    logger.info(f"   Platform : {sys.platform}")
    logger.info(f"   Python   : {sys.version.split()[0]}")
    logger.info(f"   Debug    : {settings.debug_mode}")
    logger.info(f"   Model    : {settings.openai_model}")

    if not settings.openai_api_key:
        logger.warning("OPENAI_API_KEY is not set — extraction calls will fail")

    try:
        logger.info("Initializing ChromaDB and seeding RBI guidelines...")
        get_chroma_collection()
        logger.info("ChromaDB ready ✓")
    except Exception as exc:
        logger.error(f"ChromaDB init failed (RAG disabled): {exc}")

    yield  # ── app is live ──

    logger.info("LoanGuard shutting down...")

# ── App factory ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="LoanGuard",
    description="AI-powered Indian loan, credit card and NBFC agreement audit system",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.debug_mode else None,
    redoc_url="/redoc" if settings.debug_mode else None,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# settings.cors_origins should include your Vercel URL, e.g.:
#   CORS_ORIGINS=["https://delta-build.vercel.app"]
# You can also set CORS_ORIGINS=["*"] temporarily during initial testing.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(audit_router)
app.include_router(chat_router)
app.include_router(sip_router)
app.include_router(advisor_router)

# ── Health check (always public, regardless of debug mode) ───────────────────
@app.get("/health", tags=["System"])
async def health():
    return {
        "status": "healthy",
        "model": settings.openai_model,
        "debug": settings.debug_mode,
        "platform": sys.platform,
        "python": sys.version.split()[0],
    }

# ── Local dev entrypoint ──────────────────────────────────────────────────────
# Render uses its own start command: uvicorn app.main:app --host 0.0.0.0 --port $PORT
# This block is ONLY used when you run `python app/main.py` locally.
if __name__ == "__main__":
    import uvicorn

    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
        reload_dirs=["app"],
        loop="asyncio",
        workers=1,
        log_level="info",
    )
