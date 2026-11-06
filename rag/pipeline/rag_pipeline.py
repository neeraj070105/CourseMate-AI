import os
import sys
import re
import time
from pathlib import Path

# Add rag-service root to Python import path.
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from services.pdf_parser import extract_text_from_pdf
from chunking.recursive_chunker import create_chunk_metadata

from embeddings.embedding_service import (
    generate_embedding,
    generate_query_embedding
)

from vector_store.chroma_store import (
    add_chunk,
    search_chunks
)

from bm25.bm25_index import (
    build_bm25_index,
    search_bm25
)

from hybrid.hybrid_retriever import reciprocal_rank_fusion
from reranking.cross_encoder import rerank_chunks

from prompt.prompt_builder import build_prompt
from prompt.citation_handler import (
    replace_source_ids,
    get_cited_sources
)

from llm.gemini_generator import generate_answer
from llm.query_rewriter import rewrite_query


# Default test PDF path
PDF_PATH = "citation_multi_chunk_test.pdf"


class CourseMateRAG:
    """
    Complete local-PDF RAG pipeline.
    """

    def __init__(self, pdf_path=None, document_id=None, chunks=None):

        from vector_store.chroma_store import collection
        self.collection = collection

        # If chunks are already loaded (e.g. from existing ChromaDB store)
        if chunks is not None:
            self.document_id = str(document_id) if document_id else "unknown"
            self.pdf_path = Path(pdf_path) if pdf_path else None
            self.chunks = chunks
            self.ocr_info = {"ocr_used": False, "ocr_pages": [], "total_pages": 0, "ocr_errors": []}
            self.ocr_used = False
            self.ocr_pages = []
            self.total_pages = 0
            self.bm25 = build_bm25_index(self.chunks)
            return

        if not pdf_path:
            raise ValueError("pdf_path is required when chunks are not provided.")

        # Convert the path into a Path object
        self.pdf_path = Path(pdf_path).expanduser()

        # Resolve relative paths from rag-service.
        if not self.pdf_path.is_absolute():
            self.pdf_path = BASE_DIR / self.pdf_path

        self.pdf_path = self.pdf_path.resolve()

        if not self.pdf_path.is_file():
            raise FileNotFoundError(
                f"PDF file not found: {self.pdf_path}"
            )

        if self.pdf_path.suffix.lower() != ".pdf":
            raise ValueError("Please select a PDF file.")

        # Create a stable document ID from the PDF filename or use provided document_id.
        if document_id:
            self.document_id = str(document_id)
        else:
            self.document_id = re.sub(
                r"[^a-zA-Z0-9_-]+",
                "_",
                self.pdf_path.stem
            ).strip("_")

        if not self.document_id:
            raise ValueError("Invalid PDF filename.")

        # Remove old chunks for this document only.
        self.collection.delete(
            where={"document_id": self.document_id}
        )

        # 1. Parse and clean the selected PDF (with automatic OCR for scanned or handwritten pages).
        pages, ocr_info = extract_text_from_pdf(
            str(self.pdf_path),
            return_info=True
        )

        if not pages or not any(
            page["text"].strip() for page in pages
        ):
            raise ValueError(
                "No extractable text found in this PDF. The document contains neither selectable digital text nor readable scanned/handwritten content."
            )

        self.ocr_info = ocr_info
        self.ocr_used = bool(ocr_info.get("ocr_used", False))
        self.ocr_pages = list(ocr_info.get("ocr_pages", []))
        self.total_pages = len(pages)

        # 2. Create chunks and preserve page metadata.
        self.chunks = create_chunk_metadata(
            pages,
            document_id=self.document_id,
            chunk_size=500,
            chunk_overlap=50
        )

        if not self.chunks:
            raise ValueError("No chunks were created from extracted text.")

        # 3. Generate embeddings and store each chunk in ChromaDB.
        # Batch additions in groups of 20 to reduce disk I/O contention on large PDFs.
        batch_ids = []
        batch_docs = []
        batch_embeddings = []
        batch_metas = []

        for chunk in self.chunks:
            embedding = generate_embedding(
                chunk["text"]
            )
            # Gentle pacing to avoid API burst limits
            time.sleep(0.04)

            batch_ids.append(chunk["chunk_id"])
            batch_docs.append(chunk["text"])
            batch_embeddings.append(embedding)
            batch_metas.append({
                "document_id": chunk["document_id"],
                "page_number": chunk["page_number"],
                "chunk_index": chunk["chunk_index"]
            })

            if len(batch_ids) >= 20:
                self.collection.add(
                    ids=batch_ids,
                    documents=batch_docs,
                    embeddings=batch_embeddings,
                    metadatas=batch_metas
                )
                batch_ids, batch_docs, batch_embeddings, batch_metas = [], [], [], []

        if batch_ids:
            self.collection.add(
                ids=batch_ids,
                documents=batch_docs,
                embeddings=batch_embeddings,
                metadatas=batch_metas
            )

        # 4. Build BM25 using only this PDF's chunks.
        self.bm25 = build_bm25_index(
            self.chunks
        )

        if os.getenv("DEBUG", "").lower() in ("true", "1"):
            print("\n===== PDF INGESTION COMPLETE =====")
            print("PDF:", self.pdf_path.name)
            print("Path:", self.pdf_path)
            print("Document ID:", self.document_id)
            print("Pages:", len(pages))
            print("Chunks stored:", len(self.chunks))
            print("OCR used:", self.ocr_used)
            if self.ocr_used:
                print("OCR pages:", self.ocr_pages)

    def ask(
        self,
        question,
        rewritten_question=None,
        chat_history=None,
        retrieval_k=10,
        final_k=5
    ):
        """
        Retrieves relevant chunks and generates
        an answer with page citations.
        Supports conversational query rewriting and retrieval fallback.
        """

        if not question or not question.strip():
            return {
                "question": question,
                "answer": "Please enter a question.",
                "sources": []
            }

        # If rewritten_question was not pre-computed but chat_history was provided,
        # rewrite the query into a standalone question using Gemini
        if (not rewritten_question or not rewritten_question.strip()) and chat_history:
            rewritten_question = rewrite_query(question=question, chat_history=chat_history)

        search_query = (
            rewritten_question.strip()
            if rewritten_question and rewritten_question.strip()
            else question.strip()
        )

        is_profile = os.getenv("PROFILE", "").lower() in ("true", "1") or os.getenv("DEBUG", "").lower() in ("true", "1")
        t_start = time.perf_counter()

        # 5. Generate the question embedding using the search query.
        t0 = time.perf_counter()
        query_embedding = generate_query_embedding(
            search_query
        )
        t_emb = time.perf_counter() - t0

        # 6. Vector search within the selected PDF.
        t0 = time.perf_counter()
        vector_data = search_chunks(
            query_embedding,
            top_k=min(retrieval_k, len(self.chunks)),
            document_id=self.document_id
        )

        vector_results = []

        ids = vector_data["ids"][0]
        documents = vector_data["documents"][0]
        metadatas = vector_data["metadatas"][0]
        distances = vector_data["distances"][0]

        for i in range(len(ids)):

            vector_results.append({
                "chunk_id": ids[i],
                "document_id": metadatas[i]["document_id"],
                "page_number": metadatas[i]["page_number"],
                "text": documents[i],
                "vector_distance": distances[i]
            })
        t_vec = time.perf_counter() - t0

        # 7. BM25 keyword search within this PDF using the search query.
        t0 = time.perf_counter()
        bm25_results = search_bm25(
            question=search_query,
            chunks=self.chunks,
            bm25=self.bm25,
            top_k=min(retrieval_k, len(self.chunks))
        )
        t_bm25 = time.perf_counter() - t0

        # 8. Combine vector search and BM25 using RRF.
        t0 = time.perf_counter()
        hybrid_candidates = reciprocal_rank_fusion(
            vector_results=vector_results,
            bm25_results=bm25_results,
            top_k=retrieval_k,
            rrf_k=60
        )
        t_rrf = time.perf_counter() - t0

        # Retrieval Fallback:
        # If query rewriting produced poor or empty results, try retrieval using the original question
        # and combine useful retrieval results using the existing RRF mechanism, avoiding duplicate chunks.
        if search_query.lower() != question.strip().lower():
            is_poor_result = len(hybrid_candidates) == 0 or (
                len(hybrid_candidates) < 2 and hybrid_candidates[0].get("rrf_score", 0) < 0.02
            )
            if is_poor_result:
                orig_embedding = generate_query_embedding(question.strip())
                orig_vector_data = search_chunks(
                    orig_embedding,
                    top_k=min(retrieval_k, len(self.chunks)),
                    document_id=self.document_id
                )
                orig_vec_results = []
                o_ids = orig_vector_data["ids"][0]
                o_docs = orig_vector_data["documents"][0]
                o_metas = orig_vector_data["metadatas"][0]
                o_dists = orig_vector_data["distances"][0]
                for i in range(len(o_ids)):
                    orig_vec_results.append({
                        "chunk_id": o_ids[i],
                        "document_id": o_metas[i]["document_id"],
                        "page_number": o_metas[i]["page_number"],
                        "text": o_docs[i],
                        "vector_distance": o_dists[i]
                    })
                orig_bm25_results = search_bm25(
                    question=question.strip(),
                    chunks=self.chunks,
                    bm25=self.bm25,
                    top_k=min(retrieval_k, len(self.chunks))
                )
                orig_hybrid = reciprocal_rank_fusion(
                    vector_results=orig_vec_results,
                    bm25_results=orig_bm25_results,
                    top_k=retrieval_k,
                    rrf_k=60
                )
                if orig_hybrid:
                    if hybrid_candidates:
                        hybrid_candidates = reciprocal_rank_fusion(
                            vector_results=hybrid_candidates,
                            bm25_results=orig_hybrid,
                            top_k=retrieval_k,
                            rrf_k=60
                        )
                    else:
                        hybrid_candidates = orig_hybrid

        # 9. Rerank the hybrid candidates using Cross-Encoder.
        t0 = time.perf_counter()
        final_chunks = rerank_chunks(
            question=search_query,
            chunks=hybrid_candidates,
            top_k=min(final_k, len(hybrid_candidates))
        )
        t_rerank = time.perf_counter() - t0

        if not final_chunks:
            return {
                "question": question,
                "rewritten_question": search_query,
                "answer": (
                    "The information was not found "
                    "in the provided course material."
                ),
                "sources": []
            }

        # 10. Build the prompt and source mapping.
        t0 = time.perf_counter()
        prompt, source_map = build_prompt(
            question=search_query,
            chunks=final_chunks
        )
        t_prompt = time.perf_counter() - t0

        # 11. Generate the answer using Gemini.
        t0 = time.perf_counter()
        answer = generate_answer(prompt)
        t_gen = time.perf_counter() - t0

        if not answer or not answer.strip():
            raise RuntimeError("Gemini failed to generate an answer from the retrieved document context.")

        # 12. Extract only cited sources and convert Source IDs to actual page citations.
        t0 = time.perf_counter()
        cited_sources = get_cited_sources(
            answer,
            source_map,
            question=search_query
        )
        final_answer = replace_source_ids(
            answer,
            source_map
        )
        t_cite = time.perf_counter() - t0

        t_total = time.perf_counter() - t_start
        print(
            f"[CourseMate RAG Timing] doc={self.document_id} | "
            f"emb={t_emb:.3f}s | vec={t_vec:.3f}s | bm25={t_bm25:.3f}s | "
            f"rrf={t_rrf:.3f}s | rerank={t_rerank:.3f}s | prompt={t_prompt:.3f}s | "
            f"gen={t_gen:.3f}s | cite={t_cite:.3f}s | total={t_total:.3f}s"
        )

        if is_profile:
            print("\n[PROFILING] Pipeline Stage Breakdown:")
            print(f"  1. Query embedding:          {t_emb:.4f}s")
            print(f"  2. ChromaDB vector search:   {t_vec:.4f}s")
            print(f"  3. BM25 keyword search:      {t_bm25:.4f}s")
            print(f"  4. Reciprocal Rank Fusion:   {t_rrf:.4f}s")
            print(f"  5. CrossEncoder reranking:   {t_rerank:.4f}s")
            print(f"  6. Prompt construction:      {t_prompt:.4f}s")
            print(f"  7. Gemini answer generation: {t_gen:.4f}s")
            print(f"  8. Citation replacement:     {t_cite:.4f}s")
            print(f"  Total ask execution time:    {t_total:.4f}s\n")

        # 13. Return the answer and only cited source metadata.
        return {
            "question": question,
            "rewritten_question": search_query,
            "answer": final_answer,
            "sources": cited_sources
        }

    @classmethod
    def load_from_store(cls, document_id):
        """
        Loads an existing document from ChromaDB without re-embedding.
        Rebuilds the in-memory BM25 index from stored chunks.
        """
        from vector_store.chroma_store import collection
        data = collection.get(
            where={"document_id": str(document_id)},
            include=["documents", "metadatas"]
        )
        if not data or not data.get("ids") or len(data["ids"]) == 0:
            return None

        chunks = []
        for i in range(len(data["ids"])):
            meta = data["metadatas"][i] or {}
            chunks.append({
                "chunk_id": data["ids"][i],
                "document_id": meta.get("document_id", document_id),
                "page_number": meta.get("page_number", 1),
                "chunk_index": meta.get("chunk_index", i),
                "text": data["documents"][i]
            })

        chunks.sort(key=lambda c: (c["page_number"], c["chunk_index"]))
        return cls(pdf_path=None, document_id=str(document_id), chunks=chunks)


def main():

    try:
        rag = CourseMateRAG(PDF_PATH)

    except Exception as error:
        print(f"Error loading PDF: {error}")
        return

    while True:

        question = input(
            "\nAsk a question (type 'exit' to quit): "
        )

        if question.strip().lower() == "exit":
            print("CourseMate AI stopped.")
            break

        try:
            result = rag.ask(question)

            print(f"\nQuestion:\n{question}\n")
            print(result["answer"])

            if os.getenv("DEBUG", "").lower() in ("true", "1"):
                print("\n===== SOURCES =====")
                for source in result["sources"]:
                    print(
                        f"{source['source_id']} | "
                        f"Document: {source['document_id']} | "
                        f"Page: {source['page_number']} | "
                        f"Chunk: {source['chunk_id']}"
                    )

        except Exception as error:
            print(f"Error: {error}")


if __name__ == "__main__":
    main()
