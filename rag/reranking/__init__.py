import os

from dotenv import load_dotenv
from google import genai


# Load environment variables
load_dotenv()


# Get Gemini API key from .env
api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    raise ValueError("GEMINI_API_KEY not found in .env")


# Create Gemini API client
client = genai.Client(api_key=api_key)


# Select the LLM model
MODEL_NAME = "gemini-3.8-flash"


def generate_answer(prompt):
    """
    Generates an answer using the Gemini LLM.
    """

    if not prompt or not prompt.strip():
        raise ValueError("Prompt cannot be empty")

    # Send the prompt to Gemini
    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=prompt
    )

    # Extract the generated answer
    answer = response.text

    if not answer:
        raise ValueError("Gemini did not return a text answer")

    return answer.strip()