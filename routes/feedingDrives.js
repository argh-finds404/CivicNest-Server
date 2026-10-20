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

const DRIVE_FIELDS = ["title", "description", "location", "area", "time", "volunteersNeeded", "foodType", "coordinates", "image"];

// Add new feeding drive
router.post("/", verifyToken, async (req, res) => {
  try {
    const date = new Date(req.body.date);
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ message: "Please pick a valid date for the drive." });
    }
    const drive = {};
    for (const field of DRIVE_FIELDS) {
      if (req.body[field] !== undefined) drive[field] = req.body[field];
    }
    const needed = Number(drive.volunteersNeeded);
    drive.volunteersNeeded = Number.isFinite(needed) && needed > 0 ? Math.round(needed) : 10;
    Object.assign(drive, {
      // A real Date, so upcoming-drive queries (e.g. the Volunteer Hub) find it
      date,
      createdBy: req.user.email,
      createdByName: req.user.name || req.user.email.split("@")[0],
      volunteers: [],
      createdAt: new Date(),
      status: "upcoming",
    });
    const result = await getCollection("feedingDrives").insertOne(drive);
    res.send(result);
  } catch (error) {
    console.error("Error adding feeding drive:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Join a feeding drive: always as the signed-in user, while there's room and
// before the drive day is over
router.post("/:id/join", verifyToken, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ message: "Drive not found." });
    const col = getCollection("feedingDrives");
    const drive = await col.findOne({ _id: new ObjectId(req.params.id) });
    if (!drive) return res.status(404).json({ message: "Drive not found." });

    const email = req.user.email;
    const volunteers = drive.volunteers || [];
    if (volunteers.includes(email)) return res.json({ joined: true, alreadyJoined: true });

    const endOfDriveDay = new Date(drive.date);
    endOfDriveDay.setHours(23, 59, 59, 999);
    if (!Number.isNaN(endOfDriveDay.getTime()) && endOfDriveDay < new Date()) {
      return res.status(400).json({ message: "This drive has already happened." });
    }
    if (drive.volunteersNeeded && volunteers.length >= drive.volunteersNeeded) {
      return res.status(400).json({ message: "This drive is full." });
    }

    const result = await col.updateOne({ _id: drive._id }, { $addToSet: { volunteers: email } });
    res.send(result);
  } catch (error) {
    console.error("Error joining feeding drive:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
