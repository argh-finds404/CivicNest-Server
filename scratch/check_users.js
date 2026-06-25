const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dglhl0x.mongodb.net/?appName=Cluster0`;

async function main() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('communityDB');
    const users = await db.collection('users').find({}).toArray();
    console.log(`Found ${users.length} users in the database.`);
    users.forEach(user => {
      console.log(`Email: ${user.email}, Name: ${user.name || user.displayName}, Streak:`, user.streak, `Role: ${user.role}`);
    });
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

main();
