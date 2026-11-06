import os

from dotenv import load_dotenv    #.env file ke variables ko Python ke environment mein load karna.
from google import genai


# Load variables from .env
from pathlib import Path
_BASE = Path(__file__).resolve().parent.parent
load_dotenv()
load_dotenv(dotenv_path=_BASE / ".env")
load_dotenv(dotenv_path=_BASE.parent / ".env")


# Get Gemini API key
api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    raise ValueError("GEMINI_API_KEY not found in .env file")


# Create Gemini client
client = genai.Client(api_key=api_key)   


# Gemini model used for token counting
MODEL_NAME = "gemini-embedding-2"


def count_tokens(text):
    """
    Counts the number of Gemini tokens in the given text.
    """

    response = client.models.count_tokens(
        model=MODEL_NAME,
        contents=text
    )

    return response.total_tokens


if __name__ == "__main__":

    sample_text = """
    Retrieval Augmented Generation (RAG) is a technique
    that combines document retrieval with a language model.
    """

    token_count = count_tokens(sample_text)

    print("Text:")
    print(sample_text)

    print("Token count:", token_count)