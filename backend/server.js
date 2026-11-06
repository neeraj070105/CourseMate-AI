const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const connectDB = require("./config/db");
const errorHandler = require("./middleware/errorHandler");

const authRoutes = require("./routes/authRoutes");
const documentRoutes = require("./routes/documentRoutes");
const chatRoutes = require("./routes/chatRoutes");
const { checkHealth: checkRAGHealth } = require("./services/ragClientService");
const { isCloudinaryConfigured } = require("./config/cloudinary");

const app = express();

// Connect to MongoDB
connectDB();

// Core Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/chat", chatRoutes);

// Health check and root endpoints
app.get("/", (req, res) => {
  res.json({
    name: "CourseMate AI Backend API",
    version: "1.0.0",
    status: "running",
    modes: ["Ask from My PDF", "Ask Anything"],
  });
});

app.get("/api/health", async (req, res) => {
  const ragHealth = await checkRAGHealth();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    cloudinaryConfigured: isCloudinaryConfigured(),
    pythonRAGService: ragHealth,
  });
});

// Centralized error handling middleware
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`CourseMate AI Backend running on port ${PORT}`);
});

module.exports = { app, server };