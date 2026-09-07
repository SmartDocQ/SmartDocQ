import os
import chromadb
from chromadb.config import Settings
import logging
from config import CHROMA_DB_PATH

logger = logging.getLogger(__name__)

_chroma_settings = Settings(anonymized_telemetry=False)


def _ensure_dir(p: str) -> bool:
    try:
        os.makedirs(p, exist_ok=True)
        return True
    except Exception as e:
        logger.warning("Failed to create directory %s: %s", p, e)
        return False


def _try_persistent(path: str):
    try:
        cli = chromadb.PersistentClient(path=path, settings=_chroma_settings)
        logger.info("Chroma persistent path: %s", path)
        return cli
    except BaseException as e:
        logger.warning("PersistentClient failed for %s: %s", path, e)
        return None


def init_chroma_client():
    env_path = os.path.abspath(CHROMA_DB_PATH)

    if env_path and _ensure_dir(env_path):
        cli = _try_persistent(env_path)
        if cli:
            return cli

    default_path = os.path.abspath(os.path.join(os.getcwd(), "chroma_db"))

    if _ensure_dir(default_path):
        cli = _try_persistent(default_path)
        if cli:
            return cli

    logger.warning("Using EphemeralClient (no persistence)")
    try:
        return chromadb.EphemeralClient(settings=_chroma_settings)
    except Exception:
        logger.error("Failed to initialize Chroma client")
        raise


chroma_client = init_chroma_client()

collection = chroma_client.get_or_create_collection(
    name="documents",
    metadata={"hnsw:space": "cosine"}
)