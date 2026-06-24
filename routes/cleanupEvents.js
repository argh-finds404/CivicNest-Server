const express = require('express');
const router = express.Router();
const CleanupEvent = require('../models/CleanupEvent');
const { verifyToken } = require('../middleware/auth');
const { memberOnly } = require('../middleware/memberOnly');
const { createNotification } = require('../utils/notificationHelper');
const { createFeedEvent } = require('../utils/feedHelper');
const { addPoints } = require('../utils/pointsHelper');
const { getCollection } = require('../config/db');
const { creditCheck } = require('../middleware/creditCheck');
const { updateStreak } = require('../utils/streakHelper');

// 1. Create Event
router.post('/', verifyToken, creditCheck('cleanupEvents'), async (req, res) => {
  try {
    const {
      title, slogan, description,
      eventDate, eventTime, durationHours,
      location, coverImages,
      maxVolunteers, requiredSkills, suppliesNeeded,
      meetingInstructions,
      fundingEnabled, fundingGoal,
    } = req.body;

    if (!title || !description || !eventDate || !eventTime || !location?.address) {
      return res.status(400).json({ message: 'Title, description, date, time and location are required.' });
    }

    const images = (coverImages || []).slice(0, 3);

    const event = await CleanupEvent.create({
      title, slogan, description,
      coverImages: images,
      eventDate: new Date(eventDate),
      eventTime,
      durationHours: durationHours || 3,
      location: {
        address: location.address,
        area: location.area || '',
        coordinates: location.coordinates || [],
      },
      organizer: {
        email: req.user.email,
        name: req.user.name || req.user.displayName || req.user.email,
        photoURL: req.user.photoURL || req.user.picture || null,
      },
      maxVolunteers: maxVolunteers || 0,
      requiredSkills: requiredSkills || [],
      suppliesNeeded: suppliesNeeded || [],
      meetingInstructions: meetingInstructions || '',
      fundingEnabled: fundingEnabled || false,
      fundingGoal: fundingEnabled ? (fundingGoal || 0) : 0,
      approvalStatus: 'pending_review',
      status: 'upcoming',
    });

    try {
      await addPoints(req.user.email, 'drive_created');
    } catch (ptsErr) {
      console.error("Failed to award points for creating a cleanup drive:", ptsErr);
    }

    const usersCollection = getCollection('users');
    const adminUsers = await usersCollection.find({ role: 'admin' }).toArray();

    if (typeof createNotification === 'function') {
      await Promise.all(adminUsers.map(admin =>
        createNotification({
          userId: admin.email,
          message: `New cleanup event pending review: "${title}"`,
          type: 'admin_msg',
          link: '/admin/queue',
          priority: 'normal',
        })
      ));
    }

    res.status(201).json({ success: true, event });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 2. Get All Events (Public)
router.get('/', async (req, res) => {
  try {
    const { status, area, upcoming, page = 1, limit = 12 } = req.query;

    const query = { approvalStatus: 'approved' };
    if (status) query.status = status;
    if (area) query['location.area'] = area;
    if (upcoming === 'true') {
      query.eventDate = { $gte: new Date() };
      query.status = 'upcoming';
    }

    let events = await CleanupEvent.find(query)
      .sort({ eventDate: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    // Attach real user names and photos from the DB
    const usersCollection = getCollection('users');
    if (usersCollection && events.length > 0) {
      const emails = events.map(e => e.organizer?.email).filter(Boolean);
      const users = await usersCollection.find({ email: { $in: emails } }).toArray();
      const userMap = {};
      users.forEach(u => { userMap[u.email] = u; });

      events = events.map(event => {
        if (event.organizer?.email && userMap[event.organizer.email]) {
          const u = userMap[event.organizer.email];
          // Use proper name from database, fallback to email's local part if no name exists
          event.organizer.name = u.name || u.displayName || u.email.split('@')[0] || event.organizer.name;
          event.organizer.photoURL = u.photoURL || u.image || event.organizer.photoURL;
        } else if (event.organizer?.email && !userMap[event.organizer.email]) {
          // If user not found in database, use email's local part as name
          event.organizer.name = event.organizer.email.split('@')[0] || 'Community Member';
        }
        return event;
      });
    }

    // 24h Reminder logic (Passive background check)
    if (upcoming === 'true') {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 25 * 60 * 60 * 1000);
      const earlyTomorrow = new Date(now.getTime() + 23 * 60 * 60 * 1000);

      const reminderEvents = await CleanupEvent.find({
        approvalStatus: 'approved',
        status: 'upcoming',
        reminderSent: { $ne: true },
        eventDate: { $gte: earlyTomorrow, $lte: tomorrow }
      });

      if (reminderEvents.length > 0 && typeof createNotification === 'function') {
        const notifDb = getCollection("notifications");
        if (notifDb) {
          for (const re of reminderEvents) {
            const notifications = re.going.map(att => ({
              userId: att.email,
              message: `⏰ Reminder: "${re.title}" is happening tomorrow!`,
              type: 'drive',
              link: `/cleanup-events/${re._id}`,
              priority: 'high',
              read: false,
              createdAt: new Date()
            }));
            if (notifications.length > 0) {
              await notifDb.insertMany(notifications).catch(console.error);
            }
            re.reminderSent = true;
            await re.save().catch(console.error);
          }
        }
      }
    }

    const total = await CleanupEvent.countDocuments(query);

    res.json({ events, total });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 3. Get Organizer's Events and Events Attending
router.get('/my', verifyToken, async (req, res) => {
  try {
    const email = req.user.email;
    const [organized, attending] = await Promise.all([
      CleanupEvent.find({ 'organizer.email': email }).sort({ createdAt: -1 }).lean(),
      CleanupEvent.find({ 'going.email': email }).sort({ eventDate: 1 }).lean()
    ]);
    res.json({ organized, attending });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4. Get Single Event (Public)
router.get('/:id', async (req, res) => {
  try {
    const event = await CleanupEvent.findById(req.params.id)
      .lean();

    if (!event || event.approvalStatus !== 'approved') {
      return res.status(404).json({ message: 'Event not found.' });
    }

    // Attach real user names and photos from the DB
    const usersCollection = getCollection('users');
    if (usersCollection && event.organizer?.email) {
      const u = await usersCollection.findOne({ email: event.organizer.email });
      if (u) {
        event.organizer.name = u.name || u.displayName || event.organizer.name;
        event.organizer.photoURL = u.photoURL || u.image || event.organizer.photoURL;
      }
    }

    res.json(event);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4.5 Get Event Attendees (Organizer/Admin only)
router.get('/:id/attendees', verifyToken, async (req, res) => {
  try {
    const event = await CleanupEvent.findById(req.params.id).lean();
    if (!event) return res.status(404).json({ message: 'Event not found.' });

    if (event.organizer.email !== req.user.email && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied.' });
    }

    res.json({ going: event.going, interested: event.interested });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4.6 Edit Event
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const event = await CleanupEvent.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found.' });

    // Authorization check
    if (event.organizer.email !== req.user.email && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the organizer can edit this event.' });
    }

    const { title, description, eventDate, location } = req.body;
    let detailsChanged = false;

    if (title) event.title = title;
    if (description) event.description = description;

    if (eventDate && new Date(eventDate).getTime() !== event.eventDate.getTime()) {
      event.eventDate = new Date(eventDate);
      detailsChanged = true;
    }

    if (location && location.address !== event.location.address) {
      event.location = { ...event.location, ...location };
      detailsChanged = true;
    }

    await event.save();

    // Notify attendees if date or location changed
    if (detailsChanged && event.going.length > 0) {
      const notifDb = getCollection('notifications');
      if (notifDb) {
        const docs = event.going.map(att => ({
          userId: att.email,
          message: `📅 The details of "${event.title}" have changed. Check the updated event.`,
          type: 'drive',
          link: `/cleanup-events/${event._id}`,
          isRead: false,
          createdAt: new Date()
        }));
        await notifDb.insertMany(docs).catch(console.error);
      }
    }

    res.json(event);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 5. Toggle Interested
router.post('/:id/interested', verifyToken, async (req, res) => {
  try {
    // Validate event ID format
    if (!req.params.id || !req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid event ID.' });
    }

    const event = await CleanupEvent.findById(req.params.id);
    
    // Check if event exists and is approved
    if (!event) {
      return res.status(404).json({ message: 'Event not found.' });
    }
    
    if (event.approvalStatus !== 'approved') {
      return res.status(403).json({ message: 'Event is not yet approved.' });
    }
    
    // Check if event is cancelled or completed
    if (event.status === 'cancelled') {
      return res.status(403).json({ message: 'This event has been cancelled.' });
    }
    
    if (event.status === 'completed') {
      return res.status(403).json({ message: 'This event has already completed.' });
    }

    const email = req.user.email;
    
    // Check if user is already interested (case-insensitive)
    const alreadyInterested = event.interested.some(
      interestedEmail => interestedEmail.toLowerCase() === email.toLowerCase()
    );

    if (alreadyInterested) {
      // Remove user from interested list
      event.interested = event.interested.filter(
        interestedEmail => interestedEmail.toLowerCase() !== email.toLowerCase()
      );
      // Ensure count is consistent with array length
      event.interestedCount = event.interested.length;
    } else {
      // Add user to interested list (prevent duplicates)
      if (!event.interested.some(
        interestedEmail => interestedEmail.toLowerCase() === email.toLowerCase()
      )) {
        event.interested.push(email);
      }
      // Ensure count is consistent with array length
      event.interestedCount = event.interested.length;
    }

    await event.save();
    res.json({ 
      interested: !alreadyInterested, 
      interestedCount: event.interestedCount,
      message: alreadyInterested ? 'Interest removed successfully' : 'Interest marked successfully'
    });
  } catch (err) {
    console.error('Error toggling interest:', err);
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid event ID format.' });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: 'Validation error: ' + err.message });
    }
    res.status(500).json({ message: 'Server error while updating interest. Please try again.' });
  }
});

// 6. Toggle Volunteer (was Going)
router.post('/:id/going', verifyToken, async (req, res) => {
  try {
    // Validate event ID format
    if (!req.params.id || !req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid event ID.' });
    }

    const event = await CleanupEvent.findById(req.params.id);
    
    // Check if event exists and is approved
    if (!event) {
      return res.status(404).json({ message: 'Event not found.' });
    }
    
    if (event.approvalStatus !== 'approved') {
      return res.status(403).json({ message: 'Event is not yet approved.' });
    }
    
    // Check if event is cancelled or completed
    if (event.status === 'cancelled') {
      return res.status(403).json({ message: 'This event has been cancelled.' });
    }
    
    if (event.status === 'completed') {
      return res.status(403).json({ message: 'This event has already completed.' });
    }

    // Check if event date has passed
    if (new Date(event.eventDate) < new Date()) {
      return res.status(400).json({ message: 'Cannot volunteer for a past event.' });
    }

    const email = req.user.email;
    const existingIndex = event.going.findIndex(a => a.email.toLowerCase() === email.toLowerCase());

    if (existingIndex > -1) {
      // Remove user from volunteer list
      event.going.splice(existingIndex, 1);
      // Ensure count is consistent with array length
      event.goingCount = event.going.length;
      await event.save();
      return res.json({ 
        going: false, 
        goingCount: event.goingCount,
        message: 'Volunteer registration removed successfully'
      });
    }

    // Check if user is a member
    const usersCollection = getCollection('users');
    const dbUser = await usersCollection.findOne({ email });
    if (!dbUser || (dbUser.role !== 'member' && dbUser.role !== 'admin')) {
      return res.status(403).json({ message: 'Only verified members can volunteer for drives.' });
    }

    // Check if user is a registered volunteer
    const volunteersCollection = getCollection('volunteers');
    const isRegVolunteer = await volunteersCollection.findOne({ email });
    if (!isRegVolunteer || isRegVolunteer.approvalStatus !== 'approved') {
      return res.status(403).json({ message: 'Please join the volunteer force first.' });
    }

    // Check if event is full
    if (event.maxVolunteers > 0 && event.goingCount >= event.maxVolunteers) {
      return res.status(409).json({
        message: 'This event is full. You can still mark yourself as Interested.',
        full: true,
      });
    }

    // Add user to volunteer list
    event.going.push({
      email: email,
      name: req.user.displayName || req.user.name || email,
      photoURL: req.user.photoURL || req.user.picture || null,
      status: 'going', // Will be updated to 'attended' after verification
    });
    // Ensure count is consistent with array length
    event.goingCount = event.going.length;

    // Remove from interested if present (case-insensitive)
    event.interested = event.interested.filter(
      interestedEmail => interestedEmail.toLowerCase() !== email.toLowerCase()
    );
    event.interestedCount = event.interested.length;

    await event.save();

    // Send notification to organizer if event is almost full
    if (event.maxVolunteers > 0 && event.goingCount === Math.ceil(event.maxVolunteers * 0.8) && typeof createNotification === 'function') {
      await createNotification({
        userId: event.organizer.email,
        message: `⚠️ Your event is almost full — ${event.goingCount}/${event.maxVolunteers} spots taken.`,
        type: 'drive',
        link: `/cleanup-events/${event._id}`,
        priority: 'high',
      });
    }

    // Send notification to organizer for early volunteers
    if (event.goingCount <= 5 && typeof createNotification === 'function') {
      await createNotification({
        userId: event.organizer.email,
        message: `${req.user.displayName || req.user.name || email} has volunteered for your event "${event.title}"!`,
        type: 'drive',
        link: `/cleanup-events/${event._id}`,
      });
    }

    // Create feed event
    if (typeof createFeedEvent === 'function') {
      await createFeedEvent('drive_joined', {
        count: event.goingCount,
        driveTitle: event.title,
        area: event.location.area,
        link: `/cleanup-events/${event._id}`,
      });
    }

    await updateStreak(email);
    res.json({ 
      going: true, 
      goingCount: event.goingCount,
      message: 'Volunteer registration successful'
    });
  } catch (err) {
    console.error('Error toggling volunteer:', err);
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid event ID format.' });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: 'Validation error: ' + err.message });
    }
    res.status(500).json({ message: 'Server error while updating volunteer status. Please try again.' });
  }
});

// 7. Donate to Event
router.post('/:id/donate', verifyToken, async (req, res) => {
  try {
    const { amount, name, phone, additionalInfo } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid donation amount.' });
    }

    const event = await CleanupEvent.findById(req.params.id);
    if (!event || !event.fundingEnabled) {
      return res.status(404).json({ message: 'Event not found or funding not enabled.' });
    }

    const contributionsDb = getCollection('contributions');
    await contributionsDb.insertOne({
      eventId: event._id.toString(),
      eventTitle: event.title,
      type: 'cleanup_event',
      amount: Number(amount),
      name: name || req.user.displayName,
      email: req.user.email,
      phone: phone || '',
      additionalInfo: additionalInfo || '',
      date: new Date(),
    });

    await CleanupEvent.findByIdAndUpdate(
      req.params.id,
      { $inc: { fundingRaised: Number(amount) } }
    );

    if (typeof addPoints === 'function') {
      await addPoints(req.user.email, 'contribution_made');
    }

    if (typeof createNotification === 'function') {
      await createNotification({
        userId: event.organizer.email,
        message: `${name || req.user.displayName || 'A kind community member'} donated ৳${amount} to your cleanup event!`,
        type: 'drive',
        link: `/cleanup-events/${event._id}`,
      });
    }

    res.json({ success: true, message: 'Donation recorded. Thank you!' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 8. Get Attendees List (Organizer + Admin)
router.get('/:id/attendees', verifyToken, async (req, res) => {
  try {
    const event = await CleanupEvent.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    const isOrganizer = event.organizer.email === req.user.email;
    const isAdmin = req.user.role === 'admin';

    if (!isOrganizer && !isAdmin) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    res.json({
      going: event.going,
      goingCount: event.goingCount,
      interestedCount: event.interestedCount,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 9. Update Event (Organizer Only)
router.patch('/:id', verifyToken, async (req, res) => {
  try {
    const event = await CleanupEvent.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    if (event.organizer.email !== req.user.email) {
      return res.status(403).json({ message: 'Only the organizer can update this event.' });
    }

    if (event.status !== 'upcoming') {
      return res.status(400).json({ message: 'Cannot edit an event that has started or completed.' });
    }

    const allowed = ['title', 'slogan', 'description', 'eventDate', 'eventTime',
      'durationHours', 'location', 'coverImages', 'maxVolunteers',
      'requiredSkills', 'suppliesNeeded', 'meetingInstructions',
      'fundingGoal'];

    allowed.forEach(field => {
      if (req.body[field] !== undefined) event[field] = req.body[field];
    });

    if (req.body.eventDate && typeof createNotification === 'function') {
      await Promise.all(event.going.map(att =>
        createNotification({
          userId: att.email,
          message: `📅 The date of "${event.title}" has been updated. Please check the new schedule.`,
          type: 'drive',
          link: `/cleanup-events/${event._id}`,
          priority: 'high',
        })
      ));
    }

    await event.save();
    res.json({ success: true, event });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 10. Mark Event Completed + Award Points
router.post('/:id/complete', verifyToken, async (req, res) => {
  try {
    const event = await CleanupEvent.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    const isOrganizer = event.organizer.email === req.user.email;
    const isAdmin = req.user.role === 'admin';

    if (!isOrganizer && !isAdmin) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    event.status = 'completed';
    event.postEventPhotos = req.body.postEventPhotos || [];

    if (!event.pointsAwarded && typeof addPoints === 'function') {
      event.pointsAwarded = true;

      await Promise.all([
        addPoints(event.organizer.email, 'event_organized'),
        ...event.going.map(att => addPoints(att.email, 'event_attended')),
      ]);

      if (typeof createNotification === 'function') {
        await Promise.all(event.going.map(att =>
          createNotification({
            userId: att.email,
            message: `✅ The "${event.title}" cleanup is marked complete! You've earned 30 points.`,
            type: 'badge',
            link: `/cleanup-events/${event._id}`,
          })
        ));
      }
    }

    await event.save();

    if (typeof createFeedEvent === 'function') {
      await createFeedEvent('drive_completed', {
        driveTitle: event.title,
        count: event.goingCount,
        area: event.location.area,
        link: `/cleanup-events/${event._id}`,
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 11. Cancel Event
router.post('/:id/cancel', verifyToken, async (req, res) => {
  try {
    const event = await CleanupEvent.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    const isOrganizer = event.organizer.email === req.user.email;
    const isAdmin = req.user.role === 'admin';
    if (!isOrganizer && !isAdmin) return res.status(403).json({ message: 'Access denied.' });

    event.status = 'cancelled';
    event.cancelReason = req.body.reason || 'Cancelled by organizer.';
    await event.save();

    if (typeof createNotification === 'function') {
      await Promise.all(event.going.map(att =>
        createNotification({
          userId: att.email,
          message: `❌ "${event.title}" has been cancelled. Reason: ${event.cancelReason}`,
          type: 'drive',
          link: `/cleanup-events/${event._id}`,
          priority: 'high',
        })
      ));
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Helper to combine date and time strings into a single Date object
function getEventStartDateTime(eventDate, eventTime) {
  const baseDate = new Date(eventDate);
  if (!eventTime) return baseDate;
  const match = eventTime.match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!match) return baseDate;
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const ampm = match[3];
  if (ampm) {
    if (ampm.toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
  }
  baseDate.setHours(hours, minutes, 0, 0);
  return baseDate;
}

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

const crypto = require('crypto');

// 12. Generate Check-in Code
router.post('/:id/generate-checkin-code', verifyToken, async (req, res) => {
  try {
    const event = await CleanupEvent.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found.' });

    // Only the organizer or admin can generate the code
    if (event.organizer.email !== req.user.email && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the organizer can generate the check-in code.' });
    }

    // Must be within 3 hours of the event start
    const eventStart = getEventStartDateTime(event.eventDate, event.eventTime);
    const now        = new Date();
    const hoursUntil = (eventStart - now) / (1000 * 60 * 60);

    // Allowing code generation starting 3 hours before start to 5 hours after start
    if (hoursUntil > 3 || hoursUntil < -5) {
      return res.status(400).json({
        message: 'Check-in code can only be generated within 3 hours of the event start.'
      });
    }

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();

    event.checkinCode         = otp;
    event.checkinCodeGeneratedAt = new Date();
    await event.save();

    res.json({ code: otp, validUntil: new Date(Date.now() + 5 * 60 * 60 * 1000) });
  } catch (err) {
    console.error('Error generating check-in code:', err);
    res.status(500).json({ message: err.message });
  }
});

// 13. Attendee Check-in
router.post('/:id/checkin', verifyToken, async (req, res) => {
  try {
    const { otp, coordinates } = req.body;
    const email = req.user.email;

    if (!otp) return res.status(400).json({ message: 'Check-in code is required.' });

    const event = await CleanupEvent.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found.' });

    // Validate OTP
    if (event.checkinCode !== otp) {
      return res.status(400).json({ message: 'Incorrect check-in code.' });
    }

    // OTP must be used within 5-hour window
    const generated = new Date(event.checkinCodeGeneratedAt);
    if (Date.now() - generated.getTime() > 5 * 60 * 60 * 1000) {
      return res.status(400).json({ message: 'Check-in code has expired.' });
    }

    // It must be used within the event's time window (from 30 minutes before eventTime to 3 hours after)
    const eventStart = getEventStartDateTime(event.eventDate, event.eventTime);
    const now = new Date();
    const hoursDiff = (now - eventStart) / (1000 * 60 * 60);

    if (hoursDiff < -0.5 || hoursDiff > 3) {
      return res.status(400).json({
        message: 'Check-in is only allowed from 30 minutes before the event start until 3 hours after.'
      });
    }

    // User must have RSVPd (in going[] array)
    const attendeeIndex = event.going.findIndex(a => a.email.toLowerCase() === email.toLowerCase());
    if (attendeeIndex === -1) {
      return res.status(403).json({
        message: 'You must RSVP before checking in. Go to the event page and click "Going".'
      });
    }

    // Already checked in?
    if (event.going[attendeeIndex].checkedIn) {
      return res.status(400).json({ message: 'You have already checked in to this event.' });
    }

    // GPS validation — soft check, not hard block
    let gpsConfidence = 'none';
    if (coordinates?.lat && coordinates?.lng && event.location?.coordinates?.length === 2) {
      const distance = haversineDistance(
        coordinates.lat, coordinates.lng,
        event.location.coordinates[1],
        event.location.coordinates[0]
      );
      if (distance <= 200)    gpsConfidence = 'high';
      else if (distance <= 500) gpsConfidence = 'medium';
      else if (distance <= 1000) gpsConfidence = 'low';
      // > 1000m is allowed (OTP is the primary trust signal, but confidence remains 'none')
    }

    // Mark as checked in
    event.going[attendeeIndex].checkedIn     = true;
    event.going[attendeeIndex].checkedInAt   = new Date();
    event.going[attendeeIndex].gpsConfidence = gpsConfidence;
    event.going[attendeeIndex].status        = 'attended';
    await event.save();

    // Award points immediately
    const pointsEarned = await addPoints(email, 'event_attended');

    // Award first_event bonus if applicable
    const usersCollection = getCollection('users');
    const user = await usersCollection.findOne({ email }, { projection: { eventsAttended: 1 } });
    if (!user?.eventsAttended || user.eventsAttended === 0) {
      await addPoints(email, 'first_event');
      await usersCollection.updateOne({ email }, { $set: { eventsAttended: 1 } });
    } else {
      await usersCollection.updateOne({ email }, { $inc: { eventsAttended: 1 } });
    }

    await updateStreak(email);
    res.json({
      success:      true,
      pointsEarned,
      gpsConfidence,
      message:      `✅ Checked in! You earned ${pointsEarned} points.`,
    });
  } catch (err) {
    console.error('Error during check-in:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
