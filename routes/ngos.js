const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { adminOnly } = require("../middleware/adminOnly");
const { getCollection } = require("../config/db");
const { ObjectId } = require("mongodb");

// Get stats for NGO directory banner
router.get("/stats", async (req, res) => {
  try {
    const col = getCollection("ngos");
    const [total, verified] = await Promise.all([
      col.countDocuments({}),
      col.countDocuments({ status: "verified" }),
    ]);
    res.json({ total, verified });
  } catch (err) {
    console.error('Error fetching NGO stats:', err);
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
});

// Record support/donation (record-keeping only, no actual payment)
router.post('/donate', verifyToken, async (req, res) => {
  try {
    const { ngoId, amount, message } = req.body;
    const col = getCollection("ngos");
    const ngo = await col.findOne({ _id: new ObjectId(ngoId) });

    if (!ngo) {
      return res.status(404).json({ message: 'NGO not found' });
    }

    // Add donation record to ngo
    await col.updateOne(
      { _id: new ObjectId(ngoId) },
      {
        $push: {
          donations: {
            supporterEmail: req.user.email,
            supporterName: req.user.displayName || req.user.email,
            amount: amount || 0,
            message: message || 'Support this organization',
            date: new Date()
          }
        },
        $inc: { totalSupporters: 1 }
      }
    );

    // Award points for supporting NGO
    await getCollection("users").updateOne(
      { email: req.user.email },
      { $inc: { points: 5 } }
    );

    // Trigger feed event
    try {
      const { createFeedEvent } = require("../utils/feedHelper");
      await createFeedEvent("donation_made", {
        amount: amount || 0,
        title: ngo.name || "NGO Partner",
        donor: req.user.name || req.user.displayName || req.user.email.split("@")[0]
      });
    } catch (feedErr) {
      console.error("Failed to trigger NGO support feed event:", feedErr);
    }

    res.json({ success: true, message: 'Support recorded successfully' });
  } catch (err) {
    console.error('Error recording support:', err);
    res.status(500).json({ message: 'Failed to record support' });
  }
});

// Get all verified NGOs (Public)
router.get("/", async (req, res) => {
  try {
    const ngosCollection = getCollection("ngos");
    const query = { status: "verified" };
    if (req.query.serviceType) {
      query.serviceTypes = { $in: [req.query.serviceType] };
    }
    let cursor = ngosCollection.find(query).sort({ joinedAt: -1 });
    if (req.query.limit) {
      cursor = cursor.limit(parseInt(req.query.limit));
    }
    const result = await cursor.toArray();
    res.send(result);
  } catch (error) {
    console.error("Error fetching NGOs:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get pending NGOs (Admin Only)
router.get("/pending", verifyToken, adminOnly, async (req, res) => {
  const ngosCollection = getCollection("ngos");
  const query = { status: "pending" };
  const result = await ngosCollection.find(query).sort({ joinedAt: -1 }).toArray();
  res.send(result);
});

// Get single NGO
router.get("/:id", async (req, res) => {
  const ngosCollection = getCollection("ngos");
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await ngosCollection.findOne(query);
  res.send(result);
});

// Register an NGO (Protected)
router.post("/", verifyToken, async (req, res) => {
  const ngosCollection = getCollection("ngos");
  const ngo = {
    ...req.body,
    registrarEmail: req.user.email,
    status: "pending", // Default to pending until admin approves
    joinedAt: new Date()
  };
  const result = await ngosCollection.insertOne(ngo);
  res.send(result);
});

// Approve an NGO (Admin Only)
router.patch("/:id/approve", verifyToken, adminOnly, async (req, res) => {
  const ngosCollection = getCollection("ngos");
  const id = req.params.id;
  const filter = { _id: new ObjectId(id) };
  
  // Find NGO before update to get its name/area
  const verifiedNgo = await ngosCollection.findOne(filter);
  
  const updateDoc = {
    $set: {
      status: "verified"
    },
  };
  const result = await ngosCollection.updateOne(filter, updateDoc);
  
  if (result.modifiedCount > 0 && verifiedNgo) {
    try {
      const { createFeedEvent } = require("../utils/feedHelper");
      await createFeedEvent("ngo_partnership", {
        ngoName: verifiedNgo.name || "NGO Partner",
        area: verifiedNgo.area || "City Wide"
      });
    } catch (feedErr) {
      console.error("Failed to trigger NGO partnership feed event:", feedErr);
    }
  }

  res.send(result);
});

module.exports = router;
