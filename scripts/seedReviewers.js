/**
 * Create (or reset) the reviewer demo accounts, one per role:
 *
 *   npm run seed:reviewers
 *
 * Needs the same env as the server: Firebase Admin credentials and the
 * MongoDB URL. Re-running resets the passwords and roles; nothing else is
 * touched. Demo accounts are flagged `isDemo`, which blocks role changes.
 * Override the shared password with REVIEWER_PASSWORD.
 */
require("dotenv").config();
const admin = require("../config/firebase");
const { prisma } = require("../lib/prisma");

const PASSWORD = process.env.REVIEWER_PASSWORD || "CivicNest@2026";

const REVIEWERS = [
  { email: "admin.reviewer@civicnest.app", name: "Ayesha Rahman (Admin reviewer)", role: "admin", points: 1480 },
  { email: "moderator.reviewer@civicnest.app", name: "Tanvir Hasan (Moderator reviewer)", role: "moderator", points: 920 },
  { email: "member.reviewer@civicnest.app", name: "Nusrat Jahan (Member reviewer)", role: "member", points: 310 },
];

async function upsertFirebaseUser({ email, name }) {
  try {
    const existing = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(existing.uid, { password: PASSWORD, displayName: name, emailVerified: true, disabled: false });
    return existing.uid;
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    const created = await admin.auth().createUser({ email, password: PASSWORD, displayName: name, emailVerified: true });
    return created.uid;
  }
}

async function upsertDbUser({ email, name, role, points }) {
  const existing = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  const data = { name, role, isDemo: true, points };
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data, select: { id: true } });
  } else {
    await prisma.user.create({
      data: {
        email,
        ...data,
        isVolunteer: role !== "member",
        issueCredits: 3,
        creditRegenTimestamps: [],
        streak: { current: 0, best: 0 },
      },
      select: { id: true },
    });
  }
}

(async () => {
  if (!admin.apps.length) {
    console.error("Firebase Admin isn't configured. Set FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY (or FIREBASE_SERVICE_ACCOUNT).");
    process.exit(1);
  }
  for (const reviewer of REVIEWERS) {
    await upsertFirebaseUser(reviewer);
    await upsertDbUser(reviewer);
    console.log(`✔ ${reviewer.role.padEnd(9)} ${reviewer.email}`);
  }
  console.log(`\nPassword for all three: ${PASSWORD}`);
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error("Seeding reviewers failed:", err.message);
  await prisma.$disconnect();
  process.exit(1);
});
