const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { getCollection } = require("../config/db");

// Add new contribution (Protected)
router.post("/", verifyToken, async (req, res) => {
  const contributionsCollection = getCollection("contributions");
  const contribution = {
    ...req.body,
    date: new Date()
  };
  const result = await contributionsCollection.insertOne(contribution);

  // Trigger feed event
  try {
    const { createFeedEvent } = require("../utils/feedHelper");
    await createFeedEvent("donation_made", {
      amount: contribution.amount,
      title: contribution.eventName || contribution.issueTitle || "Community Drive",
      donor: req.user.name || req.user.displayName || req.user.email.split("@")[0]
    });
  } catch (feedErr) {
    console.error("Failed to trigger donation feed event:", feedErr);
  }

  res.send(result);
});

// Get contributions by email (Protected)
router.get("/my", verifyToken, async (req, res) => {
  const contributionsCollection = getCollection("contributions");
  const email = req.query.email;
  if (!email || email !== req.user.email) {
    return res.status(403).json({ error: "Forbidden access" });
  }
  const query = { email: email };
  const result = await contributionsCollection.find(query).sort({ date: -1 }).toArray();
  
  // Attach escrow status for issues
  const Issue = require("../models/Issue");
  for (let c of result) {
    if (c.issueId) {
      try {
        const issue = await Issue.findById(c.issueId);
        if (issue && issue.crowdfunding) {
          c.escrowStatus = issue.crowdfunding.escrowStatus;
        }
      } catch (e) {
        console.log("Error fetching issue for contribution", e.message);
      }
    }
  }
  
  res.send(result);
});

router.get("/:email", verifyToken, async (req, res) => {
  const contributionsCollection = getCollection("contributions");
  const email = req.params.email;
  if (!email || email !== req.user.email) {
    return res.status(403).json({ error: "Forbidden access" });
  }
  const query = { email: email };
  const result = await contributionsCollection.find(query).sort({ date: -1 }).toArray();
  
  // Attach escrow status for issues
  const Issue = require("../models/Issue");
  for (let c of result) {
    if (c.issueId) {
      try {
        const issue = await Issue.findById(c.issueId);
        if (issue && issue.crowdfunding) {
          c.escrowStatus = issue.crowdfunding.escrowStatus;
        }
      } catch (e) {
        console.log("Error fetching issue for contribution", e.message);
      }
    }
  }
  
  res.send(result);
});

module.exports = router;
