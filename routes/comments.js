const express = require("express");
const router = express.Router({ mergeParams: true }); // to access :id from parent route if needed
const { verifyToken } = require("../middleware/auth");
const Comment = require("../models/Comment");
const Issue = require("../models/Issue");
const { updateStreak } = require("../utils/streakHelper");

// GET /api/issues/:id/comments
router.get("/", async (req, res) => {
  try {
    const issueId = req.params.id;
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const issue = await Issue.findById(issueId);
    if (!issue) return res.status(404).json({ error: "Issue not found" });

    const comments = await Comment.find({ 
      issueId, 
      isHidden: false, 
      isDeleted: { $ne: true } 
    })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const sanitizedComments = comments.map(comment => {
      // If the post is anonymous and this comment is by the post author
      if (issue.isAnonymous && comment.userId === issue.submittedBy?.userId) {
        return {
          ...comment,
          userName: "Anonymous Poster",
          userEmail: "hidden",
          userAvatar: "",
          userId: "hidden",
          memberId: "hidden",
          isOP: true
        };
      }
      return comment;
    });

    res.json(sanitizedComments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/issues/:id/comments
router.post("/", verifyToken, async (req, res) => {
  try {
    const issueId = req.params.id;
    const { body, parentCommentId } = req.body;
    
    const issue = await Issue.findById(issueId);
    if (!issue) return res.status(404).json({ error: "Issue not found" });

    const commentData = {
      issueId,
      userId: req.user.uid,
      userName: req.user.name || "Member",
      userEmail: req.user.email || "hidden@example.com",
      userAvatar: req.user.picture || "https://ui-avatars.com/api/?name=Member",
      memberId: "MEM-0000",
      body,
      isAnonymousPost: issue.isAnonymous
    };
    if (parentCommentId) commentData.parentCommentId = parentCommentId;

    const newComment = new Comment(commentData);

    await newComment.save();
    
    // Update comment count on Issue safely without triggering full document validation
    await Issue.updateOne({ _id: issueId }, { $inc: { commentCount: 1 } });
    await updateStreak(req.user.email);

    res.status(201).json(newComment);
  } catch (error) {
    res.status(400).json({ error: error.message, details: error.errors });
  }
});

module.exports = router;
