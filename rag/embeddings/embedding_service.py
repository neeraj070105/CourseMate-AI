import logging
import os
import random
import time
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

logger = logging.getLogger("CourseMate-EmbeddingService")

# Load environment variables
_BASE = Path(__file__).resolve().parent.parent
load_dotenv()
load_dotenv(dotenv_path=_BASE / ".env")
load_dotenv(dotenv_path=_BASE.parent / ".env")

# Read Gemini API key
api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    raise ValueError("GEMINI_API_KEY not found in .env")

# Create Gemini client with retry options
client = genai.Client(
    api_key=api_key,
    http_options=types.HttpOptions(
        retry_options=types.HttpRetryOptions(
            attempts=3,
            initial_delay=1.0,
            max_delay=8.0,
            http_status_codes=[408, 429, 500, 502, 503, 504],
        )
    ),
)

# Fixed embedding configuration
PRIMARY_EMBEDDING_MODEL = os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-2")
FALLBACK_EMBEDDING_MODELS = [
    m.strip()
    for m in os.getenv("GEMINI_EMBEDDING_FALLBACK_MODELS", "gemini-embedding-001").split(",")
    if m.strip() and m.strip() != PRIMARY_EMBEDDING_MODEL
]
OUTPUT_DIMENSIONS = 768

# Reusable configuration instance
_EMBED_CONFIG = types.EmbedContentConfig(
    output_dimensionality=OUTPUT_DIMENSIONS
)


def _is_transient_error(err: Exception) -> bool:
    err_str = str(err).upper()
    transient_indicators = (
        "503", "UNAVAILABLE", "HIGH DEMAND", "SERVER IS BUSY",
        "429", "RESOURCE_EXHAUSTED", "RATE_LIMIT", "QUOTA",
        "500", "502", "504", "TIMEOUT", "DEADLINE_EXCEEDED", "CONNECTION",
    )
    return any(ind in err_str for ind in transient_indicators)


def _embed_with_retry(contents: str, models: list, max_retries_per_model: int = 3) -> list:
    """
    Attempts embedding generation through primary model and fallbacks,
    applying bounded exponential backoff with jitter on transient errors (503, 429, etc.).
    """
    last_error = None
    all_models = []
    for m in models:
        if m and m not in all_models:
            all_models.append(m)

    for model_name in all_models:
        for attempt in range(1, max_retries_per_model + 1):
            try:
                response = client.models.embed_content(
                    model=model_name,
                    contents=contents,
                    config=_EMBED_CONFIG,
                )
                if response and response.embeddings and len(response.embeddings) > 0:
                    return list(response.embeddings[0].values)
                raise RuntimeError(f"Model '{model_name}' returned empty embeddings")
            except Exception as err:
                last_error = err
                is_transient = _is_transient_error(err)
                if is_transient and attempt < max_retries_per_model:
                    wait_time = (1.5 ** attempt) + random.uniform(0.5, 1.2)
                    logger.warning(
                        f"Embedding transient error on model '{model_name}' (attempt {attempt}/{max_retries_per_model}): "
                        f"{err}. Retrying in {wait_time:.1f}s..."
                    )
                    time.sleep(wait_time)
                else:
                    logger.warning(f"Model '{model_name}' failed attempt {attempt}: {err}")
                    break  # Try next fallback model

    # If all models and retries exhausted
    logger.error(f"All embedding models failed: {last_error}")
    raise last_error


def generate_embedding(text, max_retries=3):
    """
    Generates an embedding for one document chunk with rate-limit and transient error backoff.
    """
    prepared_text = f"title: none | text: {text}"
    models = [PRIMARY_EMBEDDING_MODEL] + FALLBACK_EMBEDDING_MODELS
    return _embed_with_retry(prepared_text, models, max_retries_per_model=max_retries)


def generate_query_embedding(question, max_retries=3):
    """
    Generates an embedding for a student's question.
    """
    prepared_question = f"task: question answering | query: {question}"
    models = [PRIMARY_EMBEDDING_MODEL] + FALLBACK_EMBEDDING_MODELS
    return _embed_with_retry(prepared_question, models, max_retries_per_model=max_retries)
