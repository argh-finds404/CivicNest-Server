const express = require("express");
const router = express.Router();
const { getCollection } = require("../config/db");

// Get leaderboard
router.get("/", async (req, res) => {
  try {
    const usersCollection = getCollection("users");
    // Sort by points descending, limit to top 10 (excluding admins)
    const result = await usersCollection.find({ role: { $ne: 'admin' } }).sort({ points: -1 }).limit(10).toArray();
    res.send(result);
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
