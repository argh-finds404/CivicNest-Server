const mongoose = require("mongoose");

const issueSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    minlength: 10,
    maxlength: 120,
    validate: {
      validator: function(v) {
        return v !== v.toUpperCase();
      },
      message: "Title must not be all-caps"
    }
  },
  description: {
    type: String,
    required: true,
    minlength: 30,
    maxlength: 2000
  },
  category: {
    type: String,
    required: true
  },
  customFlair: {
    type: String,
    default: null,
    validate: {
      validator: function(v) {
        if (!v) return true;
        const wordCount = v.trim().split(/\s+/).length;
        return wordCount >= 1 && wordCount <= 7;
      },
      message: "Custom flair must be 1 to 7 words"
    }
  },
  location: { type: String, required: true },
  area: { type: String, required: true },
  coordinates: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null }
  },
  images: {
    type: [String],
    required: true,
    validate: [v => v.length > 0 && v.length <= 5, 'Must have 1 to 5 images']
  },
  incidentDate: {
    type: Date,
    required: true,
    validate: {
      validator: function(v) {
        const now = new Date();
        const past90 = new Date();
        past90.setDate(now.getDate() - 90);
        return v <= now && v >= past90;
      },
      message: "Date cannot be in the future or older than 90 days"
    }
  },
  submittedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  submittedBy: {
    userId: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    memberId: String,
    photoURL: String
  },
  isAnonymous: { type: Boolean, default: false },
  isPremiumFeature: { type: Boolean, default: false },
  
  approvalStatus: { type: String, enum: ['pending_review', 'approved', 'rejected'], default: 'pending_review' },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: String, default: null },
  rejectedAt: { type: Date, default: null },
  rejectedBy: { type: String, default: null },
  rejectReason: { type: String, default: null },
  adminNote: { type: String, default: null }, // Never returned to public
  resolvedAt: { type: Date, default: null },
  
  status: { type: String, enum: ['open', 'pending', 'in_review', 'action_taken', 'solved', 'rejected'], default: 'open' },
  statusChangedAt: { type: Date, default: Date.now },
  statusChangedBy: String,
  
  upvotes: { type: [String], default: [] },
  downvotes: { type: [String], default: [] },
  netScore: { type: Number, default: 0 },
  commentCount: { type: Number, default: 0 },
  
  witnesses: { type: [String], default: [] }, // Array of userIds who witnessed this
  witnessDetails: {
    type: [{
      userId: String,
      photoURL: String,
      name: String
    }],
    default: []
  },
  witnessCount: { type: Number, default: 0 },
  verifications: { type: [String], default: [] }, // Array of userIds who verified the resolution
  verificationCount: { type: Number, default: 0 },
  
  assignedTo: {
    email: { type: String, default: null },
    name:  { type: String, default: null },
    type:  { type: String, enum: ['volunteer', 'provider', 'ngo', 'admin'], default: null },
    assignedAt: { type: Date, default: null },
    deadline: { type: Date, default: null },
    adminNote: { type: String, default: null }
  },
  
  resolutionProofs: [{
    uploadedBy: String,
    uploadedAt: { type: Date, default: Date.now },
    images: [String],
    notes: String,
    gpsMatch: { type: String, enum: ['high', 'medium', 'low', 'skipped', null], default: null },
    milestoneNo: { type: Number, default: 1 }
  }],
  
  crowdfunding: {
    enabled: { type: Boolean, default: false },
    targetAmount: { type: Number, default: null, min: 100, max: 500000 },
    purpose: { type: String, default: null, maxlength: 200 },
    raisedAmount: { type: Number, default: 0 },
    escrowStatus: { type: String, enum: ['holding', 'released', 'refunded'], default: 'holding' },
    releasedAt: { type: Date, default: null }
  },
  urgency: { type: String, enum: ['low', 'medium', 'high', 'emergency'], default: 'low' },
  spamFlags: { type: [String], default: [] },
  isHidden: { type: Boolean, default: false },
  
  editHistory: [{
    editedAt: Date,
    editedBy: String,
    fieldsChanged: [String],
    previousValues: mongoose.Schema.Types.Mixed
  }],
  identityRevealLog: [{
    revealedBy: String,
    revealedAt: Date
  }]
}, {
  timestamps: { createdAt: 'submittedAt', updatedAt: 'updatedAt' }
});

issueSchema.index({ approvalStatus: 1, status: 1 });

issueSchema.methods.toPublic = function() {
  const obj = this.toObject();
  delete obj.adminNote;
  delete obj.spamFlags;
  
  if (obj.isAnonymous && obj.submittedBy) {
    obj.submittedBy.email = undefined;
    obj.submittedBy.memberId = undefined;
    obj.submittedBy.name = 'Anonymous Member';
    obj.submittedBy.photoURL = '';
  }
  return obj;
};

module.exports = mongoose.model("Issue", issueSchema);
