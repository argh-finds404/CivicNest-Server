const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { memberOnly } = require('../middleware/memberOnly');
const { creditCheck } = require('../middleware/creditCheck');
const { getCollection } = require('../config/db');
const { ObjectId } = require('mongodb');
const { createNotification } = require('../utils/notificationHelper');

// GET /api/forum — thread list with filters
router.get('/', async (req, res) => {
  const { category, sort = 'recent', page = 1, limit = 20 } = req.query;
  const col = getCollection('forum');

  const query = { approvalStatus: 'approved' };
  if (category && category !== 'All') query.category = category;

  const sortOption = sort === 'top'
    ? { upvoteCount: -1, date: -1 }
    : { isPinned: -1, date: -1 };

  const threads = await col
    .find(query)
    .project({ replies: 0 })           // don't send replies on list view — too heavy
    .sort(sortOption)
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .toArray();

  // Attach upvoteCount if stored, or compute from array length
  const withCount = threads.map(t => ({
    ...t,
    upvoteCount: t.upvotes?.length || 0,
  }));

  const total = await col.countDocuments(query);
  res.json({ threads: withCount, total });
});

// GET /api/forum/:id — full thread with replies (with pagination)
router.get('/:id', async (req, res) => {
  const col = getCollection('forum');
  const thread = await col.findOne({ _id: new ObjectId(req.params.id) });
  if (!thread) return res.status(404).json({ message: 'Thread not found.' });

  const limit = parseInt(req.query.limit) || 50;
  const beforeId = req.query.before;

  const replies = thread.replies || [];
  let paginatedReplies = [];
  let hasMore = false;

  if (beforeId) {
    const idx = replies.findIndex(r => r._id && r._id.toString() === beforeId);
    if (idx !== -1) {
      const start = Math.max(0, idx - limit);
      paginatedReplies = replies.slice(start, idx);
      hasMore = start > 0;
    }
  } else {
    const start = Math.max(0, replies.length - limit);
    paginatedReplies = replies.slice(start);
    hasMore = start > 0;
  }

  thread.replies = paginatedReplies;
  thread.hasMore = hasMore;
  res.json(thread);
});

// GET /api/forum/users/search - Search registered users for mentions (Protected)
router.get('/users/search', verifyToken, async (req, res) => {
  try {
    const q = req.query.q || '';
    const usersCollection = getCollection('users');
    const query = q 
      ? {
          $or: [
            { name: { $regex: q, $options: 'i' } },
            { email: { $regex: q, $options: 'i' } }
          ]
        }
      : {};
    
    const users = await usersCollection
      .find(query)
      .limit(25)
      .project({ name: 1, email: 1, photoURL: 1 })
      .toArray();
      
    const mapped = users.map(u => ({
      email: u.email,
      name: u.name || u.displayName || u.email,
      photo: u.photoURL || null
    }));
    
    res.json(mapped);
  } catch (err) {
    console.error("Failed to search users for mentions:", err);
    res.status(500).json({ message: "Failed to search users." });
  }
});

// POST /api/forum — create thread (with credit check)
router.post('/', verifyToken, memberOnly, creditCheck('forum'), async (req, res) => {
  const { title, body, category } = req.body;
  if (!title || !body) return res.status(400).json({ message: 'Title and body are required.' });

  const col = getCollection('forum');

  let posterName = req.user.displayName || req.user.email;
  let posterPhoto = null;
  try {
    const usersCollection = getCollection('users');
    const dbUser = await usersCollection.findOne({ email: req.user.email });
    if (dbUser) {
      posterName = dbUser.name || dbUser.displayName || posterName;
      posterPhoto = dbUser.photoURL || null;
    }
  } catch (err) {
    console.error("Failed to query user details for thread:", err);
  }

  const newThread = {
    title:          title.trim(),
    body:           body.trim(),
    category:       category || 'General',
    postedBy:       req.user.email,
    posterName:     posterName,
    posterPhoto:    posterPhoto,
    upvotes:        [],
    upvoteCount:    0,
    replies:        [],
    replyCount:     0,
    isPinned:       false,
    isLocked:       false,
    approvalStatus: 'approved',         // forum posts don't go through admin queue
    date:           new Date(),
  };

  const result = await col.insertOne(newThread);
  const threadWithId = { ...newThread, _id: result.insertedId };

  // Broadcast new thread globally
  const io = req.app.get("io");
  if (io) {
    io.emit("thread_created", { thread: threadWithId });
  }

  // Trigger feed event
  try {
    const { createFeedEvent } = require("../utils/feedHelper");
    await createFeedEvent("social_activity", {
      title: title.trim(),
      category: category || "General",
      authorName: posterName,
      threadId: result.insertedId
    });
  } catch (feedErr) {
    console.error("Failed to trigger forum thread feed event:", feedErr);
  }

  res.status(201).json({ success: true, _id: result.insertedId, creditsRemaining: req.creditInfo?.remaining });
});

// POST /api/forum/:id/reply
router.post('/:id/reply', verifyToken, memberOnly, async (req, res) => {
  const { body, replyTo } = req.body;
  if (!body?.trim()) return res.status(400).json({ message: 'Reply body is required.' });

  const col    = getCollection('forum');
  const thread = await col.findOne({ _id: new ObjectId(req.params.id) });

  if (!thread) return res.status(404).json({ message: 'Thread not found.' });
  if (thread.isLocked) return res.status(403).json({ message: 'This thread is locked.' });

  let posterPhoto = null;
  let posterName = req.user.displayName || req.user.email;
  try {
    const usersCollection = getCollection('users');
    const dbUser = await usersCollection.findOne({ email: req.user.email });
    if (dbUser) {
      posterPhoto = dbUser.photoURL || null;
      posterName = dbUser.name || dbUser.displayName || posterName;
    }
  } catch (err) {
    console.error("Failed to query user details for reply:", err);
  }

  const reply = {
    _id:        new ObjectId(),
    body:       body.trim(),
    postedBy:   req.user.email,
    posterName: posterName,
    posterPhoto: posterPhoto,
    upvotes:    [],
    date:       new Date(),
    ...(replyTo ? { replyTo } : {})
  };

  await col.updateOne(
    { _id: new ObjectId(req.params.id) },
    { 
      $push: { replies: reply }, 
      $inc: { replyCount: 1 },
      $set: { 
        lastReply: {
          senderName: posterName,
          preview: body.trim().substring(0, 60)
        }
      }
    }
  );

  // Broadcast real-time message to room
  const io = req.app.get("io");
  if (io) {
    io.to(`thread:${req.params.id}`).emit("message_received", { threadId: req.params.id, reply });
    io.emit("thread_reply_count_updated", { threadId: req.params.id, replyCount: (thread.replyCount || 0) + 1, lastReply: { senderName: posterName, preview: body.trim().substring(0, 60) } });
  }

  // Notify thread author (not if they're replying to their own thread)
  if (thread.postedBy !== req.user.email) {
    await createNotification({
      email:   thread.postedBy,
      message: `${reply.posterName} replied to your thread: "${thread.title}"`,
      type:    'forum',
      link:    `/forum/${thread._id}`,
    });
  }

  res.json({ success: true, reply });
});

// POST /api/forum/:id/upvote — toggle
router.post('/:id/upvote', verifyToken, async (req, res) => {
  const col    = getCollection('forum');
  const thread = await col.findOne({ _id: new ObjectId(req.params.id) });
  if (!thread) return res.status(404).json({ message: 'Not found.' });

  const email         = req.user.email;
  const alreadyUpvoted = thread.upvotes?.includes(email);

  await col.updateOne(
    { _id: new ObjectId(req.params.id) },
    alreadyUpvoted
      ? { $pull: { upvotes: email }, $inc: { upvoteCount: -1 } }
      : { $push: { upvotes: email }, $inc: { upvoteCount: 1 } }
  );

  const updatedThread = await col.findOne({ _id: new ObjectId(req.params.id) });

  // Broadcast updated upvotes globally
  const io = req.app.get("io");
  if (io) {
    io.emit("thread_updated_global", { 
      threadId: req.params.id, 
      upvoteCount: updatedThread.upvoteCount,
      upvotes: updatedThread.upvotes
    });
  }

  res.json({ upvoted: !alreadyUpvoted });
});

// DELETE /api/forum/:id — delete own thread
router.delete('/:id', verifyToken, async (req, res) => {
  const col    = getCollection('forum');
  const thread = await col.findOne({ _id: new ObjectId(req.params.id) });
  if (!thread) return res.status(404).json({ message: 'Not found.' });

  if (thread.postedBy !== req.user.email && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Cannot delete someone else\'s thread.' });
  }

  await col.deleteOne({ _id: new ObjectId(req.params.id) });

  // Broadcast deletion to all users and active room participants
  const io = req.app.get("io");
  if (io) {
    io.to(`thread:${req.params.id}`).emit("thread_deleted", { threadId: req.params.id });
    io.emit("thread_deleted_global", { threadId: req.params.id });
  }

  res.json({ success: true });
});

// DELETE /api/forum/:id/reply/:replyId — delete specific reply
router.delete('/:id/reply/:replyId', verifyToken, async (req, res) => {
  const col = getCollection('forum');
  const thread = await col.findOne({ _id: new ObjectId(req.params.id) });
  if (!thread) return res.status(404).json({ message: 'Thread not found.' });

  const reply = thread.replies?.find(r => r._id?.toString() === req.params.replyId);
  if (!reply) return res.status(404).json({ message: 'Reply not found.' });

  // Allow reply author, thread author, or admin to delete
  if (reply.postedBy !== req.user.email && thread.postedBy !== req.user.email && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Unauthorized to delete this reply.' });
  }

  await col.updateOne(
    { _id: new ObjectId(req.params.id) },
    { 
      $pull: { replies: { _id: new ObjectId(req.params.replyId) } },
      $inc: { replyCount: -1 }
    }
  );

  // Broadcast deletion to active thread chatters and globally
  const io = req.app.get("io");
  if (io) {
    io.to(`thread:${req.params.id}`).emit("reply_deleted", { threadId: req.params.id, replyId: req.params.replyId });
    io.emit("thread_reply_count_updated", { threadId: req.params.id, replyCount: Math.max(0, (thread.replyCount || 1) - 1) });
  }

  res.json({ success: true });
});

module.exports = router;
