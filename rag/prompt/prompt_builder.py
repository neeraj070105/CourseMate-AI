def build_prompt(
    question,
    chunks
):
    """
    Builds the final prompt for the LLM
    and creates a mapping between Source IDs
    and their actual document/page information.
    """

    system_instructions = """
You are CourseMate AI, an expert course study assistant.

Answer the student's question directly and accurately using only the provided context.

Guidelines:
- Give a direct, well-structured, and relevant answer without conversational filler or introductory phrases (do NOT start with "Based on the provided context", "According to the course material", or "Here is").
- Do not repeat the student's question.
- Avoid repeated information or unrelated background details that were not requested.
- If comparing concepts, prefer a concise explanation, a clean Markdown comparison table, and an example.
- Formatting Standards:
  * Use standard GitHub Flavored Markdown (headings, bold text, bullet points, tables).
  * Format mathematical symbols, variables, transition functions, and formulas using standard LaTeX syntax enclosed in single dollar signs for inline math (e.g., $Q$, $\\Sigma$, $\\delta$, $\\delta(q, a) = p$) or double dollar signs for block formulas ($$...$$). Never leave raw LaTeX commands like \\delta or \\Sigma unescaped or outside math delimiters.
- Do not use unsupported information from outside the provided context.
- If the answer is not available in the provided context, state clearly: "The information was not found in the provided course material."
- When using information from a retrieved source, cite its Source ID, such as [Source 1].
"""

    context_parts = []

    source_map = {}

    for index, chunk in enumerate(
        chunks,
        start=1
    ):

        source_id = f"Source {index}"

        source_map[source_id] = {
            "document_id": chunk["document_id"],
            "page_number": chunk["page_number"],
            "chunk_id": chunk["chunk_id"],
            "text": chunk["text"].strip(),
        }

        context = f"[{source_id}]\n{chunk['text'].strip()}"

        context_parts.append(context)

    context_text = "\n".join(
        context_parts
    )

    prompt = f"""
{system_instructions}

====================
RETRIEVED CONTEXT
====================

{context_text}

====================
STUDENT QUESTION
====================

{question}

====================
ANSWER INSTRUCTIONS
====================

Answer the student's question directly, concisely, and accurately using only the retrieved context above.

- Start immediately with the direct answer.
- Do not include introductory filler, question restatements, or unrelated details.
- When comparing concepts, use a clean Markdown comparison table if helpful.
- Ensure all math expressions use LaTeX $...$ delimiters.
- If the context does not contain enough information to answer the question, say that the information was not found in the provided course material.
- When using information from a retrieved source, mention its Source ID, such as [Source 1].
"""

    return prompt, source_map
