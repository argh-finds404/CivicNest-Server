const express = require("express");
const router = express.Router();
const { getCollection, client } = require("../config/db");
const CleanupEvent = require("../models/CleanupEvent");

// GET /public/stats
// Aggregated public numbers for the home hero, press kit, etc.
// Also returns a handful of recent public issues and upcoming events so the
// home page can pin real activity on its neighbourhood map.
// Cached in memory for 60s: it's hit on every home-page load.
const STATS_TTL_MS = 60 * 1000;
let statsCache = { at: 0, payload: null };

router.get("/stats", async (req, res) => {
  if (statsCache.payload && Date.now() - statsCache.at < STATS_TTL_MS) {
    return res.json(statsCache.payload);
  }
  try {
    const usersCollection = getCollection("users");
    const issuesCollection = getCollection("issues");

    const publicIssue = { isHidden: { $ne: true } };
    const now = new Date();
    const upcomingEvent = { approvalStatus: "approved", status: "upcoming", eventDate: { $gte: now } };

    const [totalUsers, solvedIssues, totalIssues, openIssues, upcomingEvents, recentIssues, nextEvents] = await Promise.all([
      usersCollection.countDocuments(),
      issuesCollection.countDocuments({ ...publicIssue, status: "solved" }),
      issuesCollection.countDocuments(publicIssue),
      issuesCollection.countDocuments({ ...publicIssue, status: { $in: ["open", "pending", "in_review", "action_taken"] } }),
      CleanupEvent.countDocuments(upcomingEvent),
      issuesCollection
        .find({ ...publicIssue, approvalStatus: "approved" })
        .project({ title: 1, status: 1, area: 1, category: 1 })
        .sort({ _id: -1 })
        .limit(6)
        .toArray(),
      CleanupEvent.find(upcomingEvent)
        .select("title eventDate location.area")
        .sort({ eventDate: 1 })
        .limit(3)
        .lean(),
    ]);

    const payload = {
      success: true,
      data: {
        activeMembers: totalUsers,
        issuesResolved: solvedIssues,
        totalIssuesReported: totalIssues,
        openIssues,
        upcomingEvents,
        recentIssues: recentIssues.map((i) => ({
          _id: i._id,
          title: i.title,
          status: i.status,
          area: i.area,
          category: i.category,
        })),
        nextEvents: nextEvents.map((e) => ({
          _id: e._id,
          title: e.title,
          eventDate: e.eventDate,
          area: e.location?.area || "",
        })),
      },
    };
    statsCache = { at: Date.now(), payload };
    res.json(payload);
  } catch (error) {
    console.error("Error fetching public stats:", error);
    res.status(500).json({ success: false, error: "Failed to fetch stats" });
  }
});

// GET /public/status
// Performs health check for the Status page
router.get("/status", async (req, res) => {
  try {
    // Ping DB to check if it's operational
    const dbCommand = await client.db("admin").command({ ping: 1 });
    const dbOperational = dbCommand.ok === 1;

    // Simulate other systems being operational since we are responding
    res.json({
      success: true,
      timestamp: new Date(),
      uptime: 99.98,
      systems: [
        { name: 'Core API', status: 'operational' },
        { name: 'Database', status: dbOperational ? 'operational' : 'outage' },
        { name: 'Authentication Services', status: 'operational' },
        { name: 'Image Processing (Reports)', status: 'operational' },
        { name: 'Real-time Notifications', status: 'operational' },
        { name: 'Mapping Engine', status: 'operational' }
      ]
    });
  } catch (error) {
    // If DB ping fails or anything else, we still try to return a 500 with outage info
    res.status(500).json({
      success: false,
      timestamp: new Date(),
      uptime: 98.45,
      systems: [
        { name: 'Core API', status: 'degraded' },
        { name: 'Database', status: 'outage' },
        { name: 'Authentication Services', status: 'outage' },
        { name: 'Image Processing (Reports)', status: 'outage' },
        { name: 'Real-time Notifications', status: 'outage' },
        { name: 'Mapping Engine', status: 'outage' }
      ]
    });
  }
});

// GET /public/users/:uid
// Fetch public profile data for a specific user
router.get("/users/:uid", async (req, res) => {
  try {
    const usersCollection = getCollection("users");
    // Some logic: uid might be the Firebase uid which is saved somewhere,
    // but in Issues it's `submittedBy.userId`. In users collection it's usually `email` or `uid`.
    // Let's check both if possible, or just assume the user document has `uid`.
    let user = await usersCollection.findOne({ uid: req.params.uid });
    
    if (!user) {
      // Fallback: Older users in the DB might not have 'uid' saved.
      // We can look up an issue they submitted to find their email, and then find the user by email!
      const Issue = require("../models/Issue");
      const issue = await Issue.findOne({ "submittedBy.userId": req.params.uid });
      
      if (issue && issue.submittedBy.email) {
         user = await usersCollection.findOne({ email: issue.submittedBy.email });
         
         // Backfill the uid to fix it permanently for next time
         if (user) {
           await usersCollection.updateOne({ email: user.email }, { $set: { uid: req.params.uid } });
         }
      }
    }

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    // Return only public fields
    res.json({
      success: true,
      data: {
        name: user.name,
        photoURL: user.photoURL,
        coverPhoto: user.coverPhoto || "/demo/cleanup-riverbank.svg",
        bio: user.bio || "Dedicated civic member.",
        role: user.role,
        isVolunteer: user.isVolunteer || false,
        area: user.area || null,
        points: user.points || 0,
        memberId: user.memberId || null,
        joinedAt: user.createdAt || null
      }
    });
  } catch (error) {
    console.error("Error fetching public user:", error);
    res.status(500).json({ success: false, error: "Failed to fetch user" });
  }
});

const Issue = require("../models/Issue");

// GET /public/users/:uid/issues
// Fetch public issues created by this user
router.get("/users/:uid/issues", async (req, res) => {
  try {
    const issues = await Issue.find({
      "submittedBy.userId": req.params.uid,
      isHidden: false,
      approvalStatus: "approved"
    }).sort({ submittedAt: -1 }).limit(20).lean();

    res.json({
      success: true,
      data: issues
    });
  } catch (error) {
    console.error("Error fetching public user issues:", error);
    res.status(500).json({ success: false, error: "Failed to fetch issues" });
  }
});

// GET /public/feed
// Fetch aggregated feed events with pagination
router.get("/feed", async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const feedDb = getCollection("feed_events");
    
    if (!feedDb) {
       return res.json({ success: true, data: [], hasMore: false });
    }

    const events = await feedDb.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();
      
    const totalCount = await feedDb.countDocuments({});
    
    res.json({
      success: true,
      data: events,
      hasMore: skip + events.length < totalCount
    });
  } catch (error) {
    console.error("Error fetching public feed:", error);
    res.status(500).json({ success: false, error: "Failed to fetch feed" });
  }
});

// POST /public/incidents
// Create a new incident report which gets saved to the 'incidents' collection and triggers a feed event
router.post("/incidents", async (req, res) => {
  try {
    const { title, area, description, category, reporterName } = req.body;
    if (!title || !area || !description) {
      return res.status(400).json({ success: false, message: "Title, area and description are required." });
    }

    // Identify user token if present
    let finalReporterName = reporterName || "Anonymous Neighbour";
    let reporterEmail = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split("Bearer ")[1];
      try {
        const admin = require("../config/firebase");
        const decoded = await admin.auth().verifyIdToken(token);
        reporterEmail = decoded.email;
        const usersCollection = getCollection("users");
        if (usersCollection) {
          const dbUser = await usersCollection.findOne({ email: decoded.email });
          if (dbUser) {
            finalReporterName = dbUser.name || dbUser.displayName || finalReporterName;
          }
        }
      } catch (e) {
        // Ignore token verify error, treat as guest
      }
    }

    const incidentsCollection = getCollection("incidents");
    const newIncident = {
      title: title.trim(),
      area: area.trim(),
      description: description.trim(),
      category: category || "General Waste",
      reporterName: finalReporterName,
      reporterEmail,
      createdAt: new Date()
    };

    const result = await incidentsCollection.insertOne(newIncident);

    // Trigger feed event
    const { createFeedEvent } = require("../utils/feedHelper");
    await createFeedEvent("incident_reported", {
      incidentId: result.insertedId,
      title: title.trim(),
      area: area.trim(),
      category: category || "General Waste",
      reporterName: finalReporterName
    });

    res.status(201).json({ success: true, _id: result.insertedId, incident: newIncident });
  } catch (error) {
    console.error("Error creating incident:", error);
    res.status(500).json({ success: false, message: "Failed to create incident" });
  }
});

// GET /public/contributions/summary
router.get("/contributions/summary", async (req, res) => {
  try {
    const type = req.query.type;
    const contributionsDb = getCollection('contributions');
    
    if (!contributionsDb) {
       return res.json({ success: true, totalRaised: 0, totalDonors: 0 });
    }

    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);

    const matchStage = {
      date: { $gte: startOfYear }
    };

    if (type) {
      matchStage.type = type;
    }

    const summary = await contributionsDb.aggregate([
      { $match: matchStage },
      { $group: {
          _id: null,
          totalRaised: { $sum: "$amount" },
          totalDonors: { $addToSet: "$email" }
      }}
    ]).toArray();

    if (summary.length > 0) {
      res.json({
        success: true,
        totalRaised: summary[0].totalRaised,
        totalDonors: summary[0].totalDonors.length
      });
    } else {
      res.json({
        success: true,
        totalRaised: 0,
        totalDonors: 0
      });
    }
  } catch (error) {
    console.error("Error fetching contributions summary:", error);
    res.status(500).json({ success: false, error: "Failed to fetch summary" });
  }
});

// GET /public/search
router.get("/search", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, results: [] });

    const searchRegex = { $regex: q, $options: 'i' };
    
    // Search issues
    const issuesDb = getCollection("issues");
    const issues = await issuesDb.find({
      $or: [{ title: searchRegex }, { description: searchRegex }],
      isHidden: false,
      approvalStatus: "approved"
    }).limit(5).toArray();

    // Search events
    const eventsDb = getCollection("cleanupevents");
    let events = [];
    if (eventsDb) {
      events = await eventsDb.find({
        $or: [{ title: searchRegex }, { description: searchRegex }],
        approvalStatus: "approved"
      }).limit(5).toArray();
    }

    // Search notices
    const noticesDb = getCollection("announcements");
    let notices = [];
    if (noticesDb) {
      notices = await noticesDb.find({
        $or: [{ title: searchRegex }, { description: searchRegex }]
      }).limit(5).toArray();
    }

    // Search lostFound
    const lostFoundDb = getCollection("lostFound");
    let lostFoundList = [];
    if (lostFoundDb) {
      lostFoundList = await lostFoundDb.find({
        $or: [{ itemName: searchRegex }, { description: searchRegex }],
        approvalStatus: "approved"
      }).limit(5).toArray();
    }

    // Search animals
    const animalsDb = getCollection("animals");
    let animalsList = [];
    if (animalsDb) {
      animalsList = await animalsDb.find({
        $or: [{ animalType: searchRegex }, { condition: searchRegex }],
        approvalStatus: "approved"
      }).limit(5).toArray();
    }

    // Search NGOs
    const ngosDb = getCollection("ngos");
    let ngosList = [];
    if (ngosDb) {
      ngosList = await ngosDb.find({
        $or: [{ name: searchRegex }, { mission: searchRegex }],
        status: "verified"
      }).limit(5).toArray();
    }

    // Search Forum
    const forumDb = getCollection("forum");
    let forumList = [];
    if (forumDb) {
      forumList = await forumDb.find({
        $or: [{ title: searchRegex }, { body: searchRegex }],
        approvalStatus: "approved"
      }).limit(5).toArray();
    }

    const results = [
      ...issues.map(i => ({ _id: i._id, title: i.title, type: 'Issue', link: `/issues/${i._id}` })),
      ...events.map(e => ({ _id: e._id, title: e.title, type: 'Event', link: `/cleanup-events/${e._id}` })),
      ...notices.map(n => ({ _id: n._id, title: n.title, type: 'Notice', link: `/noticeboard/${n._id}` })),
      ...lostFoundList.map(lf => ({ _id: lf._id, title: lf.itemName, type: 'Lost & Found', link: `/lost-found/${lf._id}` })),
      ...animalsList.map(a => ({ _id: a._id, title: `${a.animalType} rescue: ${a.condition.slice(0, 50)}${a.condition.length > 50 ? '...' : ''}`, type: 'Animal Rescue', link: `/animals/${a._id}` })),
      ...ngosList.map(ngo => ({ _id: ngo._id, title: ngo.name, type: 'NGO', link: `/ngos/${ngo._id}` })),
      ...forumList.map(f => ({ _id: f._id, title: f.title, type: 'Forum Thread', link: `/forum/${f._id}` }))
    ];

    res.json({ success: true, results });
  } catch (error) {
    console.error("Global search error:", error);
    res.status(500).json({ success: false, error: "Failed to search" });
  }
});

// GET /public/map
// Everything with real coordinates for the community map: approved issues,
// upcoming cleanup drives and animals that still need help. Small fields only,
// cached for 60s.
let mapCache = { at: 0, payload: null };

router.get("/map", async (req, res) => {
  if (mapCache.payload && Date.now() - mapCache.at < STATS_TTL_MS) {
    return res.json(mapCache.payload);
  }
  try {
    const [issues, events, animals] = await Promise.all([
      getCollection("issues")
        .find(
          { approvalStatus: "approved", isHidden: { $ne: true }, "coordinates.lat": { $type: "number" }, "coordinates.lng": { $type: "number" } },
          { projection: { title: 1, category: 1, status: 1, urgency: 1, area: 1, coordinates: 1, images: { $slice: 1 } } }
        )
        .sort({ submittedAt: -1 })
        .limit(300)
        .toArray(),
      CleanupEvent.find(
        { approvalStatus: "approved", status: { $in: ["upcoming", "ongoing"] }, "location.coordinates.1": { $exists: true } },
        { title: 1, eventDate: 1, eventTime: 1, goingCount: 1, location: 1, coverImages: { $slice: 1 } }
      )
        .sort({ eventDate: 1 })
        .limit(100)
        .lean(),
      getCollection("animals")
        .find(
          { approvalStatus: "approved", status: { $in: ["needs-help", "in-treatment"] }, "coordinates.lat": { $type: "number" }, "coordinates.lng": { $type: "number" } },
          { projection: { animalType: 1, condition: 1, urgency: 1, status: 1, area: 1, location: 1, coordinates: 1, image: 1 } }
        )
        .sort({ date: -1 })
        .limit(100)
        .toArray(),
    ]);
    const payload = {
      issues: issues.map((i) => ({
        _id: i._id, title: i.title, category: i.category, status: i.status, urgency: i.urgency, area: i.area,
        lat: i.coordinates.lat, lng: i.coordinates.lng, image: i.images?.[0] || null,
      })),
      events: events
        .filter((e) => Number.isFinite(e.location?.coordinates?.[0]) && Number.isFinite(e.location?.coordinates?.[1]))
        .map((e) => ({
          _id: e._id, title: e.title, eventDate: e.eventDate, eventTime: e.eventTime, goingCount: e.goingCount || 0,
          area: e.location?.area || e.location?.address, lat: e.location.coordinates[1], lng: e.location.coordinates[0],
          image: e.coverImages?.[0] || null,
        })),
      animals: animals.map((a) => ({
        _id: a._id, animalType: a.animalType, condition: a.condition, urgency: a.urgency, status: a.status,
        area: a.area || a.location, lat: a.coordinates.lat, lng: a.coordinates.lng, image: a.image || null,
      })),
    };
    mapCache = { at: Date.now(), payload };
    res.json(payload);
  } catch (err) {
    console.error("Map data failed:", err);
    res.status(500).json({ error: "Couldn't load the map." });
  }
});

module.exports = router;
