const admin = require("firebase-admin");

if (!admin.apps.length) {
  let credential;

  // load from env string in prod
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
    } catch (e) {
      console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT:", e.message);
    }
  }

  // fallback to path env
  if (!credential && process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    try {
      credential = admin.credential.cert(require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH));
    } catch (e) {
      console.error("Failed to load FIREBASE_SERVICE_ACCOUNT_PATH:", e.message);
    }
  }

  // local dev fallback
  if (!credential) {
    try {
      credential = admin.credential.cert(require("../beautify-auth-firebase-adminsdk-fbsvc-16ac10c890.json"));
    } catch (e) {
      console.warn("Firebase key not found, auth will fail in prod");
    }
  }

  if (credential) {
    admin.initializeApp({ credential });
  }
}

module.exports = admin;
