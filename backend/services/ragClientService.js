const axios = require("axios");

const getRAGServiceUrl = () => {
  return process.env.PYTHON_RAG_URL || process.env.RAG_SERVICE_URL || "http://127.0.0.1:8000";
};

/**
 * Checks if the Python RAG microservice is up and reachable.
 */
const checkHealth = async () => {
  const baseUrl = getRAGServiceUrl();
  try {
    const res = await axios.get(`${baseUrl}/health`, { timeout: 4000 });
    return res.data;
  } catch (error) {
    return { status: "offline", error: error.message };
  }
};

/**
 * Requests the Python RAG service to parse, chunk, embed, and index a PDF.
 * Supports both Cloudinary URLs (pdf_url) and local file paths (pdf_path).
 * Configured with generous 5-minute timeout for large academic PDFs.
 *
 * @param {string|object} pdfSource - Cloudinary URL, local path, or { pdf_url, pdf_path }
 * @param {string} documentId - Unique document identifier
 */
const ingestDocument = async (pdfSource, documentId) => {
  const baseUrl = getRAGServiceUrl();
  let payload = { document_id: documentId };

  if (typeof pdfSource === "object" && pdfSource !== null) {
    if (pdfSource.pdf_url || pdfSource.pdfUrl) {
      payload.pdf_url = pdfSource.pdf_url || pdfSource.pdfUrl;
    }
    if (pdfSource.pdf_path || pdfSource.pdfPath) {
      payload.pdf_path = pdfSource.pdf_path || pdfSource.pdfPath;
    }
    if (pdfSource.document_id || pdfSource.documentId) {
      payload.document_id = pdfSource.document_id || pdfSource.documentId;
    }
  } else if (typeof pdfSource === "string") {
    if (pdfSource.startsWith("http://") || pdfSource.startsWith("https://")) {
      payload.pdf_url = pdfSource;
    } else {
      payload.pdf_path = pdfSource;
    }
  }

  const targetDocId = payload.document_id || documentId;

  try {
    const response = await axios.post(
      `${baseUrl}/ingest`,
      payload,
      {
        timeout: 300000, // 5 minutes for large PDFs with OCR & chunking
        headers: { "Content-Type": "application/json" },
      }
    );

    if (response.data && response.data.success === false) {
      throw new Error(response.data.error || "RAG service failed to ingest document.");
    }

    return response.data;
  } catch (error) {
    const detail = error.response?.data?.error || error.message;
    console.error(`Python RAG ingestion failed for document ${targetDocId}:`, detail);
    throw new Error(`RAG Ingestion Error: ${detail}`);
  }
};

/**
 * Asks a question against a specific document using the Python RAG pipeline.
 * Supports conversational query rewriting and context.
 * @param {string} question - Student question
 * @param {string} documentId - Document identifier
 * @param {number} retrieval_k - Optional initial retrieval count
 * @param {number} final_k - Optional final cross-encoder count
 * @param {string} rewrittenQuestion - Optional standalone rewritten question
 * @param {Array<{role: string, content: string}>} chatHistory - Optional conversation history
 */
const askQuestion = async (
  question,
  documentId,
  retrieval_k = 10,
  final_k = 5,
  rewrittenQuestion = null,
  chatHistory = []
) => {
  const baseUrl = getRAGServiceUrl();
  try {
    const response = await axios.post(
      `${baseUrl}/query`,
      {
        question,
        rewritten_question: rewrittenQuestion || question,
        chat_history: Array.isArray(chatHistory) ? chatHistory : [],
        document_id: documentId,
        retrieval_k,
        final_k,
      },
      {
        timeout: 60000,
        headers: { "Content-Type": "application/json" },
      }
    );

    if (response.data && response.data.success === false) {
      throw new Error(response.data.error || "RAG service failed to answer query.");
    }

    return response.data;
  } catch (error) {
    const detail = error.response?.data?.error || error.message;
    console.error(`Python RAG query failed for document ${documentId}:`, detail);
    throw new Error(`RAG Query Error: ${detail}`);
  }
};

/**
 * Deletes all stored chunks and BM25 index for a document in the Python RAG service.
 * @param {string} documentId - Document identifier
 */
const deleteDocumentData = async (documentId) => {
  const baseUrl = getRAGServiceUrl();
  try {
    const response = await axios.post(
      `${baseUrl}/delete`,
      {
        document_id: documentId,
      },
      {
        timeout: 10000,
        headers: { "Content-Type": "application/json" },
      }
    );

    if (response.data && response.data.success === false) {
      throw new Error(response.data.error || "RAG service failed to delete document.");
    }

    return response.data;
  } catch (error) {
    console.warn(`Python RAG delete error for ${documentId}:`, error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  checkHealth,
  ingestDocument,
  askQuestion,
  deleteDocumentData,
};
