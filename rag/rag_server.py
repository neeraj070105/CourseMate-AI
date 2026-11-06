import json
import logging
import os
import sys
import tempfile
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

# Ensure rag-service root is on sys.path
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from pipeline.rag_pipeline import CourseMateRAG
from reranking.cross_encoder import get_reranker
from vector_store.chroma_store import collection

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s: %(message)s"
)
logger = logging.getLogger("CourseMate-RAG-Service")

# In-memory cache for active CourseMateRAG instances: document_id -> CourseMateRAG
_rag_cache = {}

# Set of document IDs currently being ingested (prevents duplicate jobs)
_active_ingestions = set()


def get_or_load_rag(document_id: str):
    """
    Retrieves an in-memory RAG instance for document_id.
    If not cached, attempts to restore it from ChromaDB chunks.
    """
    if document_id in _rag_cache:
        return _rag_cache[document_id]

    # Attempt to load from ChromaDB
    rag = CourseMateRAG.load_from_store(document_id)
    if rag is not None:
        _rag_cache[document_id] = rag
        logger.info(f"Loaded existing document '{document_id}' from ChromaDB ({len(rag.chunks)} chunks).")
        return rag

    return None


class RAGRequestHandler(BaseHTTPRequestHandler):
    """
    HTTP Request Handler for CourseMate RAG Microservice.
    """

    def _set_headers(self, status_code=200, content_type="application/json"):
        self.send_response(status_code)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(HTTPStatus.NO_CONTENT)

    def _send_json(self, data, status_code=200):
        self._set_headers(status_code)
        payload = json.dumps(data).encode("utf-8")
        self.wfile.write(payload)

    def _read_json_body(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length <= 0:
                return {}
            body_bytes = self.rfile.read(content_length)
            return json.loads(body_bytes.decode("utf-8"))
        except Exception as err:
            logger.error(f"Failed to read/parse request body: {err}")
            return None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path in ("/health", "/"):
            self._send_json({
                "status": "ok",
                "service": "CourseMate-RAG",
                "models_loaded": True,
                "active_ingestions": list(_active_ingestions),
                "cached_documents": list(_rag_cache.keys())
            })
            return

        self._send_json({"error": "Not Found"}, status_code=404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/ingest":
            self.handle_ingest()
        elif path == "/query":
            self.handle_query()
        elif path == "/delete":
            self.handle_delete()
        else:
            self._send_json({"error": "Endpoint not found"}, status_code=404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/documents/"):
            document_id = path.replace("/documents/", "").strip()
            self._perform_delete(document_id)
            return

        self._send_json({"error": "Endpoint not found"}, status_code=404)

    def handle_ingest(self):
        data = self._read_json_body()
        if data is None:
            self._send_json({"error": "Invalid JSON body"}, status_code=400)
            return

        pdf_path = data.get("pdf_path")
        pdf_url = data.get("pdf_url")
        document_id = data.get("document_id")

        if not pdf_path and not pdf_url:
            self._send_json({"error": "Either 'pdf_url' or 'pdf_path' is required for ingestion"}, status_code=400)
            return

        # Prevent duplicate concurrent ingestion jobs for the same document
        if document_id and str(document_id) in _active_ingestions:
            logger.warning(f"Ingestion rejected: Document '{document_id}' is already actively processing.")
            self._send_json({
                "success": False,
                "error": f"Document '{document_id}' is already being processed. Please wait for the current job to complete."
            }, status_code=409)
            return

        if document_id:
            _active_ingestions.add(str(document_id))

        temp_path = None
        try:
            target_path = pdf_path
            if pdf_url:
                logger.info(f"Downloading PDF from URL for document_id '{document_id}': {pdf_url}")
                req = urllib.request.Request(
                    pdf_url,
                    headers={"User-Agent": "CourseMate-RAG-Service/1.0"}
                )
                with urllib.request.urlopen(req, timeout=60) as response:
                    if response.status != 200:
                        raise RuntimeError(f"Failed to download PDF from URL (HTTP status {response.status})")
                    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
                    temp_path = tmp.name
                    tmp.write(response.read())
                    tmp.close()
                target_path = temp_path

            logger.info(f"Starting ingestion for document_id '{document_id}' from path '{target_path}'")
            rag = CourseMateRAG(pdf_path=target_path, document_id=document_id)
            doc_id = rag.document_id
            _rag_cache[doc_id] = rag

            total_pages = getattr(rag, "total_pages", len(rag.chunks))
            ocr_used = getattr(rag, "ocr_used", False)
            ocr_pages = getattr(rag, "ocr_pages", [])

            logger.info(
                f"Ingestion complete for '{doc_id}': {len(rag.chunks)} chunks stored across {total_pages} pages "
                f"(OCR used: {ocr_used}, OCR pages: {ocr_pages})."
            )

            self._send_json({
                "success": True,
                "document_id": doc_id,
                "chunks_count": len(rag.chunks),
                "total_pages": total_pages,
                "ocr_used": ocr_used,
                "ocr_pages": ocr_pages,
                "message": "Document ingested successfully"
            })
        except FileNotFoundError as fnf_err:
            logger.error(f"File not found: {fnf_err}")
            self._send_json({"success": False, "error": str(fnf_err)}, status_code=404)
        except Exception as err:
            logger.error(f"Ingestion error for '{document_id}': {err}", exc_info=True)
            self._send_json({"success": False, "error": str(err)}, status_code=500)
        finally:
            if document_id:
                _active_ingestions.discard(str(document_id))
            if temp_path and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                    logger.info(f"Cleaned up temporary ingestion file: {temp_path}")
                except Exception as cleanup_err:
                    logger.warning(f"Failed to remove temp file {temp_path}: {cleanup_err}")

    def handle_query(self):
        data = self._read_json_body()
        if data is None:
            self._send_json({"error": "Invalid JSON body"}, status_code=400)
            return

        question = data.get("question", "").strip()
        rewritten_question = data.get("rewritten_question", "").strip()
        chat_history = data.get("chat_history", [])
        document_id = data.get("document_id", "").strip()
        retrieval_k = int(data.get("retrieval_k", 10))
        final_k = int(data.get("final_k", 5))

        if not question:
            self._send_json({"error": "'question' is required"}, status_code=400)
            return

        if not document_id:
            self._send_json({"error": "'document_id' is required to query PDF material"}, status_code=400)
            return

        try:
            rag = get_or_load_rag(document_id)
            if rag is None:
                self._send_json({
                    "success": False,
                    "error": f"Document '{document_id}' not found in RAG store. Please ingest first."
                }, status_code=404)
                return

            result = rag.ask(
                question=question,
                rewritten_question=rewritten_question,
                chat_history=chat_history,
                retrieval_k=retrieval_k,
                final_k=final_k
            )
            self._send_json({
                "success": True,
                "question": result.get("question", question),
                "rewritten_question": result.get("rewritten_question", rewritten_question or question),
                "answer": result.get("answer", ""),
                "sources": result.get("sources", [])
            })
        except Exception as err:
            logger.error(f"Query error for document '{document_id}': {err}", exc_info=True)
            self._send_json({"success": False, "error": str(err)}, status_code=500)

    def handle_delete(self):
        data = self._read_json_body()
        if not data or not data.get("document_id"):
            self._send_json({"error": "'document_id' is required"}, status_code=400)
            return

        document_id = data.get("document_id")
        self._perform_delete(document_id)

    def _perform_delete(self, document_id):
        if not document_id:
            self._send_json({"error": "Invalid document ID"}, status_code=400)
            return

        try:
            collection.delete(where={"document_id": str(document_id)})
            _rag_cache.pop(str(document_id), None)
            logger.info(f"Cleaned up chunks and cache for document '{document_id}'")
            self._send_json({
                "success": True,
                "document_id": document_id,
                "message": f"Document '{document_id}' data successfully removed."
            })
        except Exception as err:
            logger.error(f"Delete error: {err}", exc_info=True)
            self._send_json({"success": False, "error": str(err)}, status_code=500)

    def log_message(self, format, *args):
        logger.debug("%s - - [%s] %s" % (self.address_string(), self.log_date_time_string(), format % args))


def start_server(port=8000, host="127.0.0.1"):
    server_address = (host, port)
    logger.info(f"Pre-loading CrossEncoder model singleton...")
    get_reranker()
    logger.info("CrossEncoder model loaded.")

    httpd = ThreadingHTTPServer(server_address, RAGRequestHandler)
    logger.info(f"CourseMate Python RAG Service running on http://{host}:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down RAG service...")
        httpd.server_close()


if __name__ == "__main__":
    port = int(os.getenv("RAG_SERVICE_PORT", os.getenv("PORT", 8000)))
    start_server(port=port)
