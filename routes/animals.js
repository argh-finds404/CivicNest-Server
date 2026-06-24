const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { memberOnly } = require("../middleware/memberOnly");
const { creditCheck } = require("../middleware/creditCheck");
const { getCollection } = require("../config/db");
const { ObjectId } = require("mongodb");
const { createFeedEvent } = require("../utils/feedHelper");
const { createNotification } = require("../utils/notificationHelper");

// Get stats for the animals banner
router.get("/stats", async (req, res) => {
  try {
    const col = getCollection("animals");
    const [total, rescued, inTreatment, urgent, adoptable] = await Promise.all([
      col.countDocuments({ approvalStatus: 'approved' }),
      col.countDocuments({ status: 'rescued' }),
      col.countDocuments({ status: 'in-treatment' }),
      col.countDocuments({ urgency: { $in: ['high', 'emergency'] }, status: 'needs-help' }),
      col.countDocuments({ status: 'rescued', adoptable: true }),
    ]);
    res.json({ total, rescued, inTreatment, urgent, adoptable });
  } catch (err) {
    console.error('Error fetching animal stats:', err);
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
});

// POST /api/animals/:id/volunteer — "I'll help"
router.post('/:id/volunteer', verifyToken, async (req, res) => {
  try {
    const col    = getCollection("animals");
    const animal = await col.findOne({ _id: new ObjectId(req.params.id) });
    if (!animal) return res.status(404).json({ message: 'Not found.' });

    const volunteers = animal.volunteers || [];
    const alreadyVolunteered = volunteers.some(v => 
      (typeof v === 'string' && v === req.user.email) || 
      (v && v.email === req.user.email)
    );

    let update;
    if (alreadyVolunteered) {
      // Pull volunteer from list
      update = {
        $pull: { volunteers: { email: req.user.email } },
        $inc: { volunteerCount: -1 }
      };
      await col.updateOne({ _id: new ObjectId(req.params.id) }, update);
      // Fallback: also pull string email in case of mixed strings
      await col.updateOne({ _id: new ObjectId(req.params.id) }, {
        $pull: { volunteers: req.user.email }
      });
    } else {
      const volunteerEntry = {
        email:    req.user.email,
        name:     req.user.displayName || req.user.email.split('@')[0],
        photoURL: req.user.photoURL || null,
      };
      update = { 
        $push: { volunteers: volunteerEntry }, 
        $inc: { volunteerCount: 1 } 
      };
      await col.updateOne({ _id: new ObjectId(req.params.id) }, update);
    }

    res.json({ volunteered: !alreadyVolunteered });
  } catch (err) {
    console.error('Error volunteering for animal:', err);
    res.status(500).json({ message: 'Failed to update volunteer status' });
  }
});

// PATCH /api/animals/:id/status — mark rescued/adopted/needs-help
router.patch('/:id/status', verifyToken, async (req, res) => {
  try {
    const { status, proofImageUrl, note, verifiedVolunteers } = req.body;
    const valid = ['in-treatment', 'rescued', 'adopted', 'needs-help'];
    if (!valid.includes(status)) return res.status(400).json({ message: 'Invalid status.' });

    const col    = getCollection("animals");
    const animal = await col.findOne({ _id: new ObjectId(req.params.id) });

    if (!animal) return res.status(404).json({ message: 'Animal not found.' });
    if (animal.reporter?.email !== req.user.email && req.user.role !== 'admin' && animal.contactInfo !== req.user.email) {
      return res.status(403).json({ message: 'Only the reporter can update status.' });
    }

    const update = { $set: { status, updatedAt: new Date() } };

    if (status === 'rescued') {
      update.$set.rescueVerificationStatus = 'pending';
      update.$set.rescueProof = {
        imageUrl:    proofImageUrl || null,
        note:        note || '',
        verifiedVolunteers: verifiedVolunteers || [],
        submittedAt: new Date(),
      };
    } else {
      update.$set.rescueVerificationStatus = null;
    }

    await col.updateOne({ _id: new ObjectId(req.params.id) }, update);

    // Notify admin (batch notify all admins)
    if (status === 'rescued') {
      const usersCol = getCollection('users');
      const admins   = await usersCol.find({ role: 'admin' }, { projection: { email: 1 } }).toArray();
      await Promise.all(admins.map(admin =>
        createNotification({
          userId:  admin.email,
          email:   admin.email,
          message: `Rescue proof submitted for a ${animal.animalType || animal.type || 'animal'} in ${animal.location || 'community'}. Review required.`,
          type:    'animal',
          link:    `/admin/posts`,
        })
      ));
    }

    res.json({ success: true, message: status === 'rescued' ? 'Proof submitted. Awaiting admin verification.' : 'Status updated.' });
  } catch (err) {
    console.error('Error updating animal status:', err);
    res.status(500).json({ message: 'Failed to update status' });
  }
});

// Get all animal reports
router.get("/", async (req, res) => {
  try {
    const { urgency, status, type, area } = req.query;
    const query = { approvalStatus: 'approved' };
    if (urgency) query.urgency = urgency;
    if (status) query.status = status;
    if (type) query.animalType = type;
    if (area) {
      query.$or = [
        { area: { $regex: area, $options: 'i' } },
        { location: { $regex: area, $options: 'i' } }
      ];
    }
    const animalsCollection = getCollection("animals");
    const result = await animalsCollection.find(query).sort({ date: -1 }).toArray();
    res.send(result);
  } catch (err) {
    console.error('Error getting animals:', err);
    res.status(500).json({ message: 'Failed to get animals' });
  }
});

// Get my animal reports (Protected)
router.get("/my", verifyToken, async (req, res) => {
  const animalsCollection = getCollection("animals");
  const email = req.user.email;
  const query = { 
    $or: [
      { 'reporter.email': email },
      { contactInfo: email }
    ]
  };
  const result = await animalsCollection.find(query).sort({ date: -1 }).toArray();
  res.send(result);
});

// Get single animal report
router.get("/:id", async (req, res) => {
  const animalsCollection = getCollection("animals");
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await animalsCollection.findOne(query);
  res.send(result);
});

// Add new animal report (Protected)
router.post("/", verifyToken, creditCheck("animals"), async (req, res) => {
  const animalsCollection = getCollection("animals");
  const animal = {
    ...req.body,
    approvalStatus: 'approved',
    reporter: {
      email: req.user.email,
      name: req.user.displayName || req.user.email.split('@')[0],
      photoURL: req.user.photoURL || null
    },
    date: new Date()
  };
  const result = await animalsCollection.insertOne(animal);
  res.send(result);
});

// PUT /api/animals/:id - Edit report
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const col = getCollection("animals");
    const animal = await col.findOne({ _id: new ObjectId(req.params.id) });
    if (!animal) return res.status(404).json({ message: 'Animal not found.' });

    const isReporter = animal.reporter?.email === req.user.email || animal.contactInfo === req.user.email || req.user.role === 'admin';
    if (!isReporter) return res.status(403).json({ message: 'Forbidden. You are not the reporter.' });

    const { animalType, urgency, condition, location, date, image, contactInfo } = req.body;
    
    const update = {
      $set: {
        animalType,
        urgency,
        condition,
        location,
        date: date ? new Date(date) : animal.date,
        image,
        contactInfo,
        updatedAt: new Date()
      }
    };

    await col.updateOne({ _id: new ObjectId(req.params.id) }, update);
    res.json({ success: true, message: 'Report updated successfully.' });
  } catch (err) {
    console.error('Error updating animal:', err);
    res.status(500).json({ message: 'Failed to update report.' });
  }
});

// DELETE /api/animals/:id - Delete report
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const col = getCollection("animals");
    const animal = await col.findOne({ _id: new ObjectId(req.params.id) });
    if (!animal) return res.status(404).json({ message: 'Animal not found.' });

    const isReporter = animal.reporter?.email === req.user.email || animal.contactInfo === req.user.email || req.user.role === 'admin';
    if (!isReporter) return res.status(403).json({ message: 'Forbidden. You are not the reporter.' });

    await col.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true, message: 'Report deleted successfully.' });
  } catch (err) {
    console.error('Error deleting animal:', err);
    res.status(500).json({ message: 'Failed to delete report.' });
  }
});

// PATCH /api/animals/:id/adoptable - Toggle adoptable status
router.patch('/:id/adoptable', verifyToken, async (req, res) => {
  try {
    const col = getCollection("animals");
    const animal = await col.findOne({ _id: new ObjectId(req.params.id) });
    if (!animal) return res.status(404).json({ message: 'Animal not found.' });

    const isReporter = animal.reporter?.email === req.user.email || animal.contactInfo === req.user.email || req.user.role === 'admin';
    if (!isReporter) return res.status(403).json({ message: 'Forbidden.' });

    const { adoptable } = req.body;
    await col.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { adoptable: !!adoptable, updatedAt: new Date() } }
    );

    res.json({ success: true, adoptable: !!adoptable });
  } catch (err) {
    console.error('Error toggling adoptable:', err);
    res.status(500).json({ message: 'Failed to toggle adoptability.' });
  }
});

// POST /api/animals/:id/adopt-request - Submit adoption application
router.post('/:id/adopt-request', verifyToken, async (req, res) => {
  try {
    const col = getCollection("animals");
    const animal = await col.findOne({ _id: new ObjectId(req.params.id) });
    if (!animal) return res.status(404).json({ message: 'Animal not found.' });

    const { phone, message } = req.body;
    const requestEntry = {
      email: req.user.email,
      name: req.user.displayName || req.user.email.split('@')[0],
      phone: phone || '',
      message: message || '',
      date: new Date()
    };

    await col.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $push: { adoptionRequests: requestEntry } }
    );

    // Notify the reporter
    const reporterEmail = animal.reporter?.email || animal.contactInfo;
    if (reporterEmail) {
      await createNotification({
        userId: reporterEmail,
        email: reporterEmail,
        message: `🎉 ${requestEntry.name} has requested to adopt the ${animal.animalType || animal.type || 'animal'} you reported!`,
        type: 'animal',
        link: `/animals/${animal._id}`
      });
    }

    res.json({ success: true, message: 'Adoption request submitted.' });
  } catch (err) {
    console.error('Error submitting adoption request:', err);
    res.status(500).json({ message: 'Failed to submit request.' });
  }
});

// POST /api/animals/:id/adopt-approve - Approve adoption request
router.post('/:id/adopt-approve', verifyToken, async (req, res) => {
  try {
    const col = getCollection("animals");
    const animal = await col.findOne({ _id: new ObjectId(req.params.id) });
    if (!animal) return res.status(404).json({ message: 'Animal not found.' });

    const isReporter = animal.reporter?.email === req.user.email || animal.contactInfo === req.user.email || req.user.role === 'admin';
    if (!isReporter) return res.status(403).json({ message: 'Forbidden.' });

    const { adopterEmail } = req.body;
    if (!adopterEmail) return res.status(400).json({ message: 'Adopter email required.' });

    // Update status of animal
    await col.updateOne(
      { _id: new ObjectId(req.params.id) },
      { 
        $set: { 
          status: 'adopted', 
          adoptedBy: adopterEmail,
          adoptable: false,
          updatedAt: new Date() 
        } 
      }
    );

    // Award 30 points to reporter & adopter
    const usersCol = getCollection("users");
    await usersCol.updateOne({ email: adopterEmail }, { $inc: { points: 30 } });
    
    const reporterEmail = animal.reporter?.email || animal.contactInfo;
    if (reporterEmail) {
      await usersCol.updateOne({ email: reporterEmail }, { $inc: { points: 30 } });
    }

    // Notifications
    await createNotification({
      userId: adopterEmail,
      email: adopterEmail,
      message: `🎉 Congratulations! Your request to adopt the ${animal.animalType || animal.type || 'animal'} has been approved! You earned 30 points.`,
      type: 'animal',
      link: `/animals/${animal._id}`
    });

    if (reporterEmail) {
      await createNotification({
        userId: reporterEmail,
        email: reporterEmail,
        message: `🏠 You approved the adoption request for the ${animal.animalType || animal.type || 'animal'}! You earned 30 points.`,
        type: 'animal',
        link: `/animals/${animal._id}`
      });
    }

    // Notify other requestors of rejection
    const otherRequesters = (animal.adoptionRequests || []).filter(r => r.email !== adopterEmail);
    await Promise.all(otherRequesters.map(req => 
      createNotification({
        userId: req.email,
        email: req.email,
        message: `Thank you for your interest. The ${animal.animalType || animal.type || 'animal'} has been adopted by another community member.`,
        type: 'animal',
        link: `/animals`
      })
    ));

    res.json({ success: true, message: 'Adoption approved successfully.' });
  } catch (err) {
    console.error('Error approving adoption:', err);
    res.status(500).json({ message: 'Failed to approve adoption.' });
  }
});

// Donate to Animal
router.post('/:id/donate', verifyToken, async (req, res) => {
  try {
    const { amount, name, phone, additionalInfo } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid donation amount.' });
    }

    const animalsCollection = getCollection("animals");
    const animal = await animalsCollection.findOne({ _id: new ObjectId(req.params.id) });
    
    if (!animal) {
      return res.status(404).json({ message: 'Animal not found.' });
    }

    const contributionsDb = getCollection('contributions');
    await contributionsDb.insertOne({
      animalId: animal._id.toString(),
      animalType: animal.animalType || animal.type,
      type: 'animal_rescue',
      amount: Number(amount),
      name: name || req.user.displayName,
      email: req.user.email,
      phone: phone || '',
      additionalInfo: additionalInfo || '',
      date: new Date(),
    });

    await animalsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $inc: { fundingRaised: Number(amount) } }
    );

    const { addPoints } = require("../utils/pointsHelper");
    if (typeof addPoints === 'function') {
      await addPoints(req.user.email, 'contribution_made');
    }

    const { createNotification } = require("../utils/notificationHelper");
    if (typeof createNotification === 'function' && (animal.reporter?.email || animal.contactInfo)) {
      await createNotification({
        userId: animal.reporter?.email || animal.contactInfo,
        email: animal.reporter?.email || animal.contactInfo,
        message: `${name || req.user.displayName || 'A kind community member'} donated ৳${amount} to help with the animal you reported!`,
        type: 'drive',
        link: `/animals/${animal._id}`,
      });
    }

    res.json({ success: true, message: 'Donation recorded. Thank you!' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
