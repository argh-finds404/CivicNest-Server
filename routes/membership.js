const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { getCollection } = require("../config/db");
const { ObjectId } = require("mongodb");

// Request membership (Protected)
router.post("/request", verifyToken, async (req, res) => {
  const membershipCollection = getCollection("membershipRequests");
  const requestData = {
    ...req.body,
    email: req.user.email,
    status: "pending",
    submittedAt: new Date()
  };
  
  // Check if request already exists
  const existingRequest = await membershipCollection.findOne({ email: req.user.email, status: "pending" });
  if (existingRequest) {
    return res.status(400).json({ error: "You already have a pending membership request." });
  }

  const result = await membershipCollection.insertOne(requestData);

  // Sync address & contact details back to the users collection in the database
  const usersCollection = getCollection("users");
  await usersCollection.updateOne(
    { email: req.user.email },
    {
      $set: {
        name: req.body.name,
        phone: req.body.phone,
        area: req.body.area,
        streetAddress: req.body.streetAddress,
        apartmentNumber: req.body.apartmentNumber
      }
    }
  );

  res.send(result);
});

// Get membership status (Protected)
router.get("/status", verifyToken, async (req, res) => {
  const membershipCollection = getCollection("membershipRequests");
  const result = await membershipCollection.findOne({ email: req.user.email }, { sort: { submittedAt: -1 } });
  res.send(result);
});

module.exports = router;
