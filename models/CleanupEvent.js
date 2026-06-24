const mongoose = require('mongoose');

const AttendeeSchema = new mongoose.Schema({
  email:    { type: String, required: true },
  name:     { type: String },
  photoURL: { type: String },
  joinedAt: { type: Date, default: Date.now },
  status:   {
    type: String,
    enum: ['going', 'attended', 'no-show'],
    default: 'going',
  },
  checkedIn:    { type: Boolean, default: false },
  checkedInAt:  { type: Date,    default: null },
  gpsConfidence: { type: String, enum: ['high', 'medium', 'low', 'none'], default: 'none' },
}, { _id: false });

const CleanupEventSchema = new mongoose.Schema({

  // ── Core Content ──────────────────────────────────────────
  title:       { type: String, required: true, trim: true },
  slug:        { type: String, unique: true },              // auto-generated
  slogan:      { type: String, maxlength: 120 },            // short tagline e.g. "Let's make Mirpur green again!"
  description: { type: String, required: true },

  // ── Media ─────────────────────────────────────────────────
  coverImages: [{ type: String }],                          // up to 3 imgbb URLs
  postEventPhotos: [{ type: String }],                      // uploaded after event completes

  // ── Timing ────────────────────────────────────────────────
  eventDate:    { type: Date, required: true },
  eventTime:    { type: String, required: true },           // "10:00 AM"
  durationHours: { type: Number, default: 3 },              // estimated duration

  // ── Location ──────────────────────────────────────────────
  location: {
    address:     { type: String, required: true },
    area:        { type: String },
    coordinates: {
      type: [Number],                                       // [longitude, latitude]
      index: '2dsphere',
    },
  },

  // ── Organizer ─────────────────────────────────────────────
  organizer: {
    email:    { type: String, required: true },
    name:     { type: String },
    photoURL: { type: String },
  },

  // ── Participation ─────────────────────────────────────────
  maxVolunteers: { type: Number, default: 0 },              // 0 = unlimited
  interested:    [{ type: String }],                        // array of emails
  interestedCount: { type: Number, default: 0 },
  going:         [AttendeeSchema],
  goingCount:    { type: Number, default: 0 },

  // ── Logistics ─────────────────────────────────────────────
  requiredSkills:  [{ type: String }],                      // 'Physical Work', 'Photography', 'First Aid', etc.
  suppliesNeeded:  [{ type: String }],                      // 'Gloves', 'Bags', 'Water'
  meetingInstructions: { type: String },                    // "Meet at the mosque gate"

  // ── Funding ───────────────────────────────────────────────
  fundingEnabled: { type: Boolean, default: false },
  fundingGoal:    { type: Number, default: 0 },             // BDT target
  fundingRaised:  { type: Number, default: 0 },             // incremented on contribution

  // ── Moderation (same pattern as issues) ───────────────────
  approvalStatus: {
    type: String,
    enum: ['pending_review', 'approved', 'rejected'],
    default: 'pending_review',
    index: true,
  },
  approvedBy:   { type: String, default: null },
  rejectedBy:   { type: String, default: null },
  rejectReason: { type: String, default: null },

  // ── Status ────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['upcoming', 'ongoing', 'completed', 'cancelled'],
    default: 'upcoming',
    index: true,
  },

  // ── Gamification ──────────────────────────────────────────
  pointsAwarded: { type: Boolean, default: false },         // prevent double-awarding
  reminderSent:  { type: Boolean, default: false },         // prevents duplicate 24h notifications

  // ── Cancellation ──────────────────────────────────────────
  cancelReason:  { type: String, default: null },

  // ── Check-in ──────────────────────────────────────────────
  checkinCode:            { type: String, default: null },
  checkinCodeGeneratedAt: { type: Date,   default: null },

}, { timestamps: true });

// Auto-generate slug from title
CleanupEventSchema.pre('save', function() {
  if (this.isNew || this.isModified('title')) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      + '-' + Date.now().toString(36);
  }
});


CleanupEventSchema.index({ approvalStatus: 1, status: 1, eventDate: 1 });
CleanupEventSchema.index({ 'organizer.email': 1 });

module.exports = mongoose.model('CleanupEvent', CleanupEventSchema);
