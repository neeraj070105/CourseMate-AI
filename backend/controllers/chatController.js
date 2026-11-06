const mongoose = require("mongoose");
const Document = require("../models/Document");
const Message = require("../models/Message");
const Chat = require("../models/Chat");
const { generateGeneralAnswer, rewritePdfQuery } = require("../services/geminiService");
const { askQuestion } = require("../services/ragClientService");

/**
 * Generate a clean, compact title from the first question
 */
const generateTitle = (text) => {
  if (!text || typeof text !== "string") return "New Chat";
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 45) return cleaned;
  return cleaned.slice(0, 42) + "...";
};

/**
 * List all saved conversations for the authenticated user
 * GET /api/chat
 */
const getChats = async (req, res, next) => {
  try {
    const chats = await Chat.find({ userId: req.user._id })
      .select("title mode documentId documentName createdAt updatedAt messages")
      .sort({ updatedAt: -1 });

    const formattedChats = chats.map((chat) => ({
      _id: chat._id,
      title: chat.title,
      mode: chat.mode,
      documentId: chat.documentId,
      documentName: chat.documentName,
      messageCount: chat.messages ? chat.messages.length : 0,
      lastMessage:
        chat.messages && chat.messages.length > 0
          ? chat.messages[chat.messages.length - 1].content
          : "",
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    }));

    res.json({
      success: true,
      count: formattedChats.length,
      data: formattedChats,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new empty conversation
 * POST /api/chat
 */
const createChat = async (req, res, next) => {
  try {
    const { title, mode = "general", documentId } = req.body;
    let documentName = null;

    if (mode === "pdf" && documentId) {
      const docRecord = await Document.findOne({
        documentId,
        userId: req.user._id,
      });

      if (!docRecord) {
        return res.status(404).json({
          success: false,
          error: "Selected document not found or access denied.",
        });
      }
      documentName = docRecord.originalName;
    }

    const chat = await Chat.create({
      userId: req.user._id,
      title: title ? generateTitle(title) : "New Chat",
      mode: mode === "pdf" ? "pdf" : "general",
      documentId: mode === "pdf" ? documentId : null,
      documentName: mode === "pdf" ? documentName : null,
      messages: [],
    });

    res.status(201).json({
      success: true,
      data: chat,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific chat with all its messages
 * GET /api/chat/:id
 */
const getChatById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid chat ID.",
      });
    }

    const chat = await Chat.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        error: "Chat conversation not found or access denied.",
      });
    }

    // Check if associated PDF document is still available in the user's uploaded library
    let isDocumentAvailable = true;
    if (chat.mode === "pdf" && chat.documentId) {
      const docExists = await Document.findOne({
        documentId: chat.documentId,
        userId: req.user._id,
      });
      isDocumentAvailable = Boolean(docExists);
    }

    res.json({
      success: true,
      data: {
        ...chat.toObject(),
        isDocumentAvailable,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a specific chat
 * DELETE /api/chat/:id
 */
const deleteChat = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid chat ID.",
      });
    }

    const chat = await Chat.findOneAndDelete({
      _id: id,
      userId: req.user._id,
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        error: "Chat conversation not found or access denied.",
      });
    }

    res.json({
      success: true,
      message: "Chat conversation deleted successfully.",
      deletedId: id,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Ask Anything mode (General AI Chat via Gemini)
 * POST /api/chat/general
 */
const askGeneral = async (req, res, next) => {
  try {
    const { question, chatId } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({
        success: false,
        error: "Please enter a question.",
      });
    }

    let chat = null;

    if (chatId) {
      if (!mongoose.Types.ObjectId.isValid(chatId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid chat ID.",
        });
      }

      chat = await Chat.findOne({
        _id: chatId,
        userId: req.user._id,
      });

      if (!chat) {
        return res.status(404).json({
          success: false,
          error: "Chat conversation not found or access denied.",
        });
      }

      if (chat.mode !== "general") {
        return res.status(400).json({
          success: false,
          error: "This chat conversation is configured for PDF mode.",
        });
      }
    } else {
      // Create new chat session
      chat = new Chat({
        userId: req.user._id,
        title: generateTitle(question),
        mode: "general",
        messages: [],
      });
    }

    // Retrieve last few messages from this conversation for context
    const recentMessages = chat.messages ? chat.messages.slice(-6) : [];
    const historyForContext = recentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const tStartGen = Date.now();
    // Call Gemini directly through Node backend
    const answer = await generateGeneralAnswer(question.trim(), historyForContext);
    const genElapsed = Date.now() - tStartGen;
    console.log(`[ChatController:General] Answer generated in ${genElapsed}ms for user ${req.user._id}`);

    // Update title if chat had default name
    if (chat.title === "New Chat" || !chat.title) {
      chat.title = generateTitle(question);
    }

    // Persist user question and assistant answer inside the chat document
    chat.messages.push({
      role: "user",
      content: question.trim(),
      timestamp: new Date(),
    });

    chat.messages.push({
      role: "assistant",
      content: answer,
      timestamp: new Date(),
    });

    await chat.save();

    // Also sync to legacy Message model if needed
    try {
      await Message.create([
        {
          userId: req.user._id,
          mode: "general",
          role: "user",
          content: question.trim(),
        },
        {
          userId: req.user._id,
          mode: "general",
          role: "assistant",
          content: answer,
        },
      ]);
    } catch (legacyErr) {
      // Ignore legacy errors
    }

    res.json({
      success: true,
      data: {
        chatId: chat._id,
        title: chat.title,
        question: question.trim(),
        answer,
        mode: "general",
        chat,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Ask from My PDF mode (RAG pipeline on selected document)
 * POST /api/chat/pdf
 */
const askPDF = async (req, res, next) => {
  try {
    const { question, documentId, chatId } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({
        success: false,
        error: "Please enter a question.",
      });
    }

    let chat = null;
    let targetDocId = documentId;

    if (chatId) {
      if (!mongoose.Types.ObjectId.isValid(chatId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid chat ID.",
        });
      }

      chat = await Chat.findOne({
        _id: chatId,
        userId: req.user._id,
      });

      if (!chat) {
        return res.status(404).json({
          success: false,
          error: "Chat conversation not found or access denied.",
        });
      }

      if (chat.mode !== "pdf") {
        return res.status(400).json({
          success: false,
          error: "This chat conversation is configured for general mode.",
        });
      }

      targetDocId = chat.documentId || documentId;
    }

    if (!targetDocId) {
      return res.status(400).json({
        success: false,
        error: "Please select a PDF document to ask questions about.",
      });
    }

    // Validate document ownership and processing status
    const docRecord = await Document.findOne({
      documentId: targetDocId,
      userId: req.user._id,
    });

    if (!docRecord) {
      return res.status(404).json({
        success: false,
        error:
          "The selected document was not found or has been deleted. New questions cannot be submitted.",
      });
    }

    if (docRecord.status !== "completed") {
      return res.status(400).json({
        success: false,
        error: `Document is currently ${docRecord.status}. Please wait until processing completes.`,
      });
    }

    // If new chat session
    if (!chat) {
      chat = new Chat({
        userId: req.user._id,
        title: generateTitle(question),
        mode: "pdf",
        documentId: docRecord.documentId,
        documentName: docRecord.originalName,
        messages: [],
      });
    }

    // Retrieve last 6 messages (3 user-assistant pairs) from the SAME conversation for context
    const recentMessages = chat.messages ? chat.messages.slice(-6) : [];
    const historyForContext = recentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Send previous messages and current question to Gemini for query rewriting
    let rewrittenQuestion = question.trim();
    if (historyForContext.length > 0) {
      const tStartRewrite = Date.now();
      rewrittenQuestion = await rewritePdfQuery(question.trim(), historyForContext);
      const rewriteElapsed = Date.now() - tStartRewrite;
      console.log(`[ChatController:PDF] Query rewritten in ${rewriteElapsed}ms: "${question.trim()}" -> "${rewrittenQuestion}"`);
    }

    const tStartPdf = Date.now();
    // Call Python RAG microservice with target documentId restriction, rewritten question, and history
    const ragResponse = await askQuestion(
      question.trim(),
      targetDocId,
      10,
      5,
      rewrittenQuestion,
      historyForContext
    );
    const pdfElapsed = Date.now() - tStartPdf;
    console.log(`[ChatController:PDF] RAG query for doc '${targetDocId}' answered in ${pdfElapsed}ms for user ${req.user._id}`);

    const answer =
      ragResponse.answer || "The information was not found in the provided course material.";
    const rawSources = Array.isArray(ragResponse.sources) ? ragResponse.sources : [];
    const sources = rawSources.map((src) => ({
      source_id: src.source_id || null,
      document_id: src.document_id || targetDocId,
      page_number: src.page_number != null ? Number(src.page_number) : null,
      chunk_id: src.chunk_id || null,
      text: src.text || null,
      excerpt: src.excerpt || null,
    }));

    // Update title if needed
    if (chat.title === "New Chat" || !chat.title) {
      chat.title = generateTitle(question);
    }

    // Persist conversation with source citations
    chat.messages.push({
      role: "user",
      content: question.trim(),
      timestamp: new Date(),
    });

    chat.messages.push({
      role: "assistant",
      content: answer,
      sources,
      timestamp: new Date(),
    });

    await chat.save();

    // Also sync to legacy Message model
    try {
      await Message.create([
        {
          userId: req.user._id,
          mode: "pdf",
          documentId: targetDocId,
          role: "user",
          content: question.trim(),
        },
        {
          userId: req.user._id,
          mode: "pdf",
          documentId: targetDocId,
          role: "assistant",
          content: answer,
          sources,
        },
      ]);
    } catch (legacyErr) {
      // Ignore legacy errors
    }

    res.json({
      success: true,
      data: {
        chatId: chat._id,
        title: chat.title,
        question: question.trim(),
        answer,
        sources,
        mode: "pdf",
        documentId: docRecord.documentId,
        documentName: docRecord.originalName,
        chat,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get chat history (backward-compatible)
 * GET /api/chat/history?mode=general|pdf&documentId=...
 */
const getChatHistory = async (req, res, next) => {
  try {
    const { mode, documentId } = req.query;

    const query = { userId: req.user._id };
    if (mode) query.mode = mode;
    if (documentId) query.documentId = documentId;

    const messages = await Message.find(query).sort({ createdAt: 1 }).limit(100);

    res.json({
      success: true,
      count: messages.length,
      data: messages,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Clear chat history (backward-compatible)
 * DELETE /api/chat/history?mode=general|pdf&documentId=...
 */
const clearChatHistory = async (req, res, next) => {
  try {
    const { mode, documentId } = req.query;

    const query = { userId: req.user._id };
    if (mode) query.mode = mode;
    if (documentId) query.documentId = documentId;

    await Message.deleteMany(query);

    res.json({
      success: true,
      message: "Chat history cleared successfully.",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getChats,
  createChat,
  getChatById,
  deleteChat,
  askGeneral,
  askPDF,
  getChatHistory,
  clearChatHistory,
};
