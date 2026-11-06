const express = require("express");
const router = express.Router();
const {
  uploadDocument,
  retryDocument,
  getDocuments,
  getDocumentStatus,
  deleteDocument,
} = require("../controllers/documentController");
const { protect } = require("../middleware/auth");
const upload = require("../middleware/upload");

router.use(protect);

router.post("/upload", upload.single("pdf"), uploadDocument);
router.post("/:id/retry", retryDocument);
router.get("/", getDocuments);
router.get("/:id/status", getDocumentStatus);
router.delete("/:id", deleteDocument);

module.exports = router;
