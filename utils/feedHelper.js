const { getCollection } = require('../config/db');

/**
 * Helper to handle feed events.
 * Inserts feed events into the 'feed_events' MongoDB collection.
 */
const createFeedEvent = async (type, data) => {
  try {
    const feedDb = getCollection('feed_events');
    if (feedDb) {
      await feedDb.insertOne({ 
        type, 
        data, 
        createdAt: new Date() 
      });
      console.log(`[FEED EVENT] ${type} stored in DB.`);
    }
    return true;
  } catch (error) {
    console.error("Failed to create feed event:", error);
    return false;
  }
};

module.exports = {
  createFeedEvent,
};
