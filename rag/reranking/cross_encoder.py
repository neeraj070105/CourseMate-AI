import os
import transformers
from sentence_transformers import CrossEncoder

# Suppress Hugging Face download progress bars and unauthenticated warnings
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
transformers.logging.set_verbosity_error()
transformers.utils.logging.disable_progress_bar()

MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L6-v2"

# Reusable Cross-Encoder singleton
_reranker_instance = None


def get_reranker():
    """
    Returns the cached CrossEncoder model instance, loading it once.
    Prefers local cached weights to eliminate remote HF Hub checks.
    """
    global _reranker_instance
    if _reranker_instance is None:
        try:
            _reranker_instance = CrossEncoder(MODEL_NAME, local_files_only=True)
        except Exception:
            _reranker_instance = CrossEncoder(MODEL_NAME)
    return _reranker_instance


# Initialize singleton instance for backward compatibility
reranker = get_reranker()


def rerank_chunks(
    question,
    chunks,
    top_k=5
):
    """
    Reranks retrieved chunks according
    to their relevance to the question.
    """

    if not chunks:
        return []

    # Create question-chunk pairs
    pairs = [
        (question, chunk["text"])
        for chunk in chunks
    ]

    # Calculate relevance scores
    scores = reranker.predict(
        pairs,
        batch_size=16,   # batch_size=16 ka matlab model ek batch mein maximum 16 pairs process karne ki koshish karega.
        show_progress_bar=False
    )

    # Attach scores to the corresponding chunks
    reranked_chunks = []

    for chunk, score in zip(chunks, scores):

        chunk_data = chunk.copy()

        chunk_data["rerank_score"] = float(score)

        reranked_chunks.append(chunk_data)

    # Sort chunks by relevance score
    reranked_chunks.sort(
        key=lambda chunk: chunk["rerank_score"],
        reverse=True    # highest score ko pehle rakhta hai.
    )

    # Return only the best chunks
    return reranked_chunks[:top_k]