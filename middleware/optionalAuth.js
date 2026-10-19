/**
 * middleware/optionalAuth.js
 * Like verifyToken, but never rejects: sets req.user when a valid Firebase
 * token is sent and otherwise carries on as a guest. For public reads that
 * show a little more to signed-in users.
 */
const crypto = require("crypto");
const admin = require("../config/firebase");

const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]);
      req.user = { email: decoded.email, uid: decoded.uid, name: decoded.name, picture: decoded.picture };
    } catch {
      // Invalid or expired token: treat as a guest rather than failing a public read
    }
  }
  next();
};

/** Stable stand-in for an email so guests can't harvest addresses */
const pseudonymize = (email) =>
  email ? `u_${crypto.createHash("sha256").update(String(email).toLowerCase()).digest("hex").slice(0, 12)}` : email;

/** Display name that never falls back to an email address */
const safeName = (name) => (name && !String(name).includes("@") ? name : "Neighbour");

module.exports = { optionalAuth, pseudonymize, safeName };
