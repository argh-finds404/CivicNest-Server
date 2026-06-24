const express = require("express");
const router = express.Router();
const { getCollection } = require("../config/db");
const { verifyToken } = require("../middleware/auth");
const { adminOnly } = require("../middleware/adminOnly");
const { logAudit } = require("../utils/auditHelper");
const { ObjectId } = require("mongodb");

// GET /announcements - Retrieve notices
// Public returns only non-expired. Admin passes all=true to manage active + expired.
router.get("/", async (req, res) => {
  try {
    const announcementsCollection = getCollection("announcements");
    const showAll = req.query.all === "true";
    let query = {};
    if (!showAll) {
      query = {
        $or: [
          { validUntil: null },
          { validUntil: { $gte: new Date() } }
        ]
      };
    }

    const notices = await announcementsCollection
      .find(query)
      .sort({ isPinned: -1, date: -1 })
      .toArray();

    // Look up user names for each notice poster
    const usersCollection = getCollection("users");
    const noticesWithPosterNames = await Promise.all(notices.map(async (notice) => {
      let posterName = notice.postedBy;
      let posterRole = "user";
      if (notice.postedBy && usersCollection) {
        const user = await usersCollection.findOne({ email: notice.postedBy });
        if (user) {
          posterName = user.name || user.displayName || user.email.split("@")[0];
          posterRole = user.role || "user";
        }
      }
      return {
        ...notice,
        posterName,
        posterRole
      };
    }));

    res.json(noticesWithPosterNames);
  } catch (error) {
    console.error("Error fetching announcements:", error);
    res.status(500).json({ error: "Failed to fetch announcements" });
  }
});

// GET /announcements/:id - Get single notice details
router.get("/:id", async (req, res) => {
  try {
    const announcementsCollection = getCollection("announcements");
    const notice = await announcementsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!notice) {
      return res.status(404).json({ error: "Announcement not found" });
    }
    const usersCollection = getCollection("users");
    let posterName = notice.postedBy;
    let posterRole = "user";
    if (notice.postedBy && usersCollection) {
      const user = await usersCollection.findOne({ email: notice.postedBy });
      if (user) {
        posterName = user.name || user.displayName || user.email.split("@")[0];
        posterRole = user.role || "user";
      }
    }
    res.json({
      ...notice,
      posterName,
      posterRole
    });
  } catch (error) {
    console.error("Error fetching announcement:", error);
    res.status(500).json({ error: "Failed to fetch announcement" });
  }
});

// POST /announcements - Create a new notice (Admin only)
router.post("/", verifyToken, adminOnly, async (req, res) => {
  try {
    const { title, description, type, priority, validUntil, attachmentUrl, organizerName, organizerContact, actionRequired, coverImage, attachments } = req.body;
    if (!title || !description) {
      return res.status(400).json({ message: "Title and description are required." });
    }

    const col = getCollection("announcements");
    const notice = {
      title: title.trim(),
      description: description.trim(),
      type: type || "General",
      priority: priority || "medium",
      validUntil: validUntil ? new Date(validUntil) : null,
      attachmentUrl: attachmentUrl || null,
      targetGroup: req.body.targetGroup || "All",
      affectedArea: req.body.affectedArea || "All Areas",
      organizerName: organizerName ? organizerName.trim() : null,
      organizerContact: organizerContact ? organizerContact.trim() : null,
      actionRequired: actionRequired ? actionRequired.trim() : null,
      coverImage: coverImage ? coverImage.trim() : null,
      attachments: Array.isArray(attachments) ? attachments : [],
      postedBy: req.user.email,
      isPinned: req.body.isPinned === true || req.body.isPinned === 'true',
      date: new Date()
    };

    const result = await col.insertOne(notice);
    res.status(201).json({ success: true, _id: result.insertedId, notice });

    // No personal bell notification is generated to keep announcements separate on the Noticeboard tab.
  } catch (error) {
    console.error("Error creating notice:", error);
    res.status(500).json({ error: "Failed to create notice" });
  }
});

// PATCH /announcements/:id - Edit a notice (Admin only)
router.patch("/:id", verifyToken, adminOnly, async (req, res) => {
  try {
    const allowed = ["title", "description", "type", "priority", "validUntil", "attachmentUrl", "targetGroup", "affectedArea", "isPinned", "organizerName", "organizerContact", "actionRequired", "coverImage", "attachments"];
    const update = {};
    allowed.forEach(f => {
      if (req.body[f] !== undefined) {
        if (f === "attachments") {
          update[f] = Array.isArray(req.body[f]) ? req.body[f] : [];
        } else {
          update[f] = typeof req.body[f] === "string" ? req.body[f].trim() : req.body[f];
        }
      }
    });

    if (req.body.validUntil !== undefined) {
      update.validUntil = req.body.validUntil ? new Date(req.body.validUntil) : null;
    }

    const col = getCollection("announcements");
    const result = await col.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Notice not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error editing notice:", error);
    res.status(500).json({ error: "Failed to edit notice" });
  }
});

// PATCH /announcements/:id/pin - Toggle pin status (Admin only)
router.patch("/:id/pin", verifyToken, adminOnly, async (req, res) => {
  try {
    const col = getCollection("announcements");
    const notice = await col.findOne({ _id: new ObjectId(req.params.id) });
    if (!notice) {
      return res.status(404).json({ error: "Notice not found" });
    }

    const isPinned = !notice.isPinned;
    await col.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { isPinned } }
    );

    res.json({ success: true, isPinned });
  } catch (error) {
    console.error("Error pinning notice:", error);
    res.status(500).json({ error: "Failed to toggle pin status" });
  }
});

// DELETE /announcements/:id - Delete a notice (Admin only)
router.delete("/:id", verifyToken, adminOnly, async (req, res) => {
  try {
    const col = getCollection("announcements");
    const result = await col.deleteOne({ _id: new ObjectId(req.params.id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Notice not found" });
    }

    // Log audit action
    try {
      await logAudit({
        performedBy: req.user.email,
        action: "ANNOUNCEMENT_DELETED",
        targetId: req.params.id,
        targetType: "announcement",
        note: `Deleted notice id: ${req.params.id}`
      });
    } catch (auditErr) {
      console.error("Failed to log audit for notice delete:", auditErr);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting notice:", error);
    res.status(500).json({ error: "Failed to delete notice" });
  }
});

module.exports = router;
