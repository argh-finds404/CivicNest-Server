const express = require("express");
const { isStaff } = require('../utils/roles');
const router = express.Router();
const { createTicketForIssue, syncTicketStatus, updateTicket, safely } = require("../services/tickets");

const REPORTER_FIELDS = ['title', 'description', 'category', 'customFlair', 'location', 'area', 'coordinates', 'images', 'incidentDate', 'isAnonymous', 'urgency', 'isPremiumFeature'];

// The parts of crowdfunding a reporter may set. Raised amount and escrow state
// only ever change through confirmed payments and staff actions.
const CROWDFUNDING_FIELDS = ['enabled', 'targetAmount', 'purpose'];
const pickCrowdfunding = (body) => {
  const out = {};
  if (!body || typeof body !== 'object') return out;
  for (const key of CROWDFUNDING_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
};
const { verifyToken } = require("../middleware/auth");
const { adminOnly } = require("../middleware/adminOnly");
const { memberOnly } = require("../middleware/memberOnly");
const Issue = require("../models/Issue");
const CleanupEvent = require("../models/CleanupEvent");
const { createNotification } = require("../utils/notificationHelper");
const { addPoints } = require("../utils/pointsHelper");
const { creditCheck } = require("../middleware/creditCheck");
const { updateStreak } = require("../utils/streakHelper");


// Strip identity for public viewing of anonymous posts. Edit history and the
// reveal log carry the reporter's email, so they never leave the server here.
function stripIdentityIfAnonymous(issue) {
  const stripped = typeof issue.toObject === 'function' ? issue.toObject() : { ...issue };
  delete stripped.editHistory;
  delete stripped.identityRevealLog;
  if (stripped.isAnonymous) {
    stripped.submittedBy = { name: "Anonymous Member", photoURL: "", userId: "hidden", email: "hidden", memberId: "hidden" };
  }
  return stripped;
}

function addStaleInfo(issueObj) {
  const STALE_DAYS = { emergency: 2, high: 7, medium: 14, low: 21 };
  const issue = typeof issueObj.toObject === 'function' ? issueObj.toObject() : issueObj;
  const dateToUse = issue.submittedAt || issue.createdAt || issue.incidentDate || new Date();
  const daysOpen = Math.floor((Date.now() - new Date(dateToUse)) / 86400000);
  const isStale = issue.status !== 'solved' && issue.status !== 'resolved' && daysOpen > (STALE_DAYS[issue.urgency] || 14);
  
  return {
    ...issue,
    isStale,
    daysOpen
  };
}



// GET /api/issues/my - Poster's own issues
router.get("/my", verifyToken, async (req, res) => {
  try {
    const issues = await Issue.find({ "submittedBy.userId": req.user.uid, isHidden: false }).sort({ submittedAt: -1 }).lean();
    res.json(issues.map(addStaleInfo));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/issues - Public feed
router.get("/", async (req, res) => {
  try {
    const { category, status, area, search, crowdfunding, sort, page = 1, limit = 12 } = req.query;
    const { getCollection } = require("../config/db");
    
    let query = { approvalStatus: "approved", isHidden: false };
    if (category) query.category = category;
    if (status) query.status = status;
    if (area) query.area = { $regex: area, $options: 'i' };
    if (crowdfunding === 'true') query["crowdfunding.enabled"] = true;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    let eventQuery = { approvalStatus: "approved" };
    if (status) eventQuery.status = status;
    if (area) eventQuery['location.area'] = { $regex: area, $options: 'i' };
    if (crowdfunding === 'true') eventQuery.fundingEnabled = true;
    if (search) {
      eventQuery.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Fetch matching docs from both collections
    const [allIssues, allEvents] = await Promise.all([
      Issue.find(query).lean(),
      category ? Promise.resolve([]) : CleanupEvent.find(eventQuery).select('-going -interested').lean()
    ]);

    // Fetch user data for proper names
    const usersCollection = getCollection('users');
    const userEmails = new Set();
    
    allIssues.forEach(issue => {
      if (issue.submittedBy?.email) userEmails.add(issue.submittedBy.email);
    });
    
    allEvents.forEach(event => {
      if (event.organizer?.email) userEmails.add(event.organizer.email);
    });
    
    let usersMap = {};
    if (userEmails.size > 0) {
      const users = await usersCollection.find({ email: { $in: Array.from(userEmails) } }).toArray();
      users.forEach(user => {
        usersMap[user.email] = {
          name: user.name || user.displayName || user.email.split('@')[0],
          photoURL: user.photoURL || user.image || null
        };
      });
    }

    // Update issues with proper user names
    const issuesWithNames = allIssues.map(issue => {
      if (issue.submittedBy?.email && usersMap[issue.submittedBy.email]) {
        return {
          ...issue,
          submittedBy: {
            ...issue.submittedBy,
            name: usersMap[issue.submittedBy.email].name,
            photoURL: usersMap[issue.submittedBy.email].photoURL || issue.submittedBy.photoURL
          }
        };
      }
      return issue;
    });

    // Update events with proper user names
    const eventsWithNames = allEvents.map(event => {
      if (event.organizer?.email && usersMap[event.organizer.email]) {
        return {
          ...event,
          organizer: {
            ...event.organizer,
            name: usersMap[event.organizer.email].name,
            photoURL: usersMap[event.organizer.email].photoURL || event.organizer.photoURL
          }
        };
      }
      return event;
    });

    const publicIssues = issuesWithNames.map(stripIdentityIfAnonymous).map(addStaleInfo).map(i => ({ ...i, _type: 'issue' }));
    const formattedEvents = eventsWithNames.map(e => ({ 
      ...e, 
      _type: 'cleanup_event', 
      submittedAt: e.createdAt || e.eventDate 
    }));

    let combined = [...publicIssues, ...formattedEvents];

    // Sorting
    if (sort === "most_upvoted") {
       combined.sort((a, b) => (b.netScore || 0) - (a.netScore || 0) || new Date(b.submittedAt) - new Date(a.submittedAt));
    } else if (sort === "most_funded") {
       combined.sort((a, b) => {
         const fundA = a._type === 'cleanup_event' ? (a.fundingRaised || 0) : (a.crowdfunding?.raisedAmount || 0);
         const fundB = b._type === 'cleanup_event' ? (b.fundingRaised || 0) : (b.crowdfunding?.raisedAmount || 0);
         return fundB - fundA || new Date(b.submittedAt) - new Date(a.submittedAt);
       });
    } else {
       // newest
       combined.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    }

    const total = combined.length;
    const paginated = combined.slice(skip, skip + parseInt(limit));

    res.json({
      issues: paginated,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/issues/:id - Single issue
router.get("/:id", async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ error: "Not found" });
    
    // Auto-expiry check: If deadline passed and no proofs uploaded, revert to open
    if (
      issue.status === 'action_taken' &&
      issue.assignedTo?.deadline &&
      new Date() > issue.assignedTo.deadline &&
      issue.resolutionProofs.length === 0
    ) {
      issue.status = 'open';
      issue.assignedTo = null;
      await issue.save();
      safely("sync", () => syncTicketStatus(issue._id, "open", { by: "system", note: "Claim expired" }));
      // Optionally notify reporter
    }

    // In a real app we'd check if the user is admin. For now, public gets stripped identity if anonymous.
    res.json(addStaleInfo(stripIdentityIfAnonymous(issue)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/issues - Create issue
router.post("/", verifyToken, creditCheck("issues"), async (req, res) => {
  try {
    // Extract req.user provided by verifyToken (from firebase)
    // Only fields a reporter may set; status, approval, votes etc. stay server-controlled
    const allowed = {};
    for (const field of REPORTER_FIELDS) {
      if (req.body[field] !== undefined) allowed[field] = req.body[field];
    }
    const crowdfunding = pickCrowdfunding(req.body.crowdfunding);
    if (Object.keys(crowdfunding).length) allowed.crowdfunding = crowdfunding;
    const newIssue = new Issue({
      ...allowed,
      submittedBy: {
        userId: req.user.uid,
        name: req.user.name || req.body.submittedBy?.name || "User",
        email: req.user.email || req.body.submittedBy?.email,
        memberId: req.body.submittedBy?.memberId || "MEM-0000",
        photoURL: req.user.picture || req.body.submittedBy?.photoURL || ""
      }
    });

    await newIssue.save();

    // Every report gets a trackable ticket. A ticket failure must not lose the report.
    let ticketCode = null;
    try {
      const ticket = await createTicketForIssue(newIssue, { by: req.user.email });
      ticketCode = ticket.code;
      await Issue.updateOne({ _id: newIssue._id }, { $set: { ticketCode } });
    } catch (err) {
      console.error("[tickets] create failed for issue", String(newIssue._id), err.message);
    }

    res.status(201).json({ success: true, issueId: newIssue._id, ticketCode, creditInfo: req.creditInfo });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PATCH /api/issues/:id - Edit issue (poster only)
router.patch("/:id", verifyToken, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ error: "Not found" });
    
    if (issue.submittedBy.userId !== req.user.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }
    
    // Note: User can edit their post without admin permission (approvalStatus check removed)

    const previousValues = {};
    const fieldsChanged = [];
    
    // Only process editable fields
    const editableFields = ['title', 'description', 'category', 'customFlair', 'location', 'area', 'coordinates', 'images', 'incidentDate', 'isAnonymous'];
    
    editableFields.forEach(field => {
      if (req.body[field] !== undefined) {
        previousValues[field] = issue[field];
        issue[field] = req.body[field];
        fieldsChanged.push(field);
      }
    });

    // Crowdfunding: update only the reporter's settings, field by field, so the
    // amount raised and escrow state survive the edit
    const crowdfunding = pickCrowdfunding(req.body.crowdfunding);
    if (Object.keys(crowdfunding).length) {
      previousValues.crowdfunding = issue.crowdfunding?.toObject ? issue.crowdfunding.toObject() : issue.crowdfunding;
      for (const [key, value] of Object.entries(crowdfunding)) issue.set(`crowdfunding.${key}`, value);
      fieldsChanged.push('crowdfunding');
    }

    issue.editHistory.push({
      editedAt: new Date(),
      editedBy: req.user.email,
      fieldsChanged,
      previousValues
    });

    if (issue.approvalStatus === "rejected") {
      issue.approvalStatus = "pending_review";
      issue.status = "open";
      issue.rejectedAt = null;
      issue.rejectedBy = null;
      issue.rejectReason = null;
    }

    await issue.save();
    safely("sync", () => syncTicketStatus(issue._id, issue.status, { by: req.user.email }));
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/issues/:id - Soft delete
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ error: "Not found" });
    if (issue.submittedBy.userId !== req.user.uid) return res.status(403).json({ error: "Forbidden" });

    issue.isHidden = true;
    await issue.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Haversine distance in meters
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat/2) ** 2 +
               Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
               Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// POST /api/issues/:id/proofs - Resolver uploads proof
router.post("/:id/proofs", verifyToken, memberOnly, async (req, res) => {
  try {
    const { photos, images, notes, coordinates } = req.body;
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ error: "Not found" });
    
    // Validate if user is the assigned resolver (or staff)
    if (issue.assignedTo?.email !== req.user.email && !isStaff(req.user.role)) {
      return res.status(403).json({ error: "Only the assigned resolver can upload proof" });
    }
    // Proof belongs to work in progress; it must not reopen a solved or rejected issue
    if (!['action_taken', 'pending_verification'].includes(issue.status)) {
      return res.status(400).json({ error: `Proof can't be added while the issue is ${issue.status.replace('_', ' ')}.` });
    }

    // GPS validation
    let gpsMatch = 'skipped';
    if (coordinates?.lat && coordinates?.lng) {
      if (issue.coordinates?.lat && issue.coordinates?.lng) {
        const dist = haversineDistance(
          coordinates.lat, coordinates.lng,
          issue.coordinates.lat, issue.coordinates.lng
        );

        if (dist > 1000) {
          return res.status(403).json({
            message: `GPS mismatch: you appear to be ${Math.round(dist)}m from the issue location. You must be within 1km to submit proof.`,
            code: 'GPS_TOO_FAR',
          });
        }
        gpsMatch = dist <= 200 ? 'high' : dist <= 500 ? 'medium' : 'low';
      }
    }

    const proofImages = photos || images || [];

    issue.resolutionProofs.push({
      uploadedBy: req.user.email,
      images: proofImages,
      notes: notes || '',
      gpsMatch,
      milestoneNo: issue.resolutionProofs.length + 1,
      uploadedAt: new Date()
    });
    
    issue.status = "pending_verification";
    issue.statusChangedAt = new Date();
    await issue.save();
    safely("sync", () => syncTicketStatus(issue._id, "pending_verification", { by: req.user.email }));

    // Notify reporter
    if (issue.submittedBy?.email) {
      await createNotification({
        userId:   issue.submittedBy.userId,
        email:    issue.submittedBy.email,
        message:  `Resolution proof uploaded for your issue "${issue.title}". Needs 3 community verifications.`,
        type:     'verification',
        link:     `/issues/${issue._id}`,
      });
    }

    res.json({ success: true, gpsMatch, issue: stripIdentityIfAnonymous(issue), proofs: issue.resolutionProofs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/issues/:id/verify - Community verification
router.post("/:id/verify", verifyToken, memberOnly, async (req, res) => {
  try {
    const { coordinates } = req.body;
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ error: "Not found" });

    if (issue.status !== 'pending_verification') {
      return res.status(400).json({ error: "Issue is not pending verification" });
    }

    // User cannot verify their own issue or their own proof
    if (issue.submittedBy.userId === req.user.uid) {
      return res.status(400).json({ error: "You cannot verify your own reported issue" });
    }
    if (issue.assignedTo?.email === req.user.email) {
      return res.status(400).json({ error: "You cannot verify your own proof" });
    }

    if (issue.verifications.includes(req.user.uid)) {
      return res.status(400).json({ error: "You have already verified this" });
    }

    // Push first
    issue.verifications.push(req.user.uid);
    issue.verificationCount = issue.verifications.length;

    // Check GPS onsite bonus
    let isGPSNear = false;
    if (coordinates?.lat && coordinates?.lng && issue.coordinates?.lat && issue.coordinates?.lng) {
      const dist = haversineDistance(
        coordinates.lat, coordinates.lng,
        issue.coordinates.lat, issue.coordinates.lng
      );
      if (dist <= 200) {
        isGPSNear = true;
      }
    }

    // Award current verifier immediately
    const eventKey = isGPSNear ? 'issue_verified_onsite' : 'issue_verified';
    const verifierPoints = await addPoints(req.user.email, eventKey);

    // Auto-solve trigger
    let solved = false;
    if (issue.verificationCount >= 3) {
      issue.status = "solved";
      issue.statusChangedAt = new Date();
      issue.resolvedAt = new Date();
      solved = true;
      
      // Award solver (resolver)
      if (issue.assignedTo?.email) {
        await addPoints(issue.assignedTo.email, 'issue_solved');
      }

      // Award reporter
      if (issue.submittedBy?.email) {
        await addPoints(issue.submittedBy.email, 'issue_reporter_bonus');
      }

      // Create feed event for solved issue
      try {
        const { createFeedEvent } = require("../utils/feedHelper");
        await createFeedEvent('issue_solved', {
          issueId: issue._id,
          title: issue.title,
          area: issue.area
        });
      } catch (feedErr) {
        console.error("Failed to log issue_solved feed event:", feedErr);
      }
      
      // Release escrow if crowdfunding
      if (issue.crowdfunding?.enabled) {
        issue.crowdfunding.escrowStatus = 'released';
        issue.crowdfunding.releasedAt   = new Date();
      }

      // Send Civic Milestone Broadcast Notice!
      try {
        const currentSolvedCount = await Issue.countDocuments({ status: "solved" });
        const solvedCount = currentSolvedCount + 1; // including the one being solved now
        const milestones = [5, 10, 25, 50, 100, 250, 500, 1000];
        if (milestones.includes(solvedCount)) {
          const { getCollection } = require("../config/db");
          const announcementsCollection = getCollection("announcements");
          await announcementsCollection.insertOne({
            title: `🎉 Civic Milestone: ${solvedCount} Issues Solved!`,
            description: `Our community has reached a new milestone! ${solvedCount} civic or infrastructure issues have been successfully resolved by active citizens. Thank you for making our city cleaner and safer!`,
            type: "Announcement",
            priority: "Normal",
            source: "system",
            validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Valid for 7 days
            createdAt: new Date(),
          });
        }
      } catch (milestoneErr) {
        console.error("Failed to generate civic milestone notice:", milestoneErr);
      }

      // Send notifications to reporter and resolver
      if (issue.submittedBy?.email) {
        await createNotification({ 
          userId: issue.submittedBy.userId, 
          email: issue.submittedBy.email, 
          message: `Your issue "${issue.title}" has been officially solved by the community!`, 
          type: "achievement", 
          link: `/issues/${issue._id}` 
        });
      }
      if (issue.assignedTo?.email) {
        await createNotification({ 
          email: issue.assignedTo.email, 
          message: `Congratulations! Your resolution for "${issue.title}" was verified and you earned 50 points!`, 
          type: "achievement", 
          link: `/issues/${issue._id}` 
        });
      }
    }

    await issue.save();
    if (solved) safely("sync", () => syncTicketStatus(issue._id, "solved", { by: "community", note: "Verified by 3 neighbours" }));
    await updateStreak(req.user.email);
    res.json({
      success: true,
      solved,
      pointsEarned: verifierPoints,
      verificationCount: issue.verificationCount,
      verifications: issue.verifications,
      status: issue.status
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/issues/:id/upvote
router.patch("/:id/upvote", verifyToken, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ error: "Not found" });
    
    const userId = req.user.uid;
    const hasUpvoted = issue.upvotes.includes(userId);
    const hasDownvoted = issue.downvotes.includes(userId);

    let userVote = null;

    if (hasUpvoted) {
      issue.upvotes = issue.upvotes.filter(id => id !== userId);
    } else {
      issue.upvotes.push(userId);
      userVote = "up";
      if (hasDownvoted) issue.downvotes = issue.downvotes.filter(id => id !== userId);
    }

    issue.netScore = issue.upvotes.length - issue.downvotes.length;
    await issue.save();
    await updateStreak(req.user.email);
    res.json({ netScore: issue.netScore, userVote, upvotes: issue.upvotes, downvotes: issue.downvotes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/issues/:id/downvote
router.patch("/:id/downvote", verifyToken, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ error: "Not found" });
    
    const userId = req.user.uid;
    const hasUpvoted = issue.upvotes.includes(userId);
    const hasDownvoted = issue.downvotes.includes(userId);

    let userVote = null;

    if (hasDownvoted) {
      issue.downvotes = issue.downvotes.filter(id => id !== userId);
    } else {
      issue.downvotes.push(userId);
      userVote = "down";
      if (hasUpvoted) issue.upvotes = issue.upvotes.filter(id => id !== userId);
    }

    issue.netScore = issue.upvotes.length - issue.downvotes.length;
    await issue.save();
    await updateStreak(req.user.email);
    res.json({ netScore: issue.netScore, userVote, upvotes: issue.upvotes, downvotes: issue.downvotes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// PATCH /api/issues/:id/flag
router.patch("/:id/flag", verifyToken, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ error: "Not found" });
    
    const userId = req.user.uid;
    if (!issue.spamFlags.includes(userId)) {
      issue.spamFlags.push(userId);
    }
    
    if (issue.spamFlags.length >= 3) {
      issue.isHidden = true;
    }
    
    await issue.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// POST /api/issues/:id/witness
router.post("/:id/witness", verifyToken, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ error: "Not found" });
    
    const userId = req.user.uid;
    const { photoURL, name } = req.body || {};
    const hasWitnessed = issue.witnesses.includes(userId);
    
    if (hasWitnessed) {
      issue.witnesses = issue.witnesses.filter(id => id !== userId);
      if (issue.witnessDetails) {
        issue.witnessDetails = issue.witnessDetails.filter(d => d.userId !== userId);
      }
    } else {
      issue.witnesses.push(userId);
      if (!issue.witnessDetails) issue.witnessDetails = [];
      issue.witnessDetails.push({ userId, photoURL: photoURL || '', name: name || 'User' });
      
      try {
        await addPoints(req.user.email, 'witness_added');
      } catch (ptsErr) {
        console.error("Failed to award points for witness_added:", ptsErr);
      }
    }
    
    await issue.save();
    res.json({ success: true, witnesses: issue.witnesses, witnessDetails: issue.witnessDetails });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// POST /api/issues/:id/claim
router.post('/:id/claim', verifyToken, memberOnly, async (req, res) => {
  try {
    const { name, email } = req.user;

    const updated = await Issue.findOneAndUpdate(
      {
        _id:            req.params.id,
        approvalStatus: 'approved',
        status:         'open',
        // assignedTo always exists with empty fields, so check who it names
        'assignedTo.email': null,
      },
      {
        $set: {
          status: 'action_taken',
          assignedTo: {
            name:       name || email.split('@')[0],
            email:      email,
            type:       'volunteer',
            assignedAt: new Date(),
            deadline:   new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          }
        }
      },
      { new: true }
    );

    if (!updated) {
      return res.status(409).json({
        message: 'This issue is no longer available for claiming.',
      });
    }
    safely("sync", async () => {
      await syncTicketStatus(updated._id, "action_taken", { by: email, note: "Claimed" });
      if (updated.ticketCode) await updateTicket(updated.ticketCode, { assigneeEmail: email }, email);
    });

    // Notify the original reporter
    if (updated.submittedBy?.email) {
      await createNotification({
        userId:   updated.submittedBy.userId,
        email:    updated.submittedBy.email,
        message:  `A community member has claimed your issue "${updated.title}" and is working on a fix!`,
        type:     'assignment',
        link:     `/issues/${updated._id}`,
      });
    }

    // Award small engagement points to claimer, once per person per issue, so
    // claiming and releasing over and over earns nothing extra
    const firstClaim = await Issue.updateOne(
      { _id: updated._id, claimRewardedTo: { $ne: email } },
      { $addToSet: { claimRewardedTo: email } }
    );
    if (firstClaim.modifiedCount === 1) await addPoints(email, 'issue_claimed');

    res.json({ success: true, issue: stripIdentityIfAnonymous(updated) });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/issues/:id/unclaim
router.post('/:id/unclaim', verifyToken, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found.' });

    const isResolver = issue.assignedTo?.email === req.user.email;
    const isAdmin    = isStaff(req.user.role);

    if (!isResolver && !isAdmin) {
      return res.status(403).json({ message: 'Only the current resolver or an admin can unclaim.' });
    }

    // Once proof is up, only staff can release the issue (e.g. the proof was
    // wrong or the resolver vanished). That clears the proof and its
    // verifications so the next volunteer starts fresh.
    if (issue.resolutionProofs.length > 0 && !isAdmin) {
      return res.status(400).json({
        message: 'Cannot unclaim after uploading resolution proof. Contact an admin.',
      });
    }

    issue.status     = 'open';
    issue.assignedTo = { email: null, name: null, type: null, assignedAt: null, deadline: null, adminNote: null };
    if (issue.resolutionProofs.length > 0) {
      issue.resolutionProofs = [];
      issue.verifications = [];
      issue.verificationCount = 0;
    }
    await issue.save();
    safely("sync", () => syncTicketStatus(issue._id, "open", { by: req.user.email, note: "Released by resolver" }));

    if (issue.submittedBy?.email) {
      await createNotification({
        userId:  issue.submittedBy.userId,
        email:   issue.submittedBy.email,
        message: `The resolver stepped down from your issue "${issue.title}". It's open for claiming again.`,
        type:    'assignment',
        link:    `/issues/${issue._id}`,
      });
    }

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
