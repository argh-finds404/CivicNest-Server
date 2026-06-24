/**
 * middleware/auth.js
 * Firebase token verification middleware.
 * Sets req.user = { email, uid } from the verified token.
 */
const admin = require("../config/firebase");
const { getCollection } = require("../config/db");

/**
 * Verify Firebase ID token. Sets req.user if valid.
 */
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No authorization token provided" });
  }
  const token = authHeader.split("Bearer ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    let role = "guest";
    try {
      const usersCollection = getCollection("users");
      if (usersCollection) {
        const dbUser = await usersCollection.findOne({ email: decoded.email });
        if (dbUser) {
          role = dbUser.role || "guest";
        }
      }
    } catch (e) {
      console.warn("DB not connected yet, skipping role check in auth middleware:", e.message);
    }
    req.user = { 
      email: decoded.email, 
      uid: decoded.uid,
      name: decoded.name,
      picture: decoded.picture,
      role: role
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

module.exports = { verifyToken };
