const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { getCollection } = require("../config/db");
const { regenerateUserCredits } = require("../utils/creditHelper");
const rateLimit = require('express-rate-limit');

const emailCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max:      10,                 // 10 checks per IP per 15 minutes
  message: { error: 'Too many requests. Please try again later.' },
});

// Check if user exists in the database (Public)
router.get("/check-email", emailCheckLimiter, async (req, res) => {
  try {
    const usersCollection = getCollection("users");
    const email = (req.query.email || '').toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ error: 'Email required.' });
    }
    const user = await usersCollection.findOne({ email });
    res.json({ exists: !!user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update or create user (Protected)
router.post("/", verifyToken, async (req, res) => {
  const usersCollection = getCollection("users");
  const tokenEmail = req.user.email;
  const userData = req.body;
  
  const email = userData.email || tokenEmail;
  
  if (email !== tokenEmail) {
    return res.status(403).json({ error: "Forbidden: Token email does not match requested email" });
  }

  const query = { email: email };
  
  // Set default role to "guest" if not provided/existing
  const updateDoc = {
    $set: {
      ...userData,
      email: tokenEmail,
      uid: req.user.uid,
    },
    $setOnInsert: {
      role: "guest",
      points: 0,
      createdAt: new Date(),
      issueCredits: 3,
      creditRegenTimestamps: []
    }
  };

  const options = { upsert: true };
  const result = await usersCollection.updateOne(query, updateDoc, options);

  // Sync updated details to pending membership requests (if they exist)
  const membershipCollection = getCollection("membershipRequests");
  const syncFields = {};
  if (userData.name) syncFields.name = userData.name;
  if (userData.phone) syncFields.phone = userData.phone;
  if (userData.area) syncFields.area = userData.area;
  if (userData.streetAddress) syncFields.streetAddress = userData.streetAddress;
  if (userData.apartmentNumber) syncFields.apartmentNumber = userData.apartmentNumber;

  if (Object.keys(syncFields).length > 0) {
    await membershipCollection.updateOne(
      { email: email, status: "pending" },
      { $set: syncFields }
    );
  }

  res.send(result);
});

// Get user profile (Protected)
router.get("/my", verifyToken, async (req, res) => {
  const usersCollection = getCollection("users");
  const tokenEmail = req.user.email;
  await regenerateUserCredits(tokenEmail);
  const result = await usersCollection.findOne({ email: tokenEmail });
  res.send(result);
});

// Get user streak details (Protected)
router.get("/my/streak", verifyToken, async (req, res) => {
  try {
    const usersCollection = getCollection("users");
    const tokenEmail = req.user.email;
    const user = await usersCollection.findOne({ email: tokenEmail }, { projection: { streak: 1 } });
    res.json({
      current: user?.streak?.current || 0,
      best: user?.streak?.best || 0,
      lastActiveDate: user?.streak?.lastActiveDate || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get top users for leaderboard (Public)
router.get("/leaderboard", async (req, res) => {
  try {
    const usersCollection = getCollection("users");
    
    // Self-healing: if any user is a volunteer but has 0 points, backfill volunteer registration points
    try {
      const { addPoints } = require("../utils/pointsHelper");
      const zeroPtVolunteers = await usersCollection.find({ isVolunteer: true, points: 0 }).toArray();
      for (const vol of zeroPtVolunteers) {
        await addPoints(vol.email, "volunteer_registered");
      }
      
      // If any member has 0 points, backfill membership approval points
      const zeroPtMembers = await usersCollection.find({ role: "member", points: 0 }).toArray();
      for (const mem of zeroPtMembers) {
        await addPoints(mem.email, "membership_approved");
      }
    } catch (err) {
      console.error("Leaderboard self-healing failed:", err);
    }

    const result = await usersCollection
      .find({ role: { $ne: "admin" } }) // exclude admins
      .sort({ points: -1 })
      .limit(20)
      .project({ email: 0 }) // hide emails for safety
      .toArray();
    res.send(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Bookmark Toggle Endpoint (Protected)
router.patch("/my/bookmark", verifyToken, async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const usersCollection = getCollection("users");
    const { itemId, type, action } = req.body;
    const tokenEmail = req.user.email;

    if (!itemId || !type || !action) {
      return res.status(400).json({ error: "Missing required fields: itemId, type, action" });
    }

    if (action === 'add') {
      await usersCollection.updateOne(
        { email: tokenEmail },
        { 
          $addToSet: { 
            bookmarks: { itemId: new ObjectId(itemId), type, savedAt: new Date() } 
          } 
        }
      );
    } else if (action === 'remove') {
      await usersCollection.updateOne(
        { email: tokenEmail },
        { 
          $pull: { 
            bookmarks: { itemId: new ObjectId(itemId) } 
          } 
        }
      );
    } else {
      return res.status(400).json({ error: "Invalid action. Use 'add' or 'remove'" });
    }

    res.json({ success: true, message: `Bookmark successfully ${action}ed.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET user bookmarks with optimized aggregation queries (Protected)
router.get("/my/bookmarks", verifyToken, async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const usersCollection = getCollection("users");
    const tokenEmail = req.user.email;
    const user = await usersCollection.findOne({ email: tokenEmail });
    const bookmarks = user?.bookmarks || [];

    const byType = { issue: [], event: [], lostfound: [] };
    bookmarks.forEach(b => {
      if (byType[b.type] && b.itemId) {
        byType[b.type].push(new ObjectId(b.itemId));
      }
    });

    const [issues, events, lostFound] = await Promise.all([
      getCollection('issues').find({ _id: { $in: byType.issue } }).toArray(),
      getCollection('cleanupevents').find({ _id: { $in: byType.event } }).toArray(),
      getCollection('lostFound').find({ _id: { $in: byType.lostfound } }).toArray(),
    ]);

    // Apply stale checking and strip identity if anonymous for safety
    const processedIssues = issues.map(issue => {
      // Strip identity if anonymous
      if (issue.isAnonymous) {
        issue.submittedBy = { name: "Anonymous Member", photoURL: "", userId: "hidden", email: "hidden", memberId: "hidden" };
      }
      
      // Add stale info
      const STALE_DAYS = { emergency: 2, high: 7, medium: 14, low: 21 };
      const dateToUse = issue.submittedAt || issue.createdAt || issue.incidentDate || new Date();
      const daysOpen = Math.floor((Date.now() - new Date(dateToUse)) / 86400000);
      const isStale = issue.status !== 'solved' && issue.status !== 'resolved' && daysOpen > (STALE_DAYS[issue.urgency] || 14);
      
      return {
        ...issue,
        isStale,
        daysOpen
      };
    });

    res.json({ 
      issues: processedIssues || [], 
      events: events || [], 
      lostFound: lostFound || [] 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
module.exports = router;
