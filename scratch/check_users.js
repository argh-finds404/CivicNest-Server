const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dglhl0x.mongodb.net/?appName=Cluster0`;

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db("communityDB");
    const users = await db.collection("users").find({}).toArray();
    console.log("=== ALL USERS IN DB ===");
    users.forEach(u => {
      console.log(`- Email: ${u.email}\n  Role: ${u.role}\n  Name: ${u.name || u.displayName}\n  Area: ${u.area}\n  Phone: ${u.phone}\n  Street: ${u.streetAddress}\n  Apt: ${u.apartmentNumber}`);
    });

    const requests = await db.collection("membershipRequests").find({}).toArray();
    console.log("\n=== ALL MEMBERSHIP REQUESTS IN DB ===");
    requests.forEach(r => {
      console.log(`- Email: ${r.email}\n  Status: ${r.status}\n  Name: ${r.name}\n  Area: ${r.area}\n  Phone: ${r.phone}\n  Street: ${r.streetAddress}\n  Apt: ${r.apartmentNumber}`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
