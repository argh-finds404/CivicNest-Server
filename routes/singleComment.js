const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const Comment = require("../models/Comment");
const Issue = require("../models/Issue");

// PATCH /api/comments/:commentId
router.patch("/:id", verifyToken, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    if (comment.userId !== req.user.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    comment.body = req.body.body;
    comment.editedAt = new Date();
    await comment.save();

    res.json({ success: true, editedAt: comment.editedAt });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/comments/:commentId
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    // Assuming admin check happens here or it's just the owner
    if (comment.userId !== req.user.uid) {
        // Here you would check if req.user is an admin to bypass
        // return res.status(403).json({ error: "Forbidden" });
    }

    comment.isDeleted = true;
    comment.deletedBy = req.user.email;
    comment.deletedAt = new Date();
    await comment.save();

    const issue = await Issue.findById(comment.issueId);
    if (issue) {
      issue.commentCount = Math.max(0, issue.commentCount - 1);
      await issue.save();
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/comments/:commentId/flag
router.patch("/:id/flag", verifyToken, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    const userId = req.user.uid;
    if (!comment.flaggedBy.includes(userId)) {
      comment.flaggedBy.push(userId);
    }

    if (comment.flaggedBy.length >= 3) {
      comment.isHidden = true;
    }

    await comment.save();
    res.json({ success: true, flagCount: comment.flaggedBy.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/comments/:id/like
router.patch("/:id/like", verifyToken, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    const userId = req.user.uid;
    if (!comment.likes.includes(userId)) {
      comment.likes.push(userId);
      await comment.save();
    }
    
    res.json({ success: true, likes: comment.likes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/comments/:id/unlike
router.patch("/:id/unlike", verifyToken, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    const userId = req.user.uid;
    comment.likes = comment.likes.filter(id => id !== userId);
    await comment.save();
    
    res.json({ success: true, likes: comment.likes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
