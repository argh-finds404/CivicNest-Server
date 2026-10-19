/**
 * Roles, lowest to highest:
 *   guest      signed up, not yet a verified resident
 *   member     verified resident: can post, vote, organise
 *   moderator  member + day-to-day moderation: issue queue triage, forum,
 *              reported posts, cleanup events, polls, rescue / lost & found
 *              checks. Cannot manage users, approve residency, volunteers or
 *              NGOs, see donations, or reveal anonymous reporters.
 *   admin      everything
 */
const ROLES = ["guest", "member", "moderator", "admin"];
const RANK = { guest: 0, member: 1, moderator: 2, admin: 3 };

const isValidRole = (role) => ROLES.includes(role);
const atLeast = (role, min) => (RANK[role] ?? 0) >= RANK[min];
const isStaff = (role) => atLeast(role, "moderator");

module.exports = { ROLES, RANK, isValidRole, atLeast, isStaff };
