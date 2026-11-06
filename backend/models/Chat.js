const mongoose = require("mongoose");

const sourceCitationSchema = new mongoose.Schema(
  {
    source_id: { type: String, default: null },
    document_id: { type: String, default: null },
    page_number: { type: Number, default: null },
    chunk_id: { type: String, default: null },
    text: { type: String, default: null },
    excerpt: { type: String, default: null },
  },
  { _id: false }
);

const messageItemSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    sources: {
      type: [sourceCitationSchema],
      default: [],
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const chatSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      default: "New Chat",
    },
    mode: {
      type: String,
      enum: ["general", "pdf"],
      required: true,
      default: "general",
    },
    documentId: {
      type: String,
      default: null,
      index: true,
    },
    documentName: {
      type: String,
      default: null,
    },
    messages: [messageItemSchema],
  },
  {
    timestamps: true,
  }
);

// Compound index for user chat listing sorted by most recently updated
chatSchema.index({ userId: 1, updatedAt: -1 });

module.exports = mongoose.model("Chat", chatSchema);
