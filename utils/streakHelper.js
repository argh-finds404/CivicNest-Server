const { getCollection } = require('../config/db');
const { addPoints } = require('./pointsHelper');

async function updateStreak(email) {
  if (!email) return;
  try {
    const usersCollection = getCollection('users');
    const user = await usersCollection.findOne({ email });
    if (!user) return;

    const today = new Date().toDateString();
    const last = user.streak?.lastActiveDate
      ? new Date(user.streak.lastActiveDate).toDateString()
      : null;

    if (last === today) return; // already counted today

    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const current = last === yesterday ? (user.streak?.current || 0) + 1 : 1;
    const best = Math.max(current, user.streak?.best || 0);

    await usersCollection.updateOne(
      { email },
      {
        $set: {
          'streak.current': current,
          'streak.best': best,
          'streak.lastActiveDate': new Date(),
        }
      }
    );

    // Bonus points for milestones
    if ([7, 30, 100].includes(current)) {
      if (typeof addPoints === 'function') {
        await addPoints(email, 'streak_milestone');
      }
    }
  } catch (err) {
    console.error(`Failed to update streak for ${email}:`, err.message);
  }
}

module.exports = { updateStreak };
