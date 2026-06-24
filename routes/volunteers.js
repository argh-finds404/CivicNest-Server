// const express = require("express");
// const router = express.Router();
// const { verifyToken } = require("../middleware/auth");
// const { getCollection } = require("../config/db");
// const CleanupEvent = require("../models/CleanupEvent");
// const { ObjectId } = require("mongodb");

// // Get upcoming volunteer drives
// router.get("/drives", async (req, res) => {
//   const drivesCollection = getCollection("volunteerDrives");
//   const result = await drivesCollection.find({}).sort({ date: 1 }).toArray();
//   res.send(result);
// });

// // Check volunteer status
// router.get("/status", verifyToken, async (req, res) => {
//   const volunteersCollection = getCollection("volunteers");
//   const result = await volunteersCollection.findOne({ email: req.user.email });
//   res.send({ isRegistered: !!result });
// });

// // Register as volunteer
// router.post("/register", verifyToken, async (req, res) => {
//   const volunteersCollection = getCollection("volunteers");
//   const data = req.body;
  
//   const updateDoc = {
//     $set: {
//       email: req.user.email,
//       name: req.user.displayName || req.user.name || req.user.email,
//       photoURL: req.user.photoURL || req.user.picture || null,
//       skills: data.skills || [],
//       availability: data.availability,
//       registeredAt: new Date()
//     }
//   };
//   const result = await volunteersCollection.updateOne(
//     { email: req.user.email },
//     updateDoc,
//     { upsert: true }
//   );
//   res.send(result);
// });

// // Get volunteer stats and participation history
// router.get("/stats", verifyToken, async (req, res) => {
//   try {
//     const email = req.user.email;
    
//     // Get all events the user has volunteered for
//     const events = await CleanupEvent.find({ 'going.email': email }).lean();
    
//     // Calculate stats
//     let totalHours = 0;
//     let totalEvents = 0;
//     let totalPoints = 0;
//     let verifiedEvents = 0;
//     let pendingVerifications = 0;
    
//     const participationHistory = events.map(event => {
//       const volunteer = event.going.find(v => v.email === email);
//       const hours = event.durationHours || 3; // Default to 3 hours if not specified
//       const points = volunteer.status === 'attended' ? hours * 10 : 0; // 10 points per hour
      
//       totalHours += hours;
//       totalEvents += 1;
//       totalPoints += points;
      
//       if (volunteer.status === 'attended') {
//         verifiedEvents += 1;
//       } else if (volunteer.status === 'going') {
//         pendingVerifications += 1;
//       }
      
//       return {
//         _id: event._id,
//         title: event.title,
//         date: event.eventDate,
//         hours: hours,
//         points: points,
//         status: volunteer.status === 'attended' ? 'verified' : 'pending',
//         verificationMethod: volunteer.verificationMethod || null,
//       };
//     });
    
//     // Calculate level based on points
//     let currentLevel = 'Bronze';
//     let nextLevel = 'Silver';
//     let pointsToNextLevel = 100;
    
//     if (totalPoints >= 500) {
//       currentLevel = 'Platinum';
//       nextLevel = 'Max';
//       pointsToNextLevel = 0;
//     } else if (totalPoints >= 300) {
//       currentLevel = 'Gold';
//       nextLevel = 'Platinum';
//       pointsToNextLevel = 500 - totalPoints;
//     } else if (totalPoints >= 100) {
//       currentLevel = 'Silver';
//       nextLevel = 'Gold';
//       pointsToNextLevel = 300 - totalPoints;
//     } else {
//       pointsToNextLevel = 100 - totalPoints;
//     }
    
//     res.json({
//       totalHours,
//       totalEvents: verifiedEvents,
//       totalPoints,
//       currentLevel,
//       nextLevel,
//       pointsToNextLevel,
//       pendingVerifications,
//       participationHistory: participationHistory.sort((a, b) => new Date(b.date) - new Date(a.date)),
//     });
//   } catch (err) {
//     console.error('Error getting volunteer stats:', err);
//     res.status(500).json({ message: 'Failed to get volunteer stats' });
//   }
// });

// // Submit verification for volunteer participation
// router.post("/verify", verifyToken, async (req, res) => {
//   try {
//     const { eventId, method, proofData } = req.body;
//     const email = req.user.email;
    
//     if (!eventId || !method) {
//       return res.status(400).json({ message: 'Event ID and verification method are required' });
//     }
    
//     const event = await CleanupEvent.findById(eventId);
//     if (!event) {
//       return res.status(404).json({ message: 'Event not found' });
//     }
    
//     // Check if user is in the going list
//     const volunteerIndex = event.going.findIndex(v => v.email === email);
//     if (volunteerIndex === -1) {
//       return res.status(403).json({ message: 'You are not registered as a volunteer for this event' });
//     }
    
//     // Update volunteer with verification details
//     event.going[volunteerIndex].verificationMethod = method;
//     event.going[volunteerIndex].verificationData = proofData || {};
//     event.going[volunteerIndex].verificationSubmittedAt = new Date();
//     event.going[volunteerIndex].verificationStatus = 'pending';
    
//     await event.save();
    
//     // Create notification for organizer
//     const notificationsCollection = getCollection('notifications');
//     if (notificationsCollection) {
//       await notificationsCollection.insertOne({
//         userId: event.organizer.email,
//         message: `${req.user.displayName || email} has submitted verification for "${event.title}"`,
//         type: 'verification_request',
//         link: `/cleanup-events/${event._id}`,
//         priority: 'normal',
//         read: false,
//         createdAt: new Date()
//       });
//     }
    
//     res.json({ 
//       success: true, 
//       message: 'Verification submitted successfully. Waiting for organizer approval.' 
//     });
//   } catch (err) {
//     console.error('Error submitting verification:', err);
//     res.status(500).json({ message: 'Failed to submit verification' });
//   }
// });

// // Approve volunteer verification (organizer only)
// router.post("/approve-verification", verifyToken, async (req, res) => {
//   try {
//     const { eventId, volunteerEmail } = req.body;
//     const organizerEmail = req.user.email;
    
//     if (!eventId || !volunteerEmail) {
//       return res.status(400).json({ message: 'Event ID and volunteer email are required' });
//     }
    
//     const event = await CleanupEvent.findById(eventId);
//     if (!event) {
//       return res.status(404).json({ message: 'Event not found' });
//     }
    
//     // Check if user is the organizer
//     if (event.organizer.email !== organizerEmail && req.user.role !== 'admin') {
//       return res.status(403).json({ message: 'Only the organizer can approve verifications' });
//     }
    
//     // Find and update the volunteer
//     const volunteerIndex = event.going.findIndex(v => v.email === volunteerEmail);
//     if (volunteerIndex === -1) {
//       return res.status(404).json({ message: 'Volunteer not found in event' });
//     }
    
//     // Update volunteer status to attended
//     event.going[volunteerIndex].status = 'attended';
//     event.going[volunteerIndex].verificationStatus = 'approved';
//     event.going[volunteerIndex].verifiedAt = new Date();
//     event.going[volunteerIndex].verifiedBy = organizerEmail;
    
//     await event.save();
    
//     // Award points to volunteer
//     const usersCollection = getCollection('users');
//     if (usersCollection) {
//       const hours = event.durationHours || 3;
//       const pointsToAdd = hours * 10; // 10 points per hour
      
//       await usersCollection.updateOne(
//         { email: volunteerEmail },
//         { 
//           $inc: { points: pointsToAdd, totalVolunteerHours: hours },
//           $set: { lastUpdated: new Date() }
//         },
//         { upsert: true }
//       );
//     }
    
//     // Notify volunteer
//     const notificationsCollection = getCollection('notifications');
//     if (notificationsCollection) {
//       await notificationsCollection.insertOne({
//         userId: volunteerEmail,
//         message: `Your participation in "${event.title}" has been verified! You earned points.`,
//         type: 'verification_approved',
//         link: `/volunteer-dashboard`,
//         priority: 'high',
//         read: false,
//         createdAt: new Date()
//       });
//     }
    
//     res.json({ 
//       success: true, 
//       message: 'Volunteer verified and points awarded successfully' 
//     });
//   } catch (err) {
//     console.error('Error approving verification:', err);
//     res.status(500).json({ message: 'Failed to approve verification' });
//   }
// });

// // Reject volunteer verification (organizer only)
// router.post("/reject-verification", verifyToken, async (req, res) => {
//   try {
//     const { eventId, volunteerEmail, reason } = req.body;
//     const organizerEmail = req.user.email;
    
//     if (!eventId || !volunteerEmail) {
//       return res.status(400).json({ message: 'Event ID and volunteer email are required' });
//     }
    
//     const event = await CleanupEvent.findById(eventId);
//     if (!event) {
//       return res.status(404).json({ message: 'Event not found' });
//     }
    
//     // Check if user is the organizer
//     if (event.organizer.email !== organizerEmail && req.user.role !== 'admin') {
//       return res.status(403).json({ message: 'Only the organizer can reject verifications' });
//     }
    
//     // Find and update the volunteer
//     const volunteerIndex = event.going.findIndex(v => v.email === volunteerEmail);
//     if (volunteerIndex === -1) {
//       return res.status(404).json({ message: 'Volunteer not found in event' });
//     }
    
//     // Update volunteer status back to going
//     event.going[volunteerIndex].status = 'going';
//     event.going[volunteerIndex].verificationStatus = 'rejected';
//     event.going[volunteerIndex].rejectionReason = reason || '';
//     event.going[volunteerIndex].rejectedAt = new Date();
    
//     await event.save();
    
//     // Notify volunteer
//     const notificationsCollection = getCollection('notifications');
//     if (notificationsCollection) {
//       await notificationsCollection.insertOne({
//         userId: volunteerEmail,
//         message: `Your verification for "${event.title}" was rejected. ${reason || 'Please contact the organizer for details.'}`,
//         type: 'verification_rejected',
//         link: `/cleanup-events/${event._id}`,
//         priority: 'normal',
//         read: false,
//         createdAt: new Date()
//       });
//     }
    
//     res.json({ 
//       success: true, 
//       message: 'Verification rejected successfully' 
//     });
//   } catch (err) {
//     console.error('Error rejecting verification:', err);
//     res.status(500).json({ message: 'Failed to reject verification' });
//   }
// });

// module.exports = router;







const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { memberOnly } = require("../middleware/memberOnly");
const { getCollection } = require("../config/db");
const CleanupEvent = require("../models/CleanupEvent");
const { ObjectId } = require("mongodb");
const { addPoints } = require("../utils/pointsHelper");
const { createNotification } = require("../utils/notificationHelper");

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/volunteers/status — is current user registered?
// ─────────────────────────────────────────────────────────────────────────────
router.get("/status", verifyToken, async (req, res) => {
  try {
    const col = getCollection("volunteers");
    const doc = await col.findOne({ email: req.user.email });
    res.json({ isRegistered: !!doc, volunteer: doc || null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/volunteers/register — register or update volunteer profile
// ─────────────────────────────────────────────────────────────────────────────
router.post("/register", verifyToken, memberOnly, async (req, res) => {
  try {
    const col = getCollection("volunteers");
    const usersCol = getCollection("users");
    const { skills, availability, area, phone, contactMethod } = req.body;

    if (!skills || skills.length === 0) {
      return res.status(400).json({ message: "Select at least one skill." });
    }

    const dbUser = await usersCol.findOne({ email: req.user.email });
    const actualName = dbUser?.name || dbUser?.displayName || req.user.displayName || req.user.email;
    const actualPhoto = dbUser?.photoURL || req.user.photoURL || null;

    const existing = await col.findOne({ email: req.user.email });
    const approvalStatus = existing ? existing.approvalStatus : "pending";
    const isAvailable = existing ? existing.isAvailable : false;

    await col.updateOne(
      { email: req.user.email },
      {
        $set: {
          email: req.user.email,
          name: actualName,
          photoURL: actualPhoto,
          skills: skills || [],
          availability: availability || "Anytime",
          area: area || "", 
          phone: phone || "",
          contactMethod: contactMethod || "Email",
          isAvailable, 
          approvalStatus,
          registeredAt: new Date(),
        },
      },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/volunteers/stats — real stats from CleanupEvent data
// FIX: was returning mock data; now hits real API
// ─────────────────────────────────────────────────────────────────────────────
router.get("/stats", verifyToken, async (req, res) => {
  try {
    const email = req.user.email;
    const events = await CleanupEvent.find({ "going.email": email }).lean();

    let totalHours = 0,
      totalPoints = 0,
      verifiedCount = 0,
      pendingCount = 0;

    const history = events
      .map((event) => {
        const entry = event.going.find((v) => v.email === email);
        const hours = event.durationHours || 3;
        const verified = entry?.status === "attended";
        const pts = verified ? hours * 10 : 0;

        totalHours += hours;
        totalPoints += pts;
        if (verified) verifiedCount++;
        else if (entry?.status === "going") pendingCount++;

        return {
          _id: event._id,
          title: event.title,
          date: event.eventDate,
          area: event.location?.area || "",
          coverImage: event.coverImages?.[0] || null,
          hours,
          points: pts,
          status: verified ? "verified" : "pending",
          verificationStatus: entry?.verificationStatus || null,
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    // Level thresholds
    let level = "Bronze",
      nextLevel = "Silver",
      toNext = 100 - totalPoints;
    if (totalPoints >= 500) {
      level = "Platinum";
      nextLevel = "Max";
      toNext = 0;
    } else if (totalPoints >= 300) {
      level = "Gold";
      nextLevel = "Platinum";
      toNext = 500 - totalPoints;
    } else if (totalPoints >= 100) {
      level = "Silver";
      nextLevel = "Gold";
      toNext = 300 - totalPoints;
    }

    // Get user's total points from users collection (includes all platform points)
    const usersCol = getCollection("users");
    const user = await usersCol.findOne(
      { email },
      { projection: { points: 1 } },
    );

    res.json({
      totalHours,
      totalEvents: verifiedCount,
      totalPoints,
      platformPoints: user?.points || 0,
      currentLevel: level,
      nextLevel,
      pointsToNextLevel: Math.max(0, toNext),
      pendingVerifications: pendingCount,
      history,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/volunteers/opportunities — THE KEY NEW ENDPOINT
// Aggregates open tasks from 3 sources: cleanupEvents + feedingDrives + issues
// Optional query: ?area=Mirpur&skill=Medical
// ─────────────────────────────────────────────────────────────────────────────
router.get("/opportunities", verifyToken, async (req, res) => {
  try {
    const { area, skill } = req.query;

    // ── Source 1: Approved upcoming cleanup events ──────────────────────────
    const eventQuery = {
      approvalStatus: "approved",
      status: "upcoming",
      eventDate: { $gte: new Date() },
    };
    if (area) eventQuery["location.area"] = { $regex: area, $options: "i" };

    const cleanupEvents = await CleanupEvent.find(eventQuery)
      .select(
        "title slogan location eventDate eventTime goingCount maxVolunteers coverImages requiredSkills organizer",
      )
      .sort({ eventDate: 1 })
      .limit(20)
      .lean();

    const eventOpps = cleanupEvents.map((e) => ({
      _id: e._id,
      type: "cleanup_event",
      title: e.title,
      subtitle: e.slogan || "Community cleanup drive",
      location: e.location?.address || "",
      area: e.location?.area || "",
      date: e.eventDate,
      time: e.eventTime,
      image: e.coverImages?.[0] || null,
      spotsLeft: e.maxVolunteers > 0 ? e.maxVolunteers - e.goingCount : null,
      skills: e.requiredSkills || [],
      organizer: e.organizer?.name || "",
      link: `/cleanup-events/${e._id}`,
      actionLabel: "RSVP & Go",
    }));

    // ── Source 2: Feeding drives from feedingDrives collection ──────────────
    const drivesCol = getCollection("feedingDrives");
    const driveQuery = {
      status: "upcoming",
      date: { $gte: new Date() },
    };
    if (area) driveQuery.area = { $regex: area, $options: "i" };

    const feedingDrives = await drivesCol
      .find(driveQuery)
      .sort({ date: 1 })
      .limit(10)
      .toArray();

    const driveOpps = feedingDrives.map((d) => ({
      _id: d._id,
      type: "feeding_drive",
      title: d.title,
      subtitle: `Feeding drive — ${d.foodType || "community meal"}`,
      location: d.location || "",
      area: d.area || "",
      date: d.date,
      time: d.time || "",
      image: null,
      spotsLeft:
        d.volunteersNeeded > 0
          ? d.volunteersNeeded - (d.volunteers?.length || 0)
          : null,
      skills: ["General Cleanup"],
      organizer: d.createdBy || "",
      link: `/animals/feeding-drives`,
      actionLabel: "Join Drive",
    }));

    // ── Source 3: Issues assigned to volunteers that need help ───────────────
    const issuesCol = getCollection("issues");
    const issueQuery = {
      approvalStatus: "approved",
      "assignedTo.type": "volunteer",
      status: "action_taken",
    };
    if (area) issueQuery.area = { $regex: area, $options: "i" };

    const volunteerIssues = await issuesCol
      .find(issueQuery)
      .project({
        title: 1,
        location: 1,
        area: 1,
        image: 1,
        urgency: 1,
        assignedTo: 1,
      })
      .sort({ date: -1 })
      .limit(10)
      .toArray();

    const issueOpps = volunteerIssues.map((i) => ({
      _id: i._id,
      type: "issue_help",
      title: `Help resolve: ${i.title}`,
      subtitle: `Urgency: ${i.urgency || "medium"}`,
      location: i.location || "",
      area: i.area || "",
      date: null,
      time: null,
      image: i.image || null,
      spotsLeft: null,
      skills: ["General Cleanup"],
      organizer: "",
      link: `/issues/${i._id}`,
      actionLabel: "Volunteer to Help",
    }));

    // ── Merge, filter by skill if requested, sort by date ────────────────────
    let all = [...eventOpps, ...driveOpps, ...issueOpps];

    if (skill) {
      all = all.filter(
        (o) =>
          o.skills.length === 0 ||
          o.skills.some((s) => s.toLowerCase().includes(skill.toLowerCase())),
      );
    }

    // Put cleanup events first, then feeding drives, then issue help
    const order = { cleanup_event: 0, feeding_drive: 1, issue_help: 2 };
    all.sort((a, b) => {
      if (a.date && b.date) return new Date(a.date) - new Date(b.date);
      return (order[a.type] || 3) - (order[b.type] || 3);
    });

    res.json({ opportunities: all, total: all.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/volunteers/verify — submit verification (FIX: now hits real API)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/verify", verifyToken, async (req, res) => {
  try {
    const { eventId, method, proofData } = req.body;
    const email = req.user.email;

    if (!eventId || !method) {
      return res
        .status(400)
        .json({ message: "Event ID and method are required." });
    }

    const event = await CleanupEvent.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found." });

    const idx = event.going.findIndex((v) => v.email === email);
    if (idx === -1) {
      return res
        .status(403)
        .json({ message: "You are not registered for this event." });
    }

    event.going[idx].verificationMethod = method;
    event.going[idx].verificationData = proofData || {};
    event.going[idx].verificationSubmittedAt = new Date();
    event.going[idx].verificationStatus = "pending";
    await event.save();

    // Notify organizer
    await createNotification({
      userId: event.organizer.email,
      message: `${req.user.displayName || email} submitted verification for "${event.title}"`,
      type: "verification_request",
      link: `/cleanup-events/${event._id}`,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/volunteers/approve-verification
// FIX: now uses pointsHelper instead of direct $inc
// ─────────────────────────────────────────────────────────────────────────────
router.post("/approve-verification", verifyToken, async (req, res) => {
  try {
    const { eventId, volunteerEmail } = req.body;

    const event = await CleanupEvent.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found." });

    if (event.organizer.email !== req.user.email && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ message: "Only the organizer can approve." });
    }

    const idx = event.going.findIndex((v) => v.email === volunteerEmail);
    if (idx === -1)
      return res.status(404).json({ message: "Volunteer not found." });

    event.going[idx].status = "attended";
    event.going[idx].verificationStatus = "approved";
    event.going[idx].verifiedAt = new Date();
    event.going[idx].verifiedBy = req.user.email;
    await event.save();

    // Use pointsHelper (triggers badge unlock check)
    await addPoints(volunteerEmail, "event_attended"); // +30 from POINTS_MAP

    await createNotification({
      userId: volunteerEmail,
      message: `✅ Your participation in "${event.title}" was verified! +30 points earned.`,
      type: "verification_approved",
      link: `/volunteer-dashboard`,
      priority: "high",
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/volunteers/reject-verification
// ─────────────────────────────────────────────────────────────────────────────
router.post("/reject-verification", verifyToken, async (req, res) => {
  try {
    const { eventId, volunteerEmail, reason } = req.body;

    const event = await CleanupEvent.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found." });

    if (event.organizer.email !== req.user.email && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ message: "Only the organizer can reject." });
    }

    const idx = event.going.findIndex((v) => v.email === volunteerEmail);
    if (idx === -1)
      return res.status(404).json({ message: "Volunteer not found." });

    event.going[idx].status = "going";
    event.going[idx].verificationStatus = "rejected";
    event.going[idx].rejectionReason = reason || "";
    await event.save();

    await createNotification({
      userId: volunteerEmail,
      message: `Your verification for "${event.title}" was rejected. ${reason || "Contact the organizer."}`,
      type: "verification_rejected",
      link: `/cleanup-events/${event._id}`,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/volunteers — public volunteer directory
// Query: ?skill=Medical&area=Mirpur&available=true
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { skill, area, available } = req.query;
    const col = getCollection("volunteers");
    const query = { approvalStatus: "approved" };

    if (skill) query.skills = { $in: [skill] };
    if (area) query.area = { $regex: area, $options: "i" };
    if (available === "true") query.isAvailable = true;

    const volunteers = await col.aggregate([
      { $match: query },
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
        $project: {
          email: 0,
          phone: 0,
          uid: "$userData.uid",
          name: { $ifNull: ["$userData.name", "$userData.displayName", "$name"] },
          photoURL: { $ifNull: ["$userData.photoURL", "$photoURL"] },
          skills: 1,
          area: 1,
          availability: 1,
          registeredAt: 1,
          isAvailable: 1,
          approvalStatus: 1
        }
      },
      { $sort: { registeredAt: -1 } },
      { $limit: 50 }
    ]).toArray();

    res.json({ volunteers });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/volunteers/availability — toggle isAvailable on/off
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/availability", verifyToken, async (req, res) => {
  try {
    const col = getCollection("volunteers");
    const vol = await col.findOne({ email: req.user.email });
    if (!vol)
      return res.status(404).json({ message: "Not registered as volunteer." });

    const newStatus = !vol.isAvailable;
    await col.updateOne(
      { email: req.user.email },
      { $set: { isAvailable: newStatus } }
    );
    res.json({ success: true, isAvailable: newStatus });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
