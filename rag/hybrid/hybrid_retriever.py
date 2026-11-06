def reciprocal_rank_fusion(
    vector_results,
    bm25_results,
    top_k=5,
    rrf_k=60
):
    """
    Combines Vector Search and BM25 results
    using Reciprocal Rank Fusion (RRF).
    """

    scores = {}
    result_data = {}

    # Process Vector Search results
    for rank, result in enumerate(vector_results, start=1):

        chunk_id = result["chunk_id"]

        if chunk_id not in scores:
            scores[chunk_id] = 0

        scores[chunk_id] += 1 / (rrf_k + rank)

        result_data[chunk_id] = result

    # Process BM25 results
    for rank, result in enumerate(bm25_results, start=1):

        chunk_id = result["chunk_id"]

        if chunk_id not in scores:
            scores[chunk_id] = 0

        scores[chunk_id] += 1 / (rrf_k + rank)

        result_data[chunk_id] = result

    # Create final results
    final_results = []

    for chunk_id, score in scores.items():

        result = result_data[chunk_id].copy()

        result["rrf_score"] = score

        final_results.append(result)

    # Sort by RRF score
    final_results.sort(
        key=lambda x: x["rrf_score"],
        reverse=True
    )

    return final_results[:top_k]