from chunking.token_counter import count_tokens


def recursive_split(
    text,
    separators,
    chunk_size,
    separator_index=0
):
    """
    Recursively splits text until every piece
    fits within the required token size.
    """

    if not text:
        return []

    text = text.strip()

    # Exact Gemini token count
    token_count = count_tokens(text)

    # If text already fits, no further splitting is needed
    if token_count <= chunk_size:
        return [text]

    # If we have reached the last separator,
    # split directly by characters
    if separator_index >= len(separators):
        return [
            text[i:i + 2000]
            for i in range(0, len(text), 2000)
        ]

    separator = separators[separator_index]

    # Character-level fallback
    if separator == "":
        return [
            text[i:i + 2000]
            for i in range(0, len(text), 2000)
        ]

    parts = text.split(separator)

    smaller_parts = []

    for part in parts:

        part = part.strip()

        if not part:
            continue

        # Check exact Gemini token count
        part_token_count = count_tokens(part)

        if part_token_count <= chunk_size:

            smaller_parts.append(part)

        else:

            if separator_index + 1 < len(separators):

                split_parts = recursive_split(
                    part,
                    separators,
                    chunk_size,
                    separator_index + 1
                )

                smaller_parts.extend(split_parts)

            else:

                smaller_parts.append(part)

    return smaller_parts


def combine_parts(
    parts,
    chunk_size,
    chunk_overlap
):
    """
    Combines smaller pieces into final chunks
    while keeping the final chunk within
    the token limit.
    """

    chunks = []

    current_chunk = ""

    for part in parts:

        if not current_chunk:

            current_chunk = part
            continue

        candidate = current_chunk + " " + part

        candidate_tokens = count_tokens(candidate)

        if candidate_tokens <= chunk_size:

            current_chunk = candidate

        else:

            chunks.append(current_chunk)

            # Approximately 50 tokens ≈ 200 characters
            overlap_text = current_chunk[-200:]

            current_chunk = overlap_text + " " + part

            # Safety check
            current_tokens = count_tokens(current_chunk)

            if current_tokens > chunk_size:

                current_chunk = part

    if current_chunk:

        chunks.append(current_chunk)

    return chunks


def recursive_chunk_text(
    text,
    chunk_size=500,
    chunk_overlap=50
):
    """
    Creates token-aware recursive chunks.
    """

    separators = [
        "\n\n",
        "\n",
        ". ",
        " ",
        ""
    ]

    smaller_parts = recursive_split(
        text,
        separators,
        chunk_size
    )

    chunks = combine_parts(
        smaller_parts,
        chunk_size,
        chunk_overlap
    )

    return chunks



def create_chunk_metadata(
    pages,
    document_id="doc_001",
    chunk_size=500,
    chunk_overlap=50
):
    """
    Creates chunks with metadata
    while preserving page numbers.
    """

    final_chunks = []

    chunk_index = 0

    # Process each PDF page separately
    for page in pages:

        page_number = page["page_number"]
        page_text = page["text"]

        # Create chunks for this page
        page_chunks = recursive_chunk_text(
            page_text,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap
        )

        # Add metadata to every chunk
        for chunk in page_chunks:

            chunk_data = {
                "chunk_id": f"{document_id}_p{page_number}_c{chunk_index}",
                "document_id": document_id,
                "page_number": page_number,
                "chunk_index": chunk_index,
                "text": chunk
            }

            final_chunks.append(chunk_data)

            chunk_index += 1

    return final_chunks