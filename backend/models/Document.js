const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    documentId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    originalName: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    cloudinaryId: {
      type: String,
      default: null,
    },
    cloudinaryUrl: {
      type: String,
      default: null,
    },
    cloudinaryResourceType: {
      type: String,
      default: null,
    },
    localPath: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
      index: true,
    },
    processingStage: {
      type: String,
      enum: ["uploading", "extracting", "chunking", "embedding", "indexing", "ready", "failed"],
      default: "uploading",
    },
    ocrUsed: {
      type: Boolean,
      default: false,
    },
    ocrPages: {
      type: [Number],
      default: [],
    },
    totalPages: {
      type: Number,
      default: 0,
    },
    chunkCount: {
      type: Number,
      default: 0,
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Document", documentSchema);
