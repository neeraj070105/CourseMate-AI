
import os
from pathlib import Path
import chromadb

# Ensure ChromaDB path is absolute to rag-service/chroma_db
BASE_DIR = Path(__file__).resolve().parent.parent
CHROMA_PATH = os.getenv("CHROMA_DB_PATH", str(BASE_DIR / "chroma_db"))

# Create ChromaDB client
client = chromadb.PersistentClient(
    path=CHROMA_PATH
)


# Create or get CourseMate collection
collection = client.get_or_create_collection(
    name="coursemate_chunks",
    configuration={
        "hnsw": {
            "space": "cosine"
        }
    }
)


def add_chunk(
    chunk_id,
    text,
    embedding,
    metadata
):
    """
    Stores one chunk in ChromaDB.
    """

    collection.add(
        ids=[chunk_id],
        documents=[text],
        embeddings=[embedding],
        metadatas=[metadata]
    )


def search_chunks(
    query_embedding,
    top_k=5,
    document_id=None
):
    """
    Searches for the most similar chunks.

    If document_id is provided, searches only
    within that document.
    """

    query_options = {
        "query_embeddings": [query_embedding],
        "n_results": top_k
    }

    if document_id is not None:
        query_options["where"] = {
            "document_id": document_id
        }

    results = collection.query(
        **query_options
    )

    return results


def get_collection_count():
    """
    Returns total number of stored chunks.
    """

    return collection.count()
