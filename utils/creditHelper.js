const { getCollection } = require("../config/db");

/**
 * Automatically calculates and regenerates issue posting credits for a user based on elapsed time.
 * Each spent credit takes 48 hours to recover.
 * @param {string} email - User email
 * @returns {Promise<{issueCredits: number, creditRegenTimestamps: string[]}|null>} updated credit details
 */
async function regenerateUserCredits(email) {
  try {
    const usersCollection = getCollection("users");
    if (!usersCollection) return null;
    
    const user = await usersCollection.findOne({ email });
    if (!user) return null;

    const maxCredits = 3;
    let currentCredits = user.issueCredits !== undefined ? user.issueCredits : maxCredits;
    let regenTimestamps = user.creditRegenTimestamps || [];

    const now = Date.now();
    let updated = false;

    // Filter out timestamps that have already passed, and increment credits accordingly
    const remainingTimestamps = [];
    for (const ts of regenTimestamps) {
      const time = new Date(ts).getTime();
      if (time <= now) {
        currentCredits = Math.min(maxCredits, currentCredits + 1);
        updated = true;
      } else {
        remainingTimestamps.push(ts);
      }
    }

    // If credits are less than max but there are no regeneration timestamps registered,
    // initialize them for safety (e.g. if database state became out of sync)
    if (currentCredits < maxCredits && remainingTimestamps.length < (maxCredits - currentCredits)) {
      const diff = (maxCredits - currentCredits) - remainingTimestamps.length;
      for (let i = 0; i < diff; i++) {
        remainingTimestamps.push(new Date(now + 48 * 60 * 60 * 1000));
      }
      updated = true;
    }

    // Save changes to database if any credit recovery occurred, or if fields are newly initialized
    if (updated || user.issueCredits === undefined || user.creditRegenTimestamps === undefined) {
      await usersCollection.updateOne(
        { email },
        {
          $set: {
            issueCredits: currentCredits,
            creditRegenTimestamps: remainingTimestamps
          }
        }
      );
    }
    
    return {
      issueCredits: currentCredits,
      creditRegenTimestamps: remainingTimestamps
    };
  } catch (error) {
    console.error("Error in regenerateUserCredits:", error);
    return null;
  }
}

module.exports = { regenerateUserCredits };
