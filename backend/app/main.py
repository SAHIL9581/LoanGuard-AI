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

# ── Suppress noisy warnings ───────────────────────────────────────────────────
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

# ── Windows event loop (local dev only) ───────────────────────────────────────
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# ── Settings (loaded at module level so import errors surface immediately) ────
try:
    settings = get_settings()
except Exception as exc:
    # If config fails, print clearly and exit — gives Render a useful crash log
    print(f"[FATAL] Failed to load settings: {exc}", file=sys.stderr)
    sys.exit(1)

# ── PORT resolution ───────────────────────────────────────────────────────────
# Render injects $PORT at runtime. Resolve it early so a missing PORT is
# caught before uvicorn tries to bind.
_PORT = int(os.environ.get("PORT", settings.port if hasattr(settings, "port") else 8000))


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Logger must be set up before anything else so all startup errors are visible
    setup_logger()

    log_dir = os.path.join(os.path.dirname(__file__), "..", "logs")
    try:
        os.makedirs(log_dir, exist_ok=True)
    except OSError:
        # Read-only FS on some platforms — not fatal, just skip file logging
        logger.warning(f"Could not create log dir {log_dir!r} — file logging disabled")

    logger.info("=" * 50)
    logger.info("LoanGuard starting up")
    logger.info(f"  Platform : {sys.platform}")
    logger.info(f"  Python   : {sys.version.split()[0]}")
    logger.info(f"  Debug    : {settings.debug_mode}")
    logger.info(f"  Model    : {settings.openai_model}")
    logger.info(f"  Port     : {_PORT}")
    logger.info("=" * 50)

    if not settings.openai_api_key:
        logger.warning("OPENAI_API_KEY is not set — extraction calls will fail")

    # ChromaDB init — NEVER allowed to crash the process.
    # A failure here must only disable RAG, not prevent port binding.
    try:
        logger.info("Initializing ChromaDB and seeding RBI guidelines...")
        get_chroma_collection()
        logger.info("ChromaDB ready ✓")
    except Exception as exc:
        logger.error(f"ChromaDB init failed — RAG features disabled: {exc}")
        logger.warning("App will continue without RAG. Restart to retry.")

    logger.info("LoanGuard is live — port binding handed to uvicorn")
    yield  # ← uvicorn binds the port HERE. Must always be reached.

    logger.info("LoanGuard shutting down gracefully...")


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
# Set CORS_ORIGINS in Render env vars to your Vercel URL:
#   CORS_ORIGINS=["https://delta-build.vercel.app"]
# Use ["*"] temporarily during initial testing only.
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


# ── Health check ──────────────────────────────────────────────────────────────
# Always public — Render uses this to verify the service is alive.
@app.get("/health", tags=["System"])
async def health():
    return {
        "status": "healthy",
        "model": settings.openai_model,
        "debug": settings.debug_mode,
        "platform": sys.platform,
        "python": sys.version.split()[0],
        "port": _PORT,
    }


# ── Startup diagnostic endpoint (debug mode only) ────────────────────────────
# Hit /startup-check on Render to see exactly what env vars are loaded.
@app.get("/startup-check", tags=["System"], include_in_schema=False)
async def startup_check():
    if not settings.debug_mode:
        return {"detail": "disabled in production"}
    return {
        "openai_key_set": bool(settings.openai_api_key),
        "cors_origins": settings.cors_origins,
        "model": settings.openai_model,
        "port": _PORT,
        "env_PORT": os.environ.get("PORT", "NOT SET"),
    }


# ── Local dev entrypoint ──────────────────────────────────────────────────────
# Render does NOT use this block — it runs:
#   uvicorn app.main:app --host 0.0.0.0 --port $PORT
# This is only for: python app/main.py
if __name__ == "__main__":
    import uvicorn

    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=_PORT,
        reload=True,
        reload_dirs=["app"],
        loop="asyncio",
        workers=1,
        log_level="info",
    )
