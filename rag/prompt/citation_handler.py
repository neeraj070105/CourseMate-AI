import re


def clean_source_text(text):
    """
    Strips artificial test/debug boilerplate and header banners from chunk text.
    """
    if not text:
        return ""

    debug_patterns = [
        r"This page intentionally contains substantial text[^\n.]*[\n.]*",
        r"so that a \d+-token chunking configuration can create multiple chunks[^\n.]*[\n.]*",
        r"^Database Systems\s*[–-]\s*Page\s*\d+\s*",
        r"Database Systems\s*[–-]\s*Page\s*\d+\s*",
        r"^Page\s+\d+\s*",
    ]
    cleaned = text
    for p in debug_patterns:
        cleaned = re.sub(p, "", cleaned, flags=re.IGNORECASE | re.MULTILINE)

    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n\s*\n+", "\n\n", cleaned)
    return cleaned.strip()


def extract_meaningful_excerpt(text, question=None, answer=None, max_length=220):
    """
    Extracts a clean, meaningful snippet from the chunk centered on the topic
    discussed in the question and answer, rather than blindly slicing the top of the chunk.
    """
    cleaned = clean_source_text(text)
    if not cleaned:
        return "Relevant section from course document."

    # Identify key topic terms from the question
    if question:
        stopwords = {
            "what", "is", "a", "an", "the", "are", "in", "of", "to", "how",
            "why", "does", "do", "explain", "describe", "define", "for", "with"
        }
        words = [
            w for w in re.findall(r"\b[A-Za-z0-9_-]+\b", question)
            if w.lower() not in stopwords and len(w) > 2
        ]

        # 1. Try matching the exact combined topic phrase (e.g., "Relational Model")
        phrase = " ".join(words)
        if phrase:
            match = re.search(re.escape(phrase), cleaned, flags=re.IGNORECASE)
            if match:
                start_idx = match.start()
                line_start = cleaned.rfind("\n", 0, start_idx)
                if line_start != -1 and (start_idx - line_start) < 50:
                    start_pos = line_start + 1
                else:
                    start_pos = start_idx
                snippet = cleaned[start_pos:].strip()
                if len(snippet) > max_length:
                    cutoff = snippet[:max_length].rfind(". ")
                    if cutoff > 70:
                        snippet = snippet[:cutoff + 1]
                    else:
                        snippet = snippet[:max_length - 3].rstrip() + "..."
                return snippet

        # 2. Try individual keyword matches
        for w in words:
            match = re.search(r"\b" + re.escape(w) + r"\b", cleaned, flags=re.IGNORECASE)
            if match:
                start_idx = match.start()
                line_start = cleaned.rfind("\n", 0, start_idx)
                if line_start != -1 and (start_idx - line_start) < 50:
                    start_pos = line_start + 1
                else:
                    start_pos = max(0, start_idx - 20)
                snippet = cleaned[start_pos:].strip()
                if start_pos > 0:
                    snippet = "..." + snippet
                if len(snippet) > max_length:
                    cutoff = snippet[:max_length].rfind(". ")
                    if cutoff > 70:
                        snippet = snippet[:cutoff + 1]
                    else:
                        snippet = snippet[:max_length - 3].rstrip() + "..."
                return snippet

    # Default fallback: clean excerpt from the start
    snippet = cleaned.replace("\n", " ")
    if len(snippet) > max_length:
        cutoff = snippet[:max_length].rfind(". ")
        if cutoff > 70:
            snippet = snippet[:cutoff + 1]
        else:
            snippet = snippet[:max_length - 3].rstrip() + "..."
    return snippet


def extract_cited_source_ids(answer, source_map=None):
    """
    Extracts all Source IDs referenced in the LLM answer.
    Preserves the order of appearance and removes duplicate IDs.
    If source_map is provided, only IDs present in source_map are included.
    """
    if not answer or not isinstance(answer, str):
        return []

    cited_ids = []
    seen = set()

    def add_id(sid_str):
        sid = f"Source {sid_str}"
        if source_map is not None and sid not in source_map:
            return
        if sid not in seen:
            seen.add(sid)
            cited_ids.append(sid)

    # 1. Match bracketed source lists like [Source 1], [Source 1, Source 2], [Sources 1, 2], [Source 1, 3]
    bracket_pattern = r"\[(?:Sources?|Source)\s*([^\]]+)\]"
    for bracket_content in re.findall(bracket_pattern, answer, flags=re.IGNORECASE):
        digits = re.findall(r"\b\d+\b", bracket_content)
        for d in digits:
            add_id(d)

    # 2. Match standalone "Source X" or "Sources X"
    standalone_pattern = r"\bSources?\s*(\d+)\b"
    for d in re.findall(standalone_pattern, answer, flags=re.IGNORECASE):
        add_id(d)

    # 3. Fallback: If no Source IDs were found, check if answer already has [Page X] citations
    if not cited_ids and source_map:
        page_pattern = r"\[Page\s*(\d+)\]"
        cited_pages = set(int(p) for p in re.findall(page_pattern, answer, flags=re.IGNORECASE))
        if cited_pages:
            for sid, meta in source_map.items():
                if meta.get("page_number") in cited_pages and sid not in seen:
                    seen.add(sid)
                    cited_ids.append(sid)

    return cited_ids


def get_cited_sources(answer, source_map, question=None):
    """
    Extracts only the sources that are actually cited and used in the LLM answer.
    Ensures every source has the correct original page number, clean excerpt, and removes duplicates.
    """
    if not source_map or not isinstance(source_map, dict):
        return []

    cited_ids = extract_cited_source_ids(answer, source_map)
    if not cited_ids:
        return []

    sources = []
    seen_dedup_keys = set()

    for sid in cited_ids:
        meta = source_map[sid]
        page_num = meta.get("page_number")
        if page_num is not None:
            try:
                page_num = int(page_num)
            except (ValueError, TypeError):
                pass

        doc_id = meta.get("document_id")
        chunk_id = meta.get("chunk_id")
        raw_text = (meta.get("text") or "").strip()
        cleaned_text = clean_source_text(raw_text)
        excerpt = extract_meaningful_excerpt(cleaned_text, question=question, answer=answer)

        # Deduplicate sources if exact same chunk or identical page + text prefix
        norm_text = re.sub(r"\s+", " ", cleaned_text)[:80]
        dedup_key = (doc_id, page_num, norm_text)

        if dedup_key in seen_dedup_keys:
            continue
        seen_dedup_keys.add(dedup_key)

        sources.append({
            "source_id": sid,
            "document_id": doc_id,
            "page_number": page_num,
            "chunk_id": chunk_id,
            "text": cleaned_text,
            "excerpt": excerpt,
        })

    return sources


def replace_source_ids(
    answer,
    source_map
):
    """
    Replaces Source IDs in the LLM answer with their actual page citations [Page X].
    Deduplicates repeated page citations within bracket groups (e.g. [Page 2, Page 2] -> [Page 2]).
    """
    if not answer or not isinstance(answer, str):
        return ""

    if not source_map or not isinstance(source_map, dict):
        return answer

    def replace_bracket(match):
        bracket_content = match.group(1)
        digits = re.findall(r"\b\d+\b", bracket_content)
        pages = []
        seen_pages = set()
        for d in digits:
            sid = f"Source {d}"
            if sid in source_map:
                p = source_map[sid].get("page_number", 1)
                if p not in seen_pages:
                    seen_pages.add(p)
                    pages.append(p)
        if not pages:
            return match.group(0)
        return " ".join(f"[Page {p}]" for p in pages)

    # 1. Replace bracketed citations like [Source 1], [Source 1, Source 2], [Sources 1, 2]
    bracket_pattern = r"\[(?:Sources?|Source)\s*([^\]]+)\]"
    updated_answer = re.sub(bracket_pattern, replace_bracket, answer, flags=re.IGNORECASE)

    # 2. Clean up any remaining standalone "Source X"
    def replace_standalone(match):
        sid = f"Source {match.group(1)}"
        if sid in source_map:
            p = source_map[sid].get("page_number", 1)
            return f"Page {p}"
        return match.group(0)

    updated_answer = re.sub(r"\bSources?\s*(\d+)\b", replace_standalone, updated_answer, flags=re.IGNORECASE)

    # 3. Clean up any adjacent duplicate page citations like [Page 2] [Page 2] -> [Page 2]
    updated_answer = re.sub(r"(\[Page\s+\d+\])(?:\s+\1)+", r"\1", updated_answer, flags=re.IGNORECASE)

    return updated_answer