const { getCollection } = require("../config/db");
const { isStaff } = require("../utils/roles");

/** Admins and moderators (staff). Use adminOnly for admin-only actions. */
const adminOrMod = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized: Missing user info" });
  }

  try {
    const usersCollection = getCollection("users");
    const user = await usersCollection.findOne({ email: req.user.email });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (isStaff(user.role)) {
      next();
    } else {
      return res.status(403).json({ error: "Forbidden: Moderators and admins only" });
    }
  } catch (error) {
    console.error("adminOrMod middleware error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { adminOrMod, staffOnly: adminOrMod };
