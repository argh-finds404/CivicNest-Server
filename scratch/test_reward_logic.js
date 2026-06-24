const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dglhl0x.mongodb.net/?appName=Cluster0`;
const DB_NAME = 'communityDB';

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  
  const lostFoundCol = db.collection('lostFound');
  const usersCol = db.collection('users');
  const notificationsCol = db.collection('notifications');

  console.log("1. Finding listing and finder details...");
  const itemId = "6a248b2ca405b61f9215c994";
  const item = await lostFoundCol.findOne({ _id: new ObjectId(itemId) });
  if (!item) {
    console.error("Listing not found!");
    await client.close();
    return;
  }
  
  // Make sure finder email is resolved
  const actionTaker = item.foundReports && item.foundReports[0]?.email;
  if (!actionTaker) {
    console.error("No finder report found on this listing!");
    await client.close();
    return;
  }
  
  console.log(`Listing: "${item.itemName}" | Offered Reward: ৳${item.reward}`);
  console.log(`Finder: ${actionTaker}`);

  // Fetch or initialize finder's user balance
  let user = await usersCol.findOne({ email: actionTaker });
  if (!user) {
    console.log("Finder user not in DB, creating user...");
    await usersCol.insertOne({ email: actionTaker, name: 'Alex Finder', balance: 0, points: 0 });
    user = await usersCol.findOne({ email: actionTaker });
  }

  const initialBalance = user.balance || 0;
  console.log(`Finder Initial Balance: ৳${initialBalance}`);

  console.log("\n2. Simulating reward crediting workflow...");
  const rewardAmount = parseFloat(item.reward) || 0;
  if (rewardAmount > 0) {
    // 2.a. Credit balance
    await usersCol.updateOne(
      { email: actionTaker },
      { $inc: { balance: rewardAmount } }
    );
    console.log(`Credited ৳${rewardAmount} to ${actionTaker}`);

    // 2.b. Create notification
    await notificationsCol.insertOne({
      userId: actionTaker,
      email: actionTaker,
      message: `🎉 Congratulations! You have been credited ৳${rewardAmount} reward for returning "${item.itemName}".`,
      type: 'reward',
      link: `/lost-found/${item._id}`,
      read: false,
      isRead: false,
      createdAt: new Date()
    });
    console.log("Notification created successfully.");
  } else {
    console.log("No reward to credit.");
  }

  // Verify updates
  console.log("\n3. Verifying updates in Database...");
  const updatedUser = await usersCol.findOne({ email: actionTaker });
  console.log(`Finder New Balance: ৳${updatedUser.balance}`);
  
  const recentNotification = await notificationsCol.findOne(
    { email: actionTaker, type: 'reward' },
    { sort: { createdAt: -1 } }
  );
  console.log("Recent Notification message in DB:", recentNotification?.message);

  // Reset the item status to open for normal client/server testing
  console.log("\n4. Resetting listing status back to 'open'...");
  await lostFoundCol.updateOne(
    { _id: new ObjectId(itemId) },
    { $set: { status: 'open' } }
  );
  console.log("Listing reset to 'open' status.");

  await client.close();
  console.log("\nTest completed successfully!");
}

run().catch(console.error);
