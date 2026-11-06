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

const messageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    mode: {
      type: String,
      enum: ["general", "pdf"],
      required: true,
      index: true,
    },
    documentId: {
      type: String,
      default: null,
      index: true,
    },
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    sources: [sourceCitationSchema],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Message", messageSchema);
