import json
import os
import hashlib
import chromadb
from chromadb.config import Settings as ChromaSettings
from sentence_transformers import SentenceTransformer
from loguru import logger
from app.config import get_settings

settings = get_settings()

_chroma_client = None
_collection = None
_embedder = None

HASH_METADATA_KEY = "guidelines_file_hash"
MIN_RELEVANCE_SCORE = 0.45   # FIX: filter out low-relevance guideline noise
DEFAULT_N_RESULTS = 10        # FIX: was 5, now 10 to cover complex multi-rule documents


def get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        logger.info("Loading sentence transformer model...")
        _embedder = SentenceTransformer("all-MiniLM-L6-v2")
    return _embedder


def _compute_guidelines_hash(guidelines_path: str) -> str:
    with open(guidelines_path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def _get_stored_hash(collection) -> str:
    """Retrieve the hash stored in ChromaDB collection metadata."""
    try:
        meta = collection.metadata or {}
        return meta.get(HASH_METADATA_KEY, "")
    except Exception:
        return ""


def get_chroma_collection():
    global _chroma_client, _collection
    if _collection is not None:
        return _collection

    guidelines_path = os.path.join(
        os.path.dirname(__file__), "../data/rbi_guidelines.json"
    )
    current_hash = _compute_guidelines_hash(guidelines_path)

    os.makedirs(settings.chroma_persist_dir, exist_ok=True)
    _chroma_client = chromadb.PersistentClient(
        path=settings.chroma_persist_dir,
        settings=ChromaSettings(anonymized_telemetry=False),
    )

    collection_exists = False
    try:
        existing = _chroma_client.get_collection("rbi_guidelines")
        stored_hash = _get_stored_hash(existing)

        if stored_hash == current_hash:
            # FIX: only reuse collection if rbi_guidelines.json hasn't changed
            logger.info("ChromaDB collection is up to date — reusing")
            _collection = existing
            collection_exists = True
        else:
            logger.info(
                f"rbi_guidelines.json changed (hash mismatch) — re-seeding ChromaDB"
            )
            _chroma_client.delete_collection("rbi_guidelines")
    except Exception:
        logger.info("No existing ChromaDB collection found — creating fresh")

    if not collection_exists:
        _collection = _chroma_client.create_collection(
            name="rbi_guidelines",
            metadata={
                "hnsw:space": "cosine",
                HASH_METADATA_KEY: current_hash
            }
        )
        _seed_rbi_guidelines(guidelines_path)

    return _collection


def _seed_rbi_guidelines(guidelines_path: str):
    """Seed ChromaDB with RBI guidelines from JSON file."""
    with open(guidelines_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    embedder = get_embedder()
    guidelines = data["guidelines"]

    documents = [g["content"] for g in guidelines]
    ids = [g["id"] for g in guidelines]
    metadatas = [
        {
            "title": g["title"],
            "source": g["source"],
            "circular_ref": g["circular_ref"],
            "year": str(g["year"]),
            "keywords": ",".join(g["keywords"])
        }
        for g in guidelines
    ]

    embeddings = embedder.encode(documents).tolist()

    _collection.add(
        documents=documents,
        embeddings=embeddings,
        ids=ids,
        metadatas=metadatas
    )
    logger.info(f"Seeded {len(guidelines)} RBI guidelines into ChromaDB")


def retrieve_relevant_guidelines(query: str, n_results: int = DEFAULT_N_RESULTS) -> list[dict]:
    """
    Retrieve most relevant RBI guidelines for a query.
    FIX: filters results below MIN_RELEVANCE_SCORE to avoid polluting LLM context.
    """
    collection = get_chroma_collection()
    embedder = get_embedder()

    query_embedding = embedder.encode([query]).tolist()

    results = collection.query(
        query_embeddings=query_embedding,
        n_results=min(n_results, collection.count()),
        include=["documents", "metadatas", "distances"]
    )

    guidelines = []
    for i, doc in enumerate(results["documents"][0]):
        relevance = 1 - results["distances"][0][i]
        if relevance < MIN_RELEVANCE_SCORE:
            logger.debug(f"Skipping low-relevance guideline (score={relevance:.2f})")
            continue
        guidelines.append({
            "content": doc,
            "metadata": results["metadatas"][0][i],
            "relevance_score": relevance
        })

    logger.debug(f"Retrieved {len(guidelines)} relevant guidelines (threshold={MIN_RELEVANCE_SCORE})")
    return guidelines


def build_compliance_context(extraction_summary: str, extra_queries: list[str] = None) -> str:
    """
    Build a rich RBI compliance context string.
    FIX: runs multiple targeted queries and deduplicates by circular_ref.
    """
    # FIX: always run 4 targeted queries for comprehensive rule coverage
    base_queries = [extraction_summary]
    targeted_queries = [
        f"penal charges compounding RBI circular",
        f"KFS key facts statement disclosure mandate",
        f"processing fee cap {extraction_summary.split()[0] if extraction_summary else 'loan'}",
        f"floating rate reset clause borrower rights transparency",
    ]
    if extra_queries:
        targeted_queries.extend(extra_queries)

    all_queries = base_queries + targeted_queries

    seen_circulars: set[str] = set()
    deduped_guidelines: list[dict] = []

    for q in all_queries:
        results = retrieve_relevant_guidelines(q, n_results=5)
        for g in results:
            circ_ref = g["metadata"].get("circular_ref", g["metadata"].get("title", ""))
            if circ_ref not in seen_circulars:
                seen_circulars.add(circ_ref)
                deduped_guidelines.append(g)

    # Sort by relevance descending
    deduped_guidelines.sort(key=lambda x: x["relevance_score"], reverse=True)

    context_parts = []
    for g in deduped_guidelines[:12]:  # Cap at 12 unique guidelines
        meta = g["metadata"]
        context_parts.append(
            f"[{meta['circular_ref']}] {meta['title']}\n"
            f"Relevance: {g['relevance_score']:.2f}\n"
            f"Content: {g['content']}"
        )

    logger.info(f"Built compliance context with {len(context_parts)} unique guidelines")
    return "\n\n---\n\n".join(context_parts)
