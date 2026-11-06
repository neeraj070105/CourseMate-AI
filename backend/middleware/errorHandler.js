const errorHandler = (err, req, res, next) => {
  console.error("API Error:", err);

  // Multer-specific error handling
  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        error: "File size exceeds the maximum allowed limit of 10 MiB (10,485,760 bytes) on the Cloudinary Free plan.",
      });
    }
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`,
    });
  }

  // File format error from upload filter
  if (err.message && err.message.includes("Invalid file format")) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }

  // Specific Cloudinary size limit error
  if (err.message && err.message.includes("Cloudinary Free plan")) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      error: messages.join(", "),
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    return res.status(400).json({
      success: false,
      error: "A record with that identifier or email already exists.",
    });
  }

  const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
  res.status(statusCode).json({
    success: false,
    error: err.message || "An unexpected internal server error occurred.",
  });
};

module.exports = errorHandler;
