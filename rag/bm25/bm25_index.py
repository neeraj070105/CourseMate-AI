import re

from rank_bm25 import BM25Okapi


def tokenize_text(text):
    """
    Converts text into lowercase words.
    """

    tokens = re.findall(
        r"\b[a-z0-9]+\b",
        text.lower()
    )

    return tokens


def build_bm25_index(chunks):
    """
    Creates a BM25 index from document chunks.
    """

    tokenized_chunks = []

    for chunk in chunks:

        tokens = tokenize_text(
            chunk["text"]
        )

        tokenized_chunks.append(tokens)

    bm25 = BM25Okapi(tokenized_chunks)

    return bm25


def search_bm25(
    question,
    chunks,
    bm25,
    top_k=5
):
    """
    Searches chunks using BM25.
    """

    query_tokens = tokenize_text(question)

    scores = bm25.get_scores(query_tokens)

    ranked_indices = sorted(
        range(len(scores)),
        key=lambda i: scores[i],
        reverse=True
    )

    results = []

    for index in ranked_indices[:top_k]:

        result = {
            "chunk_id": chunks[index]["chunk_id"],
            "document_id": chunks[index]["document_id"],
            "page_number": chunks[index]["page_number"],
            "text": chunks[index]["text"],
            "bm25_score": float(scores[index])
        }

        results.append(result)

    return results