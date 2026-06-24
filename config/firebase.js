/**
 * config/firebase.js
 * Firebase Admin SDK singleton — imported by auth middleware.
 */
const admin = require("firebase-admin");

// Only initialize once (guard against hot-reload double init)
if (!admin.apps.length) {
  let credential;

  // 1. Try to load from FIREBASE_SERVICE_ACCOUNT stringified JSON environment variable
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      credential = admin.credential.cert(serviceAccount);
      console.log("Firebase Admin SDK initialized using FIREBASE_SERVICE_ACCOUNT env variable.");
    } catch (err) {
      console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT env variable:", err.message);
    }
  }

  // 2. Try to load from FIREBASE_SERVICE_ACCOUNT_PATH environment variable
  if (!credential && process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    try {
      const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
      credential = admin.credential.cert(serviceAccount);
      console.log(`Firebase Admin SDK initialized using credentials from path: ${process.env.FIREBASE_SERVICE_ACCOUNT_PATH}`);
    } catch (err) {
      console.error(`Failed to load Firebase credentials from path ${process.env.FIREBASE_SERVICE_ACCOUNT_PATH}:`, err.message);
    }
  }

  // 3. Fallback to local hardcoded JSON file for development
  if (!credential) {
    try {
      const serviceAccount = require("../beautify-auth-firebase-adminsdk-fbsvc-16ac10c890.json");
      credential = admin.credential.cert(serviceAccount);
      console.log("Firebase Admin SDK initialized using local credentials JSON file.");
    } catch (err) {
      console.warn("WARNING: Local firebase service account credentials file not found.");
      console.warn("Firebase Admin SDK was NOT initialized with credentials. Token verification will fail in production.");
    }
  }

  if (credential) {
    admin.initializeApp({ credential });
  }
}

module.exports = admin;
