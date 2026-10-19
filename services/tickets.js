/**
 * services/tickets.js
 * Every issue report gets a ticket (CN-<year>-<6 digits>) that tracks its
 * status, priority, assignee, SLA and history. Tickets live in the `tickets`
 * collection and are managed through Prisma.
 */
const { prisma } = require("../lib/prisma");

// Issue status (Mongoose model) -> ticket status
const STATUS_FROM_ISSUE = {
  open: "OPEN",
  pending: "OPEN",
  in_review: "TRIAGED",
  action_taken: "IN_PROGRESS",
  pending_verification: "IN_PROGRESS",
  solved: "RESOLVED",
  rejected: "REJECTED",
};
const PRIORITY_FROM_URGENCY = { low: "LOW", medium: "NORMAL", high: "HIGH", emergency: "URGENT" };
const SLA_HOURS = { URGENT: 24, HIGH: 72, NORMAL: 24 * 7, LOW: 24 * 14 };

const TICKET_STATUSES = ["OPEN", "TRIAGED", "IN_PROGRESS", "RESOLVED", "REJECTED"];
const TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

const slaFrom = (priority, from = new Date()) => new Date(from.getTime() + SLA_HOURS[priority] * 3600 * 1000);
const formatCode = (number, year) => `CN-${year}-${String(number).padStart(6, "0")}`;

/** Next ticket number, atomically (findAndModify with upsert on counters/_id "ticket") */
async function nextTicketNumber() {
  const res = await prisma.$runCommandRaw({
    findAndModify: "counters",
    query: { _id: "ticket" },
    update: { $inc: { seq: 1 } },
    upsert: true,
    new: true,
  });
  const seq = res?.value?.seq;
  // Raw results can come back as extended JSON ({ $numberInt: "5" })
  const n = Number(typeof seq === "object" && seq !== null ? seq.$numberInt ?? seq.$numberLong ?? seq.$numberDouble : seq);
  if (!Number.isFinite(n) || n < 1) throw new Error("Could not allocate a ticket number");
  return n;
}

/**
 * Create the ticket for an issue (idempotent: returns the existing one if the
 * issue already has a ticket). `issue` is a Mongoose doc or plain object.
 */
async function createTicketForIssue(issue, { by } = {}) {
  const issueId = String(issue._id);
  const existing = await prisma.ticket.findUnique({ where: { issueId } });
  if (existing) return existing;

  const createdAt = issue.submittedAt ? new Date(issue.submittedAt) : new Date();
  const number = await nextTicketNumber();
  const priority = PRIORITY_FROM_URGENCY[issue.urgency] || "NORMAL";
  const status = STATUS_FROM_ISSUE[issue.status] || "OPEN";

  try {
    return await prisma.ticket.create({
      data: {
        code: formatCode(number, createdAt.getFullYear()),
        number,
        issueId,
        title: String(issue.title || "Untitled report").slice(0, 200),
        category: issue.category || null,
        area: issue.area || null,
        reporterEmail: issue.submittedBy?.email || null,
        status,
        priority,
        slaDueAt: slaFrom(priority, createdAt),
        resolvedAt: status === "RESOLVED" ? issue.resolvedAt || new Date() : null,
        events: [{ type: "created", to: status, by: by || issue.submittedBy?.email || null }],
        createdAt,
      },
    });
  } catch (err) {
    // Another request created it first (unique issueId): return that one
    if (err?.code === "P2002") return prisma.ticket.findUnique({ where: { issueId } });
    throw err;
  }
}

/** Keep the ticket in step with an issue status change */
async function syncTicketStatus(issueId, issueStatus, { by, note } = {}) {
  const to = STATUS_FROM_ISSUE[issueStatus];
  if (!to) return null;
  const ticket = await prisma.ticket.findUnique({ where: { issueId: String(issueId) } });
  if (!ticket || ticket.status === to) return ticket;
  return prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      status: to,
      resolvedAt: to === "RESOLVED" ? new Date() : null,
      events: { push: { type: "status", from: ticket.status, to, by: by || null, note: note || null } },
    },
  });
}

/** A report accepted by staff moves from OPEN to TRIAGED */
async function markTriaged(issueId, by) {
  const ticket = await prisma.ticket.findUnique({ where: { issueId: String(issueId) } });
  if (!ticket || ticket.status !== "OPEN") return ticket;
  return prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: "TRIAGED", events: { push: { type: "status", from: "OPEN", to: "TRIAGED", by: by || null, note: "Report approved" } } },
  });
}

/**
 * Fire-and-forget wrapper: ticket bookkeeping must never fail the request that
 * changed the issue, so errors are logged instead of thrown.
 */
const safely = (label, fn) =>
  Promise.resolve()
    .then(fn)
    .catch((err) => console.error(`[tickets] ${label} failed:`, err.message));

/** Staff update of priority / assignee / note on a ticket */
async function updateTicket(code, { priority, assigneeEmail, note, status }, by) {
  const ticket = await prisma.ticket.findUnique({ where: { code } });
  if (!ticket) return null;
  const data = {};
  const events = [];
  if (status && status !== ticket.status) {
    data.status = status;
    data.resolvedAt = status === "RESOLVED" ? new Date() : null;
    events.push({ type: "status", from: ticket.status, to: status, by });
  }
  if (priority && priority !== ticket.priority) {
    data.priority = priority;
    data.slaDueAt = slaFrom(priority, ticket.createdAt);
    events.push({ type: "priority", from: ticket.priority, to: priority, by });
  }
  if (assigneeEmail !== undefined && assigneeEmail !== ticket.assigneeEmail) {
    data.assigneeEmail = assigneeEmail || null;
    events.push({ type: "assigned", from: ticket.assigneeEmail || null, to: assigneeEmail || null, by });
  }
  if (note) events.push({ type: "note", note: String(note).slice(0, 1000), by });
  if (!events.length) return ticket;
  return prisma.ticket.update({ where: { id: ticket.id }, data: { ...data, events: { push: events } } });
}

/**
 * Give every existing issue without a ticket one, oldest first, and copy the
 * code onto the issue document. Safe to run on every start.
 */
async function backfillTickets(issuesCollection, { log = console } = {}) {
  const cursor = issuesCollection.find({ ticketCode: { $exists: false } }).sort({ submittedAt: 1, _id: 1 });
  let created = 0;
  for await (const issue of cursor) {
    const ticket = await createTicketForIssue(issue, { by: "system" });
    await issuesCollection.updateOne({ _id: issue._id }, { $set: { ticketCode: ticket.code } });
    created += 1;
  }
  if (created) log.log(`[tickets] Backfilled ${created} ticket(s)`);
  return created;
}

module.exports = {
  createTicketForIssue,
  syncTicketStatus,
  markTriaged,
  safely,
  updateTicket,
  backfillTickets,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  STATUS_FROM_ISSUE,
};
