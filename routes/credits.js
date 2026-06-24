const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { CREDIT_LIMITS, CONFIG } = require('../middleware/creditCheck');
const { getCollection } = require('../config/db');

// GET /credits/:type - Get rolling credit details for a post type
router.get('/:type', verifyToken, async (req, res) => {
  const { type } = req.params;
  const validTypes = ['issues', 'lostFound', 'animals', 'forum', 'cleanupEvents'];
  if (!validTypes.includes(type)) return res.status(400).json({ message: 'Invalid type.' });

  try {
    const usersCollection = getCollection('users');
    if (!usersCollection) {
      return res.status(500).json({ message: 'Database not initialized.' });
    }
    const email = req.user.email;
    const user = await usersCollection.findOne({ email }, { projection: { role: 1, points: 1, isVolunteer: 1 } });

    if (user?.role === 'admin') {
      return res.json({ limit: null, used: 0, remaining: null, isAdmin: true });
    }

    const effectiveRole = user?.isVolunteer ? 'volunteer' : (user?.role || 'guest');
    let limit = CREDIT_LIMITS[type]?.[effectiveRole] ?? 0;
    if (user?.points >= 500 && ['issues', 'lostFound'].includes(type)) {
      limit += 1;
    }

    const conf = CONFIG[type];
    const windowStart = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const query = {
      [conf.emailField]: email,
      [conf.dateField]: { $gte: windowStart },
      approvalStatus: { $ne: 'rejected' },
    };

    const targetCol = getCollection(conf.collection);
    if (!targetCol) {
      return res.status(500).json({ message: `Collection ${conf.collection} not initialized.` });
    }
    const used = await targetCol.countDocuments(query);

    const oldest = used > 0 ? await targetCol.findOne(
      query,
      { sort: { [conf.dateField]: 1 }, projection: { [conf.dateField]: 1 } }
    ) : null;

    const oldestDate = oldest ? oldest[conf.dateField] : null;
    const resetAt   = oldestDate ? new Date(new Date(oldestDate).getTime() + 72 * 60 * 60 * 1000) : null;
    
    let hoursLeft = null;
    let minutesLeft = null;
    if (resetAt) {
      const diffMs = resetAt - Date.now();
      hoursLeft = Math.floor(diffMs / (1000 * 60 * 60));
      minutesLeft = Math.ceil((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      if (hoursLeft < 0) hoursLeft = 0;
      if (minutesLeft < 0) minutesLeft = 0;
    }

    res.json({ limit, used, remaining: Math.max(0, limit - used), resetAt, hoursLeft, minutesLeft });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
