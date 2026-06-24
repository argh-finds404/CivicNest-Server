const AuditLog = require('../models/AuditLog');

const logAudit = async ({ performedBy, action, targetId, targetType, oldValue, newValue, note, ipAddress }) => {
  try {
    await AuditLog.create({
      action,
      targetType,
      targetId,
      performedBy, // { email, name, role }
      previousValue: oldValue,
      newValue,
      detail: note,
      ipAddress,
      timestamp: new Date()
    });
  } catch (error) {
    console.error("Audit Log Error:", error);
    // Do NOT throw. Audit failure should not break main flow.
  }
};

module.exports = { logAudit };
