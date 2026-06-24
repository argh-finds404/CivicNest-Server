const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { getCollection } = require("../config/db");
const { ObjectId } = require("mongodb");

// Get user notifications (auto-pruned by MongoDB TTL index)
router.get("/", verifyToken, async (req, res) => {
  const notificationsCollection = getCollection("notifications");

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const result = await notificationsCollection
    .find({
      $or: [
        { userId: req.user.email },
        { email: req.user.email },
        { userId: req.user.uid }
      ],
      type: { $ne: "announcement" },
      createdAt: { $gte: sevenDaysAgo }
    })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();

  // Normalize so client always receives isRead: Boolean
  const normalized = result.map(n => ({
    ...n,
    isRead: n.isRead ?? n.read ?? false
  }));
  res.send(normalized);
});

// Mark all as read
router.patch("/read-all", verifyToken, async (req, res) => {
  const notificationsCollection = getCollection("notifications");
  const result = await notificationsCollection.updateMany(
    {
      $and: [
        {
          $or: [
            { userId: req.user.email },
            { email: req.user.email },
            { userId: req.user.uid }
          ]
        },
        {
          $or: [
            { isRead: false },
            { read: false },
            { isRead: { $exists: false } }
          ]
        }
      ]
    },
    { $set: { isRead: true, read: true } }
  );
  res.send(result);
});

// Mark as read
router.patch("/:id/read", verifyToken, async (req, res) => {
  const notificationsCollection = getCollection("notifications");
  const { id } = req.params;
  const result = await notificationsCollection.updateOne(
    {
      _id: new ObjectId(id),
      $or: [
        { userId: req.user.email },
        { email: req.user.email },
        { userId: req.user.uid }
      ]
    },
    { $set: { isRead: true, read: true } }
  );
  res.send(result);
});

module.exports = router;
