const { MongoClient, ServerApiVersion } = require("mongodb");
const mongoose = require("mongoose");
require("dotenv").config();

const uri = process.env.MONGODB_URI || 
            process.env.DATABASE_URL || 
            `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dglhl0x.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;

async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db("communityDB");
    
    await mongoose.connect(uri, {
      dbName: "communityDB"
    });

    // TTL Index for Notifications (7 days)
    await db.collection("notifications").createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 604800 }
    ).catch(console.error);

    // TTL Index for Lost & Found
    await db.collection("lostFound").createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 }
    ).catch(console.error);

    const forumCol = db.collection("forum");
    await forumCol.createIndex({ approvalStatus: 1, category: 1, isPinned: -1, date: -1 }).catch(console.error);
    await forumCol.createIndex({ approvalStatus: 1, category: 1, upvoteCount: -1, date: -1 }).catch(console.error);
    await forumCol.createIndex({ approvalStatus: 1, isPinned: -1, date: -1 }).catch(console.error);
    await forumCol.createIndex({ approvalStatus: 1, upvoteCount: -1, date: -1 }).catch(console.error);
    
    await db.collection("feed_events").createIndex({ createdAt: -1 }).catch(console.error);
    await db.collection("incidents").createIndex({ createdAt: -1 }).catch(console.error);
    
    console.log("Connected to MongoDB (Native & Mongoose)!");

    // async volunteer name/photo migration
    setImmediate(async () => {
      try {
        const volsCol = db.collection("volunteers");
        const usersCol = db.collection("users");
        const volsWithEmailNames = await volsCol.find({ name: /@/ }).toArray();
        if (volsWithEmailNames.length > 0) {
          console.log(`[Migration] Found ${volsWithEmailNames.length} volunteers with emails as names. Starting cleanup...`);
          for (const vol of volsWithEmailNames) {
            const user = await usersCol.findOne({ email: vol.email });
            if (user) {
              const actualName = user.name || user.displayName || vol.email.split('@')[0];
              const actualPhoto = user.photoURL || null;
              await volsCol.updateOne(
                { _id: vol._id },
                { $set: { name: actualName, photoURL: actualPhoto } }
              );
            }
          }
          console.log("[Migration] Volunteers cleanup complete.");
        }
      } catch (err) {
        console.error("[Migration] Failed to run volunteer cleanup migration:", err);
      }
    });
  }
  return db;
}

function getCollection(collectionName) {
  if (!db) {
    throw new Error("Call connectDB first");
  }
  return db.collection(collectionName);
}

module.exports = { connectDB, getCollection, client };
