const mongoose = require("mongoose");

/**
 * Safely masks credentials in MongoDB connection string for logging
 */
const maskUri = (uri) => {
  if (!uri || typeof uri !== "string") return "undefined";
  return uri.replace(/\/\/[^:]+:[^@]+@/, "//***:***@");
};

const connectDB = async () => {
  const primaryUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  const localFallbackUri =
    process.env.MONGODB_LOCAL_URI || "mongodb://127.0.0.1:27017/coursemate";
  const isProduction = process.env.NODE_ENV === "production";
  const allowLocalFallback =
    !isProduction || process.env.ALLOW_LOCAL_FALLBACK === "true";

  if (primaryUri) {
    try {
      console.log(`[MongoDB] Attempting connection to primary URI: ${maskUri(primaryUri)}`);
      await mongoose.connect(primaryUri, {
        serverSelectionTimeoutMS: 5000,
      });
      console.log("[MongoDB] Connected successfully via primary URI (MongoDB Atlas)");
      return;
    } catch (error) {
      console.warn(`[MongoDB] Primary connection failed: ${error.message}`);

      // Provide clear root-cause diagnostic for TLS / IP whitelist issues
      const errStr = (error.message || "") + (error.cause?.message || "");
      if (
        errStr.includes("tlsv1 alert internal error") ||
        errStr.includes("SSL alert number 80") ||
        errStr.includes("not whitelisted") ||
        error.name === "MongooseServerSelectionError"
      ) {
        console.warn(
          "[MongoDB Diagnostic] Atlas TLS handshake rejected (alert 80 / server selection timeout). " +
          "Cause: Your current public IP address is likely not whitelisted in the MongoDB Atlas dashboard. " +
          "To fix: Visit MongoDB Atlas -> Network Access -> Add IP Address -> Add Current IP Address."
        );
      }

      if (!allowLocalFallback) {
        console.error(
          "[MongoDB Error] Production environment: Refusing silent fallback to local database. " +
          "Fix Atlas cluster access or set ALLOW_LOCAL_FALLBACK=true to override."
        );
        throw error;
      }

      console.log(
        `[MongoDB] Development mode active: Explicitly falling back to local MongoDB (${localFallbackUri})...`
      );
    }
  } else {
    console.warn("[MongoDB] No primary MONGODB_URI configured in environment.");
  }

  try {
    await mongoose.connect(localFallbackUri, {
      serverSelectionTimeoutMS: 3000,
    });
    console.log(
      `[MongoDB] Connected successfully via local fallback (${localFallbackUri}). ` +
      "Active records (users, chats, documents) will be persisted in this local database."
    );
  } catch (localError) {
    console.error("[MongoDB Error] Local MongoDB connection also failed:", localError.message);
    throw localError;
  }
};

module.exports = connectDB;
