const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { prisma } = require("../lib/prisma");
const { verifyToken } = require("../middleware/auth");
const { adminOrMod } = require("../middleware/adminOrMod");
const { getCollection } = require("../config/db");
const { isStaff } = require("../utils/roles");
const { updateTicket, TICKET_STATUSES, TICKET_PRIORITIES } = require("../services/tickets");

const DAY = 24 * 60 * 60 * 1000;
const CODE_RE = /^CN-\d{4}-\d{6}$/;

// GET /tickets/mine — tickets for reports I filed
router.get("/mine", verifyToken, async (req, res) => {
  const tickets = await prisma.ticket.findMany({
    where: { reporterEmail: req.user.email },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ tickets });
});

// GET /tickets — staff queue with filters: ?status=OPEN&priority=HIGH&q=drain&page=1
router.get("/", verifyToken, adminOrMod, async (req, res) => {
  const { status, priority, q, assignee } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));

  const where = {};
  if (status && TICKET_STATUSES.includes(status)) where.status = status;
  if (priority && TICKET_PRIORITIES.includes(priority)) where.priority = priority;
  if (assignee === "me") where.assigneeEmail = req.user.email;
  if (q) {
    const term = String(q).slice(0, 80);
    where.OR = [
      { code: { contains: term, mode: "insensitive" } },
      { title: { contains: term, mode: "insensitive" } },
      { area: { contains: term, mode: "insensitive" } },
    ];
  }

  const [tickets, total, counts] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: [{ slaDueAt: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.ticket.count({ where }),
    prisma.ticket.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  res.json({
    tickets,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    byStatus: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  });
});

// GET /tickets/:code — reporter, assignee or staff
router.get("/:code", verifyToken, async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!CODE_RE.test(code)) return res.status(400).json({ error: "Ticket codes look like CN-2026-000123." });

  const ticket = await prisma.ticket.findUnique({ where: { code } });
  if (!ticket) return res.status(404).json({ error: "No ticket with that code." });

  const allowed =
    isStaff(req.user.role) || ticket.reporterEmail === req.user.email || ticket.assigneeEmail === req.user.email;
  if (!allowed) return res.status(403).json({ error: "Only the reporter, the assignee or staff can view this ticket." });

  res.json({ ticket });
});

// PATCH /tickets/:code — staff: { status?, priority?, assigneeEmail?, note? }
router.patch("/:code", verifyToken, adminOrMod, async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const { status, priority, assigneeEmail, note } = req.body || {};

  if (status && !TICKET_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${TICKET_STATUSES.join(", ")}` });
  }
  if (priority && !TICKET_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of ${TICKET_PRIORITIES.join(", ")}` });
  }
  if (assigneeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(assigneeEmail)) {
    return res.status(400).json({ error: "assigneeEmail must be an email address" });
  }

  const existing = await prisma.ticket.findUnique({ where: { code }, select: { issueId: true, assigneeEmail: true } });
  if (!existing) return res.status(404).json({ error: "No ticket with that code." });
  const issues = getCollection("issues");
  const issue = await issues.findOne({ _id: new ObjectId(existing.issueId) });

  // Work out what the issue itself should become, so it never lands in a state
  // nobody can move on from (e.g. "in progress" with no one assigned)
  let issueUpdate = null;
  const stamp = { statusChangedAt: new Date(), statusChangedBy: req.user.email };
  if (status && issue) {
    const assignee = assigneeEmail || issue.assignedTo?.email || existing.assigneeEmail;
    if (status === "IN_PROGRESS") {
      if (!assignee) {
        return res.status(400).json({ error: "Assign someone before marking this ticket in progress." });
      }
      issueUpdate = { $set: { ...stamp, status: "action_taken" } };
      if (!issue.assignedTo?.email) {
        issueUpdate.$set.assignedTo = { email: assignee, name: assignee.split("@")[0], type: "admin", assignedAt: new Date(), deadline: new Date(Date.now() + 7 * DAY), adminNote: null };
      }
    } else if (status === "OPEN") {
      // Back in the pool: anyone can claim it again
      issueUpdate = { $set: { ...stamp, status: "open", assignedTo: { email: null, name: null, type: null, assignedAt: null, deadline: null, adminNote: null } } };
    } else if (status === "TRIAGED") {
      // Accepted: approved and open for a volunteer to claim
      if (issue.approvalStatus === "pending_review") {
        return res.status(400).json({ error: "Approve this report from the issue queue first." });
      }
      issueUpdate = { $set: { ...stamp, status: issue.assignedTo?.email ? "action_taken" : "open" } };
    } else if (status === "RESOLVED") {
      issueUpdate = { $set: { ...stamp, status: "solved", resolvedAt: new Date() } };
    } else if (status === "REJECTED") {
      issueUpdate = { $set: { ...stamp, status: "rejected", approvalStatus: "rejected", rejectedAt: new Date(), rejectedBy: req.user.email } };
    }
  }

  const ticket = await updateTicket(code, { status, priority, assigneeEmail, note }, req.user.email);
  if (!ticket) return res.status(404).json({ error: "No ticket with that code." });

  if (issueUpdate) {
    await issues.updateOne({ _id: issue._id }, issueUpdate);
    const newStatus = issueUpdate.$set.status;
    const io = req.app.get("io");
    if (io) io.emit("issueStatusUpdated", { issueId: ticket.issueId, status: newStatus });
    if (status === "RESOLVED" && issue.submittedBy?.email) {
      try {
        const { createNotification } = require("../utils/notificationHelper");
        await createNotification({ userId: issue.submittedBy.userId, email: issue.submittedBy.email, message: `Good news: "${issue.title}" has been marked resolved.`, type: "info", link: `/tickets/${code}` });
      } catch (err) {
        console.error("[tickets] resolve notification failed:", err.message);
      }
    }
  }

  res.json({ ticket });
});

module.exports = router;
