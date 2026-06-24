const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { connectDB, getCollection } = require('../config/db');

async function run() {
  const db = await connectDB();
  const pendingTransactionsCol = getCollection('pendingtransactions') || db.collection('pendingtransactions');
  const contributionsCol = getCollection('contributions') || db.collection('contributions');
  const cleanupeventsCol = getCollection('cleanupevents') || db.collection('cleanupevents');
  const animalsCol = getCollection('animals') || db.collection('animals');
  const ngosCol = getCollection('ngos') || db.collection('ngos');

  console.log('\n=== LATEST PENDING/SUCCESS TRANSACTIONS ===');
  const transactions = await pendingTransactionsCol.find({}).sort({ createdAt: -1 }).limit(10).toArray();
  if (transactions.length === 0) {
    console.log('No transactions found.');
  } else {
    transactions.forEach(t => {
      console.log(`- ID: ${t._id} | Tran_ID: ${t.tran_id} | Status: ${t.status} | Gateway: ${t.gateway} | Amount: ${t.amount} | Type: ${t.donationType} | Ref: ${t.referenceId} | User: ${t.userId}`);
    });
  }

  console.log('\n=== LATEST CONTRIBUTIONS IN DB ===');
  const contributions = await contributionsCol.find({}).sort({ date: -1 }).limit(10).toArray();
  if (contributions.length === 0) {
    console.log('No contributions found.');
  } else {
    contributions.forEach(c => {
      console.log(`- ID: ${c._id} | Amount: ${c.amount} | Email: ${c.email} | Date: ${c.date} | Ref IDs: NGO=${c.ngoId || 'N/A'}, Event=${c.eventId || 'N/A'}, Animal=${c.animalId || 'N/A'}`);
    });
  }

  console.log('\n=== INTEGRITY CHECK FOR ACTIVE DONATION ENTITIES ===');
  for (const t of transactions) {
    if (t.status === 'success') {
      let entity = null;
      if (t.donationType === 'animal') {
        entity = await animalsCol.findOne({ _id: t.referenceId });
      } else if (t.donationType === 'event') {
        entity = await cleanupeventsCol.findOne({ _id: t.referenceId });
      } else if (t.donationType === 'ngo') {
        entity = await ngosCol.findOne({ _id: t.referenceId });
      }
      console.log(`- Transaction ${t.tran_id} (${t.donationType}): Target entity exists in DB? ${entity ? 'YES' : 'NO'} (${entity ? (entity.title || entity.name || entity.animalType) : 'N/A'})`);
    }
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
