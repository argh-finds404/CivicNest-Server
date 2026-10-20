/**
 * Create (or reset) the reviewer demo accounts, one per role:
 *
 *   npm run seed:reviewers
 *
 * Needs the same env as the server: Firebase Admin credentials and the
 * MongoDB URL. Admins can do the same from the dashboard (Users → "Set up
 * reviewer logins") without a terminal. See services/reviewers.js.
 * Override the shared password with REVIEWER_PASSWORD.
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");
const { resolveDatabaseUrl } = require("../lib/prisma");
const { seedReviewers, REVIEWER_PASSWORD } = require("../services/reviewers");

(async () => {
  const client = await MongoClient.connect(resolveDatabaseUrl());
  try {
    const ready = await seedReviewers(client.db("communityDB").collection("users"));
    for (const { role, email } of ready) console.log(`✔ ${role.padEnd(9)} ${email}`);
    console.log(`\nPassword for all three: ${REVIEWER_PASSWORD}`);
  } finally {
    await client.close();
  }
})().catch((err) => {
  console.error("Seeding reviewers failed:", err.message);
  process.exit(1);
});
