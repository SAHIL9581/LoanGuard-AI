import sys
from loguru import logger
from app.config import get_settings


def setup_logger():
    settings = get_settings()
    logger.remove()
    level = "DEBUG" if settings.debug_mode else "INFO"
    logger.add(
        sys.stdout,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        level=level,
        colorize=True,
    )
    logger.add(
        "logs/app.log",
        rotation="10 MB",
        retention="7 days",
        level="INFO",
        serialize=False,
    )
    return logger
