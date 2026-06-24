const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { getCollection } = require("../config/db");
const { ObjectId } = require("mongodb");

// Get all feeding drives
router.get("/", async (req, res) => {
  try {
    const feedingDrivesCollection = getCollection("feedingDrives");
    const result = await feedingDrivesCollection.find().sort({ date: -1 }).toArray();
    res.send(result);
  } catch (error) {
    console.error("Error fetching feeding drives:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Add new feeding drive
router.post("/", verifyToken, async (req, res) => {
  try {
    const feedingDrivesCollection = getCollection("feedingDrives");
    const drive = {
      ...req.body,
      createdAt: new Date(),
      status: "upcoming"
    };
    const result = await feedingDrivesCollection.insertOne(drive);
    res.send(result);
  } catch (error) {
    console.error("Error adding feeding drive:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Join a feeding drive
router.post("/:id/join", verifyToken, async (req, res) => {
  try {
    const feedingDrivesCollection = getCollection("feedingDrives");
    const id = req.params.id;
    const { userId } = req.body;
    
    const query = { _id: new ObjectId(id) };
    const update = {
      $addToSet: { volunteers: userId }
    };
    
    const result = await feedingDrivesCollection.updateOne(query, update);
    res.send(result);
  } catch (error) {
    console.error("Error joining feeding drive:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
