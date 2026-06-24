const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema({
  issueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Issue', required: true },
  parentCommentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  userEmail: { type: String, required: true },
  userAvatar: { type: String, required: true },
  memberId: { type: String },
  body: { type: String, required: true, maxlength: 1000 },
  isAnonymousPost: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  editedAt: { type: Date, default: null },
  editWindow: { type: Date }, // computed on save: createdAt + 15 mins
  isDeleted: { type: Boolean, default: false },
  deletedBy: { type: String, default: null },
  deletedAt: { type: Date, default: null },
  flaggedBy: { type: [String], default: [] },
  isHidden: { type: Boolean, default: false },
  likes: { type: [String], default: [] }
});

commentSchema.pre('save', function() {
  if (this.isNew) {
    this.editWindow = new Date(this.createdAt.getTime() + 15 * 60000);
  }
});

module.exports = mongoose.model("Comment", commentSchema);
