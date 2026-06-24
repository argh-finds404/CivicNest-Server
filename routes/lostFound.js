const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { memberOnly } = require("../middleware/memberOnly");
const { creditCheck } = require("../middleware/creditCheck");
const { getCollection } = require("../config/db");
const { ObjectId } = require("mongodb");
const { createFeedEvent } = require("../utils/feedHelper");
const { addPoints } = require("../utils/pointsHelper");

// Get stats for lost & found banner
router.get("/stats", async (req, res) => {
  try {
    const col = getCollection("lostFound");
    const [active, reunited, thisWeek] = await Promise.all([
      col.countDocuments({ status: 'open' }),
      col.countDocuments({ status: 'reunited' }),
      col.countDocuments({ date: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
    ]);
    res.json({ active, reunited, thisWeek });
  } catch (err) {
    console.error('Error fetching lost-found stats:', err);
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
});

// POST /api/lost-found/:id/found-report — "I found this item" (for Lost items, array based)
router.post('/:id/found-report', verifyToken, async (req, res) => {
  try {
    const { statement, contactPhone, photoUrl } = req.body;
    if (!statement) return res.status(400).json({ message: 'Location/found details are required.' });

    if (contactPhone && !/^[+0-9\s\-()]{6,20}$/.test(contactPhone)) {
      return res.status(400).json({ message: 'Invalid phone number format. Letters are not allowed.' });
    }

    if (photoUrl && !/^https?:\/\/[^\s]+$/i.test(photoUrl)) {
      return res.status(400).json({ message: 'Invalid evidence photo URL format.' });
    }

    const col = getCollection("lostFound");
    const item = await col.findOne({ _id: new ObjectId(req.params.id) });

    if (!item || item.status !== 'open') {
      return res.status(400).json({ message: 'Item listing is not open.' });
    }
    if (item.type !== 'lost') {
      return res.status(400).json({ message: 'Found reports can only be submitted for lost listings.' });
    }

    const itemReporter = item.reporter || item.postedBy;
    if (itemReporter === req.user.email) {
      return res.status(400).json({ message: 'You cannot submit a found report on your own listing.' });
    }

    // Check if user has already submitted a report or if it was rejected
    const existingReport = item.foundReports?.find(r => r.email === req.user.email);
    if (existingReport) {
      if (existingReport.status === 'rejected') {
        return res.status(400).json({ 
          message: `Your previous sighting report was rejected by the admin. Reason: ${existingReport.rejectionReason || 'No reason provided'}.` 
        });
      }
      return res.status(400).json({ message: 'You have already submitted a report for this listing.' });
    }

    const report = {
      _id: new ObjectId(),
      email: req.user.email,
      name: req.user.name || req.user.email.split('@')[0],
      statement,
      contactPhone: contactPhone || '',
      photoUrl: photoUrl || '',
      submittedAt: new Date(),
      isSuspicious: false,
      status: 'active',
      rejectionReason: null,
      dismissedAt: null
    };

    await col.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $push: { foundReports: report } }
    );

    // Award points for found-report submission
    await addPoints(req.user.email, 'lostfound_action_taken');

    res.json({ success: true });
  } catch (err) {
    console.error('Error reporting found item:', err);
    res.status(500).json({ message: 'Failed to process report.' });
  }
});

// POST /api/lost-found/:id/claim — "I think this is mine" (for Found items, array based)
router.post('/:id/claim', verifyToken, async (req, res) => {
  try {
    const { statement, photoUrl } = req.body;
    if (!statement) return res.status(400).json({ message: 'Ownership statement required.' });

    if (photoUrl && !/^https?:\/\/[^\s]+$/i.test(photoUrl)) {
      return res.status(400).json({ message: 'Invalid evidence photo URL format.' });
    }

    const col = getCollection("lostFound");
    const item = await col.findOne({ _id: new ObjectId(req.params.id) });

    if (!item || item.status !== 'open') {
      return res.status(400).json({ message: 'Item is not available for claiming.' });
    }
    if (item.type !== 'found') {
      return res.status(400).json({ message: 'Claims can only be submitted for found listings.' });
    }

    const itemReporter = item.reporter || item.postedBy;
    if (itemReporter === req.user.email) {
      return res.status(400).json({ message: 'You cannot claim your own listing.' });
    }

    // Check if user has already submitted a claim or if it was rejected
    const existingClaim = item.claims?.find(c => c.email === req.user.email);
    if (existingClaim) {
      if (existingClaim.status === 'rejected') {
        return res.status(400).json({ 
          message: `Your previous claim was rejected by the admin. Reason: ${existingClaim.rejectionReason || 'No reason provided'}.` 
        });
      }
      return res.status(400).json({ message: 'You have already submitted a claim for this listing.' });
    }

    const claim = {
      _id: new ObjectId(),
      email: req.user.email,
      name: req.user.name || req.user.email.split('@')[0],
      statement,
      photoUrl: photoUrl || '',
      submittedAt: new Date(),
      isSuspicious: false,
      status: 'active',
      rejectionReason: null,
      dismissedAt: null
    };

    await col.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $push: { claims: claim } }
    );

    // Award points for claim submission
    await addPoints(req.user.email, 'lostfound_action_taken');

    res.json({ success: true });
  } catch (err) {
    console.error('Error claiming item:', err);
    res.status(500).json({ message: 'Failed to process claim.' });
  }
});

// POST /api/lost-found/:id/flag-suspicious — flag a report or claim as suspicious
router.post('/:id/flag-suspicious', verifyToken, async (req, res) => {
  try {
    const col = getCollection("lostFound");
    const item = await col.findOne({ _id: new ObjectId(req.params.id) });

    if (!item) return res.status(404).json({ message: 'Listing not found.' });

    const itemReporter = item.reporter || item.postedBy;
    if (itemReporter !== req.user.email) {
      return res.status(403).json({ message: 'Only the poster can flag claims.' });
    }

    const { finderEmail, claimantEmail } = req.body;
    const { createNotification } = require("../utils/notificationHelper");

    if (item.type === 'lost') {
      if (!finderEmail) return res.status(400).json({ message: 'finderEmail is required for lost items.' });
      
      await col.updateOne(
        { _id: new ObjectId(req.params.id), "foundReports.email": finderEmail },
        { $set: { "foundReports.$.isSuspicious": true } }
      );

      // Notify Admin
      await createNotification({
        email: 'admin@civicnest.com',
        userId: 'admin',
        message: `Suspicious claim reported on Lost item "${item.itemName}" by finder ${finderEmail}.`,
        type: 'warning',
        link: `/lost-found/${item._id}`
      });

      // Notify Finder
      await createNotification({
        email: finderEmail,
        userId: finderEmail,
        message: `⚠️ Your sighting report for "${item.itemName}" was flagged because the proof wasn't strong enough. Please contact the owner or admins with additional verification evidence.`,
        type: 'warning',
        link: `/lost-found/${item._id}`
      });
    } else {
      if (!claimantEmail) return res.status(400).json({ message: 'claimantEmail is required for found items.' });

      await col.updateOne(
        { _id: new ObjectId(req.params.id), "claims.email": claimantEmail },
        { $set: { "claims.$.isSuspicious": true } }
      );

      // Notify Admin
      await createNotification({
        email: 'admin@civicnest.com',
        userId: 'admin',
        message: `Suspicious claim reported on Found item "${item.itemName}" by claimant ${claimantEmail}.`,
        type: 'warning',
        link: `/lost-found/${item._id}`
      });

      // Notify Claimant
      await createNotification({
        email: claimantEmail,
        userId: claimantEmail,
        message: `⚠️ Your ownership claim for "${item.itemName}" was flagged because the proof wasn't strong enough. Please contact the owner or admins with additional verification evidence.`,
        type: 'warning',
        link: `/lost-found/${item._id}`
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error flagging suspicious report:', err);
    res.status(500).json({ message: 'Failed to flag report.' });
  }
});

// POST /api/lost-found/:id/reunite — mark as reunited (resolves listing)
router.post('/:id/reunite', verifyToken, async (req, res) => {
  try {
    const col = getCollection("lostFound");
    const item = await col.findOne({ _id: new ObjectId(req.params.id) });

    if (!item) {
      return res.status(404).json({ message: 'Listing not found.' });
    }

    const itemReporter = item.reporter || item.postedBy;
    if (itemReporter !== req.user.email) {
      return res.status(403).json({ message: 'Only the original poster can mark this as reunited.' });
    }

    // Determine action-taker (finder or owner claiming item)
    let actionTaker = null;
    if (item.type === 'lost') {
      actionTaker = req.body.finderEmail || (item.foundReports && item.foundReports[0]?.email);
    } else {
      actionTaker = req.body.claimantEmail || (item.claims && item.claims[0]?.email);
    }

    const updateFields = { status: 'reunited', reunitedAt: new Date() };
    if (actionTaker) {
      updateFields.claimedBy = actionTaker;
    }

    await col.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updateFields }
    );

    // Award 20 points to the poster
    await addPoints(itemReporter, 'lostfound_reunited');

    // Award 20 points to action-taker
    if (actionTaker) {
      await addPoints(actionTaker, 'lostfound_reunited');
    }

    // Create feed event
    await createFeedEvent('lostfound_reunited', {
      itemName: item.itemName,
      location: item.location,
      link: `/lost-found/${item._id}`,
    });

    // Notify action-taker (finder/claimant) that item is reunited
    if (actionTaker) {
      try {
        const { createNotification } = require("../utils/notificationHelper");
        const notificationMessage = item.type === 'lost'
          ? `🎉 Your sighting report for "${item.itemName}" was accepted! The item has been marked as reunited. You earned 20 points!`
          : `🎉 Your ownership claim for "${item.itemName}" was accepted! The item has been marked as reunited. You earned 20 points!`;

        await createNotification({
          userId: actionTaker,
          email: actionTaker,
          message: notificationMessage,
          type: 'info',
          link: `/lost-found/${item._id}`
        });
      } catch (notifErr) {
        console.error("Failed to send reunited notification to action taker:", notifErr);
      }
    }

    // Reward credit logic
    if (item.type === 'lost' && actionTaker) {
      const rewardAmount = parseFloat(item.reward) || 0;
      if (rewardAmount > 0) {
        try {
          const usersCol = getCollection("users");
          await usersCol.updateOne(
            { email: actionTaker },
            { $inc: { balance: rewardAmount } }
          );

          const { createNotification } = require("../utils/notificationHelper");
          await createNotification({
            userId: actionTaker,
            email: actionTaker,
            message: `🎉 Congratulations! You have been credited ৳${rewardAmount} reward for returning "${item.itemName}".`,
            type: 'reward',
            link: `/lost-found/${item._id}`
          });
        } catch (rewardErr) {
          console.error("Failed to process reward transaction:", rewardErr);
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error reuniting item:', err);
    res.status(500).json({ message: 'Failed to reunite item.' });
  }
});

// Get all lost/found items
router.get("/", async (req, res) => {
  try {
    const lostFoundCollection = getCollection("lostFound");
    const { search } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { itemName: { $regex: search, $options: 'i' } },
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    const result = await lostFoundCollection.find(query).sort({ date: -1 }).toArray();
    res.send(result);
  } catch (error) {
    console.error("Error fetching lost/found items:", error);
    res.status(500).json({ error: "Failed to fetch items." });
  }
});

// Get my lost/found items (Protected)
router.get("/my", verifyToken, async (req, res) => {
  try {
    const lostFoundCollection = getCollection("lostFound");
    const email = req.user.email;
    const query = {
      $or: [
        { reporter: email },
        { 'reporter.email': email },
        { contactInfo: email },
        { postedBy: email }
      ]
    };
    const result = await lostFoundCollection.find(query).sort({ date: -1 }).toArray();

    // Passive check for 3-day expiry
    const now = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);

    const { createNotification } = require("../utils/notificationHelper");

    for (const item of result) {
      if (item.expiresAt && !item.notifiedExpiry && item.status === 'open') {
        const expiresAt = new Date(item.expiresAt);
        if (expiresAt > now && expiresAt <= threeDaysFromNow) {
          try {
            // Update flag in DB first to prevent duplicate notification triggers
            await lostFoundCollection.updateOne(
              { _id: item._id },
              { $set: { notifiedExpiry: true } }
            );

            await createNotification({
              userId: email,
              email: email,
              message: `⚠️ Your listing "${item.itemName}" is set to expire in less than 3 days!`,
              type: 'warning',
              link: `/lost-found/${item._id}`
            });
            item.notifiedExpiry = true; // Update local copy
          } catch (err) {
            console.error("Failed to notify expiry for item:", item._id, err);
          }
        }
      }
    }

    res.send(result);
  } catch (error) {
    console.error("Error fetching my items:", error);
    res.status(500).json({ error: "Failed to fetch items." });
  }
});

// Get single item
router.get("/:id", async (req, res) => {
  try {
    const lostFoundCollection = getCollection("lostFound");
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await lostFoundCollection.findOne(query);

    if (result) {
      const reporterEmail = result.reporter || result.postedBy || result.contactInfo;
      if (reporterEmail && typeof reporterEmail === 'string' && reporterEmail.includes('@')) {
        const usersCollection = getCollection("users");
        const membershipCollection = getCollection("membershipRequests");
        const volunteersCollection = getCollection("volunteers");

        const [userDoc, membershipDoc, volunteerDoc] = await Promise.all([
          usersCollection ? usersCollection.findOne({ email: reporterEmail }) : null,
          membershipCollection ? membershipCollection.findOne({ email: reporterEmail }) : null,
          volunteersCollection ? volunteersCollection.findOne({ email: reporterEmail }) : null
        ]);

        const name = userDoc?.name || userDoc?.displayName || membershipDoc?.name || volunteerDoc?.name || reporterEmail.split('@')[0];
        const phone = userDoc?.phone || userDoc?.phoneNumber || membershipDoc?.phone || volunteerDoc?.phone || "";
        const address = userDoc?.area || membershipDoc?.streetAddress || volunteerDoc?.area || membershipDoc?.area || "";

        result.reporterDetails = {
          name,
          phone,
          address
        };
      }
    }
    res.send(result);
  } catch (err) {
    console.error("Error fetching single item:", err);
    res.status(500).json({ error: "Failed to fetch item details" });
  }
});

// Add new lost/found item (Protected)
router.post("/", verifyToken, creditCheck("lostFound"), async (req, res) => {
  const lostFoundCollection = getCollection("lostFound");
  const item = {
    ...req.body,
    reporter: req.user.email,
    date: new Date()
  };
  const result = await lostFoundCollection.insertOne(item);
  res.send(result);
});

module.exports = router;
