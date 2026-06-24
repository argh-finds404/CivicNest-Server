// Server/scratch/update_notifications.js
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dglhl0x.mongodb.net/?appName=Cluster0`;
const DB_NAME = 'communityDB';

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection('notifications');
  
  const result = await col.updateMany(
    { 
      message: { 
        $in: [
          "🎉 You earned +25 points for your membership approval!",
          "🎉 Congrats! You are now an official member of CivicNest! We've credited your account with +25 points as a welcome bonus. Let's build a better community together! 🚀"
        ] 
      } 
    },
    { $set: { message: "🎉 Welcome to CivicNest! You've earned a +25 points member welcome bonus!" } }
  );
  
  console.log(`Successfully updated ${result.modifiedCount} existing notifications to the short version!`);
  await client.close();
}

run().catch(console.error);
