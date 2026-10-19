const AuditLog = require('../models/AuditLog');

const asText = (v) => (v === undefined || v === null ? undefined : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * Record a staff action. Accepts performedBy as { email, name, role } (or the
 * older { adminEmail, adminName }). Pass `actorRole` (req.user.role) so
 * moderator actions aren't recorded as admin ones.
 */
const logAudit = async ({ performedBy = {}, actorRole, action, targetId, targetType, oldValue, newValue, previousValue, note, detail, ipAddress }) => {
  try {
    await AuditLog.create({
      action,
      targetType,
      targetId,
      performedBy: {
        email: performedBy.email || performedBy.adminEmail,
        name: performedBy.name || performedBy.adminName,
        role: actorRole || performedBy.role,
      },
      previousValue: asText(previousValue ?? oldValue),
      newValue: asText(newValue),
      detail: note || detail,
      ipAddress,
      timestamp: new Date()
    });
  } catch (error) {
    console.error("Audit Log Error:", error.message);
    // Do NOT throw. Audit failure should not break main flow.
  }
};

module.exports = { logAudit };
