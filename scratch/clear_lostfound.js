// Server/scratch/clear_lostfound.js
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dglhl0x.mongodb.net/?appName=Cluster0`;
const DB_NAME = 'communityDB';

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection('lostFound');
  
  const result = await col.deleteMany({});
  console.log(`Successfully cleared ${result.deletedCount} documents from lostFound collection!`);
  await client.close();
}

run().catch(console.error);
