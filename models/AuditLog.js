const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  action: { 
    type: String, 
    enum: [
      'APPROVE_ISSUE', 'REJECT_ISSUE', 'CHANGE_STATUS', 'DELETE_COMMENT', 
      'REVEAL_IDENTITY', 'CHANGE_USER_ROLE', 'SUBMISSION_DISMISSED',
      'ANNOUNCEMENT_CREATED', 'ANNOUNCEMENT_DELETED'
    ],
    required: true 
  },
  targetType: { 
    type: String, 
    enum: ['issue', 'comment', 'user', 'lostfound', 'announcement'],
    required: true
  },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  performedBy: {
    adminEmail: { type: String, required: true },
    adminName: { type: String, required: true },
    adminId: { type: String, required: true }
  },
  detail: { type: String, required: true },
  previousValue: { type: String },
  newValue: { type: String },
  timestamp: { type: Date, default: Date.now },
  ipAddress: { type: String }
});

module.exports = mongoose.model("AuditLog", auditLogSchema);
