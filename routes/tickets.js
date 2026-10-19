const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { prisma } = require("../lib/prisma");
const { verifyToken } = require("../middleware/auth");
const { adminOrMod } = require("../middleware/adminOrMod");
const { getCollection } = require("../config/db");
const { isStaff } = require("../utils/roles");
const { updateTicket, TICKET_STATUSES, TICKET_PRIORITIES } = require("../services/tickets");

const ISSUE_STATUS_FROM_TICKET = {
  OPEN: "open",
  TRIAGED: "in_review",
  IN_PROGRESS: "action_taken",
  RESOLVED: "solved",
  REJECTED: "rejected",
};
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

  const ticket = await updateTicket(code, { status, priority, assigneeEmail, note }, req.user.email);
  if (!ticket) return res.status(404).json({ error: "No ticket with that code." });

  // Keep the issue's own status in step with the ticket
  if (status) {
    await getCollection("issues").updateOne(
      { _id: new ObjectId(ticket.issueId) },
      { $set: { status: ISSUE_STATUS_FROM_TICKET[status], statusChangedAt: new Date(), statusChangedBy: req.user.email } }
    );
    const io = req.app.get("io");
    if (io) io.emit("issueStatusUpdated", { issueId: ticket.issueId, status: ISSUE_STATUS_FROM_TICKET[status] });
  }

  res.json({ ticket });
});

module.exports = router;
