import io
import logging
import os
import random
import time
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger("CourseMate-OCRService")

# Load environment variables
_BASE = Path(__file__).resolve().parent.parent
load_dotenv()
load_dotenv(dotenv_path=_BASE / ".env")
load_dotenv(dotenv_path=_BASE.parent / ".env")

# Primary and fallback vision models for OCR
PRIMARY_OCR_MODEL = os.getenv("GEMINI_OCR_MODEL", os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"))
_fb_env = os.getenv("GEMINI_FALLBACK_MODELS", "gemini-3.5-flash,gemini-3.1-flash-lite,gemini-flash-latest")
OCR_FALLBACK_MODELS = [m.strip() for m in _fb_env.split(",") if m.strip()]
OCR_ENGINE = os.getenv("OCR_ENGINE", "gemini").lower()  # "gemini", "tesseract", or "auto"

_gemini_client = None


def get_gemini_client():
    """
    Lazily initializes the Google GenAI client for OCR.
    """
    global _gemini_client
    if _gemini_client is not None:
        return _gemini_client

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY is not set. Cloud vision OCR will be unavailable.")
        return None

    try:
        from google import genai
        from google.genai import types

        _gemini_client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                timeout=30000,  # 30s timeout for vision OCR calls
                retry_options=types.HttpRetryOptions(
                    attempts=3,
                    initial_delay=1.0,
                    max_delay=6.0,
                    http_status_codes=[408, 429, 500, 502, 503, 504],
                ),
            ),
        )
        return _gemini_client
    except Exception as err:
        logger.error(f"Failed to initialize Gemini client for OCR: {err}")
        return None


def is_local_tesseract_available():
    """
    Checks if pytesseract and the underlying Tesseract binary are available.
    """
    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def ocr_page_with_tesseract(page):
    """
    Attempts local OCR using PyTesseract if available.
    """
    try:
        import pytesseract
        from PIL import Image
 
        pix = page.get_pixmap(dpi=150)   # dpi = dot per inch resolution par image banana.
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        text = pytesseract.image_to_string(img)
        pix = None
        return text.strip() if text else ""
    except Exception as err:
        logger.debug(f"Local Tesseract OCR unavailable or failed: {err}")
        return None


def clean_ocr_text(text: str) -> str:
    """
    Cleans OCR output from vision LLMs by removing common conversational preambles,
    markdown code blocks, and separator lines.
    """
    if not text:
        return ""
    import re
    cleaned = text.strip()

    # Strip markdown block wrappers if present
    if cleaned.startswith("```") and cleaned.endswith("```"):
        lines = cleaned.splitlines()
        if len(lines) >= 2:
            cleaned = "\n".join(lines[1:-1]).strip()

    # Strip common conversational preambles
    preamble_patterns = [
        r"^Here (?:is|are) (?:the )?(?:verbatim )?transcription[^\n]*\n+",
        r"^Based on the (?:provided )?image[^\n]*\n+",
        r"^Transcribed text:\s*\n+",
        r"^---\s*\n+",
    ]
    for pat in preamble_patterns:
        cleaned = re.sub(pat, "", cleaned, flags=re.IGNORECASE).strip()

    return cleaned


def ocr_page_with_gemini(page, page_number=None):
    """
    Performs multimodal OCR using Gemini Vision.
    Specialized for scanned academic documents, blue/black ink handwriting,
    ruled paper, and cursive English writing.
    """
    client = get_gemini_client()
    if client is None:
        raise RuntimeError("Gemini API client not configured for OCR (missing GEMINI_API_KEY).")

    from google.genai import types

    # Render single page to JPEG at 150 DPI for optimal speed and memory footprint
    pix = page.get_pixmap(dpi=150)
    image_bytes = pix.tobytes("jpeg")
    pix = None  # Free C memory immediately

    prompt = (
        "You are an expert academic OCR transcription system.\n"
        "Transcribe all readable text from this document page verbatim.\n"
        "Instructions:\n"
        "1. Extract all printed text, headings, paragraphs, and list items.\n"
        "2. Accurately transcribe all handwritten academic notes, including blue/black ink handwriting, "
        "cursive English, formulas, and margin annotations.\n"
        "3. Maintain logical reading order (top-to-bottom, left-to-right).\n"
        "4. If a word or phrase in handwriting is ambiguous or illegible, transcribe the legible letters "
        "and mark uncertain text as [unclear]. Do not hallucinate or guess invented content.\n"
        "5. Output ONLY the transcribed text. Do NOT include markdown code blocks, introductory text, "
        "or explanations like 'Here is the transcription:'."
    )

    models_to_try = [PRIMARY_OCR_MODEL] + OCR_FALLBACK_MODELS
    # Deduplicate while preserving order
    unique_models = []
    for m in models_to_try:
        if m and m not in unique_models:
            unique_models.append(m)

    last_error = None
    for model_name in unique_models:
        for attempt in range(1, 3):
            try:
                t0 = time.perf_counter()
                response = client.models.generate_content(
                    model=model_name,
                    contents=[
                        types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                        prompt,
                    ],
                )
                elapsed = time.perf_counter() - t0

                if response and response.text:
                    clean_res = clean_ocr_text(response.text)
                    logger.info(
                        f"OCR completed for page {page_number or '?'} via '{model_name}' "
                        f"in {elapsed:.2f}s ({len(clean_res)} chars)."
                    )
                    # Short pause to prevent burst rate limit
                    time.sleep(0.25)
                    return clean_res
            except Exception as err:
                last_error = err
                err_str = str(err).upper()
                is_transient = any(
                    w in err_str
                    for w in ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "500", "502", "504", "TIMEOUT", "DEADLINE")
                )
                logger.warning(
                    f"OCR attempt {attempt} for page {page_number or '?'} via '{model_name}' failed: {err}"
                )
                if is_transient and attempt < 2:
                    wait_time = (1.5 ** attempt) + random.uniform(0.5, 1.2)
                    time.sleep(wait_time)
                else:
                    break

    if last_error:
        raise last_error

    return ""


def ocr_page(page, page_number=None):
    """
    Unified page OCR function:
    - If OCR_ENGINE is 'tesseract' and local Tesseract is available, tries Tesseract first.
    - Otherwise uses Gemini Vision OCR (which accurately handles cursive handwriting and scanned text).
    """
    if OCR_ENGINE == "tesseract" and is_local_tesseract_available():
        text = ocr_page_with_tesseract(page)
        if text and len(text.strip()) > 30:
            return text

    # Primary / fallback to Gemini Multimodal Vision
    return ocr_page_with_gemini(page, page_number=page_number)
