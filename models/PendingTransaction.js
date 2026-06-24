const mongoose = require('mongoose');

const pendingTransactionSchema = new mongoose.Schema({
  tran_id: { type: String, required: true, unique: true },
  gateway: { type: String, required: true, enum: ['stripe', 'sslcommerz'] },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'BDT' },
  donationType: { type: String, required: true, enum: ['animal', 'event', 'ngo', 'community'] },
  referenceId: { type: mongoose.Schema.Types.ObjectId, required: false },
  userId: { type: String, required: true },
  status: { type: String, default: 'pending', enum: ['pending', 'success', 'failed', 'cancelled'] },
}, { timestamps: true });

module.exports = mongoose.model('PendingTransaction', pendingTransactionSchema);
