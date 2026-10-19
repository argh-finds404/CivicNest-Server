const mongoose = require("mongoose");

// Who did what to which record. Written by utils/auditHelper.logAudit for staff
// (admin and moderator) actions; never blocks the action itself.
const auditLogSchema = new mongoose.Schema({
  // e.g. APPROVE_ISSUE, CHANGE_STATUS, CHANGE_USER_ROLE, CLEANUP_EVENT_REJECTED
  action: { type: String, required: true, index: true },
  // e.g. issue, comment, user, lostfound, announcement, cleanup_event
  targetType: { type: String, required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  performedBy: {
    email: { type: String, required: true, index: true },
    name: { type: String },
    role: { type: String }, // admin | moderator
  },
  detail: { type: String },
  previousValue: { type: String },
  newValue: { type: String },
  timestamp: { type: Date, default: Date.now, index: true },
  ipAddress: { type: String },
});

module.exports = mongoose.model("AuditLog", auditLogSchema);
