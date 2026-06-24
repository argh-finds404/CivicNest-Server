const { getCollection } = require('../config/db');

const createNotification = async ({ userId, email, message, type = 'info', link = null, priority = 'normal' }) => {
  try {
    const notificationsCollection = getCollection("notifications");
    await notificationsCollection.insertOne({
      userId,
      email,
      message,
      type,
      link,
      priority,
      read: false,
      isRead: false,
      createdAt: new Date()
    });
  } catch (error) {
    console.error("Failed to create notification:", error);
  }
};

const notifyContributors = async (issueId, message) => {
  try {
    const contributionsCollection = getCollection("contributions");
    const contributions = await contributionsCollection.find({ issueId }).toArray();
    
    // Get unique emails
    const emails = [...new Set(contributions.map(c => c.contributorEmail))];
    
    // Send to all
    for (const email of emails) {
      await createNotification({ email, message, type: 'crowdfunding', link: `/issues/${issueId}` });
    }
  } catch (error) {
    console.error("Failed to notify contributors:", error);
  }
};

module.exports = { createNotification, notifyContributors };
