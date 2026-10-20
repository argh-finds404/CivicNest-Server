/**
 * Reset the demo neighbourhood (members, issues, cleanups, animals, lost &
 * found). Demo records only; real content is never touched.
 *
 *   npm run seed:demo
 *
 * The server also adds any missing demo content on startup unless
 * DEMO_CONTENT=off. See services/demoContent.js.
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");
const { resolveDatabaseUrl } = require("../lib/prisma");
const { seedDemoContent } = require("../services/demoContent");

(async () => {
  const client = await MongoClient.connect(resolveDatabaseUrl());
  try {
    const added = await seedDemoContent(client.db("communityDB"), { reset: true });
    console.log("Demo content ready:", added);
  } finally {
    await client.close();
  }
})()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seeding demo content failed:", err.message);
    process.exit(1);
  });
