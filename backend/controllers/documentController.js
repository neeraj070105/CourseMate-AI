const path = require("path");
const fs = require("fs");
const Document = require("../models/Document");
const Message = require("../models/Message");
const {
  uploadPDF,
  deletePDF,
  CLOUDINARY_MAX_RAW_SIZE_BYTES,
} = require("../services/cloudinaryService");
const { ingestDocument, deleteDocumentData } = require("../services/ragClientService");

/**
 * Asynchronously processes PDF ingestion in the background.
 * Updates MongoDB status to 'completed' or 'failed' without deleting Cloudinary files.
 * @param {string} docRecordId - MongoDB Document _id
 */
const processDocumentBackground = async (docRecordId) => {
  try {
    const docRecord = await Document.findById(docRecordId);
    if (!docRecord) return;

    docRecord.status = "processing";
    docRecord.processingStage = "extracting";
    await docRecord.save();

    const pdfSource = docRecord.cloudinaryUrl || docRecord.localPath;
    console.log(`[Background Ingestion] Starting RAG processing for doc '${docRecord.documentId}'...`);

    const ragResult = await ingestDocument(pdfSource, docRecord.documentId);

    docRecord.status = "completed";
    docRecord.processingStage = "ready";
    docRecord.chunkCount = ragResult.chunks_count || 0;
    docRecord.totalPages = ragResult.total_pages || 0;
    docRecord.ocrUsed = Boolean(ragResult.ocr_used);
    docRecord.ocrPages = Array.isArray(ragResult.ocr_pages) ? ragResult.ocr_pages : [];
    docRecord.errorMessage = null;
    await docRecord.save();

    console.log(
      `[Background Ingestion] Successfully completed for '${docRecord.documentId}' ` +
      `(${docRecord.chunkCount} chunks, OCR: ${docRecord.ocrUsed}).`
    );
  } catch (ragErr) {
    console.error(`[Background Ingestion] Error for document record ${docRecordId}:`, ragErr.message);

    try {
      const docRecord = await Document.findById(docRecordId);
      if (docRecord) {
        // Crucial: preserve Cloudinary URL and ID so retry is supported
        docRecord.status = "failed";
        docRecord.processingStage = "failed";
        docRecord.errorMessage = ragErr.message;
        await docRecord.save();
      }
    } catch (saveErr) {
      console.error("Failed to persist failed document status:", saveErr.message);
    }
  }
};

/**
 * Upload a PDF document, store metadata in MongoDB, upload to Cloudinary,
 * and trigger asynchronous background RAG ingestion.
 * POST /api/documents/upload
 */
const uploadDocument = async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        error: "No PDF file uploaded. Please select a valid PDF file.",
      });
    }

    const originalName = req.file.originalname;
    const fileSize = req.file.size;

    // Check file size against Cloudinary Free plan limit (10,485,760 bytes)
    if (fileSize > CLOUDINARY_MAX_RAW_SIZE_BYTES) {
      const sizeMb = (fileSize / (1024 * 1024)).toFixed(2);
      return res.status(400).json({
        success: false,
        error:
          `File size (${sizeMb} MB) exceeds Cloudinary Free Tier limit of 10 MB (10,485,760 bytes). ` +
          `Cloudinary's raw asset limit on the Free plan is strictly 10 MB. ` +
          `Please compress the PDF or upload a file under 10 MB.`,
      });
    }

    // Generates unique documentId for ChromaDB and tracking
    const cleanStem = path.parse(originalName).name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const documentId = `doc_${Date.now()}_${cleanStem}`.slice(0, 60);

    // 1. Upload PDF buffer directly to Cloudinary
    let cloudinaryResult = null;
    try {
      cloudinaryResult = await uploadPDF(req.file.buffer, originalName);
      if (!cloudinaryResult || !cloudinaryResult.secure_url) {
        throw new Error("Failed to obtain secure URL from Cloudinary.");
      }
    } catch (cldErr) {
      console.error("Cloudinary upload failed:", cldErr.message);
      return res.status(400).json({
        success: false,
        error: `Cloudinary upload failed: ${cldErr.message}`,
      });
    }

    // 2. Initial save in MongoDB with status: 'processing'
    let docRecord = null;
    try {
      docRecord = await Document.create({
        userId: req.user._id,
        documentId,
        originalName,
        fileSize: cloudinaryResult.bytes || fileSize,
        cloudinaryId: cloudinaryResult.public_id,
        cloudinaryUrl: cloudinaryResult.secure_url,
        cloudinaryResourceType: cloudinaryResult.resource_type || "raw",
        localPath: null,
        status: "processing",
        processingStage: "extracting",
      });
    } catch (dbErr) {
      console.error("MongoDB document creation failed:", dbErr.message);
      // Clean up orphaned Cloudinary upload if DB insert fails
      if (cloudinaryResult?.public_id) {
        try {
          await deletePDF(cloudinaryResult.public_id, cloudinaryResult.resource_type || "raw");
        } catch (delErr) {
          console.warn("Could not clean up Cloudinary upload after DB error:", delErr.message);
        }
      }
      return res.status(500).json({
        success: false,
        error: `Failed to save document record: ${dbErr.message}`,
      });
    }

    // 3. Trigger asynchronous background ingestion without blocking the HTTP response
    processDocumentBackground(docRecord._id);

    // 4. Return immediate 201 response with processing status
    return res.status(201).json({
      success: true,
      message: "PDF uploaded successfully. Processing started in background.",
      data: docRecord,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retry processing for a document that previously failed ingestion.
 * POST /api/documents/:id/retry
 */
const retryDocument = async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        error: "Document not found or access denied.",
      });
    }

    if (document.status === "processing") {
      return res.status(400).json({
        success: false,
        error: "Document is already being processed. Please wait.",
      });
    }

    if (!document.cloudinaryUrl && !document.localPath) {
      return res.status(400).json({
        success: false,
        error: "Document has no stored file URL or local path. Please re-upload the PDF.",
      });
    }

    // Reset status to processing
    document.status = "processing";
    document.processingStage = "extracting";
    document.errorMessage = null;
    await document.save();

    // Trigger background ingestion
    processDocumentBackground(document._id);

    res.json({
      success: true,
      message: "Document processing retry started.",
      data: document,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List all documents uploaded by the authenticated user.
 * GET /api/documents
 */
const getDocuments = async (req, res, next) => {
  try {
    const documents = await Document.find({ userId: req.user._id }).sort({
      createdAt: -1,
    });

    res.json({
      success: true,
      count: documents.length,
      data: documents,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get processing status and details of a single document.
 * GET /api/documents/:id/status
 */
const getDocumentStatus = async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        error: "Document not found or access denied.",
      });
    }

    res.json({
      success: true,
      data: {
        _id: document._id,
        documentId: document.documentId,
        originalName: document.originalName,
        status: document.status,
        processingStage: document.processingStage,
        ocrUsed: document.ocrUsed,
        ocrPages: document.ocrPages,
        totalPages: document.totalPages,
        chunkCount: document.chunkCount,
        errorMessage: document.errorMessage,
        cloudinaryUrl: document.cloudinaryUrl,
        createdAt: document.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Explicitly delete a document:
 * 1. Remove Cloudinary file
 * 2. Remove ChromaDB chunks and BM25 index for only this document
 * 3. Remove local file if stored
 * 4. Remove associated messages
 * 5. Remove MongoDB record
 * DELETE /api/documents/:id
 */
const deleteDocument = async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        error: "Document not found or access denied.",
      });
    }

    // 1. Delete from Cloudinary if stored
    if (document.cloudinaryId) {
      try {
        await deletePDF(document.cloudinaryId, document.cloudinaryResourceType || "raw");
      } catch (delErr) {
        console.warn(`Could not delete Cloudinary asset ${document.cloudinaryId}:`, delErr.message);
      }
    }

    // 2. Delete ChromaDB chunks & BM25 via Python RAG service (scoped by documentId)
    await deleteDocumentData(document.documentId);

    // 3. Remove local file if present
    if (document.localPath && fs.existsSync(document.localPath)) {
      try {
        fs.unlinkSync(document.localPath);
      } catch (err) {
        console.warn("Could not delete local file:", err.message);
      }
    }

    // 4. Remove associated messages
    await Message.deleteMany({
      userId: req.user._id,
      documentId: document.documentId,
    });

    // 5. Remove document record from MongoDB
    await document.deleteOne();

    res.json({
      success: true,
      message: `Document '${document.originalName}' and its associated data were deleted.`,
      documentId: document.documentId,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadDocument,
  retryDocument,
  getDocuments,
  getDocumentStatus,
  deleteDocument,
};
