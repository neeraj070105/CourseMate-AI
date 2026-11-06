const { cloudinary, isCloudinaryConfigured } = require("../config/cloudinary");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { Readable } = require("stream");

// Cloudinary Free plan enforces a strict 10 MB (10,485,760 bytes) limit on raw assets
const CLOUDINARY_MAX_RAW_SIZE_BYTES = 10485760; // 10 MB

/**
 * Uploads a PDF buffer or local file to Cloudinary.
 * Validates file size against Cloudinary's verified plan limits.
 * Uses upload_stream for standard sizes and chunked upload_large for large files.
 *
 * @param {Buffer|string} fileSource - File Buffer from multer memoryStorage or local file path
 * @param {string} originalName - Original filename for display and public_id naming
 * @returns {Promise<{ secure_url: string, public_id: string, resource_type: string, bytes: number }>}
 */
const uploadPDF = async (fileSource, originalName) => {
  if (!isCloudinaryConfigured()) {
    throw new Error(
      "Cloudinary is not configured. Missing required credentials in environment."
    );
  }

  if (!fileSource) {
    throw new Error("No file content provided for Cloudinary upload.");
  }

  // Determine file byte size
  let fileSize = 0;
  if (Buffer.isBuffer(fileSource)) {
    fileSize = fileSource.length;
  } else if (typeof fileSource === "string") {
    if (!fs.existsSync(fileSource)) {
      throw new Error(`Local file not found for upload: ${fileSource}`);
    }
    fileSize = fs.statSync(fileSource).size;
  } else {
    throw new Error("Invalid file source type. Expected a Buffer or file path string.");
  }

  // Strictly check against Cloudinary verified plan limit
  if (fileSize > CLOUDINARY_MAX_RAW_SIZE_BYTES) {
    const sizeMb = (fileSize / (1024 * 1024)).toFixed(2);
    throw new Error(
      `File size too large (${sizeMb} MB). Maximum allowed size on Cloudinary Free plan is 10 MB (10,485,760 bytes). ` +
      `Please compress the PDF to under 10 MB.`
    );
  }

  const cleanName = path
    .parse(originalName || "document")
    .name
    .replace(/[^a-zA-Z0-9_-]/g, "_");

  const publicId = `coursemate_pdfs/${Date.now()}_${cleanName}`;

  const uploadOptions = {
    public_id: publicId,
    resource_type: "raw",
    access_mode: "public",
    overwrite: false,
  };

  // For smaller files or buffers, use upload_stream
  return new Promise((resolve, reject) => {
    let uploadResolved = false;

    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          console.error("Cloudinary upload_stream error:", {
            http_code: error.http_code,
            message: error.message,
            cloudinaryMessage: error.error?.message,
          });

          return reject(
            new Error(
              `Cloudinary upload failed: ${
                error.error?.message || error.message || "Unknown error"
              }`
            )
          );
        }

        if (!result || !result.secure_url) {
          return reject(
            new Error("Cloudinary upload did not return a valid secure_url.")
          );
        }

        uploadResolved = true;
        console.log("PDF uploaded successfully to Cloudinary:", result.public_id);

        resolve({
          secure_url: result.secure_url,
          public_id: result.public_id,
          resource_type: result.resource_type || "raw",
          bytes: result.bytes || fileSize,
        });
      }
    );

    if (Buffer.isBuffer(fileSource)) {
      Readable.from(fileSource).pipe(uploadStream);
    } else if (typeof fileSource === "string") {
      fs.createReadStream(fileSource).pipe(uploadStream);
    }
  });
};

/**
 * Deletes a PDF file from Cloudinary by its public ID.
 * @param {string} publicId - Cloudinary public_id
 * @param {string} [resourceType="raw"] - Cloudinary resource_type
 * @returns {Promise<boolean>}
 */
const deletePDF = async (publicId, resourceType = "raw") => {
  if (!isCloudinaryConfigured() || !publicId) {
    return false;
  }

  const typesToTry =
    resourceType === "image"
      ? ["image", "raw"]
      : resourceType === "raw"
      ? ["raw", "image"]
      : ["raw", "image"];

  for (const rType of typesToTry) {
    try {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: rType,
      });
      if (result.result === "ok") {
        console.log(`Deleted Cloudinary resource: ${publicId} (type: ${rType})`);
        return true;
      }
    } catch (err) {
      console.warn(
        `Attempt to delete Cloudinary resource ${publicId} as ${rType} failed:`,
        err.message
      );
    }
  }

  return false;
};

module.exports = {
  uploadPDF,
  deletePDF,
  isCloudinaryConfigured,
  CLOUDINARY_MAX_RAW_SIZE_BYTES,
};
