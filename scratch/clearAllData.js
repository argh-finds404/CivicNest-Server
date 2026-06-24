const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dglhl0x.mongodb.net/?appName=Cluster0`;
const ADMIN_EMAIL = 'shoumik499@gmail.com';

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db("communityDB");

    console.log("Connected to MongoDB!");
    
    // Retrieve all collections
    const collections = await db.listCollections().toArray();
    console.log(`Found ${collections.length} collections.`);

    for (const colInfo of collections) {
      const colName = colInfo.name;
      const col = db.collection(colName);

      // Skip system collections if any
      if (colName.startsWith('system.')) {
        console.log(`Skipping system collection: ${colName}`);
        continue;
      }

      if (colName === 'users') {
        // Delete all users EXCEPT the admin email
        const result = await col.deleteMany({ email: { $ne: ADMIN_EMAIL } });
        console.log(`Collection 'users': Deleted ${result.deletedCount} documents, leaving only admin user '${ADMIN_EMAIL}'.`);
      } else {
        // Delete ALL documents
        const result = await col.deleteMany({});
        console.log(`Collection '${colName}': Deleted ${result.deletedCount} documents.`);
      }
    }

    console.log("\nDatabase cleanup completed successfully!");
  } catch (err) {
    console.error("Error during database cleanup:", err);
  } finally {
    await client.close();
    process.exit(0);
  }
}

run();
