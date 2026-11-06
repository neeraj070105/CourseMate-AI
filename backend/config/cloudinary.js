require("dotenv").config();
const cloudinary = require("cloudinary").v2;

const getCloudinaryConfig = () => {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const api_key = process.env.CLOUDINARY_API_KEY?.trim();
  const api_secret = process.env.CLOUDINARY_API_SECRET?.trim();
  return { cloud_name, api_key, api_secret };
};

const isCloudinaryConfigured = () => {
  const { cloud_name, api_key, api_secret } = getCloudinaryConfig();
  return Boolean(cloud_name && api_key && api_secret);
};

if (isCloudinaryConfigured()) {
  const { cloud_name, api_key, api_secret } = getCloudinaryConfig();
  cloudinary.config({
    cloud_name,
    api_key,
    api_secret,
    secure: true,
  });
  console.log("Cloudinary configured successfully.");
} else {
  console.warn("Cloudinary credentials not provided in .env. PDF upload features require Cloudinary configuration.");
}

module.exports = {
  cloudinary,
  isCloudinaryConfigured,
};
