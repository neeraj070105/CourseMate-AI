const express = require("express");
const router = express.Router();
const {
  getChats,
  createChat,
  getChatById,
  deleteChat,
  askGeneral,
  askPDF,
  getChatHistory,
  clearChatHistory,
} = require("../controllers/chatController");
const { protect } = require("../middleware/auth");

// All chat routes require authentication
router.use(protect);

// Chat conversations CRUD
router.get("/", getChats);
router.post("/", createChat);

// Specific action routes (MUST come before /:id)
router.post("/general", askGeneral);
router.post("/pdf", askPDF);
router.get("/history", getChatHistory);
router.delete("/history", clearChatHistory);

// Single conversation routes
router.get("/:id", getChatById);
router.delete("/:id", deleteChat);

module.exports = router;
