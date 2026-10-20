const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { getCollection } = require("../config/db");

// Contributions are written by the payment flow (routes/payment.js) once a
// payment succeeds. Accepting them directly let anyone add money that was never
// paid to an issue, event or the community total.
router.post("/", verifyToken, (req, res) => {
  res.status(410).json({ message: "Please donate through the payment window." });
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
