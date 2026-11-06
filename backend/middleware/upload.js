const multer = require("multer");
const path = require("path");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const isPdfMime = file.mimetype === "application/pdf";
  const isPdfExt = path.extname(file.originalname).toLowerCase() === ".pdf";

  if (isPdfMime || isPdfExt) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file format. Only PDF files (.pdf) are permitted."), false);
  }
};

// 10 MiB limit (exact Cloudinary Free Plan raw asset limit: 10,485,760 bytes)
const MAX_PDF_SIZE_BYTES = 10485760;

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_PDF_SIZE_BYTES,
  },
  fileFilter,
});

module.exports = upload;
