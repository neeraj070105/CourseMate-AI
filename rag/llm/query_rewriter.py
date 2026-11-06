import logging
from typing import List, Dict, Any, Optional

from llm.gemini_generator import generate_answer

logger = logging.getLogger("CourseMate-QueryRewriter")

REWRITE_SYSTEM_PROMPT = """You are an expert query reformulator for a conversational document retrieval system.

Given the recent conversation history between a student and an assistant, and the student's latest question, rewrite the latest question into a single, complete, standalone question suitable for document retrieval.

Rules:
1. If the question refers to previous context (using pronouns like 'it', 'its', 'they', 'them', 'the second one', 'difference between them', etc.), rewrite it into a clear standalone search query that preserves the student's exact intent.
2. If the question is already complete and standalone (does not depend on previous conversation), return it unchanged.
3. Preserve the student's actual intent. Do not unnecessarily rewrite questions that are already standalone.
4. Do NOT answer the question.
5. Do NOT add any preamble, explanation, greetings, or quotation marks.
6. Return ONLY the rewritten question."""


def rewrite_query(question: str, chat_history: Optional[List[Dict[str, Any]]] = None) -> str:
    """
    Rewrites a conversational follow-up question into a standalone retrieval query.
    If no history is provided, or if rewriting fails, returns the original question.
    """
    if not question or not question.strip():
        return ""

    trimmed_q = question.strip()

    if not chat_history or len(chat_history) == 0:
        return trimmed_q

    # Use only the last 6 messages
    recent_messages = chat_history[-6:]
    history_str = ""
    for msg in recent_messages:
        role = "User" if msg.get("role") in ("user", "User") else "Assistant"
        content = msg.get("content", "").strip()
        history_str += f"{role}: {content}\n"

    prompt = f"""{REWRITE_SYSTEM_PROMPT}

Conversation History:
{history_str}

Student Question:
{trimmed_q}

Standalone Question:"""

    try:
        rewritten = generate_answer(prompt)
        if rewritten and rewritten.strip():
            cleaned = rewritten.strip().strip("\"' ")
            if cleaned:
                logger.info(f"Query rewritten: '{trimmed_q}' -> '{cleaned}'")
                return cleaned
    except Exception as err:
        logger.warning(f"Query rewriting failed with error: {err}. Falling back to original question.")

    return trimmed_q
