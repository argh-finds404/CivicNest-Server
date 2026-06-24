const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { memberOnly } = require("../middleware/memberOnly");
const { getCollection } = require("../config/db");
const { ObjectId } = require("mongodb");
const { createFeedEvent } = require("../utils/feedHelper");

// Get stats for polls banner
router.get("/stats", async (req, res) => {
  try {
    const col = getCollection("polls");
    const [active, total, totalVotes] = await Promise.all([
      col.countDocuments({ status: 'active', endsAt: { $gt: new Date() } }),
      col.countDocuments({}),
      col.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: null, total: { $sum: "$totalVotes" } } }
      ]).toArray()
    ]);
    res.json({ 
      active, 
      total, 
      totalVotes: totalVotes[0]?.total || 0 
    });
  } catch (err) {
    console.error('Error fetching polls stats:', err);
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
});

router.get("/", async (req, res) => {
  try {
    const col = getCollection("polls");
    const { status, category, search } = req.query;
    
    // Optionally extract user if token is provided
    let currentUser = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split("Bearer ")[1];
      try {
        const admin = require("../config/firebase");
        const decoded = await admin.auth().verifyIdToken(token);
        let role = "guest";
        const usersCollection = getCollection("users");
        if (usersCollection) {
          const dbUser = await usersCollection.findOne({ email: decoded.email });
          if (dbUser) {
            role = dbUser.role || "guest";
          }
        }
        currentUser = { email: decoded.email, role };
      } catch (e) {
        // Ignore token decode errors for public route
      }
    }

    let query = {};
    if (status === 'active') {
      query.$or = [
        { status: 'active', endsAt: null },
        { status: 'active', endsAt: { $gt: new Date() } }
      ];
    } else if (status === 'ended') {
      query.$or = [
        { status: 'ended' },
        { endsAt: { $lte: new Date() } }
      ];
    } else if (status) {
      query.status = status;
    }

    // Role-based visibility logic for pending polls
    const isAdmin = currentUser && currentUser.role === 'admin';
    if (!isAdmin) {
      const userEmail = currentUser ? currentUser.email : null;
      if (status === 'pending') {
        query.status = 'pending';
        query.createdBy = userEmail || "";
      } else if (!status) {
        // Exclude pending polls that do not belong to the current user
        query.$and = [
          ...(query.$and || []),
          {
            $or: [
              { status: { $ne: 'pending' } },
              { createdBy: userEmail || "" }
            ]
          }
        ];
      }
    } else {
      if (status === 'pending') {
        query.status = 'pending';
      }
    }

    if (category) query.category = category;
    if (search) {
      query.question = { $regex: search, $options: 'i' };
    }

    const polls = await col
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    
    res.json(polls);
  } catch (err) {
    console.error('Error fetching polls:', err);
    res.status(500).json({ message: 'Failed to fetch polls' });
  }
});

// Get single poll
router.get("/:id", async (req, res) => {
  try {
    const col = getCollection("polls");
    const poll = await col.findOne({ _id: new ObjectId(req.params.id) });
    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }
    res.json(poll);
  } catch (err) {
    console.error('Error fetching poll:', err);
    res.status(500).json({ message: 'Failed to fetch poll' });
  }
});

// Create new poll (protected - members only)
router.post("/", verifyToken, memberOnly, async (req, res) => {
  try {
    const { question, type, options, category, endsAt, allowAnonymous } = req.body;
    
    // Validation
    if (!question || !type || !options || options.length < 2) {
      return res.status(400).json({ message: 'Question, type, and at least 2 options are required' });
    }
    
    const validTypes = ['single', 'multiple', 'yesno', 'survey'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ message: 'Invalid poll type' });
    }

    // For yes/no polls, validate options
    if (type === 'yesno') {
      if (options.length !== 2 || 
          !options.some(opt => opt.text.toLowerCase() === 'yes') ||
          !options.some(opt => opt.text.toLowerCase() === 'no')) {
        return res.status(400).json({ message: 'Yes/No polls must have exactly "Yes" and "No" options' });
      }
    }

    const isUserAdmin = req.user.role === 'admin';
    const status = isUserAdmin ? 'active' : 'pending';

    const col = getCollection("polls");
    const poll = {
      question: question.trim(),
      type,
      options: options.map((opt, index) => ({
        id: new ObjectId().toString(),
        text: opt.text.trim(),
        votes: 0,
        order: index
      })),
      category: category || 'general',
      createdBy: req.user.email,
      createdAt: new Date(),
      endsAt: endsAt ? new Date(endsAt) : null,
      status: status,
      totalVotes: 0,
      voters: [],
      allowAnonymous: allowAnonymous || false
    };

    const result = await col.insertOne(poll);
    
    if (status === 'active') {
      // Award points for creating poll (admins only if immediate)
      await getCollection("users").updateOne(
        { email: req.user.email },
        { $inc: { points: 10 } }
      );

      // Create feed event
      await createFeedEvent('poll_created', {
        pollId: result.insertedId,
        question: poll.question,
        category: poll.category,
        link: `/polls/${result.insertedId}`,
        actorName: req.user.displayName || req.user.email
      });
    }

    res.json({ 
      success: true, 
      pollId: result.insertedId,
      status: status
    });
  } catch (err) {
    console.error('Error creating poll:', err);
    res.status(500).json({ message: 'Failed to create poll' });
  }
});

// Submit vote (protected)
router.post("/:id/vote", verifyToken, memberOnly, async (req, res) => {
  try {
    const { optionIds } = req.body;
    const col = getCollection("polls");
    const poll = await col.findOne({ _id: new ObjectId(req.params.id) });

    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    // Check if poll is active
    if (poll.status !== 'active' || (poll.endsAt && new Date(poll.endsAt) < new Date())) {
      return res.status(400).json({ message: 'This poll has ended' });
    }

    const voterVotes = poll.voterVotes || [];
    const voterRecord = voterVotes.find(v => v.email === req.user.email);

    if (voterRecord) {
      // User is changing their vote
      // 1. Timed polls cannot change vote
      if (poll.endsAt) {
        return res.status(400).json({ message: 'You cannot change your vote in a timed poll' });
      }
      // 2. Open-ended polls: check changeCount
      if (voterRecord.changeCount >= 2) {
        return res.status(400).json({ message: 'You have already changed your vote the maximum number of times (2 times)' });
      }

      // Validate options
      if (!optionIds || !Array.isArray(optionIds) || optionIds.length === 0) {
        return res.status(400).json({ message: 'Please select at least one option' });
      }
      if (poll.type === 'single' && optionIds.length > 1) {
        return res.status(400).json({ message: 'Single choice polls allow only one option' });
      }
      const validOptionIds = poll.options.map(opt => opt.id);
      const invalidOptions = optionIds.filter(id => !validOptionIds.includes(id));
      if (invalidOptions.length > 0) {
        return res.status(400).json({ message: 'Invalid option IDs' });
      }

      // Decrement old votes
      const prevOptionIds = voterRecord.optionIds || [];
      poll.options = poll.options.map(opt => {
        if (prevOptionIds.includes(opt.id)) {
          return { ...opt, votes: Math.max(0, opt.votes - 1) };
        }
        return opt;
      });
      poll.totalVotes = Math.max(0, (poll.totalVotes || 0) - prevOptionIds.length);

      // Increment new votes
      poll.options = poll.options.map(opt => {
        if (optionIds.includes(opt.id)) {
          return { ...opt, votes: (opt.votes || 0) + 1 };
        }
        return opt;
      });
      poll.totalVotes += optionIds.length;

      // Update voter record
      voterRecord.optionIds = optionIds;
      voterRecord.changeCount = (voterRecord.changeCount || 0) + 1;

      // Save to DB
      await col.updateOne(
        { _id: poll._id },
        { 
          $set: { 
            options: poll.options, 
            totalVotes: poll.totalVotes, 
            voterVotes: voterVotes
          } 
        }
      );

      return res.json({ success: true, changeCount: voterRecord.changeCount });
    }

    // First time voting
    // Validate options
    if (!optionIds || !Array.isArray(optionIds) || optionIds.length === 0) {
      return res.status(400).json({ message: 'Please select at least one option' });
    }
    if (poll.type === 'single' && optionIds.length > 1) {
      return res.status(400).json({ message: 'Single choice polls allow only one option' });
    }
    const validOptionIds = poll.options.map(opt => opt.id);
    const invalidOptions = optionIds.filter(id => !validOptionIds.includes(id));
    if (invalidOptions.length > 0) {
      return res.status(400).json({ message: 'Invalid option IDs' });
    }

    // Increment new votes
    poll.options = poll.options.map(opt => {
      if (optionIds.includes(opt.id)) {
        return { ...opt, votes: (opt.votes || 0) + 1 };
      }
      return opt;
    });
    poll.totalVotes = (poll.totalVotes || 0) + optionIds.length;

    // Add user email to voters
    if (!poll.voters) poll.voters = [];
    poll.voters.push(req.user.email);

    // Create voterVotes entry
    const newRecord = {
      email: req.user.email,
      optionIds: optionIds,
      changeCount: 0
    };
    if (!poll.voterVotes) poll.voterVotes = [];
    poll.voterVotes.push(newRecord);

    // Save to DB
    await col.updateOne(
      { _id: poll._id },
      { 
        $set: { 
          options: poll.options, 
          voters: poll.voters, 
          voterVotes: poll.voterVotes, 
          totalVotes: poll.totalVotes 
        } 
      }
    );

    // Award points for voting
    await getCollection("users").updateOne(
      { email: req.user.email },
      { $inc: { points: 2 } }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Error submitting vote:', err);
    res.status(500).json({ message: 'Failed to submit vote' });
  }
});

// Update poll (protected - creator only)
router.patch("/:id", verifyToken, async (req, res) => {
  try {
    const col = getCollection("polls");
    const poll = await col.findOne({ _id: new ObjectId(req.params.id) });

    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    if (poll.createdBy !== req.user.email) {
      return res.status(403).json({ message: 'Only the creator can update this poll' });
    }

    const { status } = req.body;
    const validStatuses = ['active', 'ended', 'archived'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const updateData = {};
    if (status) updateData.status = status;
    if (status === 'ended') {
      updateData.endedAt = new Date();
      
      // Create feed event for ended poll
      await createFeedEvent('poll_ended', {
        pollId: req.params.id,
        question: poll.question,
        totalVotes: poll.totalVotes,
        link: `/polls/${req.params.id}`
      });
    }

    await col.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updateData }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Error updating poll:', err);
    res.status(500).json({ message: 'Failed to update poll' });
  }
});

// Approve poll (protected - admin/moderator only)
router.patch("/:id/approve", verifyToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ message: 'Access denied: Only admins can approve polls' });
    }

    const col = getCollection("polls");
    const poll = await col.findOne({ _id: new ObjectId(req.params.id) });

    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    await col.updateOne(
      { _id: poll._id },
      { $set: { status: 'active', approvedAt: new Date() } }
    );

    // Award points to the creator of the poll upon approval
    const creatorEmail = poll.createdBy;
    if (creatorEmail) {
      await getCollection("users").updateOne(
        { email: creatorEmail },
        { $inc: { points: 10 } }
      );
    }

    // Create feed event for approved poll
    await createFeedEvent('poll_created', {
      pollId: poll._id,
      question: poll.question,
      category: poll.category,
      link: `/polls/${poll._id}`,
      actorName: poll.createdBy.split('@')[0]
    });

    res.json({ success: true, status: 'active' });
  } catch (err) {
    console.error('Error approving poll:', err);
    res.status(500).json({ message: 'Failed to approve poll' });
  }
});

// Delete poll (protected - creator or admin)
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const col = getCollection("polls");
    const poll = await col.findOne({ _id: new ObjectId(req.params.id) });

    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    if (poll.createdBy !== req.user.email && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the creator or admin can delete this poll' });
    }

    await col.deleteOne({ _id: new ObjectId(req.params.id) });

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting poll:', err);
    res.status(500).json({ message: 'Failed to delete poll' });
  }
});

module.exports = router;