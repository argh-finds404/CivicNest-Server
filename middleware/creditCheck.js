const { getCollection } = require('../config/db');

// Per-role limits per content type
const CREDIT_LIMITS = {
  issues: {
    guest:     1,
    member:    3,
    volunteer: 5,
  },
  lostFound: {
    guest:     1,
    member:    3,
    volunteer: 4,
  },
  animals: {
    guest:     0,
    member:    3,
    volunteer: 5,
  },
  forum: {
    guest:     0,
    member:    5,
    volunteer: 8,
  },
  cleanupEvents: {
    guest:     0,
    member:    1,
    volunteer: 2,
  },
};

const CONFIG = {
  issues: {
    collection: 'issues',
    emailField: 'submittedBy.email',
    dateField: 'submittedAt'
  },
  lostFound: {
    collection: 'lostFound',
    emailField: 'reporter.email',
    dateField: 'date'
  },
  animals: {
    collection: 'animals',
    emailField: 'reporter.email',
    dateField: 'date'
  },
  forum: {
    collection: 'forum',
    emailField: 'author',
    dateField: 'createdAt'
  },
  cleanupEvents: {
    collection: 'cleanupevents',
    emailField: 'organizer.email',
    dateField: 'createdAt'
  }
};

const WINDOW_MS = 72 * 60 * 60 * 1000;   // 72 hours

/**
 * Middleware to check and enforce rolling 72-hour credit limits based on user role and points.
 * @param {string} postType - The content type being posted ('issues', 'lostFound', 'animals', 'forum', 'cleanupEvents')
 */
function creditCheck(postType) {
  return async (req, res, next) => {
    try {
      const email = req.user?.email;
      if (!email) return res.status(401).json({ message: 'User unauthorized.' });

      const usersCollection = getCollection('users');
      if (!usersCollection) return next();

      // Fetch user role + points
      const user = await usersCollection.findOne(
        { email },
        { projection: { role: 1, points: 1, isVolunteer: 1 } }
      );

      if (!user) return res.status(401).json({ message: 'User not found.' });

      // Admins skip credit check entirely
      if (user.role === 'admin') return next();

      // Determine effective role for limit lookup
      const effectiveRole = user.isVolunteer ? 'volunteer' : (user.role || 'guest');
      let limit = CREDIT_LIMITS[postType]?.[effectiveRole] ?? 0;

      // Points bonus: 500+ points earns +1 on issues and lostFound
      if (user.points >= 500 && ['issues', 'lostFound'].includes(postType)) {
        limit += 1;
      }

      // Hard block: role has 0 credits for this type
      if (limit === 0) {
        return res.status(403).json({
          message: effectiveRole === 'guest'
            ? 'Guests cannot post this content. Apply for membership to unlock this feature.'
            : 'Your role does not have permission to post this content type.',
          code: 'NO_CREDIT_FOR_ROLE',
        });
      }

      const conf = CONFIG[postType];
      if (!conf) return next();

      // Count posts in the last 72 hours
      const windowStart  = new Date(Date.now() - WINDOW_MS);
      const query = {
        [conf.emailField]: email,
        [conf.dateField]: { $gte: windowStart },
        approvalStatus: { $ne: 'rejected' },   // rejected posts don't count against you
      };

      const targetCol = getCollection(conf.collection);
      if (!targetCol) return next();

      const recentCount = await targetCol.countDocuments(query);

      if (recentCount >= limit) {
        // Find when the oldest recent post will age out
        const oldest = await targetCol.findOne(
          query,
          { sort: { [conf.dateField]: 1 }, projection: { [conf.dateField]: 1 } }
        );

        const oldestDate = oldest ? oldest[conf.dateField] : null;
        const resetAt    = oldestDate
          ? new Date(new Date(oldestDate).getTime() + WINDOW_MS)
          : null;
        
        let hoursLeft = 72;
        let minutesLeft = 0;
        if (resetAt) {
          const diffMs = resetAt - Date.now();
          hoursLeft = Math.floor(diffMs / (1000 * 60 * 60));
          minutesLeft = Math.ceil((diffMs % (1000 * 60 * 60)) / (1000 * 60));
          if (hoursLeft < 0) hoursLeft = 0;
          if (minutesLeft < 0) minutesLeft = 0;
        }

        const timeMsg = hoursLeft > 0 
          ? `${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''} ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}`
          : `${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}`;

        return res.status(429).json({
          message:   `You've used all ${limit} credits for this content type. Your next credit returns in ${timeMsg}.`,
          code:      'CREDIT_LIMIT_REACHED',
          limit,
          used:      recentCount,
          resetAt,
          hoursLeft,
          minutesLeft
        });
      }

      // Pass credit info to route handler (for response)
      req.creditInfo = {
        limit,
        used:      recentCount,
        remaining: limit - recentCount,
      };

      next();
    } catch (err) {
      // If credit check fails, don't block the user — log and proceed
      console.error('[CreditCheck Error]', err.message);
      next();
    }
  };
}

module.exports = { creditCheck, CREDIT_LIMITS, CONFIG };
