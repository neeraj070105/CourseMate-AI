require("dotenv").config();
const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * Returns the JWT secret from environment variables.
 * Ensures a single, consistent secret is used across signing and verification.
 */
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not configured in environment variables. Please define JWT_SECRET in your .env file."
    );
  }
  return secret;
};

const protect = async (req, res, next) => {
  let token;

  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === "string") {
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
      token = parts[1];
    }
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Not authorized. No authentication token provided.",
    });
  }

  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret);
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Not authorized. User account no longer exists.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        error: "Not authorized. Authentication token has expired. Please log in again.",
      });
    }

    if (error.name === "JsonWebTokenError") {
      console.warn(`JWT verification failed: ${error.message}`);
      return res.status(401).json({
        success: false,
        error: `Not authorized. Invalid authentication token (${error.message}). Please log in again.`,
      });
    }

    console.error("Authentication error:", error.message);
    return res.status(401).json({
      success: false,
      error: "Not authorized. Token verification failed.",
    });
  }
};

module.exports = {
  protect,
  getJwtSecret,
  get JWT_SECRET() {
    return getJwtSecret();
  },
};

