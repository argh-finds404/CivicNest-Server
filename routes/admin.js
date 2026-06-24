const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { adminOnly } = require("../middleware/adminOnly");
const { adminOrMod } = require("../middleware/adminOrMod");
const { getCollection } = require("../config/db");
const { ObjectId } = require("mongodb");
const Issue = require("../models/Issue");
const CleanupEvent = require("../models/CleanupEvent");
const AuditLog = require("../models/AuditLog");

const { logAudit } = require("../utils/auditHelper");
const { createNotification } = require("../utils/notificationHelper");

// Get Dashboard Stats
router.get("/stats", verifyToken, adminOnly, async (req, res) => {
  const usersCollection = getCollection("users");
  const issuesCollection = getCollection("issues");
  const membershipCollection = getCollection("membershipRequests");
  const cleanupEventsCollection = getCollection("cleanupevents");
  const contributionsCollection = getCollection("contributions");

  const totalUsers = await usersCollection.countDocuments();
  const totalIssues = await Issue.countDocuments({ isHidden: false });
  const openIssues = await Issue.countDocuments({ approvalStatus: "approved", status: "open", isHidden: false });
  const solvedIssues = await Issue.countDocuments({ approvalStatus: "approved", status: "solved", isHidden: false });
  const pendingRequests = await membershipCollection.countDocuments({ status: "pending" });
  const pendingNGOs = await getCollection('ngos').countDocuments({ status: 'pending' });

  const totalEvents = await cleanupEventsCollection.countDocuments({ approvalStatus: "approved" });
  
  const volunteersCollection = getCollection("volunteers");
  const totalVolunteers = await volunteersCollection.countDocuments({ approvalStatus: "approved" });

  const donationsAgg = await contributionsCollection.aggregate([
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]).toArray();
  const totalDonations = donationsAgg.length > 0 ? donationsAgg[0].total : 0;

  // Category Breakdown for Pie Chart
  const categoryBreakdown = await Issue.aggregate([
    { $match: { isHidden: false } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
    { $project: { name: "$_id", value: "$count", _id: 0 } }
  ]);

  // Issue Status Trend for Bar Chart
  const issueTrend = await Issue.aggregate([
    { $match: { isHidden: false } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $project: { name: "$_id", value: "$count", _id: 0 } }
  ]);

  // Normalize status names for the chart
  const formattedTrend = issueTrend.map(item => ({
    name: item.name ? item.name.replace('_', ' ').toUpperCase() : 'UNKNOWN',
    Issues: item.value
  }));

  res.send({ 
    totalUsers, 
    totalIssues, 
    openIssues, 
    solvedIssues, 
    pendingRequests,
    pendingNGOs,
    totalEvents,
    totalVolunteers,
    totalDonations,
    categoryBreakdown,
    issueTrend: formattedTrend
  });
});

// Get all users
router.get("/users", verifyToken, adminOnly, async (req, res) => {
  const usersCollection = getCollection("users");
  const users = await usersCollection.find().sort({ createdAt: -1 }).toArray();
  res.send(users);
});

// Update user role
router.patch("/users/:id/role", verifyToken, adminOnly, async (req, res) => {
  const usersCollection = getCollection("users");
  const id = req.params.id;
  const { role } = req.body;
  
  const result = await usersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { role: role } }
  );
  res.send(result);
});
// Get all membership requests
router.get("/membership", verifyToken, adminOnly, async (req, res) => {
  const membershipCollection = getCollection("membershipRequests");
  
  const requests = await membershipCollection.aggregate([
    {
      $lookup: {
        from: "users",
        localField: "email",
        foreignField: "email",
        as: "userData"
      }
    },
    {
      $unwind: {
        path: "$userData",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $addFields: {
        photoURL: "$userData.photoURL"
      }
    },
    {
      $project: {
        userData: 0
      }
    },
    {
      $sort: { submittedAt: -1 }
    }
  ]).toArray();

  res.send(requests);
});

// Update membership request status
router.patch("/membership/:id/status", verifyToken, adminOnly, async (req, res) => {
  const membershipCollection = getCollection("membershipRequests");
  const usersCollection = getCollection("users");
  const id = req.params.id;
  const { status, email } = req.body; // status: "approved" | "rejected"
  
  const result = await membershipCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: status, reviewedAt: new Date() } }
  );

  // If approved, update user role to 'member', generate ID, and copy address/contact details from the membership request
  if (status === "approved" && email) {
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    const memberId = `MEM-${randomNum}`;

    // Get the request details to copy the address
    const membershipRequest = await membershipCollection.findOne({ _id: new ObjectId(id) });
    const addressDetails = membershipRequest ? {
      name: membershipRequest.name,
      phone: membershipRequest.phone,
      area: membershipRequest.area,
      streetAddress: membershipRequest.streetAddress,
      apartmentNumber: membershipRequest.apartmentNumber
    } : {};

    await usersCollection.updateOne(
      { email: email },
      { 
        $set: { 
          role: "member", 
          memberId, 
          verifiedAt: new Date(),
          ...addressDetails
        } 
      }
    );

    try {
      const { addPoints } = require("../utils/pointsHelper");
      await addPoints(email, "membership_approved");
    } catch (err) {
      console.error("Failed to add membership approval points:", err);
    }
  }

  res.send(result);
});

// Get all volunteer requests
router.get("/volunteers", verifyToken, adminOnly, async (req, res) => {
  try {
    const volunteersCollection = getCollection("volunteers");
    const requests = await volunteersCollection.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "email",
          foreignField: "email",
          as: "userData"
        }
      },
      {
        $unwind: {
          path: "$userData",
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $addFields: {
          photoURL: "$userData.photoURL"
        }
      },
      {
        $project: {
          userData: 0
        }
      },
      {
        $sort: { registeredAt: -1 }
      }
    ]).toArray();
    res.send(requests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update volunteer request status
router.patch("/volunteers/:id/status", verifyToken, adminOnly, async (req, res) => {
  try {
    const volunteersCollection = getCollection("volunteers");
    const usersCollection = getCollection("users");
    const id = req.params.id;
    const { status, email } = req.body; // status: "approved" | "rejected"
    
    const result = await volunteersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { approvalStatus: status, isAvailable: status === "approved", reviewedAt: new Date() } }
    );

    // If approved, update user's isVolunteer status
    if (email) {
      await usersCollection.updateOne(
        { email: email },
        { $set: { isVolunteer: status === "approved" } }
      );

      if (status === "approved") {
        try {
          const { addPoints } = require("../utils/pointsHelper");
          await addPoints(email, "volunteer_registered");
        } catch (err) {
          console.error("Failed to add volunteer registration points:", err);
        }
      }

      // Create notification
      if (typeof createNotification === "function") {
        await createNotification({
          userId: email,
          message: status === "approved" 
            ? "🎉 Congratulations! Your volunteer registration has been approved. You are now an official volunteer!"
            : "❌ Your volunteer registration request was rejected.",
          type: "drive",
          link: "/volunteer-dashboard"
        });
      }
    }

    res.send(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Cleanup Events Moderation ---

// Get all cleanup events for admin
router.get("/cleanup-events", verifyToken, adminOnly, async (req, res) => {
  try {
    const events = await CleanupEvent.find().sort({ createdAt: -1 });
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update cleanup event status
router.patch("/cleanup-events/:id/status", verifyToken, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { approvalStatus, rejectReason } = req.body;

    const event = await CleanupEvent.findByIdAndUpdate(
      id,
      { 
        approvalStatus, 
        rejectReason: rejectReason || null,
        status: approvalStatus === 'approved' ? 'upcoming' : 'cancelled',
        ...(approvalStatus === 'approved' ? { approvedBy: req.user.email } : {}),
        ...(approvalStatus === 'rejected' ? { rejectedBy: req.user.email } : {})
      },
      { new: true }
    );

    if (!event) return res.status(404).json({ message: "Event not found" });

    // Respond immediately to prevent timeout on massive loops
    res.json({ success: true, event });

    // Global Notification on Approval (runs in background)
    if (approvalStatus === "approved") {
      // Create noticeboard announcement automatically
      try {
        const announcementsCollection = getCollection("announcements");
        const formattedDate = new Date(event.eventDate).toLocaleDateString("en-US", {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        await announcementsCollection.insertOne({
          title: `New Cleanup Drive: ${event.title}`,
          description: `A new community cleanup drive has been approved for ${formattedDate} at ${event.eventTime || "scheduled time"} in ${event.location?.area || "Community"}. Join as a volunteer and help make our neighborhood clean and green!`,
          type: "Event",
          priority: "Normal",
          source: "system",
          validUntil: new Date(new Date(event.eventDate).getTime() + 24 * 60 * 60 * 1000), // Valid until 1 day after event
          createdAt: new Date(),
        });
      } catch (noticeErr) {
        console.error("Failed to auto-create event announcement notice:", noticeErr);
      }

      const usersCollection = getCollection("users");
      const allUsers = await usersCollection.find({}, { projection: { email: 1 } }).toArray();
      
      if (typeof createNotification === 'function') {
        const notifications = allUsers.map(u => ({
          userId: u.email,
          email: u.email,
          message: `New Community Drive: "${event.title}" is now approved and open for volunteers!`,
          type: 'event',
          link: `/cleanup-events/${event._id}`,
          priority: 'high',
          read: false,
          createdAt: new Date()
        }));
        
        if (notifications.length > 0) {
          const notifDb = getCollection("notifications");
          notifDb.insertMany(notifications).catch(err => console.error("Background mass notification failed:", err));
        }
      }
      
      // Feed Event
      const { createFeedEvent } = require('../utils/feedHelper');
      if (typeof createFeedEvent === 'function') {
        createFeedEvent('cleanup_approved', {
          eventId: event._id,
          title: event.title,
          organizer: event.organizer.name
        }).catch(err => console.error("Background feed event failed:", err));
      }
    }

  } catch (err) {
    console.error("Error approving event:", err);
    res.status(500).json({ message: err.message });
  }
});



// --- Content Moderation Endpoints ---

// Get all posts for moderation
router.get("/posts", verifyToken, adminOrMod, async (req, res) => {
  try {
    const animalsCollection = getCollection("animals");
    const lostFoundCollection = getCollection("lostFound");
    const announcementsCollection = getCollection("announcements");

    const animals = await animalsCollection.find().toArray();
    const lostFound = await lostFoundCollection.find().toArray();
    const announcements = await announcementsCollection.find().toArray();

    res.send({ animals, lostFound, announcements });
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch posts" });
  }
});

// Delete a post by type and id
router.delete("/posts/:type/:id", verifyToken, adminOrMod, async (req, res) => {
  try {
    const { type, id } = req.params;
    let collectionName = "";
    
    if (type === "animal") collectionName = "animals";
    else if (type === "lostfound") collectionName = "lostFound";
    else if (type === "announcement") collectionName = "announcements";
    else return res.status(400).send({ error: "Invalid post type" });

    const collection = getCollection(collectionName);
    const result = await collection.deleteOne({ _id: new ObjectId(id) });
    
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to delete post" });
  }
});


function computePriorityScore(issue) {
  const urgencyMultiplier = {
    emergency: 5.0,
    high: 2.0,
    medium: 1.2,
    low: 1.0
  };
  
  const baseScore = (issue.upvotes?.length || 0) * 10;
  const mult = urgencyMultiplier[issue.urgency] || 1.0;
  
  const hoursOpen = (Date.now() - new Date(issue.submittedAt).getTime()) / (1000 * 60 * 60);
  const timeScore = Math.min(Math.max(hoursOpen, 0), 100);
  
  return Math.round((baseScore * mult) + timeScore);
}

// GET /api/admin/queue/count - Admin only
router.get("/queue/count", verifyToken, adminOnly, async (req, res) => {
  try {
    const [pending_review, open, action_taken, pending_verification, solved, rejected, pending_events, rejected_events] = await Promise.all([
      Issue.countDocuments({ approvalStatus: "pending_review", isHidden: false }),
      Issue.countDocuments({ approvalStatus: "approved", status: "open", isHidden: false }),
      Issue.countDocuments({ approvalStatus: "approved", status: "action_taken", isHidden: false }),
      Issue.countDocuments({ approvalStatus: "approved", status: "pending_verification", isHidden: false }),
      Issue.countDocuments({ approvalStatus: "approved", status: "solved", isHidden: false }),
      Issue.countDocuments({ approvalStatus: "rejected", isHidden: false }),
      getCollection("cleanupevents").countDocuments({ approvalStatus: "pending_review" }),
      getCollection("cleanupevents").countDocuments({ approvalStatus: "rejected" })
    ]);

    res.json({
      pending_review: pending_review + pending_events,
      open,
      action_taken,
      pending_verification,
      solved,
      rejected: rejected + rejected_events
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/queue - Admin only
router.get("/queue", verifyToken, adminOnly, async (req, res) => {
  try {
    const { status, category, urgency, area, search, sort, page = 1, limit = 5, type = 'all' } = req.query;
    let query = { isHidden: false };
    let sortObj = { submittedAt: -1 };
    
    // Admin queue filters
    if (status) {
      if (status === 'pending_review') {
        query.approvalStatus = 'pending_review';
      } else if (status === 'all_approved') {
        query.approvalStatus = 'approved';
        sortObj = { approvedAt: -1, submittedAt: -1 };
      } else if (status === 'rejected') {
        query.approvalStatus = 'rejected';
      } else {
        query.approvalStatus = 'approved';
        query.status = status;
      }
    }
    
    if (category) query.category = category;
    if (urgency) query.urgency = urgency;
    if (area) query.area = area;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Always fetch all to calculate priority properly, or we can just sort natively if not using priority sort
    let issues = await Issue.find(query).sort(sortObj).lean();

    issues = issues.map(issue => {
      const obj = typeof issue.toObject === 'function' ? issue.toObject() : { ...issue };
      obj.priorityScore = computePriorityScore(obj);
      return obj;
    });

    if (sort === 'priority') {
      issues.sort((a, b) => b.priorityScore - a.priorityScore);
    } else if (sort === 'newest') {
      issues.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    } else if (sort === 'upvotes') {
      issues.sort((a, b) => (b.upvotes?.length || 0) - (a.upvotes?.length || 0));
    }

    const totalCount = issues.length;
    let paginatedIssues = issues.slice(skip, skip + parseInt(limit));

    if (type === 'all' || type === 'events') {
      let eventQuery = {};
      
      if (status) {
        if (status === 'pending_review') {
          eventQuery.approvalStatus = 'pending_review';
        } else if (status === 'all_approved') {
          eventQuery.approvalStatus = 'approved';
        } else if (status === 'rejected') {
          eventQuery.approvalStatus = 'rejected';
        } else {
          eventQuery.approvalStatus = 'approved';
          eventQuery.status = status;
        }
      }

      const events = await CleanupEvent.find(eventQuery).lean();
      
      const usersCollection = getCollection('users');
      
      const normalizedEvents = await Promise.all(events.map(async (e) => {
        let realName = e.organizer?.name;
        let realPhoto = e.organizer?.photoURL;
        
        if (e.organizer?.email) {
          const userDoc = await usersCollection.findOne({ email: e.organizer.email });
          if (userDoc) {
            realName = userDoc.name || userDoc.displayName || realName;
            realPhoto = userDoc.photoURL || realPhoto;
          }
        }
        
        return { 
          ...e, 
          _type: 'cleanup_event',
          images: e.coverImages || [],
          area: e.location?.area || e.location?.address || 'Unknown Area',
          submittedBy: e.organizer ? {
            name: realName,
            email: e.organizer.email,
            photoURL: realPhoto
          } : null,
          submittedAt: e.createdAt || e.eventDate,
          category: 'Community Drive',
          fundingEnabled: e.fundingEnabled
        };
      }));

      paginatedIssues = [...paginatedIssues, ...normalizedEvents];
    }

    res.json({
      issues: paginatedIssues,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      totalCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/admin/issues/:id/approve
router.patch("/issues/:id/approve", verifyToken, adminOnly, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ error: "Not found" });
    
    const adminInfo = { email: req.user.email, name: req.user.name || "Admin", role: "admin" };
    
    const previousValue = issue.approvalStatus;
    issue.approvalStatus = "approved";
    issue.status = "open"; // CHANGED: from in_queue to open
    issue.approvedAt = new Date();
    issue.approvedBy = req.user.email;
    
    await issue.save();
    
    // Log new_issue feed event
    try {
      const { createFeedEvent } = require("../utils/feedHelper");
      await createFeedEvent('new_issue', {
        issueId: issue._id,
        title: issue.title,
        area: issue.area,
        category: issue.category
      });
    } catch (feedErr) {
      console.error("Failed to log new_issue feed event:", feedErr);
    }

    await logAudit({ action: "ISSUE_APPROVED", targetType: "issue", targetId: issue._id, performedBy: adminInfo, note: "Approved issue", oldValue: previousValue, newValue: "approved" });
    
    if (issue.submittedBy && issue.submittedBy.email) {
      const email = issue.submittedBy.email;
      try {
        const { addPoints } = require("../utils/pointsHelper");
        await addPoints(email, "issue_reported");
        
        const usersCollection = getCollection('users');
        const user = await usersCollection.findOne({ email }, { projection: { issuesReported: 1 } });
        if (!user?.issuesReported || user.issuesReported === 0) {
          await addPoints(email, 'first_issue');
          await usersCollection.updateOne({ email }, { $set: { issuesReported: 1 } });
        } else {
          await usersCollection.updateOne({ email }, { $inc: { issuesReported: 1 } });
        }
      } catch (err) {
        console.error("Failed to add issue approval points:", err);
      }

      await createNotification({ userId: issue.submittedBy.userId, email: issue.submittedBy.email, message: "Your issue is now live and visible to the community!", type: "approval", link: `/issues/${issue._id}` });
    }
    
    // Emit real-time WebSocket event
    const io = req.app.get("io");
    if (io) {
      io.emit('issueStatusUpdated', { issueId: issue._id, status: issue.status, approvalStatus: issue.approvalStatus });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/admin/issues/:id/reject
router.patch("/issues/:id/reject", verifyToken, adminOnly, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: "Reason required" });

    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ error: "Not found" });
    
    const adminInfo = { email: req.user.email, name: req.user.name || "Admin", role: "admin" };
    
    const previousValue = issue.approvalStatus;
    issue.approvalStatus = "rejected";
    issue.status = "rejected";
    issue.rejectedAt = new Date();
    issue.rejectedBy = req.user.email;
    issue.rejectReason = reason;
    
    await issue.save();
    await logAudit({ action: "ISSUE_REJECTED", targetType: "issue", targetId: issue._id, performedBy: adminInfo, note: `Rejected issue: ${reason}`, oldValue: previousValue, newValue: "rejected" });
    
    if (issue.submittedBy && issue.submittedBy.email) {
      await createNotification({ userId: issue.submittedBy.userId, email: issue.submittedBy.email, message: "Your issue was rejected by an admin.", type: "rejection" });
    }
    
    // Emit real-time WebSocket event
    const io = req.app.get("io");
    if (io) {
      io.emit('issueStatusUpdated', { issueId: issue._id, status: issue.status, approvalStatus: issue.approvalStatus });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/admin/cleanup-events/:id/approve
router.patch("/cleanup-events/:id/approve", verifyToken, adminOnly, async (req, res) => {
  try {
    const event = await CleanupEvent.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          approvalStatus: 'approved',
          approvedBy: req.user.email,
        }
      },
      { new: true }
    );

    if (!event) return res.status(404).json({ error: "Not found" });

    // Broadcast notification to ALL users
    const { getCollection } = require("../config/db");
    const usersCollection = getCollection("users");
    const allUsers = await usersCollection.find({}, { projection: { email: 1 } }).toArray();
    
    await Promise.all(allUsers.map(u => {
      if (u.email === event.organizer.email) {
        return createNotification({
          userId:  event.organizer.email,
          message: `Your event is live! Manage it here →`,
          type:    'drive',
          link:    `/profile`,
        });
      } else {
        return createNotification({
          userId:  u.email,
          message: `🌿 A new cleanup drive is happening in ${event.location.area || 'your area'}: "${event.title}" on ${new Date(event.eventDate).toLocaleDateString()}`,
          type:    'drive',
          link:    `/cleanup-events/${event._id}`,
        });
      }
    }));

    const { createFeedEvent } = require("../utils/feedHelper");
    await createFeedEvent('new_cleanup_event', {
      driveTitle: event.title,
      area:       event.location.area || '',
      actorName:  event.organizer?.name || 'A community member',
      link:       `/cleanup-events/${event._id}`,
    });

    const adminInfo = { email: req.user.email, name: req.user.name || "Admin", role: "admin" };
    await logAudit({ performedBy: adminInfo, action: 'CLEANUP_EVENT_APPROVED', targetId: event._id, targetType: 'cleanup_event' });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/admin/cleanup-events/:id/reject
router.patch("/cleanup-events/:id/reject", verifyToken, adminOnly, async (req, res) => {
  try {
    const { reason } = req.body;
    const event = await CleanupEvent.findByIdAndUpdate(req.params.id, {
      $set: { approvalStatus: 'rejected', rejectReason: reason || '', rejectedBy: req.user.email }
    });

    if (!event) return res.status(404).json({ error: "Not found" });

    const adminInfo = { email: req.user.email, name: req.user.name || "Admin", role: "admin" };
    await logAudit({ performedBy: adminInfo, action: 'CLEANUP_EVENT_REJECTED', targetId: event._id, targetType: 'cleanup_event' });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/admin/issues/:id/status
router.patch("/issues/:id/status", verifyToken, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ error: "Not found" });
    
    const previousValue = issue.status;
    issue.status = status;
    issue.statusChangedAt = new Date();
    issue.statusChangedBy = req.user.email;
    
    await issue.save();
    
    const adminInfo = { email: req.user.email, name: req.user.name || "Admin", role: "admin" };
    await logAudit({ action: "CHANGE_STATUS", targetType: "issue", targetId: issue._id, performedBy: adminInfo, note: `Changed status to ${status}`, oldValue: previousValue, newValue: status });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/issues/:id/reveal-identity
router.get("/issues/:id/reveal-identity", verifyToken, adminOnly, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ error: "Not found" });
    
    issue.identityRevealLog.push({
      revealedBy: req.user.email,
      revealedAt: new Date()
    });
    
    await issue.save();
    
    const adminInfo = { email: req.user.email, name: req.user.name || "Admin", role: "admin" };
    await logAudit({ action: "REVEAL_IDENTITY", targetType: "issue", targetId: issue._id, performedBy: adminInfo, note: "Revealed anonymous poster identity" });
    
    res.json(issue.submittedBy);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/admin/issues/:id/assign
router.patch("/issues/:id/assign", verifyToken, adminOnly, async (req, res) => {
  try {
    const { email, name, type, deadline, adminNote } = req.body;
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ error: "Not found" });
    
    issue.assignedTo = { email, name, type, assignedAt: new Date() };
    issue.status = "action_taken";
    if (adminNote) issue.adminNotes = adminNote;
    await issue.save();
    
    const adminInfo = { email: req.user.email, name: req.user.name || "Admin", role: "admin" };
    await logAudit({ action: "ASSIGN_ISSUE", targetType: "issue", targetId: issue._id, performedBy: adminInfo, note: `Assigned to ${name} (${type})`, newValue: "action_taken" });

    if (issue.submittedBy && issue.submittedBy.email) {
      await createNotification({ userId: issue.submittedBy.userId, email: issue.submittedBy.email, message: `Your issue has been assigned to ${name}!`, type: "assignment", link: `/issues/${issue._id}` });
    }
    if (email) {
      await createNotification({ email, message: `You have been assigned to an issue: ${issue.title}`, type: "assignment", link: `/issues/${issue._id}` });
    }

    res.json({ success: true, assignedTo: issue.assignedTo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/forum
router.get('/forum', verifyToken, adminOnly, async (req, res) => {
  const { category, search, page = 1, limit = 20 } = req.query;
  const col   = getCollection('forum');
  const query = {};
  if (category) query.category = category;
  if (search)   query.title = { $regex: search, $options: 'i' };

  const threads = await col
    .find(query)
    .project({ replies: 0 })
    .sort({ isPinned: -1, date: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .toArray();

  const total = await col.countDocuments(query);
  res.json({ threads, total });
});

// PATCH /api/admin/forum/:id/pin
router.patch('/forum/:id/pin', verifyToken, adminOnly, async (req, res) => {
  const col    = getCollection('forum');
  const thread = await col.findOne({ _id: new ObjectId(req.params.id) });
  const newPinState = !thread.isPinned;
  await col.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { isPinned: newPinState } });
  await logAudit({ performedBy: req.user.email, action: 'FORUM_THREAD_PINNED', targetId: req.params.id, targetType: 'forum' });

  // Broadcast pin status update
  const io = req.app.get("io");
  if (io) {
    io.to(`thread:${req.params.id}`).emit("thread_updated", { threadId: req.params.id, isPinned: newPinState, isLocked: thread.isLocked });
    io.emit("thread_updated_global", { threadId: req.params.id, isPinned: newPinState, isLocked: thread.isLocked });
  }

  res.json({ success: true, isPinned: newPinState });
});

// PATCH /api/admin/forum/:id/lock
router.patch('/forum/:id/lock', verifyToken, adminOnly, async (req, res) => {
  const col    = getCollection('forum');
  const thread = await col.findOne({ _id: new ObjectId(req.params.id) });
  const newLockState = !thread.isLocked;
  await col.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { isLocked: newLockState } });

  // Broadcast lock status update
  const io = req.app.get("io");
  if (io) {
    io.to(`thread:${req.params.id}`).emit("thread_updated", { threadId: req.params.id, isPinned: thread.isPinned, isLocked: newLockState });
    io.emit("thread_updated_global", { threadId: req.params.id, isPinned: thread.isPinned, isLocked: newLockState });
  }

  res.json({ success: true, isLocked: newLockState });
});

// DELETE /api/admin/forum/:id
router.delete('/forum/:id', verifyToken, adminOnly, async (req, res) => {
  const col = getCollection('forum');
  await col.deleteOne({ _id: new ObjectId(req.params.id) });
  await logAudit({ performedBy: req.user.email, action: 'POST_DELETED', targetId: req.params.id, targetType: 'forum' });

  // Broadcast deletion to active thread room and globally
  const io = req.app.get("io");
  if (io) {
    io.to(`thread:${req.params.id}`).emit("thread_deleted", { threadId: req.params.id });
    io.emit("thread_deleted_global", { threadId: req.params.id });
  }

  res.json({ success: true });
});

// GET /api/admin/ngos
router.get('/ngos', verifyToken, adminOnly, async (req, res) => {
  const { status } = req.query;
  const col   = getCollection('ngos');
  const query = status ? { status } : {};
  const ngos  = await col.find(query).sort({ registeredAt: -1 }).toArray();
  res.json({ ngos });
});

// PATCH /api/admin/ngos/:id/verify
router.patch('/ngos/:id/verify', verifyToken, adminOnly, async (req, res) => {
  const col = getCollection('ngos');
  await col.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status: 'verified', verifiedAt: new Date(), verifiedBy: req.user.email } }
  );

  const ngo = await col.findOne({ _id: new ObjectId(req.params.id) });
  await createNotification({
    email:  ngo.email,
    message: `🎉 Your NGO "${ngo.name}" has been verified on CivicNest!`,
    type:    'admin_msg',
    link:    `/ngos`,
    priority: 'high',
  });

  await logAudit({ performedBy: req.user.email, action: 'NGO_VERIFIED', targetId: req.params.id, targetType: 'ngo' });
  res.json({ success: true });
});

// PATCH /api/admin/ngos/:id/reject
router.patch('/ngos/:id/reject', verifyToken, adminOnly, async (req, res) => {
  const { reason } = req.body;
  const col = getCollection('ngos');
  const ngo = await col.findOne({ _id: new ObjectId(req.params.id) });

  await col.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status: 'rejected', rejectReason: reason || '', rejectedBy: req.user.email } }
  );

  await createNotification({
    email:  ngo.email,
    message: `Your NGO registration was not approved. Reason: ${reason}`,
    type:    'admin_msg',
    link:    `/ngos/register`,
  });

  res.json({ success: true });
});

// GET /api/admin/animals/pending-rescues
router.get('/animals/pending-rescues', verifyToken, adminOnly, async (req, res) => {
  try {
    const col = getCollection('animals');
    const animals = await col.find({ rescueVerificationStatus: 'pending' }).toArray();
    res.json(animals);
  } catch (err) {
    console.error("Error fetching pending rescues:", err);
    res.status(500).json({ message: "Failed to fetch pending rescues" });
  }
});

// PATCH /api/admin/animals/:id/verify-rescue
router.patch('/animals/:id/verify-rescue', verifyToken, adminOrMod, async (req, res) => {
  try {
    const { decision, rejectionReason } = req.body;
    const col = getCollection('animals');
    const animal = await col.findOne({ _id: new ObjectId(req.params.id) });
    if (!animal) return res.status(404).json({ message: 'Not found.' });

    if (decision === 'approved') {
      await col.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { rescueVerificationStatus: 'approved', verifiedAt: new Date(), verifiedBy: req.user.email } }
      );

      const { addPoints } = require("../utils/pointsHelper");
      const { createFeedEvent } = require("../utils/feedHelper");
      
      // Award reporter
      if (animal.reporter?.email) {
        await addPoints(animal.reporter.email, 'animal_rescued_reporter');
      }

      // Award each volunteer
      const verifiedVolunteers = animal.rescueProof?.verifiedVolunteers || [];
      for (const volunteerEmail of verifiedVolunteers) {
        await addPoints(volunteerEmail, 'animal_rescued_volunteer');
      }

      await createFeedEvent('animal_rescued', {
        animalType: animal.animalType,
        area:       animal.location || animal.area,
        actorName:  'The Community',
        link:       `/animals/${animal._id}`,
      });

      if (animal.reporter?.email) {
        await createNotification({
          userId:   animal.reporter.email,
          email:    animal.reporter.email,
          message:  `✅ Your ${animal.animalType} rescue has been verified! Points awarded.`,
          type:     'animal',
          link:     `/animals/${animal._id}`,
          priority: 'high',
        });
      }

      await logAudit({ performedBy: req.user.email, action: 'ANIMAL_RESCUE_APPROVED', targetId: animal._id, targetType: 'animal' });

    } else if (decision === 'rejected') {
      await col.updateOne(
        { _id: new ObjectId(req.params.id) },
        {
          $set: {
            rescueVerificationStatus: 'rejected',
            status:                   'needs-help',
            rescueRejectionReason:    rejectionReason || 'Proof insufficient.',
          }
        }
      );

      if (animal.reporter?.email) {
        await createNotification({
          userId:   animal.reporter.email,
          email:    animal.reporter.email,
          message:  `Your rescue proof for the ${animal.animalType} in ${animal.location || animal.area} was not accepted. Reason: ${rejectionReason}. Please re-submit with clearer photos.`,
          type:     'animal',
          link:     `/animals/${animal._id}`,
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error verifying rescue:", err);
    res.status(500).json({ message: "Failed to verify rescue." });
  }
});

// POST /api/admin/lost-found/:itemId/submissions/:submissionId/dismiss - dismiss/reject and block a single claim/report
router.post("/lost-found/:itemId/submissions/:submissionId/dismiss", verifyToken, adminOrMod, async (req, res) => {
  try {
    const { itemId, submissionId } = req.params;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: "Rejection reason is required." });

    const col = getCollection("lostFound");
    const item = await col.findOne({ _id: new ObjectId(itemId) });
    if (!item) return res.status(404).json({ error: "Listing not found." });

    const submissionIdObj = new ObjectId(submissionId);
    let email = "";

    if (item.type === "lost") {
      const report = item.foundReports?.find(r => r._id && r._id.toString() === submissionId);
      if (!report) return res.status(404).json({ error: "Sighting report not found." });
      email = report.email;
      await col.updateOne(
        { _id: new ObjectId(itemId), "foundReports._id": submissionIdObj },
        { 
          $set: { 
            "foundReports.$.status": "rejected", 
            "foundReports.$.rejectionReason": reason,
            "foundReports.$.dismissedAt": new Date() 
          } 
        }
      );
    } else {
      const claim = item.claims?.find(c => c._id && c._id.toString() === submissionId);
      if (!claim) return res.status(404).json({ error: "Ownership claim not found." });
      email = claim.email;
      await col.updateOne(
        { _id: new ObjectId(itemId), "claims._id": submissionIdObj },
        { 
          $set: { 
            "claims.$.status": "rejected", 
            "claims.$.rejectionReason": reason,
            "claims.$.dismissedAt": new Date() 
          } 
        }
      );
    }

    try {
      const adminInfo = {
        adminEmail: req.user.email,
        adminName: req.user.name || req.user.email.split('@')[0],
        adminId: req.user.uid
      };
      await logAudit({ 
        performedBy: adminInfo, 
        action: 'SUBMISSION_DISMISSED',
        targetId: new ObjectId(itemId), 
        targetType: 'lostfound',
        note: `Dismissed lostfound submission from ${email}. Reason: ${reason}` 
      });
    } catch (auditErr) {
      console.error("Audit log failed for lostFound dismissal:", auditErr.message);
    }

    // Send notification to the submitter
    try {
      await createNotification({
        userId: email,
        email: email,
        message: `⚠️ Your submission for "${item.itemName}" was rejected by the admin. Reason: ${reason}`,
        type: 'warning',
        link: `/lost-found/${item._id}`
      });
    } catch (notifErr) {
      console.error("Notification failed for lostFound dismissal:", notifErr.message);
    }

    res.json({ success: true, message: "Submission dismissed successfully." });
  } catch (error) {
    console.error("Error dismissing submission:", error);
    res.status(500).json({ error: "Failed to dismiss submission: " + error.message });
  }
});

// DELETE /api/admin/lost-found/:itemId/submissions/:submissionId - completely delete/reset a single claim/report
router.delete("/lost-found/:itemId/submissions/:submissionId", verifyToken, adminOrMod, async (req, res) => {
  try {
    const { itemId, submissionId } = req.params;
    const col = getCollection("lostFound");
    const item = await col.findOne({ _id: new ObjectId(itemId) });
    if (!item) return res.status(404).json({ error: "Listing not found." });

    const submissionIdObj = new ObjectId(submissionId);
    let email = "";

    if (item.type === "lost") {
      const report = item.foundReports?.find(r => r._id && r._id.toString() === submissionId);
      if (report) email = report.email;
      await col.updateOne(
        { _id: new ObjectId(itemId) },
        { $pull: { foundReports: { _id: submissionIdObj } } }
      );
    } else {
      const claim = item.claims?.find(c => c._id && c._id.toString() === submissionId);
      if (claim) email = claim.email;
      await col.updateOne(
        { _id: new ObjectId(itemId) },
        { $pull: { claims: { _id: submissionIdObj } } }
      );
    }

    try {
      const adminInfo = {
        adminEmail: req.user.email,
        adminName: req.user.name || req.user.email.split('@')[0],
        adminId: req.user.uid
      };
      await logAudit({ 
        performedBy: adminInfo, 
        action: 'SUBMISSION_DISMISSED', 
        targetId: new ObjectId(itemId), 
        targetType: 'lostfound', 
        note: `Reset/Deleted lostfound submission from ${email || 'unknown'}` 
      });
    } catch (auditErr) {
      console.error("Audit log failed for lostFound reset:", auditErr.message);
    }

    res.json({ success: true, message: "Submission removed/reset successfully." });
  } catch (error) {
    console.error("Error resetting submission:", error);
    res.status(500).json({ error: "Failed to reset submission: " + error.message });
  }
});

// Get all donations/contributions
router.get("/donations", verifyToken, adminOnly, async (req, res) => {
  try {
    const contributionsCollection = getCollection("contributions");
    const donations = await contributionsCollection.find().sort({ date: -1 }).toArray();
    res.json(donations);
  } catch (error) {
    console.error("Error fetching admin donations:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
