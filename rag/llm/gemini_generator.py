import logging
import os
import random
import time
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import errors, types

logger = logging.getLogger("CourseMate-GeminiGenerator")

# Load environment variables
_BASE = Path(__file__).resolve().parent.parent
load_dotenv()
load_dotenv(dotenv_path=_BASE / ".env")
load_dotenv(dotenv_path=_BASE.parent / ".env")

# Read Gemini API key
api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    raise ValueError("GEMINI_API_KEY not found in .env")

# Default to fast, reliable gemini-3.5-flash-lite
MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")

# Robust fallback chain
_default_fallbacks = "gemini-3.5-flash,gemini-3.1-flash-lite,gemini-flash-latest"
FALLBACK_MODELS = [
    m.strip()
    for m in os.getenv("GEMINI_FALLBACK_MODELS", _default_fallbacks).split(",")
    if m.strip() and m.strip() != MODEL_NAME
]

RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}

# Create client with 15s timeout
client = genai.Client(
    api_key=api_key,
    http_options=types.HttpOptions(
        timeout=18000,
        retry_options=types.HttpRetryOptions(
            attempts=2,
            initial_delay=0.5,
            max_delay=2.0,
            http_status_codes=list(RETRYABLE_STATUS_CODES),
        ),
    ),
)


def _is_retryable_error(error: Exception) -> bool:
    if isinstance(error, errors.ServerError):
        return True
    if isinstance(error, errors.APIError):
        code = getattr(error, "code", None)
        if code in RETRYABLE_STATUS_CODES:
            return True
        err_str = str(error).upper()
        if any(w in err_str for w in ("503", "UNAVAILABLE", "HIGH DEMAND", "RESOURCE_EXHAUSTED", "429")):
            return True
    error_type = type(error).__name__
    if any(transient in error_type for transient in ("Timeout", "Connection", "Transport")):
        return True
    return False


def _try_model(model_name: str, prompt: str, max_retries: int = 1) -> str:
    """
    Attempts generation with a specific model with short retry on transient errors.
    Returns generated text or raises the underlying error.
    """
    last_err = None
    for attempt in range(1, max_retries + 1):
        t_start = time.perf_counter()
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt
            )
            elapsed = time.perf_counter() - t_start

            if response and response.text:
                logger.info(f"Model '{model_name}' generated answer in {elapsed:.2f}s ({len(response.text)} chars)")
                return response.text.strip()
            else:
                raise RuntimeError(f"Model '{model_name}' returned empty response text")

        except Exception as error:
            last_err = error
            elapsed = time.perf_counter() - t_start
            logger.warning(f"Model '{model_name}' attempt {attempt} failed after {elapsed:.2f}s: {error}")

            if attempt < max_retries and _is_retryable_error(error):
                time.sleep(random.uniform(0.5, 1.0))
            else:
                break

    raise last_err


def generate_answer(prompt: str) -> str:
    """
    Generates an answer using the primary model, automatically falling back
    through the model chain if transient issues (503, 429 quota, timeouts) arise.
    Raises RuntimeError if all models fail.
    """
    if not prompt or not prompt.strip():
        raise ValueError("Prompt is empty")

    models_to_try = [MODEL_NAME]
    for fm in FALLBACK_MODELS:
        if fm not in models_to_try:
            models_to_try.append(fm)

    errors_encountered = []

    for model in models_to_try:
        try:
            answer = _try_model(model, prompt, max_retries=1)
            if answer:
                return answer
        except Exception as err:
            err_summary = f"{model}: {type(err).__name__} ({str(err)[:120]})"
            errors_encountered.append(err_summary)
            logger.warning(f"Failed model '{model}', trying next in fallback chain. Reason: {err_summary}")

    full_error_msg = f"All Gemini models failed: {'; '.join(errors_encountered)}"
    logger.error(full_error_msg)
    raise RuntimeError(full_error_msg)
