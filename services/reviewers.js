/**
 * Reviewer demo accounts, one per role. Used by `npm run seed:reviewers` and
 * by the admin dashboard's "Set up reviewer logins" button, so both create the
 * accounts the same way.
 *
 * Re-running resets the passwords, names and roles; nothing else is touched.
 * Demo accounts are flagged `isDemo`, which blocks role changes on them.
 */
const admin = require("../config/firebase");

const REVIEWER_PASSWORD = process.env.REVIEWER_PASSWORD || "CivicNest@2026";

const REVIEWERS = [
  { email: "admin.reviewer@civicnest.app", name: "Ayesha Rahman (Admin reviewer)", role: "admin", points: 1480 },
  { email: "moderator.reviewer@civicnest.app", name: "Tanvir Hasan (Moderator reviewer)", role: "moderator", points: 920 },
  { email: "member.reviewer@civicnest.app", name: "Nusrat Jahan (Member reviewer)", role: "member", points: 310 },
];

async function upsertFirebaseUser({ email, name }, password) {
  try {
    const existing = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(existing.uid, { password, displayName: name, emailVerified: true, disabled: false });
    return existing.uid;
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    const created = await admin.auth().createUser({ email, password, displayName: name, emailVerified: true });
    return created.uid;
  }
}

async function upsertDbUser(users, { email, name, role, points }, uid) {
  await users.updateOne(
    { email },
    {
      $set: { name, role, isDemo: true, points, uid },
      $setOnInsert: {
        email,
        isVolunteer: role !== "member",
        issueCredits: 3,
        creditRegenTimestamps: [],
        streak: { current: 0, best: 0, lastActiveDate: null },
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
}

/**
 * Create or reset every reviewer account.
 * @param users the MongoDB `users` collection
 * @returns [{ email, role }] for the accounts that are ready
 */
async function seedReviewers(users, password = REVIEWER_PASSWORD) {
  if (!admin.apps.length) {
    throw new Error("Firebase Admin isn't configured on this server, so reviewer accounts can't be created.");
  }
  const ready = [];
  for (const reviewer of REVIEWERS) {
    const uid = await upsertFirebaseUser(reviewer, password);
    await upsertDbUser(users, reviewer, uid);
    ready.push({ email: reviewer.email, role: reviewer.role });
  }
  return ready;
}

module.exports = { REVIEWERS, REVIEWER_PASSWORD, seedReviewers };
